/**
 * 建立一份全新的游戏状态。
 * 所有可变数据都挂在这里，存档即序列化此对象。
 *
 * 开局：一块田地、十口人、一百两银，外加一处祖业地基（6 格营造额度）。
 * 除田地外，其余建筑都要先研习对应科技才能营造。
 */
function createState(now = Date.now()) {
  /** @type {Record<string, number>} */
  const buildings = {};
  for (const def of BUILDINGS) buildings[def.id] = 0;

  buildings.field = 1;

  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeen: now,

    /** 世家世代，凡人阶段恒为 1，踏入仙途后递增。 */
    generation: 1,

    /**
     * 【策划 C14 / 任务 T-2b】世界钟：只记「过了多少年」，供族谱显示寿元余量。
     *
     * 尺度（出处：docs/91-落地任务清单.md §三 T-2b「数值设计」）：
     *   **1 游戏小时 = 25 年**，一周目 44.6 小时 = 1115 年。
     * ⚠ 离线**不推**年份（runOffline 里显式不碰它）—— 这是 T-2b 与 T-7 能共存的硬约定：
     *   否则离线 12 小时 = 300 年，全族寿元瞬间见底。
     * 它不产生任何惩罚（没有老死、没有冲关修正），只是让玩家看见「还剩多少」。
     */
    clock: { year: 0 },

    silver: BASE.silver,
    population: BASE.population,
    buildings,

    /** 已研习的科技 id（凡人侧）。 */
    techs: [],

    /**
     * 已研习的科技 id（仙道侧）。
     *
     * 与 techs 并列而不是放进 cultivation 里：两条线是**同一层级**的清单，
     * 放在一起才好对照「凡人到哪一步、仙道到哪一步」。
     * 旧存档没有这个字段，repairCultivation 会补成空数组（见 systems/cultivation.js）。
     */
    immortalTechs: [],

    /**
     * 在云深谷坊市换过几次灵石。
     * 兑率是**平价**的（见 core/config.js 的 MARKET_EXCHANGE_*），
     * 这个字段只数「总量闸门还剩几笔」，不再影响定价 ——
     * 界面会把它画成一条进度条。旧存档的该字段原样保留，无需迁移。
     */
    exchangeCount: 0,

    /**
     * 进行中的商队。
     * 时间按**游戏秒**记账，不存绝对时间戳——这样中途改倍速，
     * 剩余时间与进度条会自然跟着变，不必回头重算。
     * { routeId, startedAt(真实毫秒，仅作标识用), remaining, total, invested }
     */
    caravans: [],
    tradeRuns: 0,

    /** 已播报过的人口里程碑。 */
    milestones: [],

    /**
     * 设置。
     *  - quizMode：'always'（必答）/ 'half'（一半概率）/ 'off'（不触发单词题）
     *  - difficulty：'normal'（答错返还）或 'hell'（答错不退还）；只在真的出题时才有意义
     *  - speed：手动倍速，只作用于页面开着时的推进；离线一律按 1 倍速结算
     *  - devMode：【架构 docs/101】开发者模式开关。默认 **false**；
     *      settings 本就在 serialize 白名单里，所以这里加一项**不新增顶层字段**。
     *      ⚠ 它只是「玩家按过开关」这一事实；真正生效还要有**会话令牌**
     *      （sessionStorage，不入存档）—— 见 systems/resources.js 的 devModeOn()。
     */
    settings: {
      quizMode: 'always',
      difficulty: 'normal',
      speed: 1,
      devMode: false,
    },

    /** 背单词统计：wordId -> { seen, right, wrong }，只记录见过的词。 */
    wordStats: {},
    customQuizStats: {},
    customWrongBooks: {},

    /* ────────────── 通往修仙篇的那条链 ────────────── */

    /** 灵石。凡人换来的修行货币，兑率极低，所以是小数。 */
    spiritStones: 0,

    /**
     * 道心（道德值）0–100。
     * 它不是「善恶评分」，而是**你在这个世界里被当成什么人**：
     * 凶名在外能镇住人，也会招来天谴。三条后果见 data/morality.js。
     */
    morality: MORALITY_START,

    /** 已发现的秘闻在 SECRETS 里的下标。 */
    secrets: [],

    /**
     * 【策划 docs/96 坊市】已花掉的秘闻条数。
     * `secrets` 是「累计发现」（只增不减，抽池判重也用它），这里是记账。
     * **一切旧门槛读累计 `secrets`**，所以花钱不会关掉已经打开的门。
     */
    secretsUsed: 0,
    /** 已用秘闻解锁的坊市商品 id（永久有效）。 */
    marketUnlocks: [],
    /** 反向兑换（灵石→银两）的次数，纯统计。 */
    marketSellCount: 0,

    /** 修仙侧进度。目前只有炼气这一档。 */
    cultivation: {
      qi: 0,          // 炼气人口，与 cultivators.length 保持一致
      cultivators: [], // 逐人修为、天赋和工作，可与旧存档兼容
      manuals: [], // 已收录功法的 id；目录见 CULTIVATION_MANUALS（15 本）
      equippedManual: null, // 主修：效果吃满
      assistManual: null,   // 辅修：只吃 45%，且不可与主修同道途
      attune: {},           // 每本功法的参悟度 0~5，effect ×(1+0.12×层数)
      nextId: 1,
      poolBlueprint:false, pool:0, compass:false, veins:[], mineLevel:0, mineWorkers:0, clues:0, caveRuns:0, conquests:[],
      // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「涉及文件」state.js:99 附近】
      // 目的：cluePerSecFlat 的**小数池**。按秒累加、每满 1 才扣 1 加一条线索，
      // 否则 0.0002/秒 会被取整成 0（这正是「登记了但不生效」的典型形态）。
      cluePool: 0,
      pills: 0,       // 已服下的祛障丹
      humanPills: 0,  // 人丹存量（血煞一脉独有，见 systems/schools.js）
      unlocked: false, // 是否已踏入炼气篇
    },

    /** 答题总账。 */
    quiz: {
      total: 0,
      right: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      lost: 0,        // 因答错而损失的银两总额
      lostStones: 0,  // 因答错而损失的灵石总额
      wrongBook: [],  // 错过的词 id，最新在前
    },

    stats: {
      silverEarned: 0,
      silverWasted: 0,
      silverFromSales: 0,
      births: 0,
      deaths: 0,
      playSeconds: 0,
    },

    /** 族谱纪事，最新在前。 */
    log: [],

    /**
     * 元进度：跨周目保留。轮回时会重置其它一切，但**不动这里**。
     * cycle 第几世 · points 轮回点 · unlocked 已解锁的金手指 · active 本世携带的
     */
    meta: { cycle: 1, points: 0, cleared: 0, unlocked: [], active: [], history: [] },

    /** 界面偏好，一并存档。 */
    ui: {
      buyMode: '1',
      /** 当前页：home / techs / trade / immortal / study / codex */
      page: 'home',
      /** 格物页当前看哪条线：'mortal' | 'immortal'。纯界面偏好，随存档走。 */
      techLine: 'mortal',
      /** 百科：当前章节（'all' 或章节 id）与搜索词。 */
      codexChapter: 'all',
      codexQuery: '',
      /** 百科：是否把未解锁条目的「？？？」占位也显示出来（默认不显示，免得一上来就显得内容很多）。 */
      codexShowLocked: false,
      /** 格物页是否隐藏已研习的科技。 */
      hideDoneTechs: false,
      /** 各面板的折叠状态：panelId -> true 表示已折叠。 */
      collapsed: {},
    },
  };
}

/**
 * 页面（多页布局）。
 * id 同时用于 data-page 属性与存档校验。
 */
const PAGES = ['home', 'techs', 'trade', 'immortal', 'study', 'codex', 'cycle'];

const PAGE_NAMES = {
  home: '家业',
  techs: '格物',
  trade: '通商',
  immortal: '仙途',
  study: '治学',
  codex: '百科',
  cycle: '轮回',
};

/** 难度：答错是否返还材料。只在真的出题时才有意义。 */
const DIFFICULTIES = {
  normal: {
    id: 'normal',
    name: '普通',
    desc: '答错则操作失败，但材料原样返还，只损失时间。',
  },
  hell: {
    id: 'hell',
    name: '地狱',
    desc: '答错则操作失败，且材料概不退还。',
  },
};

/**
 * 答题频率：操作前要不要答一道六级单词题。
 * chance 是触发概率。
 */
const QUIZ_MODES = [
  { id: 'always', name: '学习', chance: 1, desc: '每次操作都要答一题。' },
  { id: 'half', name: '轻松', chance: 0.5, desc: '一半概率触发单词题。' },
  { id: 'off', name: '免答', chance: 0, desc: '完全不触发单词题，当普通挂机游戏玩。' },
];

const QUIZ_MODE_MAP = Object.fromEntries(QUIZ_MODES.map((m) => [m.id, m]));

/** 深拷贝一份状态（用于重置前对比或调试）。 */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
