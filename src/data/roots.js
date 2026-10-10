
/* ────────────────────────────────────────────────────────────────
 * 区块：灵根表
 * 职责：五行的定义、灵根五档的权重与效果、抽签用的权重表。
 *       纯数据 + 纯函数，不读 state（要 state 的部分在 systems/roots.js）。
 * 依赖：无
 * 调参：
 *   ROOT_ELEMENTS      —— 五行。木留给「炼丹」（丹道属木），R3 里还没有对应功法。
 *   ROOT_GRADES        —— 五档灵根。weight 是**基础**权重（后天修士用），
 *                         innateWeight 是天生灵根用的权重（好得多）。
 *   ROOT_REROLL_*      —— 测灵根的灵石开销，是灵石的又一个去处。
 * 文档：docs/20-灵根.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 五行。
 *
 * ⚠️ 木目前没有对应的功法道途 —— 它预留给「炼丹」（丹道属木）。
 *    所以抽到带木的灵根在 R3 里只是白占一个位置，炼丹区块落地后才有用。
 */
const ROOT_ELEMENTS = {
  metal: { id: 'metal', name: '金', desc: '锋锐坚刚' },
  wood:  { id: 'wood',  name: '木', desc: '生生不息' },
  water: { id: 'water', name: '水', desc: '流通善变' },
  fire:  { id: 'fire',  name: '火', desc: '炽烈焚天' },
  earth: { id: 'earth', name: '土', desc: '厚载沉稳' },
};
const ROOT_ELEMENT_ORDER = ['metal', 'wood', 'water', 'fire', 'earth'];

/**
 * 灵根五档。
 *
 * count       拥有几种属性。**越少越纯、越好** —— 这是修仙题材的经典设定。
 * weight      后天祛障（服丹／灵池）的抽中权重，合计 1
 * innateWeight 天生灵根的抽中权重，合计 1。好灵根的概率高得多，
 *             所以「生而通灵」是真的值钱。
 * speed       修炼速度倍率
 * breakBonus  突破成功率修正（加到基础率上）
 * capIndex    能修到的最高 realmIndex —— 这就是「灵根决定上限」
 * focus       天灵根专精：对本系功法的额外效果倍率（其他档为 1）
 * canLearnAll 是否能修全部系别的功法（只有天灵根有此特权）
 */
const ROOT_GRADES = [
  {
    id: 'heaven', name: '天灵根', count: 1,
    weight: 0.005, innateWeight: 0.02,
    speed: 2.00, breakBonus: 0.15, capIndex: 25, focus: 1.5, canLearnAll: true,
    desc: '单系纯灵根，万中无一。修行一日抵旁人两日，且不拘何系功法皆可参研。',
  },
  {
    id: 'dual', name: '双灵根', count: 2,
    weight: 0.04, innateWeight: 0.12,
    speed: 1.50, breakBonus: 0.08, capIndex: 24, focus: 1, canLearnAll: false,
    desc: '两系并生，资质上佳。可修这两系的功法。',
  },
  {
    id: 'triple', name: '三灵根', count: 3,
    weight: 0.15, innateWeight: 0.30,
    speed: 1.15, breakBonus: 0.02, capIndex: 23, focus: 1, canLearnAll: false,
    desc: '三系驳杂，中人之资。修到化神中期便到了头。',
  },
  {
    id: 'quad', name: '四灵根', count: 4,
    weight: 0.30, innateWeight: 0.36,
    speed: 1.00, breakBonus: 0.00, capIndex: 22, focus: 1, canLearnAll: false,
    desc: '四系混杂，修行缓慢。若无机缘，化神初期便是极限。',
  },
  {
    id: 'pseudo', name: '五灵根', count: 5,
    weight: 0.505, innateWeight: 0.20,
    speed: 0.70, breakBonus: -0.08, capIndex: 21, focus: 1, canLearnAll: false,
    desc: '五行俱全反而俱不精，俗称伪灵根。修到元婴圆满便再难寸进。',
  },
];
const ROOT_GRADE_MAP = Object.fromEntries(ROOT_GRADES.map((g) => [g.id, g]));
/** 由差到好的顺序，用于「重新测灵根不亏」的比较。 */
const ROOT_RANK = Object.fromEntries(ROOT_GRADES.map((g, i) => [g.id, ROOT_GRADES.length - i]));

/**
 * 测灵根（重测）的开销。
 * 每次比上一次贵，且**保证不会测得更差** —— 所以它是个稳定的灵石去处，
 * 而不是赌博。灵根越差越值得重测。
 */
const ROOT_REROLL_COST_BASE = 30;
const ROOT_REROLL_COST_STEP = 25;

/** 道途 → 所需属性。null 表示无属性，人人可修。 */
const MANUAL_DAO_ELEMENT = {
  breath: null,      // 炼气：无属性，保证主线不被灵根卡住
  ward: 'metal',     // 御守
  trade: 'earth',    // 经营
  seek: 'water',     // 寻幽
  peril: 'fire',     // 涉险
  // 木预留给「炼丹」
};

/**
 * 宗门收徒的门槛（rootRank）。
 * 三灵根及以上才收 —— 换算过来就是「半数以上的修士没资格进宗门」。
 */
const SECT_MIN_ROOT_RANK = 3;

/* ── 抽签 ── */

/** 按权重表抽一档。 */
function pickRootGrade(rng, innate) {
  const r = rng();
  let acc = 0;
  for (const g of ROOT_GRADES) {
    acc += innate ? g.innateWeight : g.weight;
    if (r < acc) return g;
  }
  return ROOT_GRADES[ROOT_GRADES.length - 1];
}

/** 从五行里不重复地抽 n 个。 */
function pickElements(count, rng) {
  const pool = ROOT_ELEMENT_ORDER.slice();
  const out = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * 掷一次灵根。
 * @param {() => number} rng
 * @param {boolean} innate 天生灵根用更好的权重表
 */
function rollRoot(rng = Math.random, innate = false) {
  const grade = pickRootGrade(rng, innate);
  return { grade: grade.id, elements: pickElements(grade.count, rng) };
}
