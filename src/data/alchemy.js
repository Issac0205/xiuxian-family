
/* ────────────────────────────────────────────────────────────────
 * 区块：药材与丹方
 * 职责：四种药材、六个丹方、丹炉等级。
 *       药材**全部来自地图上已占领的势力节点** —— 所以在 R4 打通商路
 *       才有丹可炼，这是两个区块之间的主要咬合点。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   ALCHEMY_HERBS    —— 药材表。id 与 data/map.js 里节点的 herb 字段对应
 *   ALCHEMY_RECIPES  —— 丹方表。materials 是 {药材id: 数量}
 *   ALCHEMY_FURNACE  —— 丹炉等级表。等级解锁高阶丹方并提高成功率
 * 文档：docs/30-炼丹.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 四种药材。
 *
 * ⚠️ 每种药材**只由地图上的一个节点产出**，所以「炼得出什么丹」
 *    直接取决于「打通了哪几段商路」。这是刻意的：让 R4 的扩张
 *    在 R5 里有直接的兑现。
 */
const ALCHEMY_HERBS = [
  { id: 'grass', name: '青灵草', tier: 1, node: 'valley', desc: '最常见的下品灵草，山野向阳处成片生长。' },
  { id: 'ling', name: '寒潭菱', tier: 2, node: 'river', desc: '生在寒潭深处，采时需要闭气下水，稍有不慎便被水寒侵体。' },
  { id: 'iron', name: '玄铁芝', tier: 3, node: 'ridge', desc: '附在玄铁矿脉上生长的菌芝，质地坚硬，需以灵火久炼方化。' },
  { id: 'flame', name: '赤焰花', tier: 4, node: 'beastnest', desc: '只开在妖兽巢穴附近，花瓣触手灼热，是化神丹唯一的主药。' },
];
const ALCHEMY_HERB_MAP = Object.fromEntries(ALCHEMY_HERBS.map((h) => [h.id, h]));

/**
 * 丹方。
 *
 * materials  消耗的药材
 * baseRate   基础成功率；实际成功率还要加丹炉等级、熟练度、木灵根
 * yield      成功时产出的丹药数量（失败则损失全部材料）
 * furnace    需要的丹炉等级
 * months     「一炉的耗时」—— 目前一次炼制立即结算，这个字段留给
 *            以后做成排队炼制时用
 */
const ALCHEMY_RECIPES = [
  {
    id: 'quzhang', name: '祛障丹', tier: 1, furnace: 1,
    materials: { grass: 2 }, baseRate: 0.90, yield: 1, months: 1,
    effect: '凡人来服，可祛凡俗之障，后天踏入炼气。',
    desc: '最基础的丹药，也是家族扩员的根本。坊市亦有售，但自炼便宜得多。',
  },
  {
    id: 'huiqi', name: '回气丹', tier: 1, furnace: 1,
    materials: { grass: 3, ling: 1 }, baseRate: 0.75, yield: 1, months: 2,
    effect: '一名修士服下后，修炼速度 +50%，持续一个时辰。',
    desc: '闭关前服一枚，事半功倍。药力过时不候。',
  },
  {
    id: 'zhuji', name: '筑基丹', tier: 2, furnace: 2,
    materials: { grass: 3, ling: 1 }, baseRate: 0.55, yield: 1, months: 3,
    effect: '炼气九层冲关筑基时，提高成功率。',
    desc: '冲开经脉的关键之物。炼气修士一生只求这一枚。',
  },
  {
    id: 'jindan', name: '金丹', tier: 2, furnace: 3,
    materials: { ling: 3, iron: 2 }, baseRate: 0.42, yield: 1, months: 4,
    effect: '筑基圆满冲关金丹时，提高成功率。',
    desc: '气凝成丹的引子。炼制时炉温极高，寻常丹炉撑不住。',
  },
  {
    id: 'yuanying', name: '元婴丹', tier: 3, furnace: 4,
    materials: { iron: 4, flame: 2 }, baseRate: 0.30, yield: 1, months: 6,
    effect: '金丹圆满冲关元婴时，提高成功率。',
    desc: '玄铁芝的坚与赤焰花的烈相冲，稍有不慎便炸炉。',
  },
  {
    id: 'huashen', name: '化神丹', tier: 4, furnace: 5,
    materials: { flame: 4, iron: 2, grass: 2 }, baseRate: 0.20, yield: 1, months: 9,
    effect: '元婴圆满冲关化神时，提高成功率。',
    desc: '传说中的丹药。整个凡尘地界，能炼出它的丹炉不超过三座。',
  },
];
const ALCHEMY_RECIPE_MAP = Object.fromEntries(ALCHEMY_RECIPES.map((r) => [r.id, r]));

/**
 * 丹炉五级。
 *
 * rateBonus  成功率加成
 * yieldBonus 额外产出（每炉多出来的丹药，向下取整后按概率给）
 * cost       升到这一级的花费（灵石 / 银两）
 */
const ALCHEMY_FURNACE = [
  { level: 1, name: '粗陶丹炉', rateBonus: 0.00, yieldBonus: 0, stones: 0, silver: 0 },
  { level: 2, name: '青铜丹炉', rateBonus: 0.06, yieldBonus: 0, stones: 5, silver: 200000 },
  { level: 3, name: '寒铁丹炉', rateBonus: 0.12, yieldBonus: 1, stones: 25, silver: 1000000 },
  { level: 4, name: '紫金八卦炉', rateBonus: 0.18, yieldBonus: 1, stones: 120, silver: 5000000 },
  { level: 5, name: '太乙神炉', rateBonus: 0.25, yieldBonus: 2, stones: 600, silver: 20000000 },
];
const ALCHEMY_FURNACE_MAX = ALCHEMY_FURNACE.length;
/** 取某一级的定义（越界夹取）。 */
function furnaceAt(level) {
  const i = Math.max(0, Math.min(ALCHEMY_FURNACE_MAX - 1, Math.floor(Number(level) || 0) - 1));
  return ALCHEMY_FURNACE[i];
}

/** 每个丹方各自的熟练度上限，以及每点熟练度的成功率加成。 */
const ALCHEMY_PROFICIENCY_MAX = 10;
const ALCHEMY_PROFICIENCY_STEP = 0.015;

/** 木灵根对炼丹的加成：不含木则为 0。 */
const ALCHEMY_WOOD_BASE = 0.08;
const ALCHEMY_WOOD_PER_RANK = 0.04;

/** 成功率上下限。 */
const ALCHEMY_RATE_MAX = 0.98;
const ALCHEMY_RATE_MIN = 0.05;
