/**
 * 全局调参表 —— 所有数值都集中在这里，方便后续平衡。
 * 时间单位统一为「秒」，界面按真实时间推进。
 */

/** 逻辑帧间隔（毫秒）。250ms 兼顾响应速度与性能。 */
const TICK_MS = 250;

/** 可选的游戏倍速（手动切换，作用于页面开着时的推进速度）。 */
const SPEED_OPTIONS = [1, 2, 5];

/**
 * 数值积分的单步上限（游戏秒）。
 * 倍速会把一帧的游戏秒拉长，而人口是指数增长——步长过大会明显失真，所以要切开跑。
 */
const MAX_SIM_STEP = 1;

/** 离线结算是同步跑的，用迭代次数上限反推步长，避免卡住主线程。 */
const OFFLINE_MAX_STEPS = 20000;

/**
 * 单帧最多认多少真实秒。超过这个值就认为定时器被浏览器挂起了（合盖、休眠等），
 * 那一整段按离线（1 倍速）处理，免得「开 5 倍速挂后台」变成刷离线收益。
 */
const MAX_FRAME_SECONDS = 2;

/** 自动存档间隔（毫秒）。 */
const SAVE_INTERVAL_MS = 5000;

/** 离线挂机收益结算上限（小时）。 */
const OFFLINE_CAP_HOURS = 12;

/** 单次批量购买上限，防止「最大」把界面卡死。 */
const MAX_BATCH = 500;

/** 族谱纪事保留条数。 */
const LOG_LIMIT = 60;

/** 开局与基础数值。 */
const BASE = {
  silver: 100,        // 开局银两
  population: 10,     // 开局凡人人口
  buildingCap: 6,     // 祖业地基：不靠地产也有的营造额度
  housing: 20,        // 基础凡人家族容纳量（不靠房产也有这么多）
  silverCap: 3000,    // 基础银两上限
  birthRate: 0.010,   // 基础出生率（每秒，按人口比例）
  deathRate: 0.010,   // 基础死亡率（每秒，按人口比例）
  silverPerPop: 0.12, // 每名凡人每秒产出银两
};

/**
 * 人口拥挤模型：容纳量占用率超过阈值后，死亡率开始上升。
 * ratio = pop / housingCap
 * over  = max(0, ratio - threshold) / (1 - threshold)
 * death = deathRate + k * over^2
 * 于是 ratio = 1 时正好 over = 1；再往上死亡率迅速攀升，形成人口软上限。
 */
const CROWD = {
  threshold: 0.75,
  k: 0.014,
};

/** 地产：每处的建筑容量。 */
const ESTATE_SLOTS = 6;

/** 房产：每栋增加的凡人家族容纳量。 */
const HOUSE_CAPACITY = 40;

/** 房产：每栋让「地产以外的建筑」造价上浮的比例（全局通胀）。 */
const HOUSE_INFLATION = 0.02;

/** 田地：每块增加的出生率（每秒）。 */
const FIELD_BIRTH = 0.0012;

/** 钱庄：每座增加的银两上限。 */
const BANK_CAPACITY = 8000;

/**
 * 演武台：降低地产价格，但**边际递减**。
 *
 *   折扣(n) = MAX × n / (n + HALF)
 *
 * 于是 n = HALF 时正好拿到一半折扣，再往上边际越来越小，
 * 永远趋近 MAX 但拿不满。
 *
 * 早先是每座固定 −4% 线性叠加，结果是「堆演武台」成了无脑最优解——
 * 到第 15 座就顶到 60% 上限，第 16 座开始白买。改成递减后，
 * 每一座都还有用，但越往后越不划算，需要跟它的死亡率代价放在一起权衡。
 */
const ARENA_DISCOUNT_MAX = 0.6;
const ARENA_DISCOUNT_HALF = 12;

/** 演武台 + 科技（营造术等）叠加后的地产折扣总上限。 */
const TOTAL_DISCOUNT_MAX = 0.75;

/** 商队驿站：每座提供的商队位。 */
const CARAVAN_SLOTS_PER = 1;

/**
 * 对外扩张的代价：死亡率。
 *
 * 演武台是「族中子弟走出去争地」，商路是「商队走出去换钱」——
 * 走出去的人回不来，家族的人口基就薄一层。这是刻意的负面对价：
 * 扩张让你赚得更快，但也让你更难养人，必须拿田地补回来。
 */
const ARENA_DEATH = 0.0006;   // 每座演武台
const CARAVAN_DEATH = 0.0008; // 每座商队驿站

/** 出售建筑时的返还比例（半价）。 */
const SELL_RATIO = 0.5;

/* ────────────────── 通往修仙篇的那条链 ────────────────── */

/** 集齐多少条秘闻，云深谷坊市才会显现。 */
const SECRET_UNLOCK = 10;

/**
 * 祛障丹：价格（灵石）。
 *
 * 一次兑换给 0.1 灵石，所以 1 灵石 = 10 次兑换 = 100 万两银。
 * 按后期的岁入和银两上限，约 53 分钟一枚；25% 成算，约 4 枚出一名炼气，
 * 也就是三个半小时上下——正好是「凡人篇走完之后的下一个目标」该有的分量。
 * 更贵就会变成纯挂机等待，更便宜则灵石没有存在感。
 */
const PILL_STONE_COST = 1;

/** 祛障丹服下后诞生炼气人口的概率。 */
const PILL_QI_CHANCE = 0.25;

/** 灵石的显示精度（兑率是 0.1 为单位，所以保留一位小数）。 */
const STONE_DECIMALS = 1;

/** 人口里程碑，用于族谱纪事播报。 */
const POP_MILESTONES = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];

/** 存档键名与版本。 */
const SAVE_KEY = 'xiuxian-family/save/v1';
const SAVE_VERSION = 1;
const THEME_KEY = 'xiuxian-family/theme/v1';
const THEMES = {
  classic: { name: '原风格' },
  inkwash: { name: '水墨风' },
  daotian: { name: '丹霄' },
};
