/* ────────────────────────── 科技 ────────────────────────── */

/**
 * 凡人侧科技的全部合法 effect 键。
 *
 * ⚠ **加新键必须同时改三处**，缺一处就是静默失败：
 *   1. 这里的累加器（否则数值根本不生效）
 *   2. data/techs.js 的 EFFECT_LABELS（否则界面显示不出这一项收益）
 *   3. 真正消费它的地方（formulas.derive / cultivationEffects / systems/*）
 * scripts/smoke.mjs 里有断言逐项检查这三处是否对齐。
 */
const MORTAL_EFFECT_KEYS = [
  'estateDiscount', 'birthFlat', 'incomeMult', 'tradeSpeed', 'fieldBonus',
  'tradeIncome', 'deathFlat', 'secretChance', 'explorePerSecFlat', 'vaultMult',
];

/**
 * 仙道侧科技的全部合法 effect 键。
 * 与凡人侧分开列，是因为两者的结算位置不同：凡人侧基本都进 derive()，
 * 仙道侧有一部分进 cultivationEffects()（镇守、洞天、冲关）。
 */
const IMMORTAL_EFFECT_KEYS = [
  'immortalCapMult', 'innateBirthMult', 'mineDeathMult', 'mineYieldMult',
  'territoryYieldMult', 'territoryHoldMult', 'garrisonCapFlat',
  'exploreSurviveBonus', 'breakBonusFlat', 'tradeStoneMult',
  'cityMaterialMult', 'runeBenchFree', 'alchemyRateBonus', 'trainMult',
  'familyPowerMult',
  // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「实现要点 1」】第 16 个键。
  // 目的：把「秘闻线索」从**一次性池子**（SECRETS 20 条）改成**按秒累积的可再生资源**，
  // 否则 20 < REALM_GATES 四道门槛的 2+4+8+14=28 条，一周目在数学上无法通关。
  // 数值出处：docs/91 T-0「供给侧」表 —— tanxue +0.0002/秒、jiexu +0.00025/秒，
  // 慢路合计 1.62 条/时，44.6 小时产出 92 条，相对需求 59 条有 +56% 余量。
  // 消费点：systems/cultivation.js 的 progressCultivators()（**不是** cultivationBonuses）。
  'cluePerSecFlat',
];

const ALL_EFFECT_KEYS = [...MORTAL_EFFECT_KEYS, ...IMMORTAL_EFFECT_KEYS];

/**
 * 【修复 用户实机缺陷 · 拼音泄漏 / 任务 t5】科技 id → **中文名**的**唯一入口**。
 *
 * 事故：建筑卡与百科上出现 `须研习「lingtian」` —— 玩家看到的是拼音 id。
 * 根因：调用方写的是 `TECH_MAP[def.tech]?.name || def.tech`，两个问题叠在一起：
 *   ① `TECH_MAP` 只有**凡人城市线**；建筑/条目引用的若是**仙道线** id，
 *      查表落空 → 回退打印原始 id；
 *   ② `|| def.tech` 这个回退本身就是「静默降级成拼音」的写法 ——
 *      它让「查不到」表现成「看起来还行」，于是没有人会发现。
 *
 * 所以这里做两件事：
 *   · **两条线一起查**（凡人 `TECH_MAP` + 仙道 `IMMORTAL_TECH_MAP`）；
 *   · 查不到时**不回退成 id**，返回 `null` —— 由调用方决定怎么兜
 *     （本项目一律写「未知科技」，并另有机械扫描断言保证没有任何 id 漏网）。
 * 出处：主策收口指令第 3 条（单一入口 `techNameOf(id)` + 去掉 `|| def.tech` 回退 + 机械扫描断言）。
 */
function techNameOf(id) {
  if (!id) return null;
  const t = TECH_MAP[id] || IMMORTAL_TECH_MAP[id];
  return t && typeof t.name === 'string' && t.name ? t.name : null;
}

/** 取科技的展示名；查不到时给一个**中文**兜底（绝不回退成 id）。 */
function techLabelOf(id) {
  return techNameOf(id) || '未知科技';
}

/**
 * 把已研习科技的效果累加起来。
 *
 * 两条线**共用一个累加器**：凡人科技读 state.techs，仙道科技读 state.immortalTechs。
 * 之所以不分成两个函数，是因为下游（derive / cultivationEffects）本来就希望
 * 「不管是哪条线给的，都在这儿一起算」—— 分开只会让每个消费点写两遍。
 */
function techEffects(state) {
  const acc = {};
  for (const k of ALL_EFFECT_KEYS) acc[k] = 0;
  const eat = (list, map) => {
    for (const id of list || []) {
      const tech = map[id];
      if (!tech || !tech.effect) continue;
      for (const key of ALL_EFFECT_KEYS) {
        if (typeof tech.effect[key] === 'number') acc[key] += tech.effect[key];
      }
    }
  };
  eat(state.techs, TECH_MAP);
  eat(state.immortalTechs, IMMORTAL_TECH_MAP);
  return acc;
}

/** 只取凡人侧的效果（少数地方需要区分来源，例如「撑大坊市胃口」的计数）。 */
function mortalTechEffects(state) {
  const acc = {};
  for (const k of ALL_EFFECT_KEYS) acc[k] = 0;
  for (const id of state.techs || []) {
    const tech = TECH_MAP[id];
    if (!tech || !tech.effect) continue;
    for (const key of ALL_EFFECT_KEYS) {
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

/** 科技是否已研习（凡人侧）。 */
function isResearched(state, techId) {
  return (state.techs || []).includes(techId);
}

/** 仙道科技是否已研习。老存档没有这个字段，所以必须 || []。 */
function isImmortalTechResearched(state, techId) {
  return (state.immortalTechs || []).includes(techId);
}

/**
 * 凡人科技的前置是否全部满足。
 *
 * 凡人侧科技可以被仙道侧 gate 住（tech.requiresImmortal）——
 * 例如「祛障」要求仙道侧的「引灵」。这是仙凡咬合的一半，见 docs/15-科技线.md。
 *
 * ⚠ 用 (tech.requiresImmortal || []) 而不是直接读：老存档与数据缺失
 *   都要退化成「无前置」，而不是静默锁死一项科技。
 */
function isTechUnlocked(state, tech) {
  if (!(tech.requires || []).every((r) => isResearched(state, r))) return false;
  return (tech.requiresImmortal || []).every((r) => isImmortalTechResearched(state, r));
}

/**
 * 仙道科技的前置是否满足。
 * 仙道科技的 requires 里**可以混凡人科技的 id** —— 这就是跨树咬合的另一半
 * （例：灵田 requires ['tuntian', 'yinling']）。所以这里逐项判断该 id 属于哪条线。
 */
function isImmortalTechUnlocked(state, tech) {
  return (tech.requires || []).every((r) => (IMMORTAL_TECH_MAP[r]
    ? isImmortalTechResearched(state, r)
    : isResearched(state, r)));
}

/**
 * 凡人科技当前状态：
 *  done   已研习
 *  locked 前置未满足（缺前置科技，或缺秘闻，或缺跨树的仙道前置）
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

/**
 * 仙道科技当前状态。与 techStatus 同构，区别是**灵石与银两双付**。
 *
 * 灵石是主门槛（银两只是「城里拿得出这笔钱」的资格线），
 * 所以缺哪一样就报哪一样，界面直接拿去显示。
 */
function immortalTechStatus(state, tech) {
  if (!tech) return 'locked';
  if (isImmortalTechResearched(state, tech.id)) return 'done';
  if (!isImmortalTechUnlocked(state, tech)) return 'locked';
  const silverOk = state.silver >= (tech.cost || 0);
  const stoneOk = (state.spiritStones || 0) >= (tech.stones || 0);
  return silverOk && stoneOk ? 'ready' : 'open';
}

/** 仙道科技的缺口说明（界面与日志共用，保证「写的」与「扣的」一致）。 */
function immortalTechMissing(state, tech) {
  const out = [];
  if (!isImmortalTechUnlocked(state, tech)) {
    const names = (tech.requires || []).map((r) => IMMORTAL_TECH_MAP[r]?.name || TECH_MAP[r]?.name || r);
    out.push(`须先研习 ${names.join('、')}`);
  }
  if (state.silver < (tech.cost || 0)) out.push(`银两不足，需 ${Math.round(tech.cost || 0)} 两`);
  if ((state.spiritStones || 0) < (tech.stones || 0)) out.push(`灵石不足，需 ${tech.stones || 0} 枚`);
  return out;
}

/** 建筑是否已解锁。def.tech 可能是凡人侧 id，也可能是仙道侧 id。 */
function isBuildingUnlocked(state, def) {
  if (!def.tech) return true;
  if (IMMORTAL_TECH_MAP[def.tech]) return isImmortalTechResearched(state, def.tech);
  return isResearched(state, def.tech);
}

/** 可研习（前置满足且买得起）的凡人科技数量。 */
function researchableCount(state) {
  let n = 0;
  for (const id of Object.keys(TECH_MAP)) {
    const tech = TECH_MAP[id];
    if (techStatus(state, tech) === 'ready') n += 1;
  }
  return n;
}

/** 可研习的仙道科技数量。 */
function researchableImmortalCount(state) {
  let n = 0;
  for (const id of Object.keys(IMMORTAL_TECH_MAP)) {
    if (immortalTechStatus(state, IMMORTAL_TECH_MAP[id]) === 'ready') n += 1;
  }
  return n;
}

/* ────────────────────────── 城中作坊（仙凡经济的城市一侧） ────────────────────────── */

/** 全部作坊的**用工需求**（不受人口限制的名义需求）。 */
const CITY_WORKSHOP_IDS = ['herbhouse', 'minestop', 'papermill', 'immortalmarket'];

/** 名义用工需求：座数 × 每座用工。这是「想派多少人」，不是「派得出多少人」。 */
function cityWorkshopDemand(state) {
  const b = state.buildings || {};
  let demand = 0;
  for (const k of CITY_WORKSHOP_IDS) demand += (b[k] || 0) * CITY_WORKSHOP_WORKERS;
  return demand;
}

/**
 * 全市作坊实际派上的用工人数 = min(人口, 名义需求)。
 *
 * ⚠ **人是共用的一份**：同一批凡人不会同时在药圃和矿寮做工。
 *   这个数是「有多少人在做工」，所以它决定了做工的死亡率
 *   （见 derive 里的 laborDeath）——人是被抽走的，抽走就有折损。
 */
function cityWorkshopWorkers(state) {
  return Math.min(Math.max(0, state.population || 0), cityWorkshopDemand(state));
}

/**
 * 某一类作坊实际分到的用工人数。
 *
 *   人够（人口 ≥ 全部需求）：每座满员。
 *   人不够：按需求的格局分摊 —— 各让一步，谁也别想独占人手。
 *
 * 这就是「抽走劳力 → 别的产出下降」那条张力的实现：
 * 作坊铺得越多，每一座分到的人就越少，产量按比例摊薄，而人口也就那么多。
 */
function cityWorkersOf(state, buildingId) {
  const b = state.buildings || {};
  const n = b[buildingId] || 0;
  if (n <= 0) return 0;
  const pop = Math.max(0, state.population || 0);
  const demand = cityWorkshopDemand(state);
  if (demand <= 0) return 0;
  const mine = n * CITY_WORKSHOP_WORKERS;
  if (pop >= demand) return mine;                 // 人够，每座满员
  return pop * (mine / demand);                   // 人不够，按需求分摊
}

/**
 * 某一类作坊的每秒产出当量 = 实际用工 × 单产。
 *
 * ⚠ 「座数」通过 cityWorkersOf 进入公式，所以**作坊多而人少会摊薄**。
 */
function cityWorkshopRate(state, buildingId, perSec) {
  return cityWorkersOf(state, buildingId) * perSec;
}

/**
 * 坊市用工：这类建筑不产原料，只把银钱做硬。
 * 口径与作坊一致（同样按人口分摊），只是它有自己的一份用工上限。
 */
function cityMarketWorkers(state) {
  const b = state.buildings || {};
  const n = b.immortalmarket || 0;
  if (n <= 0) return 0;
  const pop = Math.max(0, state.population || 0);
  const demand = CITY_WORKSHOP_IDS.reduce(
    (acc, k) => acc + (b[k] || 0) * (k === 'immortalmarket' ? CITY_MARKET_WORKERS_MAX : CITY_WORKSHOP_WORKERS),
    0,
  );
  if (demand <= 0) return 0;
  const mine = n * CITY_MARKET_WORKERS_MAX;
  return pop >= demand ? mine : pop * (mine / demand);
}

/**
 * 云深谷坊市的**第 n 次**兑换报价（n 从 0 起）。
 *
 * 兑率是**平价**的：无论第几笔，银两成本与灵石收益都与第一笔相同 ——
 * 这是两种货币体系的兑换，不涨价（用户实机裁决；会涨价的只有建筑）。
 * tradeStoneMult 直接乘在灵石那一侧，这就是城市科技对兑率的杠杆。
 * 笔数只走 marketExchangeLimit 的**总量闸门**，与定价无关。
 */
function marketExchangeQuote(state, n = marketExchangeCount(state)) {
  const i = Math.max(0, Math.floor(Number(n) || 0));
  const fx = techEffects(state);
  return {
    index: i,
    silver: MARKET_EXCHANGE_BASE_SILVER,
    stones: +(MARKET_EXCHANGE_BASE_STONES * (1 + fx.tradeStoneMult)).toFixed(4),
  };
}

/** 已兑换次数（老存档没有这个字段，所以 || 0）。 */
function marketExchangeCount(state) {
  return Math.max(0, Math.floor(Number(state.exchangeCount) || 0));
}

/**
 * 坊市一共还能吃下几笔银钱。
 *
 * 基础量 MARKET_EXCHANGE_MAX，再按「撑胃口的科技」增加：
 *   · tradeStoneMult > 0 的科技（坊市扩建、仙凡互市、界墟、结庐）
 *   · 每项 +MARKET_EXCHANGE_BONUS_PER_TECH 笔
 * 这样「把城做大」会实打实地延长这条动脉，而不是只把单价压低。
 */
function marketExchangeLimit(state) {
  // 【用户实机报告 · 软锁】这里原来返回一个有限笔数（基础 12 + 每项相关科技 +4）。
  // 后果是**可复现的死局**：玩家把灵石全买了祛障丹、丹药全失败（或修士阵亡），
  // 而银两→灵石又有上限 ⇒ 再也换不出灵石 ⇒ 永远拿不到第一个修士。
  //   灵石是**唯一**能撬动仙途的资源，它的来源绝不能有总量上限。
  // 现在返回无限：兑换仍按平价结算（见 MARKET_EXCHANGE_*），反向的灵石→银两
  // 按 0.8 折（MARKET_SELL_RATIO），所以放开上限不会造出套利空间。
  // 函数保留（调用方与旧断言都还在用），语义变成「不设限」。
  return Number.POSITIVE_INFINITY;
}
/** 旧口径的笔数上限，仅供调试/文档引用；兑换逻辑**不再**用它。 */
function marketExchangeLegacyLimit(state) {
  let n = MARKET_EXCHANGE_MAX;
  const count = (list, map) => {
    for (const id of list || []) {
      const t = map[id];
      if (t && t.effect && typeof t.effect.tradeStoneMult === 'number' && t.effect.tradeStoneMult > 0) n += MARKET_EXCHANGE_BONUS_PER_TECH;
    }
  };
  count(state.techs, TECH_MAP);
  count(state.immortalTechs, IMMORTAL_TECH_MAP);
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

  // 出生率最后乘一层「流派倍率」——合欢双修走的就是这一条
  const birthRate =
    (BASE.birthRate + fx.birthFlat + (b.field || 0) * FIELD_BIRTH * (1 + fx.fieldBonus))
    * schoolBirthMult(state);

  /**
   * 死亡率 = 基础 + 拥挤 + 对外扩张的代价 + **城市做工的代价**。
   * 演武台与商队驿站各按座数计——走出去的人回不来，人口基就薄一层；
   * 药圃/矿寮/纸坊/坊市则是「留在城里做工的人也会折损」，
   * 这是仙凡咬合里**凡人对仙道的付出**那一半。
   * 最后再乘一层「流派倍率」——血煞魔功养功要拿人填。
   */
  const expandDeath = (b.arena || 0) * ARENA_DEATH + (b.caravan || 0) * CARAVAN_DEATH;
  const crowdDeath = CROWD.k * crowdOver * crowdOver;
  const laborWorkers = cityWorkshopWorkers(state);
  const laborDeath = laborWorkers * CITY_LABOR_DEATH;
  const deathRate = (BASE.deathRate + crowdDeath + expandDeath + laborDeath + fx.deathFlat) * schoolDeathMult(state);
  const netRate = birthRate - deathRate;

  // ── 银两 ──────────────────────────────────────────────────
  /**
   * 库房：钱庄之外的第二条「抬高银两上限」的路。
   *
   * 上限 = (基础 + 钱庄×容量) × (1 + 库房)。
   * 乘数放在括号外：库房是「把同一批仓库管得更好」，所以它对
   * 「已经堆了多少间钱庄」是放大的 —— 多盖与研习两条路互相加强。
   *
   * ⚠ 上限不只是个显示数字：云深谷坊市的第 n 笔报价一旦超过上限，
   *   那一笔就**永远换不了**。所以 vaultMult 是仙道进度的一部分。
   */
  const vaultMult = Math.max(0, fx.vaultMult || 0);
  const silverCap = Math.round(
    (BASE.silverCap + (b.bank || 0) * BANK_CAPACITY) * (1 + vaultMult),
  );
  const cultivateFx = cultivationBonuses(state);
  // 坊市用工：人多的一方在兑率上占便宜 —— 城里做工的凡人直接加银两产出
  const marketWorkerBonus = cityMarketWorkers(state) * CITY_MARKET_YIELD_PER_WORKER;
  const silverPerSec = state.population * BASE.silverPerPop
    * (1 + fx.incomeMult + marketWorkerBonus) * (1 + cultivateFx.laborMult);

  // ── 城中作坊：把人口换成仙道生产线的原料 ───────────────────
  const cityMaterialMult = 1 + fx.cityMaterialMult;
  const cityHerbPerSec = cityWorkshopRate(state, 'herbhouse', CITY_HERB_PER_SEC) * cityMaterialMult;
  const cityOrePerSec = cityWorkshopRate(state, 'minestop', CITY_ORE_PER_SEC) * cityMaterialMult;
  const cityRunePerSec = cityWorkshopRate(state, 'papermill', CITY_RUNE_PER_SEC) * cityMaterialMult;

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
    marketExchangeCount: marketExchangeCount(state),
    marketExchangeLimit: marketExchangeLimit(state),
    marketExchange: marketExchangeQuote(state),
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
    laborDeath,
    laborWorkers,
    netRate,
    netPerSec: state.population * netRate,

    silverCap,
    silverPerSec,
    marketWorkerBonus,

    cityMaterialMult,
    cityHerbPerSec,
    cityOrePerSec,
    cityRunePerSec,

    immortalTechs: (state.immortalTechs || []).slice(),
    // 【用户实测】名册容量加成是**乘数**（人口给底，科技放大），不再是「+N 人」。
    immortalCapBonus: fx.immortalCapMult,

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
