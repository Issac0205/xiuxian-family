
/* ────────────────────────────────────────────────────────────────
 * 区块：炼器规则
 * 职责：矿料产出、法器打造、装备与耐久、祭炼、锻造台升级。
 *       与 systems/alchemy.js 同构 —— 两条线的形状刻意保持一致，
 *       这样加第三个体系（炼符）时不需要重新发明一套约定。
 * 依赖：data/forge.js（表）、data/map.js、systems/roots.js
 * 调参：数值全在 data/forge.js，本文件不含魔法数字。
 * 文档：docs/31-炼器.md
 * ──────────────────────────────────────────────────────────────── */

/** 取（并初始化）器坊状态。 */
function forgeOf(state) {
  const c = state.cultivation;
  if (!c) return { ores: {}, owned: [], equipped: {}, durability: {}, prof: {}, level: 1, crafts: 0 };
  if (!c.forge || typeof c.forge !== 'object') c.forge = {};
  const f = c.forge;
  if (!f.ores || typeof f.ores !== 'object') f.ores = {};
  if (!Array.isArray(f.owned)) f.owned = [];
  if (!f.equipped || typeof f.equipped !== 'object') f.equipped = {};
  if (!f.durability || typeof f.durability !== 'object') f.durability = {};
  if (!f.prof || typeof f.prof !== 'object') f.prof = {};
  f.level = Math.max(1, Math.min(FORGE_LEVEL_MAX, Math.floor(Number(f.level) || 1)));
  f.owned = f.owned.filter((id) => FORGE_ITEM_MAP[id]);
  f.owned = [...new Set(f.owned)];
  for (const k of Object.keys(f.ores)) {
    if (!FORGE_ORE_MAP[k]) { delete f.ores[k]; continue; }
    f.ores[k] = Math.max(0, Number(f.ores[k]) || 0);
  }
  for (const k of Object.keys(f.durability)) {
    if (!f.owned.includes(k)) { delete f.durability[k]; continue; }
    f.durability[k] = Math.max(0, Math.min(FORGE_DURABILITY_MAX, Number(f.durability[k]) || 0));
  }
  for (const k of Object.keys(f.prof)) {
    if (!FORGE_ITEM_MAP[k]) { delete f.prof[k]; continue; }
    f.prof[k] = Math.max(0, Math.min(FORGE_PROFICIENCY_MAX, Math.floor(Number(f.prof[k]) || 0)));
  }
  // 装备位只能放自己有的、且部位对得上的东西
  for (const slot of Object.keys(FORGE_SLOT_MAP)) {
    const id = f.equipped[slot];
    if (!id) continue;
    const item = FORGE_ITEM_MAP[id];
    if (!item || item.slot !== slot || !f.owned.includes(id)) delete f.equipped[slot];
  }
  // 已拥有的法器必须有耐久记录
  for (const id of f.owned) {
    if (f.durability[id] === undefined) f.durability[id] = FORGE_DURABILITY_MAX;
  }
  return f;
}

/* ── 矿料 ── */

function oreCount(state, id) { return Math.max(0, Number(forgeOf(state).ores[id]) || 0); }
function addOres(state, id, amount) {
  const f = forgeOf(state);
  f.ores[id] = Math.max(0, (Number(f.ores[id]) || 0) + amount);
}

/** 所有领地每秒产出的矿料合计。 */
function orePerSec(state) {
  const out = {};
  for (const o of FORGE_ORES) out[o.id] = 0;
  for (const id of worldOf(state).held) {
    const node = mapNode(id);
    if (!node || !node.ore) continue;
    if (!mapIsPacified(state, id)) continue;
    out[node.ore] = (out[node.ore] || 0) + (node.oreYield || 0);
  }
  return out;
}

/* ── 器师与灵根 ── */

/** 当前的器师（负责炼器的修士）。 */
function smith(state) {
  return (state.cultivation?.cultivators || []).find((p) => p.job === 'forge') || null;
}

/**
 * 金灵根对炼器的加成。
 * 与炼丹的木灵根对称：金主锋锐，宜作兵刃。
 */
function forgeMetalBonus(state) {
  const p = smith(state);
  if (!p) return 0;
  if (!rootElementsOf(p).includes('metal')) return 0;
  return FORGE_METAL_BASE + FORGE_METAL_PER_RANK * Math.max(0, rootRank(p) - 1);
}

/* ── 打造 ── */

function forgeProficiency(state, itemId) {
  return Math.max(0, Math.min(FORGE_PROFICIENCY_MAX, Math.floor(Number(forgeOf(state).prof[itemId]) || 0)));
}

/**
 * 某件法器当前的成功率。
 * 与炼丹同一条约定：锻造台等级夹到至少该法器的要求，
 * 免得给玩家显示一个永远达不到的数字。
 */
function forgeRate(state, itemId) {
  const item = FORGE_ITEM_MAP[itemId];
  if (!item) return 0;
  const lv = Math.max(forgeOf(state).level, item.forge);
  const rate = item.baseRate
    + forgeAt(lv).rateBonus
    + forgeProficiency(state, itemId) * FORGE_PROFICIENCY_STEP
    + forgeMetalBonus(state)
    // 器修流派：专精这一行，代价是修炼分心
    + schoolFx(state, 'forgeRate');
  return Math.max(FORGE_RATE_MIN, Math.min(FORGE_RATE_MAX, rate));
}

/** 询价：这件法器现在能不能打。 */
function forgePlan(state, itemId) {
  const item = FORGE_ITEM_MAP[itemId];
  if (!item) return { ok: false, reason: '并无此器' };
  if (forgeOf(state).owned.includes(itemId)) {
    return { ok: false, reason: '已铸成此器（法器不重复铸造，祭炼即可）', item };
  }
  if (forgeAt(forgeOf(state).level).level < item.forge) {
    return { ok: false, reason: `需 ${FORGE_LEVELS[item.forge - 1].name}（锻造台 ${item.forge} 级）`, item };
  }
  const missing = [];
  for (const [ore, need] of Object.entries(item.materials)) {
    if (oreCount(state, ore) < need) missing.push(`${FORGE_ORE_MAP[ore]?.name || ore} 缺 ${Math.ceil(need - oreCount(state, ore))}`);
  }
  if (missing.length) return { ok: false, reason: missing.join('、'), item };
  return {
    ok: true, kind: 'forge', item, itemId,
    name: item.name, slot: FORGE_SLOT_MAP[item.slot].name,
    rate: forgeRate(state, itemId),
    prof: forgeProficiency(state, itemId),
    metal: forgeMetalBonus(state),
    materials: { ...item.materials },
    cost: 0, currency: 'none',
  };
}

/** 打一件。**失败损失全部矿料** —— 与炼丹同一条负面对价。 */
function commitForge(state, itemId, now = Date.now(), rng = Math.random) {
  const plan = forgePlan(state, itemId);
  if (!plan.ok) return plan;
  const item = plan.item;
  const f = forgeOf(state);
  for (const [ore, need] of Object.entries(item.materials)) {
    f.ores[ore] = Math.max(0, oreCount(state, ore) - need);
  }
  f.crafts = (f.crafts || 0) + 1;

  if (rng() >= plan.rate) {
    return { ok: true, success: false, name: item.name,
      reason: `铸${item.name}失败（成功率 ${(plan.rate * 100).toFixed(0)}%），一炉矿料尽废` };
  }

  f.owned.push(itemId);
  f.durability[itemId] = FORGE_DURABILITY_MAX;
  const before = forgeProficiency(state, itemId);
  f.prof[itemId] = Math.min(FORGE_PROFICIENCY_MAX, before + 1);
  // 铸成之后如果该部位还空着，自动装上 —— 少一次点击
  if (!f.equipped[item.slot]) f.equipped[item.slot] = itemId;
  pushLog(state, `${item.name}铸成！`, 'cultivate', null, now);
  return {
    ok: true, success: true, name: item.name,
    equipped: f.equipped[item.slot] === itemId,
    reason: `铸成${item.name}（${FORGE_SLOT_MAP[item.slot].name} · 战力 +${(item.power * 100).toFixed(0)}%）`
      + (f.equipped[item.slot] === itemId ? '，已装备' : ''),
  };
}

/* ── 装备与耐久 ── */

/** 装备一件（必须已有，且部位空闲或替换）。 */
function equipArtifact(state, itemId) {
  const item = FORGE_ITEM_MAP[itemId];
  if (!item) return { ok: false, reason: '并无此器' };
  const f = forgeOf(state);
  if (!f.owned.includes(itemId)) return { ok: false, reason: '尚未铸成此器' };
  f.equipped[item.slot] = itemId;
  return { ok: true, reason: `已装备${item.name}（${FORGE_SLOT_MAP[item.slot].name}）` };
}

/** 卸下某个部位。 */
function unequipSlot(state, slot) {
  const f = forgeOf(state);
  if (!f.equipped[slot]) return { ok: false, reason: '此位本空' };
  const name = FORGE_ITEM_MAP[f.equipped[slot]]?.name || '';
  delete f.equipped[slot];
  return { ok: true, reason: `已卸下${name}` };
}

/** 某件法器当前的耐久。 */
function durabilityOf(state, itemId) {
  const f = forgeOf(state);
  if (!f.owned.includes(itemId)) return 0;
  return Math.max(0, Math.min(FORGE_DURABILITY_MAX, Number(f.durability[itemId]) || 0));
}

/**
 * 家族当前实际生效的法器加成。
 *
 * **耐久为 0 的法器不给加成** —— 这是炼器区块的负面对价：
 * 法器会在征伐与探险中磨损，破了就得花矿料重祭，
 * 所以「一直打」和「养得起」是两件事。
 */
function artifactBonus(state) {
  const f = forgeOf(state);
  let power = 0;
  let survive = 0;
  const broken = [];
  for (const slot of Object.keys(FORGE_SLOT_MAP)) {
    const id = f.equipped[slot];
    if (!id) continue;
    const item = FORGE_ITEM_MAP[id];
    if (!item) continue;
    const dur = durabilityOf(state, id);
    if (dur <= 0) { broken.push(item.name); continue; }
    // 耐久越低效果越弱：五成耐久给七成效果，见 doc
    const wearFactor = 0.7 + 0.3 * (dur / FORGE_DURABILITY_MAX);
    power += item.power * wearFactor;
    survive += (item.survive || 0) * wearFactor;
  }
  return { power, survive, broken };
}

/**
 * 磨损。由攻伐与洞天结算调用。
 * @param {string} reason 'attack' | 'cave'
 */
function wearArtifacts(state, reason) {
  const f = forgeOf(state);
  const out = [];
  for (const id of Object.values(f.equipped)) {
    const item = FORGE_ITEM_MAP[id];
    if (!item || !id) continue;
    // 护甲在攻伐里挨打更多，法宝在洞天里消耗更大
    const mult = reason === 'cave'
      ? (item.slot === 'talisman' ? 1.6 : 0.7)
      : (item.slot === 'armor' ? 1.5 : 0.9);
    const before = durabilityOf(state, id);
    const after = Math.max(0, before - item.wear * FORGE_WEAR_SCALE * mult);
    f.durability[id] = after;
    if (after <= 0 && before > 0) out.push(item.name);
  }
  return out;
}

/* ── 祭炼（修复） ── */

/** 祭炼消耗：打造材料的一半（向上取整）。 */
function repairCost(item) {
  const out = {};
  for (const [ore, n] of Object.entries(item.materials)) out[ore] = Math.max(1, Math.ceil(n / 2));
  return out;
}

function repairPlan(state, itemId) {
  const item = FORGE_ITEM_MAP[itemId];
  if (!item) return { ok: false, reason: '并无此器' };
  if (!forgeOf(state).owned.includes(itemId)) return { ok: false, reason: '尚未铸成此器' };
  const dur = durabilityOf(state, itemId);
  if (dur >= FORGE_DURABILITY_MAX) return { ok: false, reason: '完好如初，无需祭炼', item };
  const need = repairCost(item);
  const missing = [];
  for (const [ore, n] of Object.entries(need)) {
    if (oreCount(state, ore) < n) missing.push(`${FORGE_ORE_MAP[ore]?.name || ore} 缺 ${Math.ceil(n - oreCount(state, ore))}`);
  }
  if (missing.length) return { ok: false, reason: missing.join('、'), item, materials: need };
  return { ok: true, kind: 'repair', item, itemId, name: item.name, durability: dur, materials: need, cost: 0, currency: 'none' };
}

function commitRepair(state, itemId, now = Date.now()) {
  const plan = repairPlan(state, itemId);
  if (!plan.ok) return plan;
  const f = forgeOf(state);
  for (const [ore, n] of Object.entries(repairCost(plan.item))) {
    f.ores[ore] = Math.max(0, oreCount(state, ore) - n);
  }
  f.durability[itemId] = FORGE_DURABILITY_MAX;
  return { ok: true, name: plan.item.name, reason: `${plan.item.name}已重祭，耐久恢复如初` };
}

/* ── 锻造台 ── */

function forgeUpgradePlan(state) {
  const f = forgeOf(state);
  const cur = forgeAt(f.level);
  if (f.level >= FORGE_LEVEL_MAX) return { ok: false, reason: '锻造台已至顶阶', level: f.level, current: cur };
  const next = FORGE_LEVELS[f.level];
  if ((state.spiritStones || 0) < next.stones) {
    return { ok: false, reason: `需 ${next.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）`, next, current: cur };
  }
  if ((state.silver || 0) < next.silver) {
    return { ok: false, reason: `需 ${next.silver} 两银（现有 ${Math.floor(state.silver || 0)}）`, next, current: cur };
  }
  return { ok: true, kind: 'forge-level', next, current: cur, toLevel: f.level + 1,
    stones: next.stones, silver: next.silver, cost: next.stones, currency: 'stones' };
}

function commitForgeUpgrade(state, now = Date.now()) {
  const plan = forgeUpgradePlan(state);
  if (!plan.ok) return plan;
  const f = forgeOf(state);
  state.spiritStones -= plan.stones;
  state.silver -= plan.silver;
  f.level = plan.toLevel;
  pushLog(state, `锻造台升为${FORGE_LEVELS[f.level - 1].name}（${f.level} 级）。`, 'cultivate', null, now);
  return { ok: true, level: f.level, name: FORGE_LEVELS[f.level - 1].name,
    reason: `锻造台升为${FORGE_LEVELS[f.level - 1].name}` };
}
