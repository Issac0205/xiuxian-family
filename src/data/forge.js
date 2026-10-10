
/* ────────────────────────────────────────────────────────────────
 * 区块：矿料与法器
 * 职责：四种矿料、九个法器、锻造台等级。
 *       与炼丹**同构**：矿料同样来自地图上已占领且有效镇守的势力节点，
 *       只是每种节点同时产一味药材和一种矿料。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   FORGE_ORES      —— 矿料表。id 与 data/map.js 里节点的 ore 字段对应
 *   FORGE_ITEMS     —— 法器表。slot 分兵器 / 护甲 / 法宝，每个部位只能装备一件
 *   FORGE_LEVELS    —— 锻造台等级表
 * 文档：docs/31-炼器.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 四种矿料。
 *
 * ⚠️ 与药材（data/alchemy.js）是**两套独立的材料**，虽然产地是同样的四个节点。
 *    这是刻意的：让炼丹与炼器抢同一批领地，但彼此不抢材料，
 *    于是玩家不需要在「这两条线选哪条」上做排他选择，而是两条都能推。
 */
const FORGE_ORES = [
  { id: 'lingmu', name: '灵木', tier: 1, node: 'valley', desc: '浸过灵气的硬木，轻而韧，宜作剑柄与甲衬。' },
  { id: 'hantie', name: '寒铁', tier: 2, node: 'river', desc: '自寒潭底捞出的铁砂所炼，触手生凉，护体最宜。' },
  { id: 'xuantie', name: '玄铁', tier: 3, node: 'ridge', desc: '玄铁宗立宗的根本，重逾寻常精铁三倍。' },
  { id: 'yaogu', name: '妖骨', tier: 4, node: 'beastnest', desc: '筑基妖兽的遗骨，坚硬更胜玄铁，且自带凶煞之气。' },
];
const FORGE_ORE_MAP = Object.fromEntries(FORGE_ORES.map((o) => [o.id, o]));

/** 三个部位。每个部位只能装备一件 —— 这是法器体系唯一的取舍。 */
const FORGE_SLOTS = [
  { id: 'weapon', name: '兵器', desc: '主杀伐，战力加成最高。' },
  { id: 'armor', name: '护甲', desc: '主护体，加成居中，但耐久掉得慢。' },
  { id: 'talisman', name: '法宝', desc: '主神通，加成最低，但洞天里额外保命。' },
];
const FORGE_SLOT_MAP = Object.fromEntries(FORGE_SLOTS.map((s) => [s.id, s]));

/**
 * 九个法器（三个部位 × 三个品阶）。
 *
 * materials   打造消耗的矿料
 * baseRate    基础成功率；还要加锻造台等级、熟练度、金灵根
 * power       家族战力加成（对所有修士生效）
 * survive     洞天生还率加成（只有法宝有）
 * wear        每次征伐 / 探险的耐久损耗
 * forge       需要的锻造台等级
 * cost        祭炼一次（修耐久）的矿料，按打造的一半取整
 */
const FORGE_ITEMS = [
  /* ── 兵器 ── */
  {
    id: 'qingfeng', name: '青锋剑', slot: 'weapon', tier: 1, forge: 1,
    materials: { lingmu: 3, xuantie: 1 }, baseRate: 0.72, power: 0.15, survive: 0, wear: 8,
    desc: '家族第一柄真正意义上的法器。剑身泛青，斩得动凡铁。',
  },
  {
    id: 'xuantiejian', name: '玄铁重剑', slot: 'weapon', tier: 2, forge: 2,
    materials: { xuantie: 4, hantie: 1 }, baseRate: 0.50, power: 0.35, survive: 0, wear: 10,
    desc: '重剑无锋，大巧不工。抡起来吃修为，炼气修士勉强使得动。',
  },
  {
    id: 'zhuxie', name: '诛邪剑', slot: 'weapon', tier: 3, forge: 4,
    materials: { xuantie: 6, yaogu: 3 }, baseRate: 0.28, power: 0.70, survive: 0, wear: 12,
    desc: '以妖骨为脊、玄铁为刃。剑成之日，谷中妖兽尽皆噤声。',
  },
  /* ── 护甲 ── */
  {
    id: 'lingmujia', name: '灵木软甲', slot: 'armor', tier: 1, forge: 1,
    materials: { lingmu: 4 }, baseRate: 0.78, power: 0.18, survive: 0, wear: 5,
    desc: '灵木片以丝线密密编成，轻便透气，族中老少都能穿。',
  },
  {
    id: 'hanyu', name: '寒玉战甲', slot: 'armor', tier: 2, forge: 3,
    materials: { hantie: 4, lingmu: 2 }, baseRate: 0.45, power: 0.40, survive: 0, wear: 6,
    desc: '寒铁淬火七次而成，着之如抱冰，刀剑加身只留白痕。',
  },
  {
    id: 'xuanwu', name: '玄武宝铠', slot: 'armor', tier: 3, forge: 4,
    materials: { hantie: 6, yaogu: 4 }, baseRate: 0.30, power: 0.80, survive: 0, wear: 7,
    desc: '取妖兽背甲整片炼化，据说能硬抗金丹修士一击。',
  },
  /* ── 法宝 ── */
  {
    id: 'julingzhu', name: '聚灵珠', slot: 'talisman', tier: 1, forge: 1,
    materials: { lingmu: 2, hantie: 1 }, baseRate: 0.80, power: 0.12, survive: 0.02, wear: 3,
    desc: '含在口中可缓缓聚气，是族中子弟最爱的贴身之物。',
  },
  {
    id: 'yaodanfan', name: '妖丹幡', slot: 'talisman', tier: 2, forge: 3,
    materials: { yaogu: 3, xuantie: 2 }, baseRate: 0.48, power: 0.30, survive: 0.05, wear: 4,
    desc: '幡上悬着一枚炼化的妖丹，入洞天时能替主人挡一次阴煞。',
  },
  {
    id: 'taixujing', name: '太虚镜', slot: 'talisman', tier: 3, forge: 5,
    materials: { yaogu: 5, hantie: 3, xuantie: 3 }, baseRate: 0.22, power: 0.60, survive: 0.09, wear: 5,
    desc: '镜面照得见灵脉走向，也能在绝境里撕开一道缝隙。',
  },
];
const FORGE_ITEM_MAP = Object.fromEntries(FORGE_ITEMS.map((i) => [i.id, i]));

/** 按部位分组，界面用。 */
function forgeItemsOfSlot(slot) { return FORGE_ITEMS.filter((i) => i.slot === slot); }

/**
 * 锻造台五级。与丹炉完全对称，只是加成给的是成功率。
 */
const FORGE_LEVELS = [
  { level: 1, name: '土窑', rateBonus: 0.00, stones: 0, silver: 0 },
  { level: 2, name: '铁匠铺', rateBonus: 0.05, stones: 8, silver: 300000 },
  { level: 3, name: '地火炉', rateBonus: 0.10, stones: 35, silver: 1500000 },
  { level: 4, name: '天工坊', rateBonus: 0.16, stones: 150, silver: 7000000 },
  { level: 5, name: '神匠殿', rateBonus: 0.22, stones: 700, silver: 25000000 },
];
const FORGE_LEVEL_MAX = FORGE_LEVELS.length;
function forgeAt(level) {
  const i = Math.max(0, Math.min(FORGE_LEVEL_MAX - 1, Math.floor(Number(level) || 0) - 1));
  return FORGE_LEVELS[i];
}

/** 法器耐久上限，以及祭炼的加成。 */
const FORGE_DURABILITY_MAX = 100;
/** 每次征伐 / 探险的额外耐久损耗系数（乘在 item.wear 上）。 */
const FORGE_WEAR_SCALE = 1;

/** 金灵根加成（与炼丹的木灵根对称）。 */
const FORGE_METAL_BASE = 0.08;
const FORGE_METAL_PER_RANK = 0.04;

/** 熟练度：每个法器独立，上限 10，每点 +1.5%。 */
const FORGE_PROFICIENCY_MAX = 10;
const FORGE_PROFICIENCY_STEP = 0.015;

const FORGE_RATE_MAX = 0.98;
const FORGE_RATE_MIN = 0.05;
