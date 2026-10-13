
/* ────────────────────────────────────────────────────────────────
 * 区块：寻仙探索（规则）
 * 【凡人篇重构 I1 / docs/104-凡人篇重构.md】
 * 职责：派遣族人出门 → 按游戏秒计时 → 归来结算（人口返还 / 秘闻 / 银两 / 折损）。
 * 依赖：data/expeditions.js（地点表）、core/formulas.js（名额与收益）、
 *       core/engine.js（pushLog 与 grantSecret）、core/eventBus.js（广播归来）
 *
 * ⚠ 时间按**游戏秒**记账，不存绝对时间戳 —— 中途改倍速时，剩余时间与进度条
 *   会自然跟着变，不必回头重算。这条口径是从原「商队」原样继承的（它是对的）。
 * ⚠ 与 systems/exploration.js（仙道侧的洞天/征伐）**是两码事，名字必须区分**：
 *   那边要修士、灵石、线索；这边只要凡人人口与银两。
 *   data/map.js 记过一次同名覆盖事故（浏览器 ES module 里直接抛重名，界面成空壳
 *   而冒烟测试照样全绿），所以这里一律用 expedition* 前缀。
 * ──────────────────────────────────────────────────────────────── */

/** 一趟探索要跑多少「游戏秒」。
 *  ⚠ 这里**故意不做任何加速**：地点表里的 duration 就是最终值。
 *   （原商队有一层 routeSeconds 乘科技，那是「商路越快越赚」；
 *     探索的收益是秘闻，加速会直接把 10/15/20 三道门变松 —— 要调就调 duration。） */
function expeditionSeconds(state, def) {
  return Math.max(1, Math.round(def.duration));
}

/** 计算派遣一支探索队的代价；不改动状态。 */
function planExpedition(state, id) {
  const def = EXPEDITION_MAP[id];
  if (!def) return { ok: false, reason: '并无此地' };

  const d = derive(state);
  if (!d.expeditionUnlocked) return { ok: false, reason: '尚未建立驿馆' };
  if (d.freeExpeditions <= 0) return { ok: false, reason: '驿馆已满，族人尚未归来' };
  if (state.silver < def.cost) {
    return { ok: false, reason: `需备盘缠 ${fmt(def.cost)} 两` };
  }
  // ⚠ 不许把人派空：至少留 1 个凡人在族中，否则人口再也长不回来（死局）。
  if (state.population - def.people < 1) {
    return { ok: false, reason: `需留 1 人在族中：要派 ${def.people} 人，现有 ${Math.floor(state.population)}` };
  }

  const seconds = expeditionSeconds(state, def);
  return {
    ok: true,
    kind: 'expedition',
    id: def.id,
    name: def.name,
    cost: def.cost,
    people: def.people,
    currency: 'silver',
    seconds,
    label: `遣 ${def.people} 人往「${def.name}」`,
  };
}

/** 兑现一次派遣。 */
function commitExpedition(state, id, now = Date.now()) {
  const plan = planExpedition(state, id);
  if (!plan.ok) return plan;
  const def = EXPEDITION_MAP[id];

  state.silver -= def.cost;
  state.population = Math.max(0, state.population - def.people);
  state.expeditions.push({
    id: def.id,
    startedAt: now,
    remaining: plan.seconds,  // 还需多少「游戏秒」
    total: plan.seconds,      // 全程「游戏秒」，用于算进度
    people: def.people,       // 派出去的人数（归来时按风险折损）
    invested: def.cost,
  });

  pushLog(
    state,
    `${def.people} 人往「${def.name}」去了，带去盘缠 ${fmt(def.cost)} 两，约 ${fmtDuration(plan.seconds)} 后回来。`,
    'trade',
    null,
    now,
  );
  emitEvent(GAME_EVENTS.EXPEDITION_SENT, { state, id: def.id, name: def.name, people: def.people, now });

  return { ok: true, seconds: plan.seconds, cost: def.cost, people: def.people };
}

/** 一站式派遣（不含答题，供测试与内部使用）。 */
function startExpedition(state, id, now = Date.now()) {
  return commitExpedition(state, id, now);
}

/* ────────────────────── 批量派遣：全部 / 一半 ────────────────────── */

/** 这一批能派几队（同时受名额、银两、人口三重限制）。 */
function expeditionFleetSize(state, d, def, fleet = 'all') {
  const bySilver = Math.floor(state.silver / def.cost);
  const byPeople = Math.floor(Math.max(0, state.population - 1) / def.people);
  const capacity = Math.min(d.freeExpeditions, bySilver, byPeople);
  if (capacity <= 0) return 0;
  if (fleet === 'half') return Math.max(1, Math.ceil(capacity / 2));
  return capacity;
}

/** 询价：批量派遣。整批算一个 plan ⇒ 整批只出一道题。 */
function planExpeditionFleet(state, id, fleet = 'all') {
  const def = EXPEDITION_MAP[id];
  if (!def) return { ok: false, reason: '并无此地' };

  const d = derive(state);
  if (!d.expeditionUnlocked) return { ok: false, reason: '尚未建立驿馆' };
  if (d.freeExpeditions <= 0) return { ok: false, reason: '驿馆已满，族人尚未归来' };

  const n = expeditionFleetSize(state, d, def, fleet);
  if (n <= 0) {
    return { ok: false, reason: `银两或人手不足：每队需盘缠 ${fmt(def.cost)} 两、${def.people} 人` };
  }

  return {
    ok: true,
    kind: 'expeditionFleet',
    id: def.id,
    name: def.name,
    count: n,
    cost: def.cost * n,
    people: def.people * n,
    currency: 'silver',
    seconds: expeditionSeconds(state, def),
    label: n > 1 ? `遣 ${n} 队（共 ${def.people * n} 人）往「${def.name}」` : planExpedition(state, id).label,
  };
}

/** 兑现一次批量派遣。整批共用一条纪事，不刷屏。 */
function commitExpeditionFleet(state, id, count, now = Date.now()) {
  const def = EXPEDITION_MAP[id];
  if (!def) return { ok: false, reason: '并无此地' };

  const d = derive(state);
  const n = Math.min(
    Math.max(0, Math.floor(count)),
    d.freeExpeditions,
    Math.floor(state.silver / def.cost),
    Math.floor(Math.max(0, state.population - 1) / def.people),
  );
  if (n <= 0) return { ok: false, reason: '名额、银两或人手不足' };

  const seconds = expeditionSeconds(state, def);
  state.silver -= def.cost * n;
  state.population = Math.max(0, state.population - def.people * n);
  for (let i = 0; i < n; i += 1) {
    state.expeditions.push({
      id,
      startedAt: now,
      remaining: seconds,
      total: seconds,
      people: def.people,
      invested: def.cost,
    });
  }
  pushLog(state, `${n} 队族人分头往「${def.name}」去了。`, 'trade', null, now);
  emitEvent(GAME_EVENTS.EXPEDITION_SENT, { state, id, name: def.name, people: def.people * n, now });
  return { ok: true, seconds, count: n };
}

/* ────────────────────────── 归来结算 ────────────────────────── */

/**
 * 按「游戏秒」推进探索，并结算所有到期的。随机源可注入，便于测试。
 *
 * 结算顺序（每一处都对应一条设计约定）：
 *   ① **人口先返还存活的那部分**（折损的人不回来）—— 先还人，日志里的数字才对得上；
 *   ② 银两受库房上限约束（溢出记进 stats.silverWasted，与产业口径一致）；
 *   ③ 秘闻**最后**掷（它优先播报，且 grantSecret 内部会去重）；
 *   ④ 广播 EXPEDITION_RETURNED，族谱由订阅者写（架构第 1 轮的做法）。
 */
function advanceExpeditions(state, gameSeconds, now = Date.now(), rng = Math.random) {
  if (!Array.isArray(state.expeditions) || !state.expeditions.length || !(gameSeconds > 0)) return;

  const due = [];
  const keep = [];
  for (const e of state.expeditions) {
    e.remaining -= gameSeconds;
    if (e.remaining <= 0) due.push(e);
    else keep.push(e);
  }
  if (!due.length) return;
  state.expeditions = keep;

  const d = derive(state);

  for (const e of due) {
    const def = EXPEDITION_MAP[e.id];
    if (!def) continue;

    const sent = Math.max(1, Math.floor(Number(e.people) || def.people));
    // ① 还人：折损的唯一实现在 data/expeditions.js 的 expeditionSurvivors（不在这里抄一份）
    const survivors = expeditionSurvivors(def, rng, sent);
    state.population += survivors;

    // ② 银两（受库房上限约束）
    // ⚠ 必须走 `expeditionReward`（core/formulas.js）—— 界面上的「带回」也读它。
    //   直接写 `def.silver` 会让「显示的收益」与「到手的收益」变成两个真相源
    //   （docs/96 §1.2 缺陷①就是这么来的：界面差 5 倍而断言全绿）。
    const reward = expeditionReward(state, def);
    const room = Math.max(0, d.silverCap - state.silver);
    const applied = Math.min(reward, room);
    state.silver += applied;
    state.stats.silverEarned += applied;
    state.stats.silverWasted += reward - applied;
    state.expeditionRuns += 1;

    // ③ 秘闻（凡人接触仙道的唯一桥梁；**不设总量上限**）
    const chance = exploreSecretChance(state, def);
    const gainedSecret = chance > 0 && rng() < chance;
    if (gainedSecret) grantSecret(state, now, rng);

    // ④ 广播（族谱由 systems/chronicle.js 订阅后落库）
    emitEvent(GAME_EVENTS.EXPEDITION_RETURNED, {
      state, id: def.id, name: def.name, sent, survivors,
      lost: sent - survivors, silver: reward, overflow: reward - applied,
      secret: gainedSecret, now,
    });
  }
}
