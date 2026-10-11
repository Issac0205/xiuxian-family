/**
 * 《修仙世家》平衡仿真器。
 *
 *   node scripts/balance.mjs                       # 跑全部策略，出对比表
 *   node scripts/balance.mjs greedy                # 只跑一条策略
 *   node scripts/balance.mjs --json                # 附带机读 JSON
 *   node scripts/balance.mjs --snap greedy         # 打印时间序列快照
 *   node scripts/balance.mjs --baseline            # 只做静态盘点（秒出，不跑仿真）
 *
 * 本文件也可以被 import：脚本尾部整段入口代码被 `import.meta.main` 守着，
 * 所以 import 时只拿到 boot / run / auditTechs 等函数，不会顺带跑一局仿真。
 * 诊断探针 scripts/diagnose.mjs 就是这么复用它、而不是另写一套 AI 的。
 *
 * 为什么要有这个文件
 * ──────────────────
 * 「44.6 小时通关」只是一个总数，它看不出**钱在哪一段变成废纸**、
 * **哪一层科技点完之后玩家就没事可做**。这个脚本把游戏真跑一遍，
 * 用同一套数值回答这些问题。所有数字都出自 src/ 的真实逻辑
 * （靠 dom-shim 无头加载 game.html），不是另写一套公式重算 ——
 * 所以它测出来的节奏就是玩家会遇到的节奏。
 *
 * 三条策略
 * ────────
 *   greedy   见钱就赚：只买回本最快的建筑，科技按性价比点。
 *   trade    重商：优先铺商队与银两倍率。
 *   farm     重农：优先人口与田地。
 *   三条走的是同一套修仙侧策略（见 run 里的 aiImmortal），差异只在凡人篇，
 *   所以它们之间的差别能直接读成「科技路线值不值」。
 *
 * 度量口径
 * ────────
 *   · 答题一律关掉（settings.quizMode='off'）—— 答题是真人操作，
 *     混进来只会让数值噪声盖住数值本身。
 *   · 修士一律 `innate` 天赋 1，不带灵根加成、不带金手指、不带流派。
 *     即「第一次玩、什么都没有」的基准盘。
 *   · 时间一律按游戏内秒计。
 */

import { readFileSync } from 'node:fs';
import { installDOM } from './dom-shim.mjs';

const H = 3600;

/* ────────────────────────── 装载游戏 ────────────────────────── */

const html = readFileSync(new URL('../game.html', import.meta.url), 'utf8');
const code = html.match(/<script type="module">\r?\n([\s\S]*?)\r?\n<\/script>/)[1];

/**
 * 需要从 game.html 模块作用域里借出来的名字。
 *
 * game.html 的区块共享同一层作用域，但那是 `new Function(code)()` 的函数作用域
 * —— 里面的 `const` 不是全局。调试口 `__xiuxian` 只挑了一部分出来，
 * `derive` / `techStatus` / `currentUnitCost` 这些都不在其中，而仿真要用它们。
 * 所以这里按名字扫出顶层声明，装载时拼一个 bridge 把需要的挂到全局。
 * 将来加新函数不用改本文件结构，往这个列表里加个名字就行。
 */
const NEEDED = [
  'derive', 'techStatus', 'research', 'buy', 'currentUnitCost', 'maxAffordable',
  'isBuildingUnlocked', 'isResearched', 'realmName', 'realmXpNeeded', 'realmGate',
  'breakthroughPlan', 'commitBreakthrough', 'worldOf', 'mapIsPacified',
  'mapGarrisonCandidates', 'mapAssignGarrison', 'cultivatorPower', 'mapAccessible',
  'mapPlan', 'commitAttack', 'commitExplore', 'caveSurvival', 'metaOf',
  'rootRank', 'rootRerollPlan', 'commitRootReroll',
  'TECHS', 'BUILDINGS', 'BUILDING_MAP', 'MAP_NODES', 'REALM_GATES', 'REALM_TIERS',
  'CULTIVATOR_LIMIT', 'SECRETS', 'BASE', 'REALM_XP_RATE', 'TECH_MAP',
  'CULTIVATOR_MARKET', 'PILL_STONE_COST', 'SECRET_UNLOCK', 'ROUTE_MAP',
  'ESTATE_SLOTS', 'HOUSE_CAPACITY', 'ARENA_DISCOUNT_MAX', 'ARENA_DISCOUNT_HALF',
  'ARENA_DEATH', 'CARAVAN_DEATH', 'CARAVAN_SLOTS_PER', 'TOTAL_DISCOUNT_MAX',
  'FIELD_BIRTH', 'TECH_TIERS', 'IMMORTAL_TECHS', 'IMMORTAL_TECH_TIERS',
  // 仙道侧的研习与查询（before/after 对比要靠它们）
  'IMMORTAL_TECH_MAP', 'planImmortalResearch', 'researchImmortal',
  'immortalTechStatus', 'immortalTechMissing', 'isImmortalTechResearched',
  'cultivatorLimit', 'mapHoldPower', 'mapHoldPowerFor', 'mapYieldOf',
  'marketExchangeQuote', 'marketExchangeLimit', 'marketExchangeCount',
  'cityWorkshopDemand', 'cityWorkersOf', 'innatePoolBonus',
  'MORTAL_EFFECT_KEYS', 'IMMORTAL_EFFECT_KEYS', 'EFFECT_LABELS',
];

const declared = new Set([
  ...[...code.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ...[...code.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]),
]);
const MISSING = NEEDED.filter((n) => !declared.has(n));
const AVAILABLE = NEEDED.filter((n) => declared.has(n));

let B = null;   // 桥对象

/**
 * 装一份全新的游戏。每次调用都是干净的一局。
 *
 * 装载期间把 setInterval 换成假实现：main.js 尾部挂着三个定时重绘
 * （百科/轮回/仙途），它们会用 live 的 timer 把 Node 进程永远吊住，
 * 而且本仿真完全不需要界面。假实现只记下 id，等价于「刚 clearInterval 完」。
 */
function boot(seed = 20260101) {
  installDOM(html);
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const ids = [];
  globalThis.setInterval = (fn, ms) => { ids.push(ids.length); return ids.length; };
  try {
    new Function(
      `${code}\n;globalThis.__xiuxian = window.__xiuxian;`
      + `globalThis.__balance = {${AVAILABLE.join(', ')}};`,
    )();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
  B = globalThis.__balance;
  const X = globalThis.__xiuxian;
  X.seedRng(seed);
  X.state.settings.quizMode = 'off';
  return X;
}

/* ────────────────────────── 策略定义 ────────────────────────── */

/**
 * 凡人篇的建筑打分。
 *
 * 这里刻意**不是**一个漂亮的 ROI 公式 —— 第一版写的就是那个，
 * 结果它把自己跑成了「52 座田地、0 座商队驿站、90 小时卡在凡人」。
 * 原因是银两 ROI 这个尺子**量不到进度**：商队驿站是秘闻的唯一来源，
 * 而秘闻 → 坊市 → 灵石 → 祛障丹 → 炼气篇；纯按银两算，它永远输给田地。
 *
 * 所以改成两层：
 *   一、**闸门**（gate）：没做到就什么都别谈，优先做掉。
 *   二、过了闸门之后，按边际收益 ÷ 边际成本排序（这一层才是 ROI）。
 *
 * 这不只是仿真技巧 —— 真人玩家就是这么想的，界面上也确实是这么暗示的
 * （「秘闻≥12 后可在坊市购得灵池蓝图」）。
 */
const gatesFor = (strategy) => [
  // 1. 秘闻从哪来：至少一座驿站。没有它整局都是死路。
  (s, d) => (s.secrets.length < B.SECRET_UNLOCK && s.buildings.caravan < 1
    ? { id: 'caravan', why: '核心链：秘闻唯一来源' } : null),
  // 2. 人口是银两与修士的共同分母：拥挤之前先铺田地
  (s, d) => (s.buildings.field < 4 ? { id: 'field', why: '开局人口' } : null),
  // 3. 拥挤到七成就补住房
  (s, d) => (d.housingCap > 0 && s.population / d.housingCap > 0.7
    ? { id: 'house', why: '住房紧张' } : null),
  // 4. 银两上限顶满了就补钱庄（不补的话产出直接蒸发）
  (s, d) => (s.silver >= d.silverCap - 1 ? { id: 'bank', why: '上限顶满' } : null),
  // 5. 重商路线：多铺驿站（秘闻与跑商都要位子）
  (s, d) => (strategy === 'trade' && s.secrets.length < B.SECRET_UNLOCK
    && s.buildings.caravan < 6 ? { id: 'caravan', why: '重商：多铺驿站' } : null),
  // 6. 营造位不够了就补地产（地产本身占 0 格，是唯一的扩容手段）
  (s, d) => (d.freeSlots < 2 ? { id: 'estate', why: '格位不够' } : null),
  // 7. 冲关要秘闻线索，线索靠商队 —— 到门槛前一直补
  (s, d) => (d.caravanSlots < 8 && s.secrets.length < 16
    ? { id: 'caravan', why: '线索储备' } : null),
];

/**
 * 过了闸门之后的边际收益打分（银/秒 ÷ 单价）。
 * 只在这里用 ROI —— 它擅长回答「同样花钱，哪个更划算」，
 * 不擅长回答「哪条路能推进度」。
 */
function buildScore(s, d, id, strategy) {
  const def = B.BUILDING_MAP[id];
  const cost = B.currentUnitCost(s, d, def);
  const pop = Math.max(0, s.population);
  const perCap = B.BASE.silverPerPop * (1 + d.fx.incomeMult) * (1 + d.cultivateFx.laborMult);

  let gain = 0;
  if (id === 'field') {
    // 出生率 × 每人产值。随人口线性增长，但人口自己有上限，所以会自然饱和。
    gain = B.FIELD_BIRTH * (1 + d.fx.fieldBonus) * pop * perCap;
  } else if (id === 'house') {
    const room = Math.max(0, Math.min(B.HOUSE_CAPACITY, d.housingCap - pop));
    gain = room * perCap;
  } else if (id === 'bank') {
    const full = s.silver >= d.silverCap - 1e-6;
    gain = full ? d.silverPerSec : d.silverPerSec * (s.silver / Math.max(1, d.silverCap)) * 0.5;
  } else if (id === 'estate') {
    const best = ['field', 'house', 'bank', 'caravan'].map((k) => {
      const dd = B.BUILDING_MAP[k];
      if (!B.isBuildingUnlocked(s, dd) || dd.slots === 0) return 0;
      return buildScore(s, d, k, strategy) * dd.slots;
    });
    gain = B.ESTATE_SLOTS * Math.max(1e-9, Math.max(...best));
  } else if (id === 'arena') {
    const cur = Math.min(B.TOTAL_DISCOUNT_MAX, d.estateDiscountTotal);
    const n = s.buildings.arena;
    const next = Math.min(B.TOTAL_DISCOUNT_MAX,
      d.arenaPart + B.ARENA_DISCOUNT_MAX * ((n + 1) / (n + 1 + B.ARENA_DISCOUNT_HALF)));
    const nextEstate = B.currentUnitCost(s, d, B.BUILDING_MAP.estate);
    gain = (nextEstate * Math.max(0, (next - cur) / Math.max(1e-6, 1 - cur))) / 600;
    // 死亡率抬升的代价：等于「这些人的银两产值」被永久抽掉
    gain -= B.ARENA_DEATH * (B.BASE.silverPerPop * (1 + d.fx.incomeMult)) / Math.max(1e-6, d.deathRate);
  } else if (id === 'caravan') {
    const route = B.ROUTE_MAP.mortal;
    gain = ((route.cost * (route.multiplier - 1)) / Math.max(1, route.duration)) * B.CARAVAN_SLOTS_PER;
    gain -= B.CARAVAN_DEATH * (B.BASE.silverPerPop * (1 + d.fx.incomeMult)) / Math.max(1e-6, d.deathRate);
  }
  const mult = BUILD_MULT[strategy][id] ?? 1;
  return (Math.max(0, gain) * mult) / Math.max(1, cost);
}

/** 这个修士离「下一道大境界门槛」还差几层（差 0 就是正卡在门槛上）。 */
function gateDistance(p) {
  const i = Math.floor(p.realmIndex) || 0;
  for (let k = i; k < 26; k += 1) if (B.realmGate(k)) return k - i;
  return 99;
}

/** 三条路线只差偏好乘数。 */
const BUILD_MULT = {
  greedy: { field: 1, house: 1, bank: 1, estate: 1, arena: 1, caravan: 1 },
  trade: { field: 0.85, house: 1, bank: 1.5, estate: 1, arena: 0.7, caravan: 1.4 },
  farm: { field: 1.5, house: 1.5, bank: 0.8, estate: 1, arena: 0.7, caravan: 0.9 },
};
/**
 * 科技研习顺序。只列 id —— 没列出的科技该策略永不研习，
 * 这样才能读出「孤儿节点」（前置了但没人点）。
 *
 * ⚠ `quzhang` 故意排在很前面：它连锁着**整条仙道线**
 *   （祛障 → 祛障丹 → 第一位修士 → 仙途开启）。
 *   排在 `courier` 后面的话，一旦 courier 被某条策略卡住，
 *   整局就停在凡人篇 —— 这种「一个节点拖死整条线」的排序是仿真的坑，
 *   不是游戏的坑（真人看到「仙途」页签一直是灰的会先去点它）。
 */
const TECH_ORDER = {
  greedy: ['realestate', 'architecture', 'finance', 'surveying', 'expansion', 'household', 'trade', 'quzhang', 'vault', 'tuntian', 'arithmetic', 'seeker', 'courier', 'marketexp', 'yizhuang', 'jixian', 'xiangxian', 'mutualmarket'],
  trade: ['realestate', 'architecture', 'finance', 'surveying', 'trade', 'quzhang', 'vault', 'expansion', 'household', 'courier', 'seeker', 'arithmetic', 'marketexp', 'tuntian', 'yizhuang', 'jixian', 'xiangxian', 'mutualmarket'],
  farm: ['realestate', 'architecture', 'surveying', 'expansion', 'tuntian', 'household', 'vault', 'quzhang', 'finance', 'trade', 'seeker', 'arithmetic', 'courier', 'marketexp', 'yizhuang', 'jixian', 'xiangxian', 'mutualmarket'],
};
/**
 * ⚠ 三条策略都必须含 `tuntian`。
 *
 *   仙道线的入口是「灵田」，而灵田 require 凡人侧的「屯田」。
 *   第一版的 greedy 顺序里漏了屯田 → 整条仙道线对它永久锁死 →
 *   仿真报告上看起来是「仙道线没用」，实际上是**AI 没点那个前置**。
 *   这类「策略表漏一项 → 结论反转」的坑，是读对照表时最该先排除的。
 */

/**
 * 仙道科技研习顺序。
 *
 * 与凡人侧同构，并且是**三条策略共用**的（策略差异只在凡人篇）。
 * 遍历顺序刻意与修仙侧 AI 的优先级一致：
 *   先把「能养人」（开脉/引灵）与「城里能出料」（灵田/丹药房）打开，
 *   再开「冲关材料」（筑基之道/镇岳），最后开上限（元婴/化神）。
 *
 * ⚠ 这里可以出现**尚不可研习**的项（跨树前置还没满足，例如灵田要凡人侧屯田）。
 *   doImmortalTech 会把它们跳过去、继续往后看，所以顺序表不必按依赖拓扑排序。
 */
const IMMORTAL_ORDER = [
  // 一 · 开脉：先把名册与灵根这两条根养起来
  'kaimai', 'yinling', 'lingtian',
  // 二 · 筑基：冲关率、镇守、城里出料
  'zhuji', 'zhenyue', 'lingxu', 'danfang',
  // 三 · 结丹：材料与战力
  'xuanhu', 'julingzhen', 'yujian', 'qidao', 'fudi', 'tanxue', 'jindan',
  // 四 · 元婴：矿、洞府、田
  'lingmai', 'dongfu', 'zhoutian', 'yuanying', 'lingzhi',
  // 五 · 化神
  'jiexu', 'jiuzhuan', 'huashen', 'jielu',
];

/**
 * 城中作坊的营造门槛（策略无关）。
 *
 * 城里盖作坊不产银两，产的是**仙道的原料**：药圃出药材、矿寮出矿料、
 * 纸坊出符料。所以它们只在「已经踏入仙途、材料确实在用」的时候才值得盖 ——
 * 与 gatesFor 的银两闸门是两回事，故单独一张表。
 */
const CITY_GATES = [
  // 已经开脉（有人能修行）之后才谈供给。没修士的话作坊产了也没人用。
  (s, d) => (!s.immortalTechs?.includes('lingtian') ? null
    : (s.buildings.herbhouse || 0) < 2 && s.spiritStones > 40
      ? { id: 'herbhouse', why: '仙道原料：药材' } : null),
  (s, d) => (!s.immortalTechs?.includes('xuanhu') ? null
    : (s.buildings.minestop || 0) < 2 && s.spiritStones > 60
      ? { id: 'minestop', why: '仙道原料：矿料' } : null),
  (s, d) => (!s.immortalTechs?.includes('xuanhu') ? null
    : (s.buildings.papermill || 0) < 1 && s.spiritStones > 60
      ? { id: 'papermill', why: '仙道原料：符料' } : null),
  // 灵脉感应开了矿场建筑，才去盖它（它只放大已有矿脉的出石）
  (s, d) => (!s.immortalTechs?.includes('lingmai') ? null
    : (s.buildings.spiritmine || 0) < 1 && (s.cultivation?.mineLevel || 0) > 0
      ? { id: 'spiritmine', why: '灵脉采掘队' } : null),
  // 仙凡互市：把银钱做硬，是后期银两的主要去处之一
  (s, d) => (!s.immortalTechs?.includes('mutualmarket') && !s.techs.includes('mutualmarket') ? null
    : (s.buildings.immortalmarket || 0) < 2 ? { id: 'immortalmarket', why: '仙凡互市' } : null),
];

const ALL_STRATEGIES = ['greedy', 'trade', 'farm'];

/* ────────────────────────── 仿真主循环 ────────────────────────── */

/**
 * 跑一局，直到出现一名化神期修士（或超时）。
 *
 * @param {string} strategy
 * @param {object} opt  maxHours / actionEvery / tickSeconds / snapEvery / onSnap
 */
function run(strategy, opt = {}) {
  const maxHours = opt.maxHours ?? 90;
  const actionEvery = opt.actionEvery ?? 20;
  const tickSeconds = opt.tickSeconds ?? 5;
  const snapEvery = opt.snapEvery ?? 600;
  /**
   * 是否让 AI 研习仙道科技。
   *
   * 关掉它（XIUXIAN_NO_IMMORTAL=1）就得到一份**同 AI、同凡人树**的对照盘：
   *   「改了之后」= 22 项凡人科技 + 23 项仙道科技
   *   「改之前」  = 22 项凡人科技 + 0 项仙道科技
   * 两者之差就是仙道线（以及它对凡人线的反哺）的净贡献。
   * 城坊建筑也会随之不盖 —— 它们全部由仙道科技解锁，本来就打不开。
   */
  const immortalOn = opt.immortal !== false && process.env.XIUXIAN_NO_IMMORTAL !== '1';

  const X = boot();
  const s = X.state;
  const to = TECH_ORDER[strategy];
  const ito = IMMORTAL_ORDER;

  const realmAt = {};    // realmIndex -> 首次达成的小时
  const techAt = {};     // techId -> 研习时的小时
  const buildAt = {};    // buildingId -> 首次营造的小时
  /** 关键里程碑的达成时点（小时）—— 审计报告主要看这一张表。 */
  const gateAt = {};
  const mark = (k) => { if (gateAt[k] === undefined) gateAt[k] = +hour().toFixed(3); };
  const snaps = [];
  const stalls = [];
  let stallRun = 0;
  let hours = 0;
  let topRealm = 0;
  let done = false;

  const hour = () => s.stats.playSeconds / H;

  function noteRealm() {
    for (const p of s.cultivation.cultivators || []) {
      const i = Math.floor(p.realmIndex) || 0;
      if (i > topRealm) {
        topRealm = i;
        if (realmAt[i] === undefined) realmAt[i] = hour();
      }
    }
  }

  /** 研习凡人科技：按策略顺序找第一个「可研习且买得起」的。 */
  function doTech() {
    for (const id of to) {
      if (s.techs.includes(id)) continue;
      const tech = B.TECH_MAP[id] || null;
      if (!tech) continue;
      const st = B.techStatus(s, tech);
      if (st === 'ready' || st === 'open') {
        const res = X.actions.research(id);
        if (res && res.ok) { techAt[id] = hour(); return true; }
      }
    }
    return false;
  }

  /**
   * 研习仙道科技。与 doTech 同构，只是走 X.actions.researchImmortal。
   *
   * ⚠ 顺序里有「跨树混排」的项（例如 lingtian 要求凡人侧的 tuntian），
   *   所以这里必须能把「还没解锁」的项跳过而不阻塞后面的项 ——
   *   immortalTechStatus 返回 'locked' 时 continue，不 return。
   */
  function doImmortalTech() {
    if (!immortalOn) return false;
    for (const id of ito) {
      const tech = B.IMMORTAL_TECH_MAP[id];
      if (!tech) continue;
      const st = B.immortalTechStatus(s, tech);
      if (st !== 'ready') continue;
      const res = X.actions.researchImmortal(id);
      if (res && res.ok) { techAt[id] = hour(); return true; }
    }
    return false;
  }

  /**
   * 营造：按策略优先级买第一个买得起、也放得下的。
   *
   * ⚠ 这里有个**只有仿真才需要**的规则：留一格给「地产」。
   * 地产占 0 格却 +6 格额度，是唯一能扩张容量的建筑。
   * 如果让田地这种「占 1 格」的先把格子吃光，仿真会自己把自己锁死
   * （真人玩家不会犯这个错，因为界面上写着「格 0」）。
   */
  function doBuild() {
    const d = B.derive(s);
    // 先过凡人侧的闸门，再城坊闸门，最后才是 ROI。
    for (const gate of [...gatesFor(strategy), ...CITY_GATES]) {
      const g = gate(s, d);
      if (!g) continue;
      const def = B.BUILDING_MAP[g.id];
      if (!def || !B.isBuildingUnlocked(s, def)) continue;
      if (X.actions.buy(g.id, '1').ok) { if (buildAt[g.id] === undefined) buildAt[g.id] = hour(); return true; }
    }
    const ids = ['estate', 'house', 'bank', 'field', 'caravan', 'arena'];
    let best = null;
    for (const id of ids) {
      const def = B.BUILDING_MAP[id];
      if (!def || !B.isBuildingUnlocked(s, def)) continue;
      if (def.slots > 0 && d.freeSlots - def.slots < 1) continue;   // 留一格
      if (B.maxAffordable(s, d, def, '1') <= 0) continue;
      const score = buildScore(s, d, id, strategy);
      if (!best || score > best.score) best = { id, score };
    }
    if (best && X.actions.buy(best.id, '1').ok) {
      if (buildAt[best.id] === undefined) buildAt[best.id] = hour();
      return true;
    }
    return false;
  }

  /**
   * 凡人篇的非建筑动作。
   *
   *   1. 买祛障丹 —— 修士是全局运转的分母
   *   2. 换灵石 —— 银两→灵石是凡人向修仙输送资源的唯一动脉
   *   3. 商队对着凡人商路一直跑 —— 秘闻的唯一来源
   *
   * 商队收益恒为正（1.6 倍），所以「铺满、一直跑」就是最优解，
   * 不存在「该不该派」的决策 —— 这也是一个要写进审计的结论。
   */
  function doMortal() {
    const c = s.cultivation;
    // ── 1. 换灵石：银→石是**唯一的动脉**，优先级必须排在商队与营造之前 ──
    //
    // ⚠ 为什么它必须最优先：商队（每 20 秒一批，本钱 100 两 × 队数）
    //   会把银两**一直花到接近零**。只要它在换灵石之前跑，银两就永远
    //   攒不到「一笔兑换」的规模 —— 实测 25 小时只点出了 0 笔兑换、
    //   0 枚祛障丹、0 位修士，整局停在凡人。
    //
    // 兑率是递进的（第 n 笔更贵、给得更多，总笔数有上限），
    // 而撑大胃口的是「坊市扩建 / 仙凡互市 / 界墟 / 结庐」这四项科技。
    //
    // 留多少银两这件事**很容易把自己锁死**，所以这里只留「两座地产的钱」，
    // 并且**夹在一个不会挡住报价的上限里**。
    //
    // ⚠ 第一版写的是 min(silverCap × 0.5, …) = 121500，于是要 12.15 万 + 报价
    //   才肯换；而开局银两上限就只有 24.3 万，换过一笔之后永远攒不到这个数。
    //   第二版写成 min(地产×2, silverCap) —— 更糟：银两一旦顶到 24.3 万上限，
    //   reserve 就等于 silverCap，条件变成 `silver >= 2×silverCap`，**恒为假**。
    //   实测 50 小时 0 笔兑换、0 位修士。教训：reserve 的上限绝不能取 silverCap，
    //   必须取「比 silverCap 小一个报价」的量级。
    const d = B.derive(s);
    if (d.marketUnlocked) {
      const quote = d.marketExchange;
      const est = B.BUILDING_MAP.estate;
      const estateMoney = B.currentUnitCost(s, d, est) * 2;
      const reserve = Math.min(estateMoney, d.silverCap * 0.25);
      if (s.silver >= reserve + quote.silver) {
        const res = X.actions.exchange('yunshen');
        if (res && res.ok) return true;
      }
    }

    // ── 2. 买祛障丹。判据是「**现在还有没有修士**」，不是 cultivation.unlocked ——
    //    unlocked 一旦置位就永不复位，修士死光了它也还是 true。
    //    真人会一直补人（这是维持全局运转的基本操作），这里照做。
    const cults = (c && c.cultivators) ? c.cultivators.length : 0;
    if (s.techs.includes('quzhang') && cults < Math.min(B.CULTIVATOR_LIMIT, 60)) {
      if (s.spiritStones >= B.PILL_STONE_COST && s.population >= 1) {
        const before = cults;
        X.actions.pill('quzhangdan');
        if (((c.cultivators || []).length) > before) return true;
      }
    }

    // ── 3. 商队：铺满就一直跑。收益恒为正（1.6 倍本钱），不存在「该不该派」的决策 ──
    if (s.techs.includes('trade') && d.freeCaravans > 0 && d.tradeUnlocked) {
      const res = X.actions.tradeFleet('mortal', 'all');
      if (res && res.ok) return true;
    }
    return false;
  }

  /**
   * 修仙侧策略。顺序即优先级，与真人直觉一致：
   *   0. 先补冲关材料（炼丹）—— 没有丹，卡在门口的人一个都过不去
   *   1. 能冲关就冲关（唯一的进度来源）
   *   2. 先补镇守（不镇守的领地会叛离）
   *   3. 有把握就攻伐下一块地（领地是灵石与材料的唯一来源）
   *   4. 洞天只在生还率够高时去（死人是不可逆损失）
   *   5. 给主力测灵根（灵石的主要去处，且**保证不亏**）
   *   6. 闲人丢去闭关
   *
   * ⚠ 第 0 条是补上的，而且是整条链最容易漏的一环。
   *   大境界门槛要一枚丹（筑基丹/金丹/元婴丹/化神丹），而丹**只能自己炼**。
   *   不炼的话「堵在门口的 194 人」会一直站着 —— 实测 90 小时停在炼气九层，
   *   灵石攒到 5.5 万却一枚筑基丹都没有。这是仿真的坑，不是游戏的坑
   *   （真人看到「冲关需一枚筑基丹（尚无）」会立刻去丹房）。
   *
   * ⚠ 第 5 条不能省。灵根决定 capIndex（境界硬上限）：
   * 五灵根卡在元婴圆满、四灵根卡在化神初期、三灵根卡在化神中期。
   * 不测灵根的话，后天祛障来的修士（大多是四五灵根）
   * 会在炼气四层前后集体撞墙，全局进度直接停死 ——
   * 我第一版就漏了这一步，跑出「90 小时仍在炼气四层、攒了 2.4 万灵石」。
   */
  function aiImmortal() {
    const c = s.cultivation;
    if (!c) return false;
    const ps = c.cultivators || [];
    if (!ps.length) return false;

    // 0. 炼冲关用的丹：只要有人卡在本档最后一层，就按需要的丹方炼一枚。
    //    顺带把丹炉升上去（炉子不够就炼不动高阶丹）。
    if (X.alchemy) {
      const top = [...ps].sort((a, b) => b.realmIndex - a.realmIndex)[0];
      const rg = top ? B.realmGate(Math.floor(top.realmIndex)) : null;
      const need = rg && rg.pill ? rg.pill : null;
      if (need) {
        const have = X.alchemy.pill(need);
        if (have < 3) {
          const r = X.alchemy.craft(need);
          if (r && r.ok) return true;
          const up = X.alchemy.furnacePlan();
          if (up && up.ok) { X.alchemy.upgradeFurnace(); return true; }
        }
      }
    }

    // 1. 把所有「卡在大档瓶颈上、材料也够」的人逐个推过去。
    //    不能只推一个 —— 只有一个人过门槛的话，其余全族都会堵在
    //    炼气九层攒满修为干等（真人会把每一条能冲的都点了）。
    //    失败也算动作：它扣了丹药与灵石、也涨了下一次的成功率，
    //    真人不会在同一分钟里连点 25 次，所以这里一轮最多试 25 次。
    //
    // ⚠ 这里**不要**给 300+ 人的名册做全排序，也不要对每个人算 realmXpNeeded。
    //   第一版是 `[...ps].sort(gateDistance)` + 逐个问 breakthroughPlan。
    //   名册涨到 950 人、而大家都在等一枚不存在的丹时，
    //   「排序 + 950 次询价」会在**每一轮**白跑一遍 ——
    //   实测一条策略要跑 40 分钟，整套对照实验要两小时。
    //
    //   现在分两层筛：
    //     1. 只对**站在门槛层**的人看修为（全局只有 4 个门槛层，绝大多数人一层就被刷掉）
    //     2. 命中之后才问 breakthroughPlan（通常只有几十个人）
    //   语义与原来完全相同（没站上门槛层的人不可能冲关成功），
    //   但每轮的成本从 O(n log n) 降到 O(n) 次整数比较。
    const atGate = [];
    for (const p of ps) {
      if (!B.realmGate(Math.floor(p.realmIndex))) continue;       // ① 廉价的层号判断
      if (p.xp < B.realmXpNeeded(p.realmIndex)) continue;         // ② 只在门槛层算这个
      atGate.push(p);
      if (atGate.length >= 60) break;
    }
    let tries = 0;
    for (const p of atGate) {
      const plan = B.breakthroughPlan(s, p.id);
      if (!plan.ok) continue;
      B.commitBreakthrough(s, p.id, Date.now());
      tries += 1;
      if (tries >= 25) break;
    }
    if (tries) return true;

    const w = B.worldOf(s);
    for (const id of w.held) {
      if (B.mapIsPacified(s, id)) continue;
      // 一趟 O(n) 找最强的可派人，而不是 O(n log n) 全排序 ——
      // 名册 950 人时这个差别是「每轮 950 次比较」对「每轮 950·log950 次」。
      let best = null;
      let bestPower = -1;
      for (const p of ps) {
        if (p.job === 'sect' || p.job === 'garrison') continue;
        const pw = B.cultivatorPower(s, p);
        if (pw > bestPower) { bestPower = pw; best = p; }
      }
      if (best) { B.mapAssignGarrison(s, id, best.id); return true; }
    }

    // 打下来的地得有人守，所以先确认派得出多余的镇守者
    if (ps.length - w.held.length > 0) {
      for (const n of B.MAP_NODES) {
        if (n.kind !== 'foe' || w.held.includes(n.id)) continue;
        if (!B.mapAccessible(s, n.id)) continue;
        const plan = B.mapPlan(s, n.id);
        if (plan.ok && plan.rate >= 0.55) { B.commitAttack(s, n.id, Date.now()); return true; }
      }
    }

    for (const n of B.MAP_NODES) {
      if (n.kind !== 'cave' || w.reached.includes(n.id)) continue;
      if (!B.mapAccessible(s, n.id)) continue;
      if (!B.mapPlan(s, n.id).ok) continue;
      const cands = ps.filter((p) => p.job !== 'sect' && p.job !== 'garrison')
        .map((p) => ({ p, sv: B.caveSurvival(s, p, n) }))
        .sort((a, b) => b.sv - a.sv);
      if (cands.length && cands[0].sv >= 0.90) {
        B.commitExplore(s, n.id, cands[0].p.id, Date.now());
        return true;
      }
    }

    // 测灵根：只给「最靠前的那个人」，一直测到双灵根为止。
    // 灵根决定 capIndex（境界硬上限）——三灵根卡化神中期、四灵根卡化神初期、
    // 五灵根卡元婴圆满。所以「把一个人测上去」是全局进度的必经之路，
    // 而不是可有可无的优化。留 300 灵石机动（冲关要用），其余都可以花。
    const best = [...ps].sort((a, b) => b.realmIndex - a.realmIndex)[0];
    if (best && B.rootRank(best) < 5 && s.spiritStones > 300) {
      const plan = B.rootRerollPlan(s, best.id);
      if (plan.ok && plan.cost <= s.spiritStones - 300) {
        B.commitRootReroll(s, best.id);
        return true;
      }
    }

    // 灵脉矿场：秘闻门槛到了之后，这是灵石的第二条腿
    // （寻龙尺 3 石 → 探脉 1 石 → 矿场 2 石 + 8 万银两 / 派工）
    if (s.secrets.length >= 15 && s.spiritStones >= 8) {
      if (!c.compass) { if (X.immortalAction('compass', '').ok) return true; }
      else if (c.veins.length < 12) { if (X.immortalAction('survey', '').ok) return true; }
      else if (!c.mineLevel && s.silver >= 80000) {
        if (X.immortalAction('mine-build', '').ok) return true;
      }
      if (c.mineLevel && c.mineWorkers < 200) { X.immortalAction('mine-workers', '200'); return true; }
    }

    const idlers = ps.filter((p) => !['retreat', 'sect', 'garrison'].includes(p.job));
    if (idlers.length) { idlers[0].job = 'retreat'; return true; }
    return false;
  }

  let sinceAction = 0;
  let sinceSnap = 0;
  let immortalDue = 60;
  /** 修士数上一次观测值：掉人就往事件流里记一条，方便事后查是谁在吃人。 */
  let lastCultCount = 0;
  const events = [];

  /**
   * 排查用的事件流（`XIUXIAN_TRACE=1` 打开）。
   *
   * 只在真的要看「为什么这一步没发生」时才开 —— 它记录的是
   * **每一次成功操作**，而不是 AI 的判定过程，所以输出量很小。
   */
  const TRACE = process.env.XIUXIAN_TRACE === '1';
  const trace = [];
  const noteAction = (what, extra = '') => { if (TRACE) trace.push(`${hour().toFixed(2)}h ${what} ${extra}`); };
  if (TRACE) {
    for (const k of Object.keys(X.actions || {})) {
      const orig = X.actions[k];
      if (typeof orig !== 'function') continue;
      X.actions[k] = function traced(...args) {
        const r = orig.apply(this, args);
        if (r && r.ok) {
          noteAction(k, String(args[0] ?? '')
            + (r.cost !== undefined ? ` 价${Math.round(r.cost)}` : '')
            + (r.stones !== undefined ? ` 石${r.stones}` : ''));
        }
        return r;
      };
    }
  }


  while (hours < maxHours && !done) {
    X.tick(tickSeconds);
    hours = hour();
    sinceAction += tickSeconds;
    sinceSnap += tickSeconds;

    if (sinceSnap >= snapEvery) {
      sinceSnap = 0;
      const d = B.derive(s);
      // 里程碑打点
      if (s.secrets.length >= 1) mark('首条秘闻');
      if (d.marketUnlocked) mark('坊市开放(10秘闻)');
      if (s.spiritStones >= 1) mark('首枚灵石');
      if (s.cultivation?.unlocked) mark('踏入炼气');
      if ((s.cultivation?.cultivators || []).length >= 1) mark('首位修士');
      if (s.spiritStones >= 8 && (s.cultivation?.clues || 0) >= 2) mark('备齐冲关材料');
      const snap = {
        h: +hours.toFixed(2),
        pop: Math.round(s.population),
        silver: Math.round(s.silver),
        silverCap: Math.round(d.silverCap),
        silverPerSec: +d.silverPerSec.toFixed(4),
        birth: d.birthRate,
        death: d.deathRate,
        stones: +s.spiritStones.toFixed(2),
        secrets: s.secrets.length,
        topRealm,
        cultivators: (s.cultivation?.cultivators || []).length,
        buildings: Object.fromEntries(B.BUILDINGS.map((b) => [b.id, s.buildings[b.id] || 0])),
        techCount: s.techs.length,
        immortalTechCount: (s.immortalTechs || []).length,
        held: B.worldOf(s).held.length,
        wasted: Math.round(s.stats.silverWasted),
        equity: Math.round(s.stats.silverEarned),
      };
      snaps.push(snap);
      if (opt.onSnap) opt.onSnap(snap, s);
    }

    if (sinceAction >= actionEvery) {
      sinceAction = 0;
      let acted = false;
      /**
       * AI 决策节流：修仙侧那一串判定（冲关/镇守/攻伐/洞天/测灵根）
       * 每轮都要把 300 名修士 × 8 个地图节点过一遍，是整局最贵的部分。
       * 真人不可能每 20 秒重排一次优先级，所以这里按**游戏分钟**重算，
       * 中间这段时间只做便宜的收尾动作。这既更接近真人，也快了一个数量级。
       */
      immortalDue += actionEvery;
      if (immortalDue >= 60) { immortalDue = 0; if (aiImmortal()) acted = true; }

      /**
       * ⚠ 研习**不参与** `acted` 的短路链，这是踩过坑之后改的。
       *
       * 原来的写法是 `if (!acted && doTech()) ...`：只要 aiImmortal 做过任意一件事
       * （而它几乎每轮都会做 —— 「把闲人丢去闭关」永远成立），
       * 研习就永远轮不上。实测后果是三条策略跑满 90 小时**一项仙道科技都没点**，
       * 而报告看上去一切正常（「损银 367%」只像是数值问题）。
       *
       * 真人是会一边推进仙途、一边点科技的，两者本来就不互斥；
       * 所以这里让研习每轮都有机会，只是不参与「这轮算不算做过事」的判定。
       */
      const techActed = doTech();
      const immActed = doImmortalTech();
      if (techActed || immActed) acted = true;

      if (!acted && doMortal()) acted = true;
      if (!acted && doBuild()) acted = true;

      // 修士数下降 —— 记一条，带上当时最新的一条日志（通常是死因）
      const cc = (s.cultivation?.cultivators || []).length;
      if (cc < lastCultCount) {
        events.push({
          h: +hours.toFixed(2), kind: '修士减少',
          from: lastCultCount, to: cc,
          text: (s.log[0] && s.log[0].text) || '(无日志)',
        });
      }
      lastCultCount = cc;
      if (s.buildings.caravan > 0 && gateAt['首座驿站'] === undefined) mark('首座驿站');

      if (acted) stallRun = 0;
      else {
        stallRun += 1;
        if (stallRun * actionEvery >= 1800) {
          const d = B.derive(s);
          // 修士到底卡在哪：把前 3 名「离门槛最近」的人的状态摊开。
          // 没有这一栏，卡点报告只会说「90 小时仍在炼气八层」，
          // 却看不出是修为没满、材料不够，还是**根本没人走到门槛上**。
          const nearTop = [...(s.cultivation?.cultivators || [])]
            .sort((a, b) => b.realmIndex - a.realmIndex || gateDistance(a) - gateDistance(b))
            .slice(0, 3)
            .map((p) => {
              const g = B.realmGate(Math.floor(p.realmIndex));
              return `${B.realmName(p.realmIndex)}${g ? '(门槛上)' : ''} xp${Math.round(p.xp||0)}/${Math.round(B.realmXpNeeded(p.realmIndex))} 灵根${p.root?.grade || '?'} cap${B.cultivateLevelCap ? B.cultivateLevelCap(p) : '?'}`;
            });
          stalls.push({
            h: +hours.toFixed(2),
            realm: topRealm,
            realmName: topRealm ? B.realmName(topRealm) : '凡人',
            silver: Math.round(s.silver),
            silverCap: Math.round(d.silverCap),
            stones: +s.spiritStones.toFixed(2),
            secrets: s.secrets.length,
            clues: s.cultivation?.clues || 0,
            cultivators: (s.cultivation?.cultivators || []).length,
            topPower: Math.round(d.totalPower),
            techsLeft: B.TECHS.filter((t) => !s.techs.includes(t.id)).map((t) => t.id),
            nearTop,
          });
          stallRun = 0;
        }
      }
      noteRealm();
      if (topRealm >= 25) done = true;
    }
  }

  const idxs = Object.keys(realmAt).map(Number).sort((a, b) => a - b);
  const dwell = {};
  for (let i = 0; i < idxs.length; i += 1) {
    const cur = idxs[i];
    const next = idxs[i + 1];
    dwell[cur] = (next === undefined ? hours : realmAt[next]) - realmAt[cur];
  }

  const d = B.derive(s);
  /** 修士的境界分布与灵根分布 —— 用来判断「卡在哪一层、卡的是谁」。 */
  function realmHistogram() {
    const byRealm = {};
    const byRoot = {};
    for (const p of s.cultivation?.cultivators || []) {
      const i = Math.floor(p.realmIndex) || 0;
      byRealm[i] = (byRealm[i] || 0) + 1;
      const g = p.root?.grade || '?';
      byRoot[g] = (byRoot[g] || 0) + 1;
    }
    return { byRealm, byRoot };
  }

  return {
    strategy,
    hours: +hours.toFixed(2),
    reachedTop: topRealm >= 25,
    topRealm,
    topRealmName: topRealm ? B.realmName(topRealm) : '凡人',
    realmHistogram: realmHistogram(),
    gates: gateAt,
    events,
    pop: Math.round(s.population),
    silver: Math.round(s.silver),
    silverCap: Math.round(d.silverCap),
    silverWasted: Math.round(s.stats.silverWasted),
    silverEarned: Math.round(s.stats.silverEarned),
    wasteRatio: s.stats.silverEarned > 0 ? s.stats.silverWasted / s.stats.silverEarned : 0,
    stones: +s.spiritStones.toFixed(2),
    secrets: s.secrets.length,
    clues: s.cultivation?.clues || 0,
    techs: s.techs.slice(),
    immortalTechs: (s.immortalTechs || []).slice(),
    exchangeCount: s.exchangeCount || 0,
    techAt,
    gateAt,
    buildAt,
    buildings: Object.fromEntries(B.BUILDINGS.map((b) => [b.id, s.buildings[b.id] || 0])),
    realmAt,
    dwell,
    held: B.worldOf(s).held.slice(),
    manuals: (s.cultivation?.manuals || []).slice(),
    stalls,
    snaps,
    trace,
    s,
  };
}

/* ────────────────────────── 静态盘点 ────────────────────────── */

/**
 * 科技树的静态体检：成本曲线、层间跳变、孤儿节点、effect 覆盖面。
 * 不需要跑仿真，秒出。
 */
function auditTechs() {
  const rows = [...B.TECHS].sort((a, b) => a.cost - b.cost);
  const byTier = {};
  for (const t of B.TECHS) (byTier[t.tier] ||= []).push(t);

  console.log('\n── 二、凡人科技树静态盘点 ──');
  console.log('   id            层  成本     前置              effect');
  for (const t of rows) {
    const fx = t.effect ? Object.entries(t.effect).map(([k, v]) => `${k}:${v}`).join(' ') : '';
    const unl = t.unlocksBuilding ? `建筑:${t.unlocksBuilding}` : (t.unlocksPill ? `丹药:${t.unlocksPill}` : '');
    console.log(`   ${t.id.padEnd(13)} ${String(t.tier).padStart(2)} ${String(t.cost).padStart(6)}  `
      + `${(t.requires.join('+') || '—').padEnd(16)} ${fx} ${unl}`.trimEnd());
  }

  console.log('\n   层级成本区间与跳变：');
  const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);
  for (const tier of tiers) {
    const list = byTier[tier];
    const costs = list.map((t) => t.cost);
    console.log(`     T${tier}  ${list.length} 项  ${Math.min(...costs)}–${Math.max(...costs)} 银  ${list.map((t) => t.id).join(' ')}`);
  }
  let prevMax = 0;
  for (const tier of tiers) {
    const costs = byTier[tier].map((t) => t.cost);
    const lo = Math.min(...costs);
    if (prevMax) console.log(`     T${tier - 1}最高 ${prevMax} → T${tier}最低 ${lo}   倍数 ×${(lo / prevMax).toFixed(2)}`);
    prevMax = Math.max(...costs);
  }

  // 孤儿节点：谁需要它
  const usedBy = {};
  for (const t of B.TECHS) for (const r of t.requires || []) (usedBy[r] ||= []).push(t.id);
  for (const t of B.IMMORTAL_TECHS || []) for (const r of t.requires || []) (usedBy[r] ||= []).push(t.id);
  for (const t of B.TECHS) for (const r of t.requiresImmortal || []) (usedBy[r] ||= []).push(`仙:${t.id}`);

  console.log('\n   后缀（谁需要它）：');
  let orphans = 0;
  for (const t of B.TECHS) {
    const users = usedBy[t.id] || [];
    // terminal: true 的节点是**刻意的终点**（该条线的最后一块碑），不算孤儿
    const tag = users.length ? users.join(' ')
      : (t.terminal ? '○ 终点（刻意的末节点）' : '★ 没有后继 —— 点了它只为它自己');
    if (!users.length && !t.terminal) orphans += 1;
    console.log(`     ${t.id.padEnd(13)} ${tag}`);
  }
  console.log(`   孤儿节点合计：${orphans} 个`);

  // effect 键覆盖面
  const keyUse = {};
  for (const t of B.TECHS) for (const k of Object.keys(t.effect || {})) (keyUse[k] ||= []).push(t.id);
  console.log('\n   effect 键使用情况：');
  for (const [k, ids] of Object.entries(keyUse).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${k.padEnd(22)} ×${ids.length}   ${ids.join(' ')}`);
  }

  auditImmortalTechs();
}

/** 修仙侧科技树的静态盘点（结构与凡人侧对称，另加「交叉依赖」一栏）。 */
function auditImmortalTechs() {
  const list = B.IMMORTAL_TECHS || [];
  if (!list.length) { console.log('\n   修仙侧科技树：**不存在**（本版本尚未实现）'); return; }

  const byTier = {};
  for (const t of list) (byTier[t.tier] ||= []).push(t);

  console.log('\n── 二之二、仙道科技树静态盘点 ──');
  console.log('   id            层  成本(银/石)  前置                     effect / 解锁');
  for (const t of [...list].sort((a, b) => a.tier - b.tier || a.cost - b.cost)) {
    const fx = t.effect ? Object.entries(t.effect).map(([k, v]) => `${k}:${v}`).join(' ') : '';
    const unl = [
      t.unlocksBuilding ? `建筑:${t.unlocksBuilding}` : '',
      t.unlocksPill ? `丹药:${t.unlocksPill}` : '',
      t.unlocksAction ? `操作:${t.unlocksAction}` : '',
    ].filter(Boolean).join(' ');
    const cost = `${t.cost}${t.stones ? '/' + t.stones : ''}`;
    console.log(`   ${t.id.padEnd(13)} ${String(t.tier).padStart(2)} ${cost.padStart(11)}  `
      + `${(t.requires.join('+') || '—').padEnd(24)} ${fx} ${unl}`.trimEnd());
  }

  console.log('\n   层级成本区间与跳变（灵石）：');
  const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);
  let prevMax = 0;
  for (const tier of tiers) {
    const costs = byTier[tier].map((t) => t.stones || 0);
    const lo = Math.min(...costs); const hi = Math.max(...costs);
    console.log(`     T${tier}  ${byTier[tier].length} 项  ${lo}–${hi} 石  ${byTier[tier].map((t) => t.id).join(' ')}`);
    if (prevMax) console.log(`        T${tier - 1}最高 ${prevMax} → T${tier}最低 ${lo}   倍数 ×${(lo / prevMax).toFixed(2)}`);
    prevMax = hi;
  }

  const usedBy = {};
  for (const t of list) for (const r of t.requires || []) (usedBy[r] ||= []).push(t.id);
  for (const t of list) for (const r of t.requiresImmortal || []) (usedBy[r] ||= []).push(t.id);
  console.log('\n   后缀（谁需要它）：');
  let orphans = 0;
  for (const t of list) {
    const users = usedBy[t.id] || [];
    const tag = users.length ? users.join(' ')
      : (t.terminal ? '○ 终点（刻意的末节点）' : '★ 没有后继');
    if (!users.length && !t.terminal) orphans += 1;
    console.log(`     ${t.id.padEnd(13)} ${tag}`);
  }
  console.log(`   孤儿节点合计：${orphans} 个`);

  // 跨树前置：两条线互相咬合的地方
  const mortalIds = new Set(B.TECHS.map((t) => t.id));
  const cross = [];
  for (const t of list) {
    for (const r of t.requires) if (mortalIds.has(r)) cross.push(`仙道「${t.name}」← 凡人「${r}」`);
  }
  for (const t of B.TECHS) {
    for (const r of (t.requiresImmortal || [])) cross.push(`凡人「${t.name}」← 仙道「${r}」`);
  }
  console.log('\n   跨树前置（仙凡咬合点）：');
  if (!cross.length) console.log('     ★ 无 —— 两条线完全平行，没有咬合');
  for (const c of cross) console.log(`     ${c}`);

  const keyUse = {};
  for (const t of list) for (const k of Object.keys(t.effect || {})) (keyUse[k] ||= []).push(t.id);
  console.log('\n   effect 键使用情况：');
  for (const [k, ids] of Object.entries(keyUse).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${k.padEnd(22)} ×${ids.length}   ${ids.join(' ')}`);
  }
}

/** 建筑的成本/收益曲线。 */
function auditBuildings() {
  console.log('\n── 三、建筑曲线（首件成本 / 增长 / 每件效果）──');
  const d0 = B.derive(boot().state);
  for (const b of B.BUILDINGS) {
    const cap = (() => {
      try { return b.perText || ''; } catch { return ''; }
    })();
    console.log(`   ${b.name.padEnd(6)} 首件 ${String(b.baseCost).padStart(7)}  增长 ×${b.growth}  格 ${b.slots}  ${b.tech || '开局即有'}  ${cap}`);
    // 第 10 / 25 / 50 件的边际成本
    const seq = [1, 10, 25, 50].map((n) => {
      const c = b.baseCost * Math.pow(b.growth, n - 1);
      return `${n}件:${Math.round(c)}`;
    }).join('  ');
    console.log(`           边际成本 ${seq}`);
  }
  console.log(`\n   营造额度：开局 ${B.BASE.buildingCap} 格，每座地产 +6 格（ESTATE_SLOTS）`);
  console.log(`   银两上限：开局 ${B.BASE.silverCap}，每座钱庄 +8000`);
}

/** 境界与门槛的静态表。 */
function auditRealms() {
  console.log('\n── 四、境界表与冲关门槛 ──');
  let cum = 0;
  for (let i = 1; i <= 24; i += 1) {
    const need = B.realmXpNeeded(i);
    if (Number.isFinite(need)) cum += need;
    const gate = B.realmGate(i);
    const g = gate ? `冲关 石${gate.stones} 线索${gate.clues} 丹${gate.pill} 成功${(gate.baseRate * 100).toFixed(0)}% 失败退${(gate.failLoss * 100).toFixed(0)}%` : '';
    const isTierStart = B.REALM_TIERS.some((t) => B.REALM_TIERS.indexOf(t) >= 0 && b_indexOfTier(t) === i);
    const mark = gate || isTierStart ? '' : '   ';
    console.log(`   ${String(i).padStart(2)} ${B.realmName(i).padEnd(12, '　')} 需 ${String(Math.round(need)).padStart(6)} 修为  累计 ${(cum / H).toFixed(2).padStart(6)}h  ${g}`);
  }
}

/** 某境界是不是它所属大档的第一层（用来在表里画分隔）。 */
function b_indexOfTier(tier) {
  let acc = 0;
  for (const t of B.REALM_TIERS) {
    if (t === tier) return acc + 1;
    acc += t.stages.length;
  }
  return -1;
}

/** 银两经济：产出与去处。 */
function auditSilver() {
  console.log('\n── 五、银两产出与去处 ──');
  const X = boot();
  const s = X.state;
  const d = B.derive(s);
  console.log(`   开局：人 ${s.population} · 银 ${s.silver}/${d.silverCap} · 产出 ${d.silverPerSec.toFixed(4)}/秒 = 每小时 ${(d.silverPerSec * H).toFixed(2)} 两`);
  console.log(`   出生率 ${d.birthRate.toFixed(5)}/秒  死亡率 ${d.deathRate.toFixed(5)}/秒  净值 ${d.netRate.toFixed(5)}/秒`);
  console.log(`   人均产出 BASE.silverPerPop = ${B.BASE.silverPerPop}/秒/人`);
  console.log('\n   银两的出口（一次性 / 持续）：');
  console.log('     · 营造建筑物：唯一的持续出口，指数增长');
  console.log('     · 坊市换灵石：CULTIVATOR_MARKET.silver 一次一笔');
  console.log('     · 丹炉/锻造台/符台升级：每次 stones + silver');
  console.log('     · 灵池营造 5 万两 · 矿场 8 万两');
  console.log('     · 施粥赈济（道心）');
}

/* ────────────────────────── 入口 ────────────────────────── */

/**
 * 只有「被当成脚本跑」时才执行这一段。
 *
 * 用 `import.meta.main`（Node 22+）判定：被 import 时本段整块跳过，
 * 于是 diagnose.mjs 能拿到 boot/run 而不用白跑一局仿真。
 */
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const staticOnly = argv.includes('--baseline');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const only = positional.find((a) => ALL_STRATEGIES.includes(a)) || null;
  const snapIdx = argv.indexOf('--snap');
  const snapFor = snapIdx >= 0 ? argv[snapIdx + 1] : null;

  boot();   // 先把桥搭起来（静态盘点要用）

  console.log('\n《修仙世家》平衡仿真 · 基准盘（天赋 1 · 无灵根 · 无金手指 · 关答题）');
  if (MISSING.length) console.log(`⚠ 缺失的名字：${MISSING.join(', ')}`);

  auditTechs();
  auditBuildings();
  auditRealms();
  auditSilver();

  if (staticOnly) {
    console.log('\n（--baseline：只做静态盘点，未跑仿真）\n');
    process.exit(0);
  }

  const strategies = only ? [only] : ALL_STRATEGIES;
  const results = [];

  for (const st of strategies) {
    console.log(`\n… 正在跑「${st}」，最多 90 小时游戏时间`);
    const t0 = Date.now();
    const r = run(st, {
      snapEvery: 600,
      onSnap: snapFor === st ? (snap) => {
        if (Math.abs(snap.h % 1) < 1e-9) {
          console.log(`   ${String(Math.round(snap.h)).padStart(4)}h  ${snap.topRealm ? B.realmName(snap.topRealm) : '凡人'}`
            + `  人 ${String(snap.pop).padStart(7)}  银 ${String(snap.silver).padStart(10)}/${snap.silverCap}`
            + `  石 ${String(snap.stones).padStart(8)}  秘闻 ${String(snap.secrets).padStart(2)}  修士 ${snap.cultivators}`);
        }
      } : undefined,
    });
    console.log(`   用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
    results.push(r);
  }

  console.log('\n════════════════════ 六、总览 ════════════════════');
  const pad = (v, n) => String(v).padStart(n);
  console.log('策略     通关  总时长   最高境界       人口      银两/上限    灵石   秘闻 凡人术 仙道术 领地  损银占比');
  for (const r of results) {
    console.log(
      `${r.strategy.padEnd(7)} ${r.reachedTop ? '✓' : '✗'}  ${pad(r.hours.toFixed(1), 6)}h ${r.topRealmName.padEnd(12, '　')} `
      + `${pad(r.pop, 8)} ${pad(r.silver, 10)}/${pad(r.silverCap, 7)} ${pad(r.stones.toFixed(1), 7)} `
      + `${pad(r.secrets, 4)} ${pad(r.techs.length, 5)} ${pad(r.immortalTechs.length, 6)} ${pad(r.held.length, 4)} ${pad((r.wasteRatio * 100).toFixed(1) + '%', 9)}`,
    );
  }

  console.log('\n════════════════════ 七、境界驻留（小时）════════════════════');
  for (const r of results) {
    console.log(`\n［${r.strategy}］`);
    for (const i of Object.keys(r.dwell).map(Number).sort((a, b) => a - b)) {
      const d = r.dwell[i];
      console.log(`   ${r.realmAt[i].toFixed(2).padStart(6)}h 起  ${B.realmName(i).padEnd(12, '　')} 停留 ${d.toFixed(2).padStart(6)}h  ${'█'.repeat(Math.max(1, Math.round(d * 1.6)))}`);
    }
  }

  console.log('\n════════════════════ 八、科技研习时点（小时）════════════════════');
  console.log('   id'.padEnd(19) + '成本   ' + results.map((r) => r.strategy.padStart(9)).join(''));
  for (const t of [...B.TECHS].sort((a, b) => a.cost - b.cost)) {
    const cells = results.map((r) => {
      const at = r.techAt[t.id];
      return (at === undefined ? '—' : at.toFixed(2)).padStart(9);
    }).join('');
    console.log(`   ${t.id.padEnd(14)} ${String(t.cost).padStart(5)} ${cells}`);
  }
  if ((B.IMMORTAL_TECHS || []).length) {
    console.log('   ── 仙道 ──');
    for (const t of [...B.IMMORTAL_TECHS].sort((a, b) => (a.stones || 0) - (b.stones || 0))) {
      const cells = results.map((r) => {
        const at = r.techAt[t.id];
        return (at === undefined ? '—' : at.toFixed(2)).padStart(9);
      }).join('');
      console.log(`   ${t.id.padEnd(14)} ${String(t.stones || 0).padStart(5)}石 ${cells}`);
    }
  }

  console.log('\n════════════════════ 九、建筑数量 ════════════════════');
  for (const r of results) {
    console.log(`   [${r.strategy}] ` + B.BUILDINGS.map((b) => `${b.name} ${r.buildings[b.id]}`).join('  '));
  }

  console.log('\n════════════════════ 九之二、收局时修士的境界与灵根分布 ════════════════════');
  for (const r of results) {
    const rh = r.realmHistogram;
    const realms = Object.keys(rh.byRealm).map(Number).sort((a, b) => a - b);
    console.log(`   [${r.strategy}] 境界：` + (realms.length
      ? realms.map((i) => `${B.realmName(i)}×${rh.byRealm[i]}`).join('  ') : '无修士'));
    console.log(`              灵根：` + (Object.keys(rh.byRoot).length
      ? Object.entries(rh.byRoot).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}×${n}`).join('  ') : '—'));
  }

  console.log('\n════════════════════ 九之三、关键里程碑时点（小时）════════════════════');
  for (const r of results) {
    console.log(`\n［${r.strategy}］`);
    for (const [k, v] of Object.entries(r.gates)) console.log(`   ${k.padEnd(18, '　')} ${v.toFixed(2)}h`);
  }

  console.log('\n════════════════════ 九之四、修士减少事件 ════════════════════');
  for (const r of results) {
    console.log(`\n［${r.strategy}］共 ${r.events.length} 次`);
    for (const e of r.events.slice(0, 10)) {
      console.log(`   ${e.h.toFixed(1).padStart(6)}h  ${e.from} → ${e.to}   ${e.text.slice(0, 70)}`);
    }
    if (r.events.length > 10) console.log(`   …… 另有 ${r.events.length - 10} 次`);
  }

  console.log('\n════════════════════ 十、卡点（连续 30 分钟无任何可做的事）════════════════════');
  for (const r of results) {
    console.log(`\n［${r.strategy}］共 ${r.stalls.length} 次`);
    for (const s of r.stalls.slice(0, 14)) {
      console.log(`   ${s.h.toFixed(1).padStart(6)}h  ${s.realmName.padEnd(10, '　')} 银 ${pad(s.silver, 10)}/${s.silverCap}`
        + `  石 ${s.stones.toFixed(1).padStart(8)}  秘闻 ${pad(s.secrets, 3)}/线索 ${pad(s.clues, 3)}`
        + `  修士 ${pad(s.cultivators, 2)}  战力 ${pad(s.topPower, 7)}  未研科技: ${s.techsLeft.join(',') || '无'}`);
      for (const t of s.nearTop || []) console.log(`            ↳ ${t}`);
    }
    if (r.stalls.length > 14) console.log(`   …… 另有 ${r.stalls.length - 14} 次`);
  }

  if (wantJson) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(results.map((r) => ({ ...r, snaps: undefined, s: undefined })), null, 1));
  }

  console.log('\n完成。\n');
}

/* ────────────────────────── 模块出口 ────────────────────────── */

/**
 * 让别的脚本能复用这套仿真核心（见 scripts/diagnose.mjs）。
 *
 * 之所以要求 `import.meta.main`：本文件尾部是**入口代码**，被 import 时
 * 会直接跑一整轮 90 小时仿真，那样 diagnose 每开一次就白跑三个策略。
 * Node 22 起 `import.meta.main` 可用（本仓库要求 Node 22）。
 */
export { boot, run, auditTechs, auditBuildings, auditRealms, auditSilver };
export { B };          // 活绑定：boot() 之后才是桥对象
export const SIM = { run, boot, get bridge() { return B; } };
