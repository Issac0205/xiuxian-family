/* ────────────────────────── 科技 ────────────────────────── */

/** 把已研习科技的效果累加起来。 */
function techEffects(state) {
  const acc = {
    estateDiscount: 0,
    birthFlat: 0,
    incomeMult: 0,
    tradeSpeed: 0,
    fieldBonus: 0,
    tradeIncome: 0,
    deathFlat: 0,
    secretChance: 0,
  };
  for (const id of state.techs || []) {
    const tech = TECH_MAP[id];
    if (!tech || !tech.effect) continue;
    for (const key of Object.keys(acc)) {
      if (typeof tech.effect[key] === 'number') acc[key] += tech.effect[key];
    }
  }
  return acc;
}

/**
 * 演武台的地产折扣：边际递减，趋近（但拿不满）ARENA_DISCOUNT_MAX。
 *
 *   折扣(n) = MAX × n / (n + HALF)
 *
 * 第 1 座就拿到 MAX/(1+HALF)（约 4.6%），第 HALF 座时刚好一半，
 * 之后每多一座的增量都在变小。所以「堆演武台」不再有终点，
 * 但也不再有「买到第 15 座就封顶、后面白买」这种浪费。
 */
function arenaDiscount(n) {
  const count = Math.max(0, n || 0);
  if (count <= 0) return 0;
  return (ARENA_DISCOUNT_MAX * count) / (count + ARENA_DISCOUNT_HALF);
}

/**
 * 商路的一趟回报（已含科技对收益的削减）。
 * 探秘者这类科技会让商队赚得少，所以报价必须过这一层。
 */
function tradeReward(state, route) {
  const fx = techEffects(state);
  return routeReward(route, 1 + fx.tradeIncome);
}

/** 一趟商路带回秘闻的概率（已含科技加成）。 */
function tradeSecretChance(state, route) {
  const fx = techEffects(state);
  return Math.min(1, Math.max(0, (route.secretChance || 0) + fx.secretChance + cultivationBonuses(state).exploreTradeBonus));
}

/** 科技是否已研习。 */
function isResearched(state, techId) {
  return (state.techs || []).includes(techId);
}

/** 科技的前置是否全部满足。 */
function isTechUnlocked(state, tech) {
  return tech.requires.every((r) => isResearched(state, r));
}

/**
 * 科技当前状态：
 *  done   已研习
 *  locked 前置未满足（缺前置科技，或缺秘闻）
 *  open   可研习但银两不够
 *  ready  银两充足，可以研习
 */
function techStatus(state, tech) {
  if (isResearched(state, tech.id)) return 'done';
  if (!isTechUnlocked(state, tech)) return 'locked';
  if (tech.requiresSecrets
    && (state.secrets || []).length < CULTIVATOR_MARKET.requiresSecrets) {
    return 'locked';
  }
  return state.silver >= tech.cost ? 'ready' : 'open';
}

/** 建筑是否已解锁。 */
function isBuildingUnlocked(state, def) {
  return !def.tech || isResearched(state, def.tech);
}

/** 可研习（前置满足且未研习）的科技数量。 */
function researchableCount(state) {
  let n = 0;
  for (const id of Object.keys(TECH_MAP)) {
    const tech = TECH_MAP[id];
    if (techStatus(state, tech) === 'ready') n += 1;
  }
  return n;
}

/* ────────────────────────── 派生数值 ────────────────────────── */

/**
 * 由状态推导出的全部「即时数值」。
 * 每帧重算一次；不要把结果存进存档，它们随时可以重算。
 */
function derive(state) {
  const b = state.buildings;
  const fx = techEffects(state);

  // ── 建筑容量 ───────────────────────────────────────────────
  const buildingCap = BASE.buildingCap + (b.estate || 0) * ESTATE_SLOTS;
  let usedSlots = 0;
  for (const def of SLOT_BUILDINGS) usedSlots += (b[def.id] || 0) * def.slots;
  const freeSlots = Math.max(0, buildingCap - usedSlots);

  // ── 人口 ──────────────────────────────────────────────────
  const housingCap = BASE.housing + (b.house || 0) * HOUSE_CAPACITY;
  const crowdRatio = housingCap > 0 ? state.population / housingCap : 1;
  const crowdOver = Math.max(
    0,
    (crowdRatio - CROWD.threshold) / (1 - CROWD.threshold),
  );

  const birthRate =
    BASE.birthRate + fx.birthFlat + (b.field || 0) * FIELD_BIRTH * (1 + fx.fieldBonus);

  /**
   * 死亡率 = 基础 + 拥挤 + 对外扩张的代价。
   * 演武台与商队驿站各按座数计——走出去的人回不来，人口基就薄一层。
   */
  const expandDeath = (b.arena || 0) * ARENA_DEATH + (b.caravan || 0) * CARAVAN_DEATH;
  const crowdDeath = CROWD.k * crowdOver * crowdOver;
  const deathRate = BASE.deathRate + crowdDeath + expandDeath + fx.deathFlat;
  const netRate = birthRate - deathRate;

  // ── 银两 ──────────────────────────────────────────────────
  const silverCap = BASE.silverCap + (b.bank || 0) * BANK_CAPACITY;
  const cultivateFx = cultivationBonuses(state);
  const silverPerSec = state.population * BASE.silverPerPop * (1 + fx.incomeMult) * (1 + cultivateFx.laborMult);

  // ── 造价 ──────────────────────────────────────────────────
  /** 全局通胀：房产愈多，地产以外的营造愈贵。 */
  const inflation = 1 + (b.house || 0) * HOUSE_INFLATION;
  /** 地产折扣 = 演武台（递减，有渐近上限）+ 科技，再受总上限约束。 */
  const arenaPart = arenaDiscount(b.arena || 0);
  const estateDiscountTotal = Math.min(TOTAL_DISCOUNT_MAX, arenaPart + fx.estateDiscount);
  const estateDiscount = 1 - estateDiscountTotal;

  // ── 商队 ──────────────────────────────────────────────────
  const caravanSlots = (b.caravan || 0) * CARAVAN_SLOTS_PER;
  const usedCaravans = state.caravans.length;
  const freeCaravans = Math.max(0, caravanSlots - usedCaravans);

  // ── 解锁情况 ───────────────────────────────────────────────
  /** @type {Record<string, boolean>} */
  const unlocked = {};
  for (const def of BUILDINGS) unlocked[def.id] = isBuildingUnlocked(state, def);

  // ── 通往修仙篇的那条链 ─────────────────────────────────────
  const secretCount = (state.secrets || []).length;
  const secretGoal = CULTIVATOR_MARKET.requiresSecrets;
  const marketUnlocked = secretCount >= secretGoal;
  const stones = state.spiritStones || 0;
  const qi = state.cultivation?.cultivators?.length ?? (state.cultivation?.qi || 0);
  const mortalPower=state.population*0.1;
  const cultivatorPower=cultivateFx.corePower;
  const guardPower=cultivateFx.guardBonus;
  const totalPower=mortalPower+cultivatorPower+guardPower;

  return {
    fx,
    unlocked,

    secretCount,
    secretGoal,
    marketUnlocked,
    stones,
    qi,
    cultivateFx,
    totalPower, mortalPower, cultivatorPower, guardPower,
    cultivationUnlocked: Boolean(state.cultivation?.unlocked),

    buildingCap,
    usedSlots,
    freeSlots,

    housingCap,
    crowdRatio,
    crowdOver,

    birthRate,
    deathRate,
    crowdDeath,
    expandDeath,
    netRate,
    netPerSec: state.population * netRate,

    silverCap,
    silverPerSec,

    inflation,
    estateDiscount,
    estateDiscountTotal,

    caravanSlots,
    usedCaravans,
    freeCaravans,
    tradeUnlocked: unlocked.caravan && freeCaravans + usedCaravans > 0,
  };
}

/* ────────────────────────── 造价 ────────────────────────── */

/**
 * 某建筑的当前单位价格倍率。
 *  - 房产不承担自己造成的通胀（否则会双重指数爆炸）
 *  - 地产额外享受演武台与科技折扣
 */
function costMultiplier(state, d, def) {
  if (def.id === 'house') return 1;
  if (def.id === 'estate') return d.inflation * d.estateDiscount;
  return d.inflation;
}

/** 下一座的单价。 */
function currentUnitCost(state, d, def) {
  const owned = state.buildings[def.id] || 0;
  return def.baseCost * Math.pow(def.growth, owned) * costMultiplier(state, d, def);
}

/** 等比数列求和：从 c0 起连续 count 座的总价。 */
function sumCost(c0, growth, count) {
  if (count <= 0) return 0;
  if (Math.abs(growth - 1) < 1e-9) return c0 * count;
  return (c0 * (Math.pow(growth, count) - 1)) / (growth - 1);
}

/** 连续购置 count 座的总价。 */
function batchCost(state, d, def, count) {
  const c0 = currentUnitCost(state, d, def);
  return sumCost(c0, def.growth, count);
}

/**
 * 按购买模式算出本次能买几座。
 * @param {'1'|'10'|'max'} mode
 */
function maxAffordable(state, d, def, mode) {
  if (!isBuildingUnlocked(state, def)) return 0;

  const c0 = currentUnitCost(state, d, def);
  const g = def.growth;

  let k = 0;
  if (state.silver >= c0) {
    // Σ c0·g^i ≤ S  ⇒  k ≤ log(1 + S(g-1)/c0) / log(g)
    k = Math.floor(
      Math.log(1 + (state.silver * (g - 1)) / c0) / Math.log(g),
    );
    if (!Number.isFinite(k) || k < 0) k = 0;
    // 浮点修正
    while (k > 0 && sumCost(c0, g, k) > state.silver) k -= 1;
    while (sumCost(c0, g, k + 1) <= state.silver) k += 1;
  }

  // 建筑容量限制
  if (def.slots > 0) {
    k = Math.min(k, Math.floor(d.freeSlots / def.slots));
  }

  k = Math.min(k, MAX_BATCH);
  if (mode === '1') k = Math.min(k, 1);
  else if (mode === '10') k = Math.min(k, 10);

  return Math.max(0, k);
}

/** 人口状态的一句话描述。 */
function populationMood(d) {
  if (d.netRate > 0.002) return { key: 'boom', text: '人丁兴旺' };
  if (d.netRate > 0.0002) return { key: 'grow', text: '缓慢滋生' };
  if (d.netRate > -0.0002) return { key: 'flat', text: '不增不减' };
  if (d.netRate > -0.004) return { key: 'shrink', text: '略有凋零' };
  return { key: 'crisis', text: '人丁凋敝' };
}

/* ────────────────────────── 批量派遣 ────────────────────────── */

/**
 * 这批能派几队商队。
 *
 * 上限同时受「空商队位」和「银两」约束。「一半」向上取整——
 * 只剩 1 个空位时也派得出去，不然那个按钮就成了摆设。
 *
 * @param {'all'|'half'} fleet
 */
function fleetSize(state, d, route, fleet) {
  const bySilver = Math.floor(state.silver / route.cost);
  const capacity = Math.min(d.freeCaravans, bySilver);
  if (capacity <= 0) return 0;
  if (fleet === 'half') {
    return Math.min(Math.ceil(Math.min(d.freeCaravans, capacity) / 2), capacity);
  }
  return capacity;
}

/* ────────────────────────── 出售 ────────────────────────── */

/**
 * 卖掉已拥有的 count 座能拿回多少银两（半价）。
 *
 * 卖掉的是**最近买的那几座**——它们单价最高。所以「买进来再卖出去」永远是亏的，
 * 不存在低买高卖的套利空间。
 */
function sellRefund(state, d, def, count = 1) {
  const owned = state.buildings[def.id] || 0;
  const k = Math.min(Math.max(0, Math.floor(count)), owned);
  if (k <= 0) return 0;

  const g = def.growth;
  // 「下一座」的价格，也就是手里最贵的那些
  const nextCost = def.baseCost * Math.pow(g, owned) * costMultiplier(state, d, def);
  const gross = Math.abs(g - 1) < 1e-9
    ? nextCost * k
    : (nextCost * (1 - Math.pow(g, -k))) / (g - 1);

  return gross * SELL_RATIO;
}

/**
 * 最多能卖几座。
 *
 * 地产是建筑容量的来源，把它拆了可能让已用容量撑破上限；其余建筑只占容量，
 * 卖掉只会腾出空间，所以不受限。
 */
function maxSellable(state, d, def) {
  const owned = state.buildings[def.id] || 0;
  if (owned <= 0) return 0;
  if (def.id !== 'estate') return owned;

  // 卖 k 座后仍要满足：BASE.buildingCap + (owned - k) * ESTATE_SLOTS >= usedSlots
  const need = Math.ceil(Math.max(0, d.usedSlots - BASE.buildingCap) / ESTATE_SLOTS);
  return Math.max(0, Math.min(owned, owned - need));
}
