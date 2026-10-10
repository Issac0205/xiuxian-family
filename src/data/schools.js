
/* ────────────────────────────────────────────────────────────────
 * 区块：功法流派
 * 职责：给功法一个「玩法身份」。原来的十五本只差数值大小，
 *       选哪本只是选大小；加上流派之后，选哪本变成**走哪条路**。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   MANUAL_SCHOOLS —— 六个流派。每个都必须同时有 fx（拿到什么）与 price（付出什么）
 *
 * ⚠️ 约定：**只有「主修」位的功法会触发流派机制**，辅修只贡献数值。
 *    所以「主修选哪本」就是「这一世走哪条路」，一个角色只能有一条路。
 * 文档：docs/85-流派与道心.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 流派表。
 *
 * fx 的键与「生效处」一一对应：
 *   training    修炼速度（加到 1 之上，如 0.55 表示 ×1.55 的那部分）
 *   power       修士战力（加到已有的百分比上）
 *   birthMult   凡人出生率**倍率**
 *   deathMult   凡人死亡率**倍率**
 *   alchemyRate 炼丹成功率（百分点）
 *   forgeRate   炼器成功率（百分点）
 *   caveBonus   洞天生还率（百分点）
 *   warBonus    攻伐胜算（百分点）
 *
 * drift  主修该流派时，道心每秒漂移多少（负=越练越邪）
 * unlock 解锁的动作 id（目前只有炼人丹）
 * price  给玩家看的代价文案
 */
const MANUAL_SCHOOLS = [
  {
    id: 'orthodox', name: '玄门正宗', tone: 'plain',
    tagline: '不偏不倚，稳当',
    desc: '中规中矩的正统法门。没有任何额外机制，也没有任何代价。',
    lore: '玄门的路子最笨：一步一个脚印，不取巧，也不走火。'
      + '族里若有人问「练这个有什么坏处」，答案是「没有」——'
      + '在这个世道里，这四个字本身就是最大的好处。',
    fx: {}, drift: 0, unlock: null,
    price: '无代价，但也没有任何额外手段。',
  },
  {
    id: 'demonic', name: '血煞魔功', tone: 'evil',
    tagline: '以血养功，进境极快',
    desc: '解锁「炼人丹」：献祭凡人换修为。战力大增，但道心持续下坠。',
    lore: '血煞一门不忌人。他们认为凡人本就是灵气所聚，与其老死田垄，'
      + '不如炼成一枚丹，把这点灵气还给修士。话说得漂亮，做的事却难看——'
      + '族中人口会一年比一年少，而修为什么都不缺。',
    fx: { training: -0.10, power: 0.35, deathMult: 1.25 },
    drift: -0.010, unlock: 'humanPill',
    price: '修炼 −10%、凡人死亡率 ×1.25、**道心持续下坠**。道心越低，入洞天越容易死。',
  },
  {
    id: 'dual', name: '合欢双修', tone: 'rose',
    tagline: '人丁兴旺，进境亦快',
    desc: '凡人出生率大增，修炼速度提升，但战力偏弱。',
    lore: '合欢宗的法子讲究阴阳相济，最看重「有人」。别人练功要静室独处，'
      + '他们练功要满城灯火。族中人口翻得比谁都快，'
      + '只是真动起手来，同阶的合欢修士往往是最先倒下的那个。',
    fx: { training: 0.35, birthMult: 1.40, power: -0.25 },
    drift: -0.003, unlock: null,
    price: '战力 −25%、道心略微下坠（世人多有非议）。',
  },
  {
    id: 'sword', name: '剑修', tone: 'steel',
    tagline: '一剑破万法',
    desc: '战力与攻伐胜算大幅提升，但修炼变慢、洞天里更容易折损。',
    lore: '剑修只信手里的东西。同阶之中剑修最能打，也最不肯绕路——'
      + '遇事第一反应是拔剑。所以在需要小心谨慎的洞天里，'
      + '剑修反而比谁都不顶用。',
    fx: { power: 0.55, training: -0.18, caveBonus: -0.06, warBonus: 0.06 },
    drift: 0, unlock: null,
    price: '修炼 −18%、洞天生还 −6 个百分点。',
  },
  {
    id: 'alchemy', name: '丹修', tone: 'jade',
    tagline: '以丹证道',
    desc: '炼丹成功率与修为俱增，但不擅争斗。',
    lore: '丹修一辈子守在炉前。他们论战力排不上号，可整个地界的修士'
      + '都要看他们的脸色——毕竟谁都想要一枚好丹。'
      + '走丹修这条路的家族，往往不是最强的，却是活得最久的。',
    fx: { training: 0.20, alchemyRate: 0.12, power: -0.20 },
    drift: 0, unlock: null,
    price: '战力 −20%。',
  },
  {
    id: 'forge', name: '器修', tone: 'ember',
    tagline: '以器载道',
    desc: '炼器成功率提升，战力小增，但分心于炉火。',
    lore: '器修信「手中无器，心中有器」。他们不亲自去争，'
      + '而是把力气花在别人手里的剑上。一个器修坐镇的家族，'
      + '战力上未必顶尖，但每一件法器都比旁人的多撑几年。',
    fx: { power: 0.15, forgeRate: 0.12, training: -0.15 },
    drift: 0, unlock: null,
    price: '修炼 −15%。',
  },
];
const MANUAL_SCHOOL_MAP = Object.fromEntries(MANUAL_SCHOOLS.map((s) => [s.id, s]));

/** 取流派定义；没有 school 字段的功法一律算玄门正宗。 */
function schoolOf(manual) {
  return MANUAL_SCHOOL_MAP[manual?.school] || MANUAL_SCHOOL_MAP.orthodox;
}

/** 没有 school 字段的旧功法按玄门正宗处理，不需要迁移。 */
const DEFAULT_SCHOOL = 'orthodox';

/* ── 人丹：血煞一脉的独有手段 ── */

/**
 * 炼一枚人丹的代价。
 *
 * ⚠️ 原料是**人**。凡人人口是家族银两的来源，道心是洞天里的保命符，
 *    所以「用命换修为」在这里是字面意思 —— 这是全篇最重的代价。
 */
const HUMAN_PILL_MORTALS = 5;      // 献祭几名凡人
const HUMAN_PILL_STONES = 2;       // 另耗灵石
/** 服下后获得的修为 = 该修士当前一层所需修为 × 这个比例。 */
const HUMAN_PILL_XP_RATIO = 0.35;
