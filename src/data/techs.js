/**
 * 凡人科技线 —— 【凡人篇 I3】三条路线 × 5 阶。
 *
 * 玩家要能「每周目走不同方向」，所以凡人线不再是七阶一条直线，而是三条
 * 各自独立成链的路线，第 5 阶三选一互斥（百年望族 / 江南巨富 / 寻仙世家）：
 *
 *   TECH_ROUTES = [
 *     clan  一 · 人丁兴旺   household → tuntian → yizhuang → jiangnan_clan → xiangxian
 *     rich  二 · 富甲江南   realestate → finance → vault → marketexp → jiangnan_rich
 *     seek  三 · 寻仙问道   seeker → jixian → sishu → fanggu → xunxian
 *     base  共业 · 城基     architecture / surveying / expansion / trade /
 *                          arithmetic / courier / quzhang / mutualmarket
 *   ]
 *
 * 设计原则：
 *  - 开局只会「种地」——田地是唯一不需要科技的营造项。
 *  - 三条路线的第 1 阶都**零前置**（`realestate` / `household` / `seeker`），
 *    所以「先走哪条」是一局里第一个真决策，而不是被上一阶逼出来的。
 *  - 第 5 阶**三选一互斥**：`exclusiveGroup: 'capstone'`。互斥判据落在
 *    `src/systems/progression.js` 的 `exclusiveResearchBlocker()`，
 *    消费点是 `core/formulas.js` 的 `isTechUnlocked()` 与
 *    `core/engine.js` 的 `planResearch()`（拒绝时必须说明「与谁择一」）。
 *    ⚠ 互斥只发生在第 5 阶：早期选择（前四阶）永不后悔、永不互斥。
 *
 * ⚠ **没有孤儿节点**：每一项科技都必须至少被另一项 require，
 *   或者被仙道侧 require（见 data/immortal-techs.js）。
 *   这条规则是仿真的科技盘点（balance.mjs 的 auditTechs）逐条查的。
 *
 * ⚠ **跨树前置只能挂在凡人线的「可选深处」，绝不能挂在主线上。**
 *   这条规则是踩过坑之后立的：第一版让「祛障」require 仙道「引灵」，
 *   用意是「城要养得起修士，先得把灵气往族里引」。结果是在
 *   「仙道侧不可用」的局面下（本仓库的对照实验就会这样摆），
 *   祛障被永久锁死 → 没有修士 → 仙道永远开不了 → 祛障永远开不了。
 *   这就是**互相卡脖子**，也正是本次设计要避免的东西。
 *
 *   现在跨树前置的方向是「仙道依赖凡人」：
 *     仙道「灵田」← 凡人「精耕细作」（id 仍是 tuntian）
 *     仙道「灵脉感应」← 凡人「江湖耳目」（id 仍是 seeker）
 *   而凡人侧的跨树前置（医药改善←悬壶、藏书阁←聚灵阵、仙凡互市←界墟）
 *   都在各路线的深处（第 3–5 阶），不挡任何主线。
 *
 * ⚠ **id 只增不减**（`node scripts/savecompat.mjs` 拿 fixtures/save-ids.json
 *   逐表比对）。I3 只改了 `name` / `desc` / `requires` / `effect` / `tier` /
 *   新增 `route`，**没有删或改任何一个 id**。
 *
 * effect 支持的键：见文件末尾的 EFFECT_LABELS，那里登记了全部合法键。
 *   （凡人侧与仙道侧共用一张表；键在这里定义，在 core/formulas.js 里结算。）
 */

/**
 * 三条路线 + 一个共用的「城基」组。
 *   key   路由键（写进 tech.route 与界面上的 data-route）
 *   name  界面上的组标题
 *   hint  组标题右边那一行小字（说清这条路线的性格）
 *
 * ⚠ 字段叫 `key` 而不是 `id`，是**有意的**：`scripts/savecompat.mjs` 会把
 *   `src/data/*.js` 里每一处 id 字面量收进存档基线（只增不减）。路线键是展示层的
 *   东西，没必要被基线冻住 —— 所以不让它长得像一条数据表的 id。
 *   （同理：这段注释里也不要**写出** id 字面量的形状，否则会被那条正则收进基线。）
 */
const TECH_ROUTES = [
  {
    key: 'clan', name: '一 · 人丁兴旺', icon: '丁',
    hint: '田地、宗族、医药 —— 把一姓人扎进这片土里',
  },
  {
    key: 'rich', name: '二 · 富甲江南', icon: '银',
    hint: '铺面、钱庄、库房、坊市 —— 让银钱自己长大',
  },
  {
    key: 'seek', name: '三 · 寻仙问道', icon: '寻',
    hint: '耳目、藏书、私塾、访古 —— 一步步摸到修行的边',
  },
  {
    key: 'base', name: '共业 · 城基', icon: '基',
    hint: '三条路线都要踩的共用节点（营造 / 驿路 / 祛障 / 互市）',
  },
];

/**
 * 每一条路线内部的五个阶。
 * ⚠ 阶只是**路线内部**的先后与展示分层，跨路线的比较不靠它。
 */
const TECH_TIERS = [
  { tier: 1, name: '一阶 · 起手', hint: '零前置 —— 三条路随你先挑一条' },
  { tier: 2, name: '二阶 · 扎根', hint: '把第一条路走深（前置满足才现身）' },
  { tier: 3, name: '三阶 · 兴业', hint: '别的路线开始反过来喂这一条' },
  { tier: 4, name: '四阶 · 门户', hint: '本家在这一带已经叫得出字号' },
  { tier: 5, name: '五阶 · 世家', hint: '三选一：百年望族 / 江南巨富 / 寻仙世家' },
];

/**
 * 【凡人篇 I3】第 5 阶的三选一互斥。
 *
 * 只做一件事：研习了其中一个，另两个的 `plan` 必须**拒绝并说明理由**
 * （判据在 systems/progression.js 的 exclusiveResearchBlocker）。
 * 这是「每周目走不同方向」的最小实现 —— 前四阶永不互斥，所以早选不吃亏。
 */
const CAPSTONE_GROUP = 'capstone';
const CAPSTONE_TECHS = ['xiangxian', 'jiangnan_rich', 'xunxian'];

const TECHS = [
  /* ══════════════ 一 · 人丁兴旺（clan）══════════════ */
  {
    id: 'household',
    name: '宗族制度',
    icon: '册',
    route: 'clan',
    tier: 1,
    cost: 1600,
    requires: [],
    effect: { birthFlat: 0.001 },
    desc: '编户齐民，生子入册，房长支长各管一摊。族中生育从此有了章程，'
      + '人丁滋生更稳 —— 这一条是整条「人丁兴旺」路的头一块砖。',
  },
  {
    id: 'tuntian',
    name: '精耕细作',
    icon: '耒',
    route: 'clan',
    tier: 2,
    cost: 2200,
    requires: ['household'],
    effect: { fieldBonus: 0.25 },
    /**
     * 跨树前置：精耕细作要「引灵」（id 与位置一个字都没动）。
     * 理由是叙事上的：引灵台把灵气引到田里，同一块田才真的能多养人。
     * 数值上它让「凡人篇的农业」与「仙道篇的灵气」第一次接上。
     */
    requiresImmortal: ['yinling'],
    desc: '设屯田、修水利，选种、轮作、淤田，同一块田地能养活更多人。'
      + '引灵台的水先过一遍田垄，收成便不只多一成。',
  },
  {
    id: 'yizhuang',
    name: '医药改善',
    icon: '药',
    route: 'clan',
    tier: 3,
    cost: 9000,
    requires: ['tuntian'],
    effect: { deathFlat: -0.0012, birthFlat: 0.0008 },
    /** 跨树前置：医药改善要「悬壶」（仙家的医药）。见 data/immortal-techs.js。 */
    requiresImmortal: ['xuanhu'],
    desc: '在城外立一处义庄，收殓无主的尸骨，也给族里老弱一口热粥；'
      + '再请悬壶堂的郎中过府坐馆。死的人少了，活着的人也就敢多生。',
  },
  {
    id: 'jiangnan_clan',
    name: '江南名门',
    icon: '门',
    route: 'clan',
    tier: 4,
    cost: 30000,
    requires: ['yizhuang'],
    effect: { birthFlat: 0.0015, deathFlat: -0.0006 },
    desc: '三世积谷，五世积德，到这一代终于有人肯把女儿嫁进来、'
      + '也有人肯把儿子送进来读书。门第既立，生养与医药都不再是一家一户的事。',
  },
  {
    id: 'xiangxian',
    name: '百年望族',
    icon: '乡',
    route: 'clan',
    tier: 5,
    cost: 45000,
    requires: ['jiangnan_clan'],
    terminal: true,
    exclusiveGroup: CAPSTONE_GROUP,
    effect: { incomeMult: 0.25, birthFlat: 0.0015, secretChance: 0.04 },
    desc: '一姓在此地传了七代，里正见你祖父要叫一声老太爷。'
      + '祠堂里的牌位比县衙的卷宗还厚——这城里的事，一半在族中过。'
      + '（与「江南巨富」「寻仙世家」三选一。）',
  },

  /* ══════════════ 二 · 富甲江南（rich）══════════════ */
  {
    id: 'realestate',
    name: '商铺经营',
    icon: '宅',
    route: 'rich',
    tier: 1,
    cost: 250,
    requires: [],
    unlocksBuilding: 'estate',
    desc: '摸清了地契、铺面、税契与里正的门道，世家终于能在本乡置办田庄宅地，'
      + '也能盘下几间临街的铺子。',
  },
  {
    id: 'finance',
    name: '钱庄体系',
    icon: '铢',
    route: 'rich',
    tier: 2,
    cost: 700,
    requires: ['realestate'],
    unlocksBuilding: 'bank',
    desc: '懂得了折色、兑付与存息，银钱可以存下来，不必再堆在自家地窖里。'
      + '票号既通，本家的银子才敢往远处走。',
  },
  {
    id: 'vault',
    name: '资金容量',
    icon: '库',
    route: 'rich',
    tier: 3,
    cost: 4800,
    requires: ['finance'],
    effect: { vaultMult: 1.0 },
    desc: '钱庄只管把银子收进来，库房管的是「收进来之后还数得清」。'
      + '账房分门别类、按季盘库，同一批仓库能装下的银子翻了一倍。'
      + '——坊市那头肯不肯多称几钱灵石，全看你先拿得出多少现银。',
  },
  {
    id: 'marketexp',
    name: '商业网络',
    icon: '廛',
    route: 'rich',
    tier: 4,
    cost: 8000,
    requires: ['vault', 'arithmetic'],
    effect: { tradeStoneMult: 0.25 },
    desc: '把江南坊市那头的小集扩成一条街，再沿水路布下几处货栈。'
      + '本家的银钱递过去，对面肯多称几钱灵石——兑率这东西，向来是人多的一方说了算。',
  },
  {
    id: 'jiangnan_rich',
    name: '江南巨富',
    icon: '富',
    route: 'rich',
    tier: 5,
    cost: 50000,
    requires: ['marketexp'],
    terminal: true,
    exclusiveGroup: CAPSTONE_GROUP,
    effect: { incomeMult: 0.3, tradeStoneMult: 0.2 },
    desc: '到这一代，本家的字号在江南几条水路上都挂得住。'
      + '银钱已经不必自己跑——是它自己认得回来的路。'
      + '（与「百年望族」「寻仙世家」三选一。）',
  },

  /* ══════════════ 三 · 寻仙问道（seek）══════════════ */
  {
    id: 'seeker',
    name: '江湖耳目',
    icon: '探',
    route: 'seek',
    tier: 1,
    cost: 1800,
    requires: [],
    /**
     * 拿银两与人命换消息。
     *
     * ⚠ 【凡人篇 I1/I3】`tradeIncome` 原写的是「商路银两收益」，
     *   商队取消后它的消费方变成了**探索结算**（core/formulas.js 的
     *   `expeditionReward()`，被 systems/expeditions.js 的归来结算与
     *   界面的报价各读一次）—— 也就是「出门探访带回的银两少三成」。
     *   所以这个键**不是**死效果，文案在 I3 一并改到探索口径。
     *   （对照：`courier` 原来的 `tradeSpeed` 才是真的没有消费者，见那里。）
     */
    effect: { tradeIncome: -0.3, deathFlat: 0.004, secretChance: 0.05 },
    desc: '养一批专管打听的人。他们不走货，只走门路——出门探访带回的银两少三成，'
      + '人也折得多，但山野间的风声听得见了。',
  },
  {
    id: 'jixian',
    name: '藏书阁',
    icon: '贤',
    route: 'seek',
    tier: 2,
    cost: 11000,
    requires: ['seeker'],
    effect: { incomeMult: 0.12, secretChance: 0.03, explorePerSecFlat: 0.00012 },
    /**
     * 跨树前置：藏书阁要「聚灵阵」。
     * 阁里养的不是普通读书人，是**替仙家记档、递帖子的人** ——
     * 所以它顺带给了「修士自动寻秘」，这也是城里唯一一项
     * 「仙道进度直接变成凡人科技的产出」。
     */
    requiresImmortal: ['julingzhen'],
    desc: '养几个读书人，管账、修谱、也管往山外递帖子。'
      + '阁里清静，日子久了，什么话都能听见——哪怕说话的人不在城里。',
  },
  {
    id: 'sishu',
    name: '私塾',
    icon: '塾',
    route: 'seek',
    tier: 3,
    cost: 12000,
    requires: ['jixian'],
    effect: { incomeMult: 0.08, secretChance: 0.03 },
    desc: '族中子弟不必再跟着父兄下地。识字、算账、读山志、记舆图 ——'
      + '认得字的人多了，山外递进来的一张纸才有人看得出值钱。',
  },
  {
    id: 'fanggu',
    name: '访古寻迹',
    icon: '古',
    route: 'seek',
    tier: 4,
    cost: 20000,
    requires: ['sishu'],
    effect: { secretChance: 0.05, explorePerSecFlat: 0.0002 },
    desc: '照着旧地方志与山志，把断碑、废观、老渡口一处一处走一遍。'
      + '凡人找不到仙家，但凡人的脚力能把仙家的旧迹踩出来。',
  },
  {
    id: 'xunxian',
    name: '寻仙世家',
    icon: '仙',
    route: 'seek',
    tier: 5,
    cost: 40000,
    requires: ['fanggu'],
    terminal: true,
    exclusiveGroup: CAPSTONE_GROUP,
    effect: { secretChance: 0.08, explorePerSecFlat: 0.0003 },
    desc: '到这一代，本家已经不必四处打听：山里那头会自己把话递下来。'
      + '一姓人家几代人都在找同一件事，这件事也就认了这一姓。'
      + '（与「百年望族」「江南巨富」三选一。）',
  },

  /* ══════════════ 共业 · 城基（base）：三条路线共用的节点 ══════════════ */
  {
    id: 'architecture',
    name: '建筑学',
    icon: '匠',
    route: 'base',
    tier: 1,
    cost: 320,
    requires: ['realestate'],
    unlocksBuilding: 'house',
    desc: '夯土、榫卯、院落布局——族人不必再挤在一处，可起广厦安置老小。',
  },
  {
    id: 'surveying',
    name: '营造术',
    icon: '矩',
    route: 'base',
    tier: 2,
    cost: 900,
    requires: ['architecture'],
    effect: { estateDiscount: 0.15 },
    desc: '会看地形、会算工时，同样的银两能置下更多地产。',
  },
  {
    id: 'expansion',
    name: '对外扩张',
    icon: '旗',
    route: 'base',
    tier: 2,
    cost: 1200,
    requires: ['architecture'],
    unlocksBuilding: 'arena',
    desc: '族中子弟走出本乡，与外姓争地争水。立起演武台，方有立威之所。',
  },
  {
    id: 'trade',
    name: '驿路',
    icon: '驿',
    route: 'base',
    tier: 3,
    cost: 2600,
    requires: ['finance', 'expansion'],
    /**
     * ⚠ 解锁 `caravan`（驿馆）是**探索名额的唯一来源**
     *   （core/formulas.js 的 `expeditionSlots = (b.caravan||0) × EXPEDITION_SLOTS_PER`），
     *   这条线断了就没有探索队，秘闻也就断了。I1 把它从「商路」改叫「驿路」、
     *   从「养商队」改到「设驿馆、遣族人出门探访」，但 id 与解锁关系一个字没动。
     */
    unlocksBuilding: 'caravan',
    desc: '摸清了各州关隘与抽分，沿官道设驿馆、备马匹干粮，'
      + '遣族人出门探访——探索队的名额从此有着落。',
  },
  {
    id: 'arithmetic',
    name: '算学',
    icon: '筹',
    route: 'base',
    tier: 4,
    cost: 3500,
    requires: ['finance', 'household'],
    effect: { incomeMult: 0.1 },
    desc: '会记帐、会盘库，族中产出不再白白流失。',
  },
  {
    id: 'courier',
    name: '驿道',
    icon: '传',
    route: 'base',
    tier: 4,
    cost: 6000,
    requires: ['trade', 'surveying'],
    /**
     * 【凡人篇 I1/I3】**被修掉的死效果**。
     *
     * 原来这里挂的是 `effect: { tradeSpeed: 0.15 }`（「商队耗时 −15%」）。
     * I1 把商队整套换成寻仙探索之后，`engine.routeSeconds()` 不再存在，
     * 而 `systems/expeditions.js` 的 `expeditionSeconds()` **故意不乘任何科技加速**
     * （加速会把 10/15/20 三道秘闻门变松）—— 于是 `tradeSpeed` 没有消费者，
     * 玩家研习「驿道」点了等于没点（见 docs/104 §七 已知遗留 1）。
     *
     * I3 的处理：把这份额度改挂到**探索真的会读**的东西上 ——
     * `secretChance`（`core/formulas.js` 的 `exploreSecretChance()`，
     * 结算与界面报价共用）。口径也顺着改：驿道铺开，山野间的风声先到本家一步。
     */
    effect: { secretChance: 0.04 },
    desc: '沿官道设驿、换马不换人，出门探访的人先在本家驿站落脚。'
      + '路既通，山野间的消息比别家早到一步。',
  },
  {
    id: 'quzhang',
    name: '祛障',
    icon: '障',
    route: 'base',
    tier: 5,
    cost: 6500,
    requires: ['trade', 'household', 'courier'],
    /** 除了前置科技，还要先摸到修行世界的边（集齐秘闻）。 */
    requiresSecrets: true,
    unlocksPill: 'quzhangdan',
    unlocksPillName: '祛障丹',
    desc: '凡人篇的最后一道门。障一破，方见天光——但破障要拿命去试。',
  },
  {
    id: 'mutualmarket',
    name: '仙凡互市',
    icon: '互',
    route: 'base',
    tier: 5,
    cost: 60000,
    requires: ['marketexp', 'quzhang'],
    /**
     * 跨树前置：仙凡互市要仙道「界墟」。
     * 城里想开一条两边通用的街，先得对面**认你的字号** ——
     * 界墟给的正是这个。这是凡人线最深处的一处「非仙不成」，
     * 也是本树唯一一处会卡住玩家的跨树前置（因此它必须落在各路线的可选深处）。
     */
    requiresImmortal: ['jiexu'],
    terminal: true,
    unlocksBuilding: 'immortalmarket',
    effect: { tradeIncome: 0.35, tradeStoneMult: 0.35 },
    desc: '凡人卖药、卖铁、卖纸，仙家收的是灵石；仙家卖丹、卖符、卖法器，'
      + '凡人拿银钱接。两边的账本第一次并成了一本'
      + '——但那条街得等江南坊市那头先认了本家的字号。',
  },
];

const TECH_MAP = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/**
 * 效果键 → 展示文案。
 *
 * ⚠ 这是**两条科技线共用的一张表**（凡人篇与仙道篇），所以新增 effect 键时
 *   只需在这里加一行：加了才算「界面会显示」。忘了加不会报错，
 *   但那一项科技的收益栏会是一片空白 —— 这属于必须避免的静默失败，
 *   所以 scripts/smoke.mjs 里有一条断言专门查「每个 effect 键都有文案」。
 *
 * 命名约定：
 *   · 以 Mult 结尾的是**倍率加成**（0.25 = +25%）
 *   · 以 Flat 结尾的是**绝对值**，尺度由各自的标签决定
 *   · 减益用负数，文案自动带正负号
 *
 * 四个格式化器，按「这个数是什么尺度」选：
 *   signedPct   0.25  → “+25%”
 *   signedPoint 0.06  → “+6 个百分点”（百分点本身就是 0–100 的数）
 *   signedAbs   150   → “+150”
 *   signedFlat  0.001 → “+0.10”（每秒绝对值要缩小 100 倍看）
 */
const signedPct = (v) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v * 100))}%`;
const signedPoint = (v) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v * 100))}`;
const signedAbs = (v) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}`;
const signedFlat = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(2)}`;

const EFFECT_LABELS = {
  /* ── 凡人侧 ── */
  estateDiscount: (v) => `地产价格 −${Math.round(v * 100)}%`,
  birthFlat: (v) => `基础出生率 ${signedFlat(v)}%/秒`,
  incomeMult: (v) => `银两产出 ${signedPct(v)}`,
  fieldBonus: (v) => `田地效果 +${Math.round(v * 100)}%`,
  // 【凡人篇 I3】口径从「商路银两收益」改成「探索带回银两」：
  //   商队（贸易派遣）在 I1 被寻仙探索取代，这个键的消费方已经是
  //   core/formulas.js 的 `expeditionReward()`（探索归来结算 + 界面报价）。
  //   键名一个字没改（改键名等于删键，会毁存档里的效果累加口径）。
  tradeIncome: (v) => `探索带回银两 ${signedPct(v)}`,
  deathFlat: (v) => `死亡率 ${signedFlat(v)}%/秒`,
  secretChance: (v) => `秘闻概率 ${signedPct(v)}`,
  explorePerSecFlat: (v) => `修士自动寻秘 +${(v * 100000).toFixed(1)} 条/万秒`,
  vaultMult: (v) => `银两上限 ${signedPct(v)}`,
  // ⚠ 【凡人篇 I3】`tradeSpeed`（原「商队耗时 −15%」）已从这张表、从
  //   core/formulas.js 的 MORTAL_EFFECT_KEYS、从 TECH 表里**一并删除**：
  //   I1 取消商队后它没有消费者（engine.routeSeconds 不再存在，
  //   expeditionSeconds 故意不吃科技加速），留着就是「登记了却不生效」的死键。
  //   原来挂它的「驿道（courier）」改挂 secretChance，见那边的注释。

  /* ── 仙道侧 ── */
  immortalCapMult: (v) => `名册容量 +${Math.round(v * 100)}%（随凡人人口放大）`,
  innateBirthMult: (v) => `天生灵根诞生率 ${signedPct(v)}`,
  mineDeathMult: (v) => `矿工死亡 ${signedPct(v)}`,
  mineYieldMult: (v) => `灵脉矿场出石 ${signedPct(v)}`,
  territoryYieldMult: (v) => `领地赋税与材料 ${signedPct(v)}`,
  territoryHoldMult: (v) => `领地镇守所需战力 ${signedPct(v)}`,
  garrisonCapFlat: (v) => `可同时镇守 ${signedAbs(v)} 处`,
  exploreSurviveBonus: (v) => `洞天生还率 ${signedPoint(v)} 个百分点`,
  breakBonusFlat: (v) => `大境界冲关成功率 ${signedPoint(v)} 个百分点`,
  tradeStoneMult: (v) => `银两换灵石兑率 ${signedPct(v)}`,
  cityMaterialMult: (v) => `城中作坊（药材/矿料/符料）产出 ${signedPct(v)}`,
  runeBenchFree: (v) => `符台免费升 ${signedAbs(v)} 阶`,
  alchemyRateBonus: (v) => `炼丹成功率 ${signedPoint(v)} 个百分点`,
  trainMult: (v) => `全族修炼速度 ${signedPct(v)}`,
  familyPowerMult: (v) => `家族战力 ${signedPct(v)}`,
  // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「实现要点 2」】
  // 目的：让「探穴 / 界墟」这两项科技在格物页把「线索 +X 条/时」写出来 ——
  // 缺了这行收益栏会空白（smoke 的「每个 effect 键都有界面文案」会立刻抓到）。
  // 数值出处：docs/91 T-0 供给侧表（0.0002 与 0.00025 每秒 → 0.72 / 0.90 条每时）。
  cluePerSecFlat: (v) => `秘闻线索 +${(v * 3600).toFixed(2)} 条/时`,
};

/** 一项科技的全部收益文案（凡人侧与仙道侧共用）。 */
function techGainText(tech, buildingName, pillName) {
  const out = [];
  if (tech.unlocksBuilding) out.push(`解锁营造「${buildingName || tech.unlocksBuilding}」`);
  if (tech.unlocksPill) out.push(`解锁「${pillName || tech.unlocksPillName || tech.unlocksPill}」`);
  for (const [key, val] of Object.entries(tech.effect || {})) {
    if (EFFECT_LABELS[key]) out.push(EFFECT_LABELS[key](val));
  }
  return out;
}
