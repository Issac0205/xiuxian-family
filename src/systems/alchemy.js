
/* ────────────────────────────────────────────────────────────────
 * 区块：炼丹规则
 * 职责：药材产出、丹方成功率、炼制结算、丹炉升级。
 *       药材从地图上「已占领且有效镇守」的节点来（见 systems/exploration.js），
 *       丹药则是四道大境界突破门槛的必需材料（见 data/realms.js 的 REALM_GATES）。
 * 依赖：data/alchemy.js（表）、data/map.js、systems/roots.js、data/realms.js
 * 调参：数值全在 data/alchemy.js，本文件不含魔法数字。
 * 文档：docs/30-炼丹.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 取（并初始化）丹房状态。
 *
 * ⚠️ 祛障丹的数量**故意留在旧的 `cultivation.pills` 字段里**（不是这里），
 *    因为它在 R1 就有、被坊市与界面四处读着。搬动它只会平白引入迁移风险，
 *    所以这里只管 R5 新增的丹药，`pillCount()` 负责把两者统一对外。
 */
function alchemyOf(state) {
  const c = state.cultivation;
  if (!c) return { herbs: {}, pills: {}, furnace: 1, prof: {} };
  if (!c.alchemy || typeof c.alchemy !== 'object') c.alchemy = {};
  const a = c.alchemy;
  if (!a.herbs || typeof a.herbs !== 'object') a.herbs = {};
  if (!a.pills || typeof a.pills !== 'object') a.pills = {};
  if (!a.prof || typeof a.prof !== 'object') a.prof = {};
  a.furnace = Math.max(1, Math.min(ALCHEMY_FURNACE_MAX, Math.floor(Number(a.furnace) || 1)));
  // 清掉不再存在的药材 / 丹药键，并保证数量是非负整数
  for (const k of Object.keys(a.herbs)) {
    if (!ALCHEMY_HERB_MAP[k]) { delete a.herbs[k]; continue; }
    a.herbs[k] = Math.max(0, Number(a.herbs[k]) || 0);
  }
  for (const k of Object.keys(a.pills)) {
    if (!ALCHEMY_RECIPE_MAP[k] || k === 'quzhang') { delete a.pills[k]; continue; }
    a.pills[k] = Math.max(0, Math.floor(Number(a.pills[k]) || 0));
  }
  for (const k of Object.keys(a.prof)) {
    if (!ALCHEMY_RECIPE_MAP[k]) { delete a.prof[k]; continue; }
    a.prof[k] = Math.max(0, Math.min(ALCHEMY_PROFICIENCY_MAX, Math.floor(Number(a.prof[k]) || 0)));
  }
  return a;
}

/** 某种药材的存量。 */
function herbCount(state, id) { return Math.max(0, Number(alchemyOf(state).herbs[id]) || 0); }

/**
 * 某种丹药的存量。
 * 祛障丹走旧字段，其余走丹房 —— 这是两个存量唯一的对外出口。
 */
function pillCount(state, id) {
  if (id === 'quzhang') return Math.max(0, Math.floor(Number(state.cultivation?.pills) || 0));
  return Math.max(0, Math.floor(Number(alchemyOf(state).pills[id]) || 0));
}

/** 增减丹药。传负数表示消耗。 */
function addPills(state, id, n) {
  const d = Math.floor(Number(n) || 0);
  if (id === 'quzhang') {
    state.cultivation.pills = Math.max(0, pillCount(state, id) + d);
    return;
  }
  const a = alchemyOf(state);
  a.pills[id] = Math.max(0, pillCount(state, id) + d);
}

/** 某个丹方当前的熟练度。 */
function proficiency(state, recipeId) {
  return Math.max(0, Math.min(ALCHEMY_PROFICIENCY_MAX, Math.floor(Number(alchemyOf(state).prof[recipeId]) || 0)));
}

/** 当前的丹师（负责炼丹的修士），没人就返回 null。 */
function alchemist(state) {
  return (state.cultivation?.cultivators || []).find((p) => p.job === 'alchemy') || null;
}

/**
 * 木灵根对炼丹的加成。
 *
 * 这是 R3 那个「白占一位」的木属性的兑现处：丹道属木，
 * 灵根里带木才吃得到加成，越纯加得越多（天灵根木能到 +24%）。
 */
function alchemyWoodBonus(state) {
  const p = alchemist(state);
  if (!p) return 0;
  if (!rootElementsOf(p).includes('wood')) return 0;
  return ALCHEMY_WOOD_BASE + ALCHEMY_WOOD_PER_RANK * Math.max(0, rootRank(p) - 1);
}

/**
 * 某个丹方当前的成功率。
 * 四个来源：丹方基础率 + 丹炉 + 熟练度 + 木灵根。全部公开在界面上。
 *
 * ⚠️ 丹炉等级**夹到至少该丹方的要求**：丹炉不达标时这炉本来就炼不了，
 *    此时显示「按当前丹炉算」的数字（比如金丹 72%）是误导 ——
 *    玩家升到三级炉之后会变成 78%，那个 72% 永远不会出现。
 *    按达标丹炉算，玩家看到的才是「能炼的那天会是多少」。
 */
function recipeRate(state, recipeId) {
  const r = ALCHEMY_RECIPE_MAP[recipeId];
  if (!r) return 0;
  const lv = Math.max(alchemyOf(state).furnace, r.furnace);
  const rate = r.baseRate
    + furnaceAt(lv).rateBonus
    + proficiency(state, recipeId) * ALCHEMY_PROFICIENCY_STEP
    + alchemyWoodBonus(state)
    // 丹修流派：专精这一行，代价是战力
    + schoolFx(state, 'alchemyRate')
    // 仙道科技「金丹大道」：把火候写定，全族少炸几炉
    + techEffects(state).alchemyRateBonus;
  return Math.max(ALCHEMY_RATE_MIN, Math.min(ALCHEMY_RATE_MAX, rate));
}

/** 一炉能出几枚。 */
function recipeYield(state, recipeId) {
  const r = ALCHEMY_RECIPE_MAP[recipeId];
  if (!r) return 0;
  return r.yield + furnaceAt(alchemyOf(state).furnace).yieldBonus;
}

/**
 * 询价：这个丹方现在能不能炼、要什么、成功率多少。
 * 与 commitCraft 分离，所以界面上写的与实际扣的一致。
 */
function recipePlan(state, recipeId) {
  const r = ALCHEMY_RECIPE_MAP[recipeId];
  if (!r) return { ok: false, reason: '并无此方' };
  // 丹方也能被仙道科技 gate 住（例：凝丹丸要「金丹大道」）。
  // 与 techs.js 的 requiresImmortal 是同一套约定，只是长在丹方上。
  if (r.requiresImmortalTech && !isImmortalTechResearched(state, r.requiresImmortalTech)) {
    return {
      ok: false,
      reason: `此方尚未参透（须仙道「${IMMORTAL_TECH_MAP[r.requiresImmortalTech]?.name || r.requiresImmortalTech}」）`,
      recipe: r,
    };
  }
  const a = alchemyOf(state);
  if (furnaceAt(a.furnace).level < r.furnace) {
    return { ok: false, reason: `需 ${ALCHEMY_FURNACE[r.furnace - 1].name}（丹炉 ${r.furnace} 级）`, recipe: r };
  }
  const missing = [];
  for (const [herb, need] of Object.entries(r.materials)) {
    const have = herbCount(state, herb);
    if (have < need) {
      missing.push(`${ALCHEMY_HERB_MAP[herb]?.name || herb} 缺 ${Math.ceil(need - have)}`);
    }
  }
  if (missing.length) return { ok: false, reason: missing.join('、'), recipe: r };
  return {
    ok: true, kind: 'craft', recipe: r,
    recipeId: r.id, name: r.name,
    rate: recipeRate(state, r.id),
    out: recipeYield(state, r.id),
    prof: proficiency(state, r.id),
    wood: alchemyWoodBonus(state),
    materials: { ...r.materials },
    cost: 0, currency: 'none',
  };
}

/**
 * 炼一炉。
 *
 * **失败会损失全部材料** —— 所以「先把丹炉升上去、把熟练度刷起来」
 * 是有意义的投入，而不是无脑连点。这是炼丹区块的负面对价。
 */
function commitCraft(state, recipeId, now = Date.now(), rng = Math.random) {
  const plan = recipePlan(state, recipeId);
  if (!plan.ok) return plan;
  const r = plan.recipe;
  const a = alchemyOf(state);

  for (const [herb, need] of Object.entries(r.materials)) {
    a.herbs[herb] = Math.max(0, herbCount(state, herb) - need);
  }
  a.crafts = (a.crafts || 0) + 1;

  if (rng() >= plan.rate) {
    // 失败不掉熟练度，但也不涨 —— 只是白费一炉材料
    return {
      ok: true, success: false, name: r.name,
      reason: `炼${r.name}失败（成功率 ${(plan.rate * 100).toFixed(0)}%），一炉药材尽废`,
    };
  }

  addPills(state, r.id, plan.out);
  const before = proficiency(state, r.id);
  a.prof[r.id] = Math.min(ALCHEMY_PROFICIENCY_MAX, before + 1);
  const now2 = proficiency(state, r.id);
  return {
    ok: true, success: true, name: r.name, out: plan.out,
    prof: now2, profUp: now2 > before,
    total: pillCount(state, r.id),
    reason: `炼成${r.name} ×${plan.out}（现存 ${pillCount(state, r.id)} 枚）`
      + (now2 > before ? `，熟练度提升到 ${now2}/${ALCHEMY_PROFICIENCY_MAX}` : ''),
  };
}

/** 丹炉升级的询价。 */
function furnaceUpgradePlan(state) {
  const a = alchemyOf(state);
  const cur = furnaceAt(a.furnace);
  if (a.furnace >= ALCHEMY_FURNACE_MAX) {
    return { ok: false, reason: '丹炉已至顶阶', level: a.furnace, current: cur };
  }
  const next = ALCHEMY_FURNACE[a.furnace];
  if ((state.spiritStones || 0) < next.stones) {
    return { ok: false, reason: `需 ${next.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）`, next, current: cur };
  }
  if ((state.silver || 0) < next.silver) {
    return { ok: false, reason: `需 ${next.silver} 两银（现有 ${Math.floor(state.silver || 0)}）`, next, current: cur };
  }
  return {
    ok: true, kind: 'furnace', next, current: cur,
    level: a.furnace, toLevel: a.furnace + 1,
    stones: next.stones, silver: next.silver,
    cost: next.stones, currency: 'stones',
  };
}

/** 升级丹炉。 */
function commitFurnaceUpgrade(state, now = Date.now()) {
  const plan = furnaceUpgradePlan(state);
  if (!plan.ok) return plan;
  const a = alchemyOf(state);
  state.spiritStones -= plan.stones;
  state.silver -= plan.silver;
  a.furnace = plan.toLevel;
  pushLog(state, `丹炉升为${ALCHEMY_FURNACE[a.furnace - 1].name}（${a.furnace} 级）。`, 'cultivate', null, now);
  return {
    ok: true, level: a.furnace, name: ALCHEMY_FURNACE[a.furnace - 1].name,
    reason: `丹炉升为${ALCHEMY_FURNACE[a.furnace - 1].name}，成功率 +${(ALCHEMY_FURNACE[a.furnace - 1].rateBonus * 100).toFixed(0)}%`,
  };
}

/**
 * 药材产出。由 systems/exploration.js 的领地结算调用 ——
 * 只有「已占领且有效镇守」的节点才产出药材，规则与赋税完全一致。
 */
function herbYieldFor(state, nodeId) {
  const node = mapNode(nodeId);
  if (!node || !mapIsPacified(state, nodeId)) return 0;
  return node.herbYield || 0;
}

/** 所有领地每秒产出的药材合计。界面用。 */
function herbPerSec(state) {
  const out = {};
  for (const h of ALCHEMY_HERBS) out[h.id] = 0;
  for (const id of worldOf(state).held) {
    const node = mapNode(id);
    if (!node || !node.herb) continue;
    out[node.herb] = (out[node.herb] || 0) + herbYieldFor(state, id);
  }
  return out;
}

/** 累积药材（带小数，界面显示时取整）。 */
function addHerbs(state, id, amount) {
  const a = alchemyOf(state);
  a.herbs[id] = Math.max(0, (Number(a.herbs[id]) || 0) + amount);
}
