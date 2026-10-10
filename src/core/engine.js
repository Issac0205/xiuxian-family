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
 * @returns {number|null} 秘闻下标；已全部集齐时返回 null
 */
function grantSecret(state, now = Date.now(), rng = Math.random) {
  const pool = SECRETS.map((_, i) => i).filter((i) => !state.secrets.includes(i));
  if (!pool.length) return null;

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
      .filter((r) => !isResearched(state, r))
      .map((r) => `「${TECH_MAP[r]?.name || r}」`)
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

/* ────────────────────────────── 购置 ────────────────────────────── */

/** 计算一次购置的代价与规模；不改动状态。 */
function planBuy(state, id, mode = '1') {
  const def = BUILDING_MAP[id];
  if (!def) return { ok: false, reason: '并无此物' };

  if (!isBuildingUnlocked(state, def)) {
    const tech = TECH_MAP[def.tech];
    return { ok: false, reason: `须先研习「${tech?.name || def.tech}」` };
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

/** 询价：兑 count 份灵石要多少银两。不改动状态。 */
function planExchange(state, count = 1) {
  const n = Math.max(1, Math.floor(count));

  if (state.secrets.length < CULTIVATOR_MARKET.requiresSecrets) {
    return {
      ok: false,
      reason: `须先集齐 ${CULTIVATOR_MARKET.requiresSecrets} 条秘闻（现有 ${state.secrets.length}）`,
    };
  }

  const cost = CULTIVATOR_MARKET.silver * n;
  if (state.silver < cost) {
    return { ok: false, reason: `银两不足，需 ${fmt(cost)} 两` };
  }

  return {
    ok: true,
    kind: 'exchange',
    id: CULTIVATOR_MARKET.id,
    name: CULTIVATOR_MARKET.name,
    count: n,
    cost,
    currency: 'silver',
    stones: CULTIVATOR_MARKET.stones * n,
    label: `云深谷坊市兑灵石 ×${n}`,
  };
}

/** 兑现一次兑换。 */
function commitExchange(state, count = 1, now = Date.now()) {
  const plan = planExchange(state, count);
  if (!plan.ok) return plan;

  state.silver -= plan.cost;
  state.spiritStones += plan.stones;

  pushLog(
    state,
    `于云深谷坊市兑得灵石 ${fmtStones(plan.stones)} 枚，耗银 ${fmt(plan.cost)} 两。`,
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
  if ((state.cultivation.cultivators||[]).length>=CULTIVATOR_LIMIT) return { ok:false,reason:'名册已达本版人数上限' };
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

/* ────────────────────────────── 贸易 ────────────────────────────── */

/** 一条路线在当前科技下的实际耗时（秒）。 */
function routeSeconds(state, route) {
  const { fx } = derive(state);
  return route.duration * (1 - fx.tradeSpeed);
}

/** 计算派遣一支商队的代价；不改动状态。 */
function planTrade(state, routeId) {
  const route = ROUTE_MAP[routeId];
  if (!route) return { ok: false, reason: '并无此路' };

  const d = derive(state);
  if (!d.tradeUnlocked) return { ok: false, reason: '尚未建立商队驿站' };
  if (d.freeCaravans <= 0) return { ok: false, reason: '商队位已满，商队尚未归来' };
  if (state.silver < route.cost) {
    return { ok: false, reason: `需备本钱 ${fmt(route.cost)} 两` };
  }

  const seconds = routeSeconds(state, route);
  return {
    ok: true,
    kind: 'trade',
    id: route.id,
    name: route.name,
    cost: route.cost,
    currency: 'silver',
    seconds,
    label: `遣商队往「${route.name}」`,
  };
}

/** 兑现一次派遣。 */
function commitTrade(state, routeId, now = Date.now()) {
  const route = ROUTE_MAP[routeId];
  if (!route) return { ok: false, reason: '并无此路' };

  const d = derive(state);
  if (d.freeCaravans <= 0) return { ok: false, reason: '商队位已满' };
  if (state.silver < route.cost) return { ok: false, reason: '银两不足' };

  const seconds = routeSeconds(state, route);
  state.silver -= route.cost;
  state.caravans.push({
    routeId,
    startedAt: now,
    remaining: seconds,   // 还需多少「游戏秒」
    total: seconds,       // 全程「游戏秒」，用于算进度
    invested: route.cost,
  });

  pushLog(
    state,
    `商队启程前往「${route.name}」，押本 ${fmt(route.cost)} 两，约 ${fmtDuration(seconds)} 后归来。`,
    'trade',
    null,
    now,
  );

  return { ok: true, seconds, cost: route.cost };
}

/** 一站式派遣（不含答题，供测试与内部使用）。 */
function startTrade(state, routeId, now = Date.now()) {
  const plan = planTrade(state, routeId);
  if (!plan.ok) return plan;
  return commitTrade(state, routeId, now);
}

/* ────────────────────── 批量派遣：全部 / 一半 ────────────────────── */

/**
 * 询价：批量派遣。
 *
 * 整批算**一个 plan**，所以整批只出一道题——这正是这个功能存在的意义，
 * 一队一道题的话，按钮越多越烦。答错时地狱难度没收的也是整批的本钱。
 */
function planTradeFleet(state, routeId, fleet = 'all') {
  const route = ROUTE_MAP[routeId];
  if (!route) return { ok: false, reason: '并无此路' };

  const d = derive(state);
  if (!d.tradeUnlocked) return { ok: false, reason: '尚未建立商队驿站' };
  if (d.freeCaravans <= 0) return { ok: false, reason: '商队位已满，商队尚未归来' };

  const n = fleetSize(state, d, route, fleet);
  if (n <= 0) {
    return { ok: false, reason: `银两不足，每队需备本钱 ${fmt(route.cost)} 两` };
  }

  const seconds = routeSeconds(state, route);
  const cost = route.cost * n;
  return {
    ok: true,
    kind: 'tradeFleet',
    id: route.id,
    name: route.name,
    count: n,
    cost,
    currency: 'silver',
    seconds,
    label: n > 1 ? `遣 ${n} 支商队往「${route.name}」` : `遣商队往「${route.name}」`,
  };
}

/** 兑现一次批量派遣。整批共用一条纪事，不刷屏。 */
function commitTradeFleet(state, routeId, count, now = Date.now()) {
  const route = ROUTE_MAP[routeId];
  if (!route) return { ok: false, reason: '并无此路' };

  const d = derive(state);
  const n = Math.min(
    Math.max(0, Math.floor(count)),
    d.freeCaravans,
    Math.floor(state.silver / route.cost),
  );
  if (n <= 0) return { ok: false, reason: '商队位已满或银两不足' };

  const seconds = routeSeconds(state, route);
  const cost = route.cost * n;

  state.silver -= cost;
  for (let i = 0; i < n; i += 1) {
    state.caravans.push({
      routeId,
      startedAt: now,
      remaining: seconds,
      total: seconds,
      invested: route.cost,
    });
  }

  pushLog(
    state,
    n > 1
      ? `${n} 支商队一同启程前往「${route.name}」，共押本 ${fmt(cost)} 两，约 ${fmtDuration(seconds)} 后归来。`
      : `商队启程前往「${route.name}」，押本 ${fmt(cost)} 两，约 ${fmtDuration(seconds)} 后归来。`,
    'trade',
    `fleet:${route.id}`,
    now,
  );

  return { ok: true, count: n, cost, seconds };
}

/** 为界面准备一份「可执行的操作」清单状态。 */
function planStatus(state, kind, id, mode = '1') {
  if (kind === 'buy') return planBuy(state, id, mode);
  if (kind === 'research') return planResearch(state, id);
  if (kind === 'trade') return planTrade(state, id);
  if (kind === 'tradeFleet') return planTradeFleet(state, id, mode);
  if (kind === 'exchange') return planExchange(state, 1);
  if (kind === 'pill') return planPill(state, id);
  return { ok: false, reason: '未知操作' };
}

/** 兑现一份 plan。随机源可注入，便于测试确定化。 */
function commitPlan(state, plan, now = Date.now(), rng = Math.random) {
  if (!plan || !plan.ok) return { ok: false, reason: '操作无效' };
  if (plan.kind === 'buy') return commitBuy(state, plan.id, plan.count, now);
  if (plan.kind === 'research') return commitResearch(state, plan.id, now);
  if (plan.kind === 'trade') return commitTrade(state, plan.id, now);
  if (plan.kind === 'tradeFleet') return commitTradeFleet(state, plan.id, plan.count, now);
  if (plan.kind === 'exchange') return commitExchange(state, plan.count, now);
  if (plan.kind === 'pill') return commitPill(state, plan.id, now, rng);
  return { ok: false, reason: '未知操作' };
}

/** 一个建筑/科技当前是否能立刻执行（界面上用来区分「答对就成」与「根本买不起」）。 */
function techPlanStatus(state, techId) {
  return techStatus(state, TECH_MAP[techId]);
}

/* ────────────────────────────── 商队结算 ────────────────────────────── */

/** 按「游戏秒」推进商队，并结算所有到期的。随机源可注入，便于测试。 */
function advanceCaravans(state, gameSeconds, now = Date.now(), rng = Math.random) {
  if (!state.caravans.length || !(gameSeconds > 0)) return;

  const due = [];
  const keep = [];
  for (const c of state.caravans) {
    c.remaining -= gameSeconds;
    if (c.remaining <= 0) due.push(c);
    else keep.push(c);
  }
  if (!due.length) return;
  state.caravans = keep;

  const d = derive(state);

  for (const c of due) {
    const route = ROUTE_MAP[c.routeId];
    if (!route) continue;

    const reward = tradeReward(state, route);
    const room = Math.max(0, d.silverCap - state.silver);
    const applied = Math.min(reward, room);

    state.silver += applied;
    state.stats.silverEarned += applied;
    state.stats.silverWasted += reward - applied;
    state.tradeRuns += 1;

    const overflow = reward - applied;
    const chance = tradeSecretChance(state, route);
    const gainedSecret = chance > 0 && rng() < chance;

    // 秘闻优先播报：它是这条商路真正值钱的东西
    if (gainedSecret) grantSecret(state, now, rng);

    pushLog(
      state,
      `「${route.name}」商队归来，得银 ${fmt(reward)} 两` +
        (overflow > 0.5 ? `（库房已满，溢出 ${fmt(overflow)} 两）` : ''),
      'trade',
      null,
      now,
    );
  }
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
    simulateSpan(state, gameDt, MAX_SIM_STEP, rng, now);
    advanceCaravans(state, gameDt, now, rng);
  }
  checkMilestones(state, now);
}

/**
 * 离线结算。**不吃倍速**，一律按 1 倍速算，上限 OFFLINE_CAP_HOURS 小时。
 * @param {number} seconds 离线秒数
 */
function runOffline(state, seconds, now = Date.now()) {
  if (!(seconds > 1)) return null;

  const capped = Math.min(seconds, OFFLINE_CAP_HOURS * 3600);
  const popFrom = state.population;
  const silverFrom = state.silver;

  // 用迭代次数上限反推步长：12 小时离线也只会跑两万步以内
  const step = Math.max(MAX_SIM_STEP, capped / OFFLINE_MAX_STEPS);
  simulateSpan(state, capped, step, Math.random, now);

  advanceCaravans(state, capped, now);
  const top = checkMilestones(state, now, true);

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
