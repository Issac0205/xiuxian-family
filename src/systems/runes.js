
/* ────────────────────────────────────────────────────────────────
 * 区块：炼符规则
 * 职责：符文产出、画符、保质期、符箓生效与消耗。
 *       与 systems/alchemy.js / systems/forge.js 同构，但成品性质不同：
 *       符箓是**「下一次行动」的一次性加成**，且有保质期。
 * 依赖：data/runes.js（表）、data/map.js、systems/roots.js
 * 调参：数值全在 data/runes.js，本文件不含魔法数字。
 * 文档：docs/32-炼符.md
 * ──────────────────────────────────────────────────────────────── */

/** 取（并初始化）符房状态。 */
function runesOf(state) {
  const c = state.cultivation;
  if (!c) return { mats: {}, stock: {}, prof: {}, pending: {}, bench: 1, crafts: 0 };
  if (!c.runes || typeof c.runes !== 'object') c.runes = {};
  const r = c.runes;
  if (!r.mats || typeof r.mats !== 'object') r.mats = {};
  if (!r.stock || typeof r.stock !== 'object') r.stock = {};
  if (!r.prof || typeof r.prof !== 'object') r.prof = {};
  if (!r.pending || typeof r.pending !== 'object') r.pending = {};
  r.bench = Math.max(1, Math.min(RUNE_BENCH_MAX, Math.floor(Number(r.bench) || 1)));
  for (const k of Object.keys(r.mats)) {
    if (!RUNE_MATERIAL_MAP[k]) { delete r.mats[k]; continue; }
    r.mats[k] = Math.max(0, Number(r.mats[k]) || 0);
  }
  for (const k of Object.keys(r.stock)) {
    const it = RUNE_ITEM_MAP[k];
    const e = r.stock[k];
    if (!it || !e || typeof e !== 'object') { delete r.stock[k]; continue; }
    e.n = Math.max(0, Math.floor(Number(e.n) || 0));
    e.expiresAt = Math.max(0, Number(e.expiresAt) || 0);
    if (e.n <= 0) delete r.stock[k];
  }
  for (const k of Object.keys(r.prof)) {
    if (!RUNE_ITEM_MAP[k]) { delete r.prof[k]; continue; }
    r.prof[k] = Math.max(0, Math.min(RUNE_PROFICIENCY_MAX, Math.floor(Number(r.prof[k]) || 0)));
  }
  for (const k of Object.keys(r.pending)) {
    if (!['cave', 'attack', 'break'].includes(k)) { delete r.pending[k]; continue; }
    r.pending[k] = Math.max(0, Number(r.pending[k]) || 0);
  }
  return r;
}

/* ── 符文 ── */

function runeMatCount(state, id) { return Math.max(0, Number(runesOf(state).mats[id]) || 0); }
function addRuneMats(state, id, amount) {
  const r = runesOf(state);
  r.mats[id] = Math.max(0, (Number(r.mats[id]) || 0) + amount);
}

/** 所有领地每秒产出的符文合计。 */
function runePerSec(state) {
  const out = {};
  for (const m of RUNE_MATERIALS) out[m.id] = 0;
  for (const id of worldOf(state).held) {
    const node = mapNode(id);
    if (!node || !node.rune) continue;
    if (!mapIsPacified(state, id)) continue;
    out[node.rune] = (out[node.rune] || 0) + (node.runeYield || 0);
  }
  return out;
}

/* ── 符师与灵根 ── */

function runist(state) {
  return (state.cultivation?.cultivators || []).find((p) => p.job === 'runes') || null;
}

/** 火灵根对炼符的加成。与丹师之木、器师之金完全对称。 */
function runeFireBonus(state) {
  const p = runist(state);
  if (!p) return 0;
  if (!rootElementsOf(p).includes('fire')) return 0;
  return RUNE_FIRE_BASE + RUNE_FIRE_PER_RANK * Math.max(0, rootRank(p) - 1);
}

/* ── 画符 ── */

function runeProficiency(state, id) {
  return Math.max(0, Math.min(RUNE_PROFICIENCY_MAX, Math.floor(Number(runesOf(state).prof[id]) || 0)));
}

/**
 * 成功率。符台等级同样夹到至少该符的要求。
 *
 * 「聚灵阵」这类仙道科技会让符台免费升 runeBenchFree 阶 ——
 * 那是**等效等级**，所以加在这里而不是去改 runesOf().bench：
 * 玩家自己买的符台等级不能被科技覆盖掉，否则「升符台」就白花了灵石。
 */
function runeEffectiveBench(state) {
  const own = runesOf(state).bench;
  const free = Math.max(0, Math.round(techEffects(state).runeBenchFree || 0));
  return Math.max(1, Math.min(RUNE_BENCH_MAX, own + free));
}

function runeRate(state, id) {
  const item = RUNE_ITEM_MAP[id];
  if (!item) return 0;
  const lv = Math.max(runeEffectiveBench(state), item.bench);
  const rate = item.baseRate
    + runeBenchAt(lv).rateBonus
    + runeProficiency(state, id) * RUNE_PROFICIENCY_STEP
    + runeFireBonus(state);
  return Math.max(RUNE_RATE_MIN, Math.min(RUNE_RATE_MAX, rate));
}

function runePlan(state, id) {
  const item = RUNE_ITEM_MAP[id];
  if (!item) return { ok: false, reason: '并无此符' };
  if (runeEffectiveBench(state) < item.bench) {
    return { ok: false, reason: `需 ${RUNE_BENCH_LEVELS[item.bench - 1].name}（符台 ${item.bench} 级）`, item };
  }
  const missing = [];
  for (const [m, need] of Object.entries(item.materials)) {
    if (runeMatCount(state, m) < need) missing.push(`${RUNE_MATERIAL_MAP[m]?.name || m} 缺 ${Math.ceil(need - runeMatCount(state, m))}`);
  }
  if (missing.length) return { ok: false, reason: missing.join('、'), item };
  return {
    ok: true, kind: 'rune', item, itemId: item.id, name: item.name,
    rate: runeRate(state, id), prof: runeProficiency(state, id), fire: runeFireBonus(state),
    materials: { ...item.materials }, text: item.text,
    cost: 0, currency: 'none',
  };
}

/**
 * 画一张符。
 *
 * 失败损失全部符文，并且**不产出**。
 * 画成之后**起算保质期**：同一种符如果已有存货，保质期沿用最早那一批
 * （先画的先过期），所以反复补货不会把旧的洗成新的。
 */
function commitRune(state, id, now = Date.now(), rng = Math.random) {
  const plan = runePlan(state, id);
  if (!plan.ok) return plan;
  const item = plan.item;
  const r = runesOf(state);
  for (const [m, need] of Object.entries(item.materials)) {
    r.mats[m] = Math.max(0, runeMatCount(state, m) - need);
  }
  r.crafts = (r.crafts || 0) + 1;

  if (rng() >= plan.rate) {
    // 失败会毁掉一张已有的存货（画符画废了，纸也废了）
    return { ok: true, success: false, name: item.name,
      reason: `画${item.name}失败（成功率 ${(plan.rate * 100).toFixed(0)}%），符文尽废` };
  }

  const shelfMs = RUNE_SHELF_HOURS * 3600 * 1000;
  const entry = r.stock[id];
  if (!entry || entry.n <= 0) {
    r.stock[id] = { n: 1, expiresAt: now + shelfMs };
  } else {
    // 已经有存货：数量 +1，但保质期不延长（先画的先过期）
    entry.n += 1;
  }
  const before = runeProficiency(state, id);
  r.prof[id] = Math.min(RUNE_PROFICIENCY_MAX, before + 1);
  return {
    ok: true, success: true, name: item.name, text: item.text,
    count: runeCount(state, id),
    expiresIn: Math.max(0, (r.stock[id].expiresAt - now) / 1000),
    reason: `画成${item.name} ×1（现存 ${runeCount(state, id)} 张，${RUNE_SHELF_HOURS} 小时内有效）`,
  };
}

/* ── 存货与保质期 ── */

/**
 * 某种符当前的有效存货。
 * 已过期的直接算 0（真正的清理在 advanceRunes 里做，这里只保证读数是准的）。
 */
function runeCount(state, id, now = Date.now()) {
  const e = runesOf(state).stock[id];
  if (!e || e.n <= 0) return 0;
  if (e.expiresAt > 0 && now >= e.expiresAt) return 0;
  return e.n;
}

/** 距离过期还有多少秒；没有存货返回 0。 */
function runeExpiresIn(state, id, now = Date.now()) {
  const e = runesOf(state).stock[id];
  if (!e || e.n <= 0) return 0;
  return Math.max(0, (e.expiresAt - now) / 1000);
}

/** 消耗一张符。不够就返回 false。 */
function consumeRune(state, id, now = Date.now()) {
  if (runeCount(state, id, now) <= 0) return false;
  const r = runesOf(state);
  r.stock[id].n -= 1;
  if (r.stock[id].n <= 0) delete r.stock[id];
  return true;
}

/* ── 生效与消耗 ── */

/** 当前挂着的「下一次」加成（百分点）。 */
function runePending(state, kind) {
  return Math.max(0, Number(runesOf(state).pending[kind]) || 0);
}

/** 用掉挂着的加成。 */
function consumePending(state, kind) {
  const r = runesOf(state);
  const v = Math.max(0, Number(r.pending[kind]) || 0);
  delete r.pending[kind];
  return v;
}

/**
 * 使用一张符。
 *   聚灵符 → 立刻开始一段限时修炼加成
 *   其余三张 → 挂成「下一次」加成，等对应的行动来消费
 */
function useRune(state, id, now = Date.now()) {
  const item = RUNE_ITEM_MAP[id];
  if (!item) return { ok: false, reason: '并无此符' };
  if (runeCount(state, id, now) <= 0) {
    return { ok: false, reason: `没有可用的${item.name}${runeExpiresIn(state, id, now) === 0 && runesOf(state).stock[id] ? '（已过保质期）' : ''}` };
  }
  const r = runesOf(state);
  if (item.effect.kind === 'train') {
    const ms = item.effect.hours * 3600 * 1000;
    // 已经在生效中就不再叠加时长，只把倍率取最高 —— 免得囤符无限续
    r.trainUntil = Math.max(Number(r.trainUntil) || 0, now + ms);
    r.trainRate = Math.max(Number(r.trainRate) || 0, item.effect.rate);
  } else {
    r.pending[item.effect.kind] = item.effect.points;
  }
  consumeRune(state, id, now);
  return { ok: true, name: item.name, text: item.text, reason: `${item.name}已启用：${item.text}` };
}

/** 聚灵符带来的修炼倍率（1 表示没有）。 */
function runeTrainingMult(state, now = Date.now()) {
  const r = runesOf(state);
  if ((Number(r.trainUntil) || 0) <= now) return 1;
  return 1 + (Number(r.trainRate) || 0);
}

/* ── 每帧推进 ── */

/**
 * 符箓的时间推进：清理过期存货、结束聚灵符。
 * 由 systems/cultivation.js 的每步调用。
 */
function advanceRunes(state, dt, now = Date.now()) {
  const r = runesOf(state);
  if (!(dt > 0)) return;
  // 聚灵符到期：清掉倍率
  if ((Number(r.trainUntil) || 0) > 0 && now >= r.trainUntil) {
    r.trainUntil = 0;
    r.trainRate = 0;
  }
  for (const id of Object.keys(r.stock)) {
    const e = r.stock[id];
    if (e.expiresAt > 0 && now >= e.expiresAt) {
      pushLog(state, `${RUNE_ITEM_MAP[id]?.name || id}过了保质期，${e.n} 张尽数作废。`, 'cultivate', null, now);
      delete r.stock[id];
    }
  }
}

/* ── 符台 ── */

function benchUpgradePlan(state) {
  const r = runesOf(state);
  const cur = runeBenchAt(r.bench);
  if (r.bench >= RUNE_BENCH_MAX) return { ok: false, reason: '符台已至顶阶', level: r.bench, current: cur };
  const next = RUNE_BENCH_LEVELS[r.bench];
  if ((state.spiritStones || 0) < next.stones) {
    return { ok: false, reason: `需 ${next.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）`, next, current: cur };
  }
  if ((state.silver || 0) < next.silver) {
    return { ok: false, reason: `需 ${next.silver} 两银（现有 ${Math.floor(state.silver || 0)}）`, next, current: cur };
  }
  return { ok: true, kind: 'bench', next, current: cur, toLevel: r.bench + 1,
    stones: next.stones, silver: next.silver, cost: next.stones, currency: 'stones' };
}

function commitBenchUpgrade(state, now = Date.now()) {
  const plan = benchUpgradePlan(state);
  if (!plan.ok) return plan;
  const r = runesOf(state);
  state.spiritStones -= plan.stones;
  state.silver -= plan.silver;
  r.bench = plan.toLevel;
  pushLog(state, `符台升为${RUNE_BENCH_LEVELS[r.bench - 1].name}（${r.bench} 级）。`, 'cultivate', null, now);
  return { ok: true, level: r.bench, name: RUNE_BENCH_LEVELS[r.bench - 1].name,
    reason: `符台升为${RUNE_BENCH_LEVELS[r.bench - 1].name}` };
}
