/**
 * 所有会花钱的操作都拆成 plan / commit 两步。
 *
 * 原因是答题机制：玩家点下按钮时先把「要花多少、能得到什么」算出来（plan），
 * 答对才 commit。答错时普通难度什么都不做，地狱难度按 plan.cost 扣钱。
 * 这样惩罚金额与界面上显示的数字永远一致，不会被这期间跳动的银两影响。
 */

/* ────────────────────────────── 纪事 ────────────────────────────── */

/**
 * 写入一条族谱纪事。
 * 若与上一条同 key，则合并计数，避免连点刷屏。
 */
function pushLog(state, text, kind = 'info', key = null, now = Date.now()) {
  const head = state.log[0];
  if (key && head && head.key === key && now - head.at < 4000) {
    head.text = text;
    head.at = now;
    head.repeat = (head.repeat || 1) + 1;
    return;
  }
  state.log.unshift({ text, kind, key, at: now, repeat: 1 });
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
}

/* ────────────────────────────── 答错的惩罚 ────────────────────────────── */

/**
 * 地狱难度下答错的惩罚：材料概不退还。
 * 代价可能是银两，也可能是灵石（看操作本身花的是什么）。
 * @returns {number} 实际损失掉的数量
 */
function applyPenalty(state, plan, now = Date.now()) {
  const cost = typeof plan === 'number' ? plan : (plan?.cost || 0);
  const currency = typeof plan === 'number' ? 'silver' : (plan?.currency || 'silver');

  if (currency === 'stones') {
    const lost = Math.max(0, Math.min(state.spiritStones, cost));
    if (lost > 0) {
      state.spiritStones -= lost;
      state.quiz.lostStones += lost;
    }
    return lost;
  }

  const lost = Math.max(0, Math.min(state.silver, cost));
  if (lost > 0) {
    state.silver -= lost;
    state.quiz.lost += lost;
    state.stats.silverWasted += lost;
  }
  return lost;
}

/**
 * 记下一条秘闻。抽到过的不会重复抽，抽完为止。
 *
 * 【策划 T-0 / docs/91-落地任务清单.md §三 T-0 验收标准 2】
 * **池空不再等于「线索断供」**：线索是能不能突破大境界的硬通货，
 * 而 SECRETS 只有 20 条、四道门槛要 28 条 —— 池子抽干之后必须还能继续产线索，
 * 否则「修为满了、丹药有了、灵石够了，就是没有线索」会变成一个死局。
 * 所以这里在 `return null` **之前**先把线索加上，池空时依然返回 null（调用方靠它判重）。
 *
 * @returns {number|null} 秘闻下标；池子已空时返回 null（但线索照加）
 */
function grantSecret(state, now = Date.now(), rng = Math.random) {
  const pool = SECRETS.map((_, i) => i).filter((i) => !state.secrets.includes(i));
  if (!pool.length) {
    if (state.cultivation) state.cultivation.clues = (state.cultivation.clues || 0) + 1;
    return null;
  }

  const idx = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  state.secrets.push(idx);
  if(state.cultivation) state.cultivation.clues=(state.cultivation.clues||0)+1;

  const total = state.secrets.length;
  if (total === SECRET_UNLOCK) {
    pushLog(state, `秘闻已集 ${SECRET_UNLOCK} 条，云深谷坊市的路，摸到了。`, 'unlock', null, now);
  }
  pushLog(state, `得秘闻一条（${total}/${SECRET_UNLOCK}）：${SECRETS[idx]}`, 'secret', null, now);
  return idx;
}

/* ────────────────────────────── 科技 ────────────────────────────── */

/** 计算研习一项科技的代价；不改动状态。 */
function planResearch(state, techId) {
  const tech = TECH_MAP[techId];
  if (!tech) return { ok: false, reason: '并无此术' };
  if (isResearched(state, tech.id)) return { ok: false, reason: '此术已研习' };

  if (!isTechUnlocked(state, tech)) {
    const missing = tech.requires
      // 【修复 用户实机缺陷 ③·拼音泄漏 · 第三落点】原来是 `TECH_MAP[r]?.name || r` ——
      //   与建筑卡/百科同一个病：查不到就回退打印原始 id。
      //   凡人与仙道**共用同一张前置条件表**，所以这里两条线的 id 都可能出现，
      //   一律走 `techLabelOf()`（两条线一起查、查不到给中文「未知科技」）。
      .filter((r) => !isResearched(state, r))
      .map((r) => `「${techLabelOf(r)}」`)
      .join('、');
    return { ok: false, reason: `须先研习 ${missing}` };
  }

  // 有些科技还要先见过世面：集齐秘闻，才够得着修行那道门
  if (tech.requiresSecrets && state.secrets.length < SECRET_UNLOCK) {
    return {
      ok: false,
      reason: `须先集齐 ${SECRET_UNLOCK} 条秘闻（现有 ${state.secrets.length}）`,
    };
  }

  if (state.silver < tech.cost) {
    return { ok: false, reason: `银两不足，需 ${fmt(tech.cost)} 两` };
  }

  return {
    ok: true,
    kind: 'research',
    id: tech.id,
    name: tech.name,
    cost: tech.cost,
    currency: 'silver',
    label: `研习「${tech.name}」`,
  };
}

/** 兑现一次研习。 */
function commitResearch(state, techId, now = Date.now()) {
  const tech = TECH_MAP[techId];
  if (!tech || isResearched(state, tech.id)) return { ok: false, reason: '此术已研习' };
  if (state.silver < tech.cost) return { ok: false, reason: '银两不足' };

  state.silver -= tech.cost;
  state.techs.push(tech.id);

  const gains = techGainText(tech, BUILDING_MAP[tech.unlocksBuilding]?.name);
  pushLog(
    state,
    `研习「${tech.name}」成，耗银 ${fmt(tech.cost)} 两。${gains.join('；')}`,
    'tech',
    null,
    now,
  );

  return { ok: true, tech, cost: tech.cost };
}

/** 一站式研习（不含答题，供测试与内部使用）。 */
function research(state, techId, now = Date.now()) {
  const plan = planResearch(state, techId);
  if (!plan.ok) return plan;
  return commitResearch(state, techId, now);
}

/* ────────────────────── 仙道科技：灵石与银两双付 ────────────────────── */

/**
 * 询价：研习一项仙道科技要什么。不改动状态。
 *
 * 与凡人侧的 planResearch 是两个函数而不是一个带分支的函数，
 * 因为两者的**货币不同**（仙道是灵石 + 银两双付），硬合在一起
 * 会让「界面写的代价」与「实际扣的代价」很容易走偏。
 */
function planImmortalResearch(state, techId) {
  const tech = IMMORTAL_TECH_MAP[techId];
  if (!tech) return { ok: false, reason: '并无此术' };
  if (isImmortalTechResearched(state, techId)) return { ok: false, reason: '此术已研习' };
  const missing = immortalTechMissing(state, tech);
  if (missing.length) return { ok: false, reason: missing[0], missing };
  return {
    ok: true,
    kind: 'immortalResearch',
    id: tech.id,
    name: tech.name,
    cost: tech.cost || 0,
    stones: tech.stones || 0,
    currency: 'stones',
    label: `参悟「${tech.name}」`,
  };
}

/**
 * 兑现一次仙道研习。
 *
 * 注意**扣两样**：灵石与银两。灵石是主门槛，银两是「城里拿得出这笔钱」
 * 的资格线 —— 这条设计本身就是仙凡咬合：仙道再高，也要城供着。
 */
function commitImmortalResearch(state, techId, now = Date.now()) {
  const tech = IMMORTAL_TECH_MAP[techId];
  if (!tech) return { ok: false, reason: '并无此术' };
  const plan = planImmortalResearch(state, techId);
  if (!plan.ok) return plan;

  state.silver -= plan.cost;
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.stones);
  if (!Array.isArray(state.immortalTechs)) state.immortalTechs = [];
  state.immortalTechs.push(tech.id);

  const gains = techGainText(
    tech,
    BUILDING_MAP[tech.unlocksBuilding]?.name,
    ALCHEMY_RECIPE_MAP[tech.unlocksPill]?.name || PILL_MAP[tech.unlocksPill]?.name,
  );
  pushLog(
    state,
    `参悟「${tech.name}」成，耗灵石 ${fmtStones(plan.stones)} 枚、银 ${fmt(plan.cost)} 两。`
      + (gains.length ? `${gains.join('；')}` : ''),
    'tech',
    null,
    now,
  );

  return { ok: true, tech, cost: plan.cost, stones: plan.stones };
}

/** 一站式研习仙道科技（供测试与仿真使用）。 */
function researchImmortal(state, techId, now = Date.now()) {
  const plan = planImmortalResearch(state, techId);
  if (!plan.ok) return plan;
  return commitImmortalResearch(state, techId, now);
}

/** 仙道科技是否已研习（对外的查询口，仿真与界面都用它）。 */
function isImmortalTechResearchedPublic(state, techId) {
  return isImmortalTechResearched(state, techId);
}

/* ────────────────────────────── 购置 ────────────────────────────── */

/** 计算一次购置的代价与规模；不改动状态。 */
function planBuy(state, id, mode = '1') {
  const def = BUILDING_MAP[id];
  if (!def) return { ok: false, reason: '并无此物' };

  if (!isBuildingUnlocked(state, def)) {
    // 【修复 用户实机缺陷 ③·拼音泄漏 · 第三落点】**这就是用户点下建造时看到的那一句**。
    //   原来是 `TECH_MAP[def.tech]?.name || def.tech`：`lingtian`/`xuanhu`/`lingmai`
    //   是**仙道线** id，而 `TECH_MAP` 只有凡人线 ⇒ 查不到 ⇒ `|| def.tech` 打印拼音。
    //   统一走 `techLabelOf()`；那个「回退到原始 id」的写法已从全仓去掉。
    return { ok: false, reason: `须先研习「${techLabelOf(def.tech)}」` };
  }

  const d = derive(state);

  if (def.slots > 0 && d.freeSlots < def.slots) {
    return { ok: false, reason: '建筑容量不足，先购置地产' };
  }

  const count = maxAffordable(state, d, def, mode);
  if (count <= 0) {
    return {
      ok: false,
      reason: `银两不足，需 ${fmt(currentUnitCost(state, d, def))} 两`,
    };
  }

  return {
    ok: true,
    kind: 'buy',
    id,
    name: def.name,
    count,
    cost: batchCost(state, d, def, count),
    currency: 'silver',
    label: count > 1 ? `营造「${def.name}」×${count}` : `营造「${def.name}」`,
  };
}

/** 兑现一次购置（按 plan 时算好的座数，不重算「最大」）。 */
function commitBuy(state, id, count, now = Date.now()) {
  const def = BUILDING_MAP[id];
  if (!def || !(count > 0)) return { ok: false, reason: '并无此物' };

  const cost = batchCost(state, derive(state), def, count);
  if (state.silver < cost) return { ok: false, reason: '银两不足' };

  state.silver -= cost;
  state.buildings[id] = (state.buildings[id] || 0) + count;

  // 纪事里带上「这一步之后变成了什么」——这是侧栏日志的主要用处
  const owned = state.buildings[id];
  const effect = def.effectText(owned, derive(state));
  pushLog(
    state,
    `营造「${def.name}」×${count}，耗银 ${fmt(cost)} 两 → ${effect}`,
    'build',
    `build:${id}`,
    now,
  );

  return { ok: true, count, cost, owned: state.buildings[id] };
}

/** 一站式购置（不含答题，供测试与内部使用）。 */
function buy(state, id, mode = '1', now = Date.now()) {
  const plan = planBuy(state, id, mode);
  if (!plan.ok) return plan;
  return commitBuy(state, id, plan.count, now);
}

/* ────────────────────────────── 出售 ────────────────────────────── */

/**
 * 询价：拆售 count 座能拿回多少银两。不改动状态。
 *
 * 出售**不触发答题**——它是「我建错了，要腾地方」的纠错动作，
 * 在一道题前面再拦一道题只会让人卡住。
 */
function planSell(state, id, count = 1) {
  const def = BUILDING_MAP[id];
  if (!def) return { ok: false, reason: '并无此物' };

  const owned = state.buildings[id] || 0;
  if (owned <= 0) return { ok: false, reason: `尚无「${def.name}」可拆` };

  const d = derive(state);
  const cap = maxSellable(state, d, def);
  if (cap <= 0) {
    return { ok: false, reason: `拆掉「${def.name}」会撑破建筑容量，先拆别的` };
  }

  const k = Math.min(Math.max(1, Math.floor(count)), cap);
  return {
    ok: true,
    kind: 'sell',
    id,
    name: def.name,
    count: k,
    refund: sellRefund(state, d, def, k),
    label: `拆售「${def.name}」×${k}`,
  };
}

/**
 * 兑现一次出售。
 *
 * 返还的银两**不受银两上限约束**：这是把已有资产换回银两，不是新增产出。
 * 如果连这个也截断，玩家在库房满时拆房子会一分钱拿不到，那纯属坑人。
 */
function commitSell(state, id, count = 1, now = Date.now()) {
  const plan = planSell(state, id, count);
  if (!plan.ok) return plan;

  state.buildings[id] -= plan.count;
  state.silver += plan.refund;
  state.stats.silverFromSales += plan.refund;

  // 同样记下「拆完之后剩下什么」
  const def = BUILDING_MAP[id];
  const left = state.buildings[id];
  const effect = left > 0 && def ? ` → ${def.effectText(left, derive(state))}` : ' → 已无存量';
  pushLog(
    state,
    `拆售「${plan.name}」×${plan.count}，回收 ${fmt(plan.refund)} 两（半价）${effect}`,
    'sell',
    `sell:${id}`,
    now,
  );

  return plan;
}

/** 一站式出售（不触发答题）。 */
function sell(state, id, count = 1, now = Date.now()) {
  return commitSell(state, id, count, now);
}

/* ────────────────────── 云深谷坊市：银两换灵石 ────────────────────── */

/**
 * 询价：再兑一笔灵石要多少银两、给多少灵石。不改动状态。
 *
 * ⚠ 兑率是**平价**的（见 core/config.js 的 MARKET_EXCHANGE_*）：
 *   每一笔的银两成本与灵石收益都相同，不随笔数涨价（用户实机裁决：
 *   两种货币体系的兑换不涨价，只有建筑涨价）。限制总量的是
 *   marketExchangeLimit 的**笔数上限**（总量闸门，与定价两码事），
 *   所以「换过几次」本身是一条进度线，而不是可以无限刷的兑换按钮。
 *
 * 灵石那一侧还乘 (1 + tradeStoneMult) ——
 * 这就是**城中科技对兑率的杠杆**（坊市扩建 / 仙凡互市 / 界墟 / 结庐）。
 * 「城越像样，银钱越值灵石」，这句设计话术的全部实现就在这里。
 *
 * @param {number} count 这一次要兑几笔（默认 1）。批量时逐笔累加，
 *                       所以「一次换三笔」与「分三次换」代价完全相同——
 *                       报价与实际扣除共用这一个函数，不可能对不上。
 */
function planExchange(state, count = 1) {
  const n = Math.max(1, Math.floor(count));

  if (state.secrets.length < CULTIVATOR_MARKET.requiresSecrets) {
    return {
      ok: false,
      reason: `须先集齐 ${CULTIVATOR_MARKET.requiresSecrets} 条秘闻（现有 ${state.secrets.length}）`,
    };
  }

  const limit = marketExchangeLimit(state);
  const done = marketExchangeCount(state);
  if (done >= limit) {
    return {
      ok: false,
      reason: `云深谷坊市已吃不下更多银钱（${done}/${limit} 笔）——扩建坊市或通仙凡互市可再开胃口`,
      exhausted: true,
    };
  }

  const batches = Math.min(n, limit - done);
  let cost = 0;
  let stones = 0;
  for (let i = 0; i < batches; i += 1) {
    const q = marketExchangeQuote(state, done + i);
    cost += q.silver;
    stones += q.stones;
  }
  stones = +stones.toFixed(4);

  if (state.silver < cost) {
    return {
      ok: false,
      reason: `银两不足，需 ${fmt(cost)} 两（第 ${done + 1} 笔起）`,
      need: cost,
      quote: marketExchangeQuote(state, done),
      remaining: limit - done,
    };
  }

  return {
    ok: true,
    kind: 'exchange',
    id: CULTIVATOR_MARKET.id,
    name: CULTIVATOR_MARKET.name,
    count: batches,
    cost,
    currency: 'silver',
    stones,
    index: done,
    remaining: limit - done - batches,
    limit,
    quote: marketExchangeQuote(state, done),
    label: `云深谷坊市兑灵石 ×${batches}`,
  };
}

/** 兑现一次兑换。 */
function commitExchange(state, count = 1, now = Date.now()) {
  const plan = planExchange(state, count);
  if (!plan.ok) return plan;

  state.silver -= plan.cost;
  state.spiritStones += plan.stones;
  state.exchangeCount = marketExchangeCount(state) + plan.count;

  pushLog(
    state,
    `于云深谷坊市兑得灵石 ${fmtStones(plan.stones)} 枚，耗银 ${fmt(plan.cost)} 两`
      + `（第 ${plan.index + plan.count}/${plan.limit} 笔）。`,
    'spirit',
    null,
    now,
  );

  return plan;
}

/* ────────────────────── 祛障丹：灵石换炼气人口 ────────────────────── */

/** 询价：服一枚丹的代价。不改动状态。 */
function planPill(state, pillId = 'quzhangdan') {
  const pill = PILL_MAP[pillId];
  if (!pill) return { ok: false, reason: '并无此丹' };

  if (!isResearched(state, pill.requiresTech)) {
    const tech = TECH_MAP[pill.requiresTech];
    return { ok: false, reason: `须先研习「${tech?.name || pill.requiresTech}」` };
  }

  if (state.population < 1) return { ok: false, reason:'族中暂无可祛障的凡人' };
  if ((state.cultivation.cultivators||[]).length>=cultivatorLimit(state)) return { ok:false,reason:'名册已满（凡人人口每满 1000 才多养 1 位；仙道「开脉」「化神大道」可按比例扩容）' };
  if (state.spiritStones < pill.stoneCost) {
    return { ok: false, reason: `灵石不足，需 ${fmtStones(pill.stoneCost)} 枚` };
  }

  return {
    ok: true,
    kind: 'pill',
    id: pill.id,
    name: pill.name,
    cost: pill.stoneCost,
    currency: 'stones',
    label: `服下「${pill.name}」`,
  };
}

/**
 * 服下一枚祛障丹。是否诞生炼气人口看概率，随机源可注入。
 * @returns {{ok:boolean, success?:boolean, qi?:number}}
 */
function commitPill(state, pillId = 'quzhangdan', now = Date.now(), rng = Math.random) {
  const plan = planPill(state, pillId);
  if (!plan.ok) return plan;

  const pill = PILL_MAP[pillId];
  state.spiritStones -= pill.stoneCost;
  state.cultivation.pills += 1;

  const success = rng() < pill.qiChance;

  if (success) {
    const first=!state.cultivation.unlocked;
    const person=addCultivator(state,'awakened',now,false,'',rng);
    if(first && person) pushLog(state,'祛障丹生效！家族第一位炼气修士诞生，自此踏入炼气篇。','unlock',null,now);
  } else {
    pushLog(state, '祛障丹无效，服丹者经脉未开。', 'cultivate', null, now);
  }

  return { ok: true, success, qi: state.cultivation.qi, cost: pill.stoneCost };
}

/* ────────────────────── 寻仙探索（【凡人篇 I1】原「贸易」）────────────────────── */

/**
 * 派遣 / 计时 / 归来结算**全部**搬进了 `src/systems/expeditions.js`：
 * `planExpedition` / `commitExpedition` / `startExpedition` /
 * `planExpeditionFleet` / `commitExpeditionFleet` / `advanceExpeditions`。
 *
 * 为什么搬走：这一块原来是「商队」（routeSeconds 乘科技、银两是收益）。
 * 现在收益是秘闻、代价是银两与人口，规则与数据表都换了，
 * 再留在 core/engine.js 里只会让 engine 继续变大（见 docs/103 §四 第 3 轮）。
 *
 * ⚠ 原 `routeSeconds` **不再有对应物**：`expeditionSeconds` 故意不乘任何科技加速
 *   （加速会把 10/15/20 三道秘闻门变松）—— 详见 systems/expeditions.js 的注释。
 *   ⚠ 连带后果：凡人科技「驿道（courier）」的 `tradeSpeed: 0.15` 现在**没有消费者**，
 *     见 docs/104-凡人篇重构.md「已知遗留」。
 */

/** 为界面准备一份「可执行的操作」清单状态。 */
function planStatus(state, kind, id, mode = '1') {
  if (kind === 'buy') return planBuy(state, id, mode);
  if (kind === 'research') return planResearch(state, id);
  if (kind === 'immortalResearch') return planImmortalResearch(state, id);
  if (kind === 'expedition') return planExpedition(state, id);
  if (kind === 'expeditionFleet') return planExpeditionFleet(state, id, mode);
  if (kind === 'exchange') return planExchange(state, mode === '1' ? 1 : Number(mode) || 1);
  if (kind === 'pill') return planPill(state, id);
  return { ok: false, reason: '未知操作' };
}

/** 兑现一份 plan。随机源可注入，便于测试确定化。 */
function commitPlan(state, plan, now = Date.now(), rng = Math.random) {
  if (!plan || !plan.ok) return { ok: false, reason: '操作无效' };
  if (plan.kind === 'buy') return commitBuy(state, plan.id, plan.count, now);
  if (plan.kind === 'research') return commitResearch(state, plan.id, now);
  if (plan.kind === 'immortalResearch') return commitImmortalResearch(state, plan.id, now);
  if (plan.kind === 'expedition') return commitExpedition(state, plan.id, now);
  if (plan.kind === 'expeditionFleet') return commitExpeditionFleet(state, plan.id, plan.count, now);
  if (plan.kind === 'exchange') return commitExchange(state, plan.count, now);
  if (plan.kind === 'pill') return commitPill(state, plan.id, now, rng);
  return { ok: false, reason: '未知操作' };
}

/** 一个建筑/科技当前是否能立刻执行（界面上用来区分「答对就成」与「根本买不起」）。 */
function techPlanStatus(state, techId) {
  return techStatus(state, TECH_MAP[techId]);
}

/* ────────────────────────────── 时间推进 ────────────────────────────── */

/**
 * 纯数值推进：人口与银两。
 * 离线结算也复用这一段，保证在线离线口径一致。
 */
function simulate(state, dt, now=Date.now(), rng=Math.random) {
  if (!(dt > 0)) return;

  const d = derive(state);

  // 人口：出生与死亡都按当前人口比例计算
  const births = state.population * d.birthRate * dt;
  const deaths = state.population * d.deathRate * dt;
  state.population = Math.max(0, state.population + births - deaths);
  state.stats.births += births;
  state.stats.deaths += deaths;
  progressCultivators(state,dt,now,rng,births);

  // 银两：受钱庄上限约束，超出部分记入损耗
  const gain = d.silverPerSec * dt;
  const room = Math.max(0, d.silverCap - state.silver);
  const applied = Math.min(gain, room);
  state.silver += applied;
  state.stats.silverEarned += applied;
  state.stats.silverWasted += gain - applied;

  state.stats.playSeconds += dt;
}

/**
 * 按「游戏秒」推进经济，内部自动细分步长。
 *
 * 倍速会把一帧的游戏秒拉长（5×0.25s → 1.25s，定时器被节流时更大），
 * 而人口是指数增长，步长过大会明显失真，所以这里切开成小步跑。
 *
 * @param {number} gameSeconds 要推进的游戏秒
 * @param {number} maxStep 单步上限（秒）
 * @returns {number} 实际推进的游戏秒
 */
function simulateSpan(state, gameSeconds, maxStep = MAX_SIM_STEP, rng=Math.random, now=Date.now()) {
  if (!(gameSeconds > 0)) return 0;

  const step = Math.max(1e-6, maxStep);
  let left = gameSeconds;
  let guard = 0;

  while (left > 1e-9 && guard < 20000) {
    const dt = left > step ? step : left;
    simulate(state, dt,now,rng);
    left -= dt;
    guard += 1;
  }
  return gameSeconds - left;
}

/** 检查人口里程碑。 */
function checkMilestones(state, now, silent = false) {
  const pop = Math.floor(state.population);
  let top = null;
  for (const m of POP_MILESTONES) {
    if (pop >= m && !state.milestones.includes(m)) {
      state.milestones.push(m);
      top = m;
      if (!silent) {
        pushLog(state, `族中人口突破 ${fmt(m)} 人，家业渐兴。`, 'milestone', null, now);
      }
    }
  }
  return top;
}

/**
 * 在线主循环。
 * @param {number} gameDt 已经乘过倍速的「游戏秒」
 */
function tick(state, gameDt, now = Date.now(), rng = Math.random) {
  if (gameDt > 0) {
    // ══════════════════════════════════════════════════════════════════
    // 【策划 C14 / 任务 T-2b 验收标准 1】世界钟：在线每过 1 游戏小时 = +25 年。
    // 尺度出处：docs/91-落地任务清单.md §三 T-2b（1 h = 25 年，一周目 44.6 h = 1115 年）。
    // ⚠ 这里只推**年份**，不产生任何惩罚（没有老死、没有冲关修正）——
    //   它的全部作用是让族谱上的「寿 X，余 Y」动起来。
    // ⚠ 倍速会一起放大（gameDt 已乘过倍速），这是**有意的**：
    //   倍速是「快进这个世界的年月」，寿元钟理应跟着快。
    // ══════════════════════════════════════════════════════════════════
    ensureClock(state);
    state.clock.year += (gameDt / 3600) * YEARS_PER_GAME_HOUR;
    simulateSpan(state, gameDt, MAX_SIM_STEP, rng, now);
    advanceExpeditions(state, gameDt, now, rng);
  }
  checkMilestones(state, now);
  // 【架构 docs/101 §3.3】开发者模式：在**每 tick 的末尾**统一补满。
  // 放在这里而不是逐个改扣减点 —— 扣减点散在 engine / alchemy / forge /
  // runes / immortal-actions / markets / breakthrough 七处，逐个改必漏。
  // ⚠ 参数名不能叫 state：本函数内部一直用 `state` 指当前状态。
  devRefill(state);
}

/**
 * 离线结算。**不吃倍速**，一律按 1 倍速算，上限 OFFLINE_CAP_HOURS 小时。
 * @param {number} seconds 离线秒数
 *
 * ⚠ 【策划 C14 / 任务 T-2b 验收标准 2】**离线不推年份**（这是本条唯一的硬约束）。
 *   原因有二：① 离线 12 小时 = 300 年，收窄版的寿元上限会被瞬间吃穿，
 *   界面上会出现满屏「寿元已尽」的假警报；② 完整版的 T-7（元婴出窍）也要动这个函数，
 *   而「离线不推年份」正是让 T-2b 与 T-7 能共存的具体做法。
 *   所以下面这段**刻意不碰 state.clock** —— 不改行为本身就是验收标准。
 */
function runOffline(state, seconds, now = Date.now()) {
  if (!(seconds > 1)) return null;

  const capped = Math.min(seconds, OFFLINE_CAP_HOURS * 3600);
  const popFrom = state.population;
  const silverFrom = state.silver;

  // ══════════════════════════════════════════════════════════════════
  // 【策划 C8 / 任务 T-7 验收标准 7】🔴 离线硬约定：所有出窍者**自动回体**，
  //   且稳固度**不下降**。
  //
  // 为什么这条必须是硬约定（而不是「离线也扣」）：
  //   稳固度按 0.03/秒下降 ⇒ 离线 12 小时（上限）会扣 1296 点，
  //   远超满值 100 ⇒ **任何出窍者只要关掉页面就必然「离体不返」**。
  //   那不是玩法，那是「离线惩罚」——而本项目从 T-2b（离线不推年份）
  //   到 FAQ 都明确不惩罚离线。所以离线期间视为「元婴回了本体」。
  //
  // ⚠ 实现方式：结算前先回体，于是下面 simulateSpan 里的稳固度结算
  //   走的是「在体 +0.02/秒」这条分支（它会回满，而不是掉光）。
  //   **不能**只跳过衰减而不回体：那样 `out` 会留在 true，
  //   玩家回来看到的是一个「在外」却不再消耗的不自洽状态。
  // ══════════════════════════════════════════════════════════════════
  const recalled = recallAllNascent(state, now);

  // 用迭代次数上限反推步长：12 小时离线也只会跑两万步以内
  const step = Math.max(MAX_SIM_STEP, capped / OFFLINE_MAX_STEPS);
  simulateSpan(state, capped, step, Math.random, now);

  advanceExpeditions(state, capped, now);
  const top = checkMilestones(state, now, true);

  // 【架构 docs/101 §3.3】离线结算同样收在末尾补满一次：
  // 离线是「一帧跑完 12 小时」，末尾补一次就等于「回来时资源是满的」。
  devRefill(state);

  return {
    seconds: capped,
    capped: seconds > capped + 1,
    silverGain: state.silver - silverFrom,
    popGain: state.population - popFrom,
    popFrom,
    popTo: state.population,
    top,
  };
}
const advanceTick = tick;
const sellBuilding = sell;
const settleOffline = runOffline;
const writeLog = pushLog;
