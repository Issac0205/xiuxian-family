
/* ────────────────────────────────────────────────────────────────
 * 区块：符文与符箓
 * 职责：四种符文、四张符箓、符台等级、保质期。
 *       与炼丹（木）、炼器（金）同构的第三条线，归**火**。
 *       但成品性质不同：丹药进突破门槛、法器是长期资产、
 *       **符箓是「下一次行动」的一次性加成**，且有保质期。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   RUNE_MATERIALS —— 符文表。id 与 data/map.js 里节点的 rune 字段对应
 *   RUNE_ITEMS     —— 符箓表。effect.kind 决定它接在哪一个决策点上
 *   RUNE_SHELF_HOURS —— 保质期（游戏小时）。这是本区块的负面对价
 * 文档：docs/32-炼符.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 四种符文。产地仍是 R4 那四个势力节点 —— 与药材、矿料**同源但独立**。
 */
const RUNE_MATERIALS = [
  { id: 'paper', name: '符纸', tier: 1, node: 'valley', desc: '以灵木纤维捣浆抄成的黄纸，符箓的载体。' },
  { id: 'cinnabar', name: '朱砂', tier: 2, node: 'river', desc: '寒潭边采的赤色矿砂，画符的主料，性烈。' },
  { id: 'ink', name: '灵墨', tier: 3, node: 'ridge', desc: '玄铁宗以铁屑与松烟合炼，字迹入纸三分不褪。' },
  { id: 'blood', name: '妖血', tier: 4, node: 'beastnest', desc: '妖兽心血，封在玉瓶里仍会微微搏动。' },
];
const RUNE_MATERIAL_MAP = Object.fromEntries(RUNE_MATERIALS.map((m) => [m.id, m]));

/**
 * 四张符箓。
 *
 * effect.kind 决定它接在哪一个决策点上：
 *   'train'   聚灵符 —— 全族修炼速度加成，持续 effect.hours 小时
 *   'cave'    护身符 —— 下一次洞天的生还率加成（百分点）
 *   'attack'  破阵符 —— 下一次攻伐的胜算加成（百分点）
 *   'break'   冲关符 —— 下一次大境界突破的成功率加成（百分点）
 *
 * 「下一次」类符箓**用掉即消耗**，且**只有一次**。
 * 所以玩家要在「现在就冲」和「再攒一张符」之间权衡。
 */
const RUNE_ITEMS = [
  {
    id: 'juling', name: '聚灵符', tier: 1, bench: 1, kind: 'train',
    materials: { paper: 2, cinnabar: 1 }, baseRate: 0.80,
    effect: { kind: 'train', rate: 0.30, hours: 2 },
    desc: '贴于闭关静室四壁，引动周天灵气汇聚。两日内修行事半功倍。',
    text: '全族修炼 +30%，持续 2 小时',
  },
  {
    id: 'husheng', name: '护身符', tier: 2, bench: 2, kind: 'cave',
    materials: { paper: 2, blood: 1 }, baseRate: 0.62,
    effect: { kind: 'cave', points: 0.20 },
    desc: '以妖血点睛，佩之可挡一次致命阴煞。入洞天前贴在胸前。',
    text: '下一次洞天生还率 +20 个百分点',
  },
  {
    id: 'pozhen', name: '破阵符', tier: 3, bench: 3, kind: 'attack',
    materials: { ink: 2, cinnabar: 2 }, baseRate: 0.48,
    effect: { kind: 'attack', points: 0.15 },
    desc: '专破护山法阵。掷出即炸，阵眼一乱，守方便失了地利。',
    text: '下一次攻伐胜算 +15 个百分点',
  },
  {
    id: 'chongguan', name: '冲关符', tier: 4, bench: 4, kind: 'break',
    materials: { blood: 2, ink: 3 }, baseRate: 0.30,
    effect: { kind: 'break', points: 0.12 },
    desc: '以妖血作墨、灵墨作骨，画的是上古冲关之法。修士冲关时贴在背心。',
    text: '下一次大境界突破成功率 +12 个百分点',
  },
];
const RUNE_ITEM_MAP = Object.fromEntries(RUNE_ITEMS.map((r) => [r.id, r]));

/** 符台五级。与丹炉、锻造台完全对称。 */
const RUNE_BENCH_LEVELS = [
  { level: 1, name: '一方矮案', rateBonus: 0.00, stones: 0, silver: 0 },
  { level: 2, name: '朱漆符案', rateBonus: 0.06, stones: 10, silver: 400000 },
  { level: 3, name: '净室法坛', rateBonus: 0.12, stones: 45, silver: 1800000 },
  { level: 4, name: '紫府符殿', rateBonus: 0.18, stones: 200, silver: 8000000 },
  { level: 5, name: '天篆道场', rateBonus: 0.25, stones: 900, silver: 30000000 },
];
const RUNE_BENCH_MAX = RUNE_BENCH_LEVELS.length;
function runeBenchAt(level) {
  const i = Math.max(0, Math.min(RUNE_BENCH_MAX - 1, Math.floor(Number(level) || 0) - 1));
  return RUNE_BENCH_LEVELS[i];
}

/**
 * 保质期（**游戏内**小时）。
 *
 * 这是炼符区块的负面对价：符箓画好之后会随时间失效，
 * 所以「一次性囤一百张」是不可能的 —— 玩家只能**用多少画多少**。
 * 这也让符箓的决策发生在「临出门前」，而不是开局一次性投资。
 *
 * ⚠️ 离线挂机会照常消耗保质期，这是有意的：
 *    不然挂着机回来就能白嫖一叠符。
 */
const RUNE_SHELF_HOURS = 3;
/** 火灵根对炼符的加成（与丹师之木、器师之金对称）。 */
const RUNE_FIRE_BASE = 0.08;
const RUNE_FIRE_PER_RANK = 0.04;

/** 熟练度：每张符独立，上限 10，每点 +1.5%。 */
const RUNE_PROFICIENCY_MAX = 10;
const RUNE_PROFICIENCY_STEP = 0.015;

const RUNE_RATE_MAX = 0.98;
const RUNE_RATE_MIN = 0.05;
