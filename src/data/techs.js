/**
 * 凡人科技线。
 *
 * 设计原则：
 *  - 开局只会「种地」——田地是唯一不需要科技的营造项。
 *  - 其余建筑全部由科技解锁，其中「房地产 / 建筑学 / 对外扩张」的命名与顺序
 *    由需求指定，钱庄与驿站对应的「金融 / 商路」是同一风格补齐的。
 *  - 除解锁建筑外，还有若干「精进」类科技直接改数值，让这条线有纵深。
 *
 * ⚠ **没有孤儿节点**：每一项科技都必须至少被另一项 require，
 *   或者被仙道侧 require（见 data/immortal-techs.js）。
 *   这条规则是仿真的科技盘点（balance.mjs 的 auditTechs）逐条查的，
 *   上一版有 6 项点了只为它自己，这一版清零。
 *
 * ⚠ **跨树前置只能挂在凡人线的「可选深处」，绝不能挂在主线上。**
 *   这条规则是踩过坑之后立的：第一版让「祛障」require 仙道「引灵」，
 *   用意是「城要养得起修士，先得把灵气往族里引」。结果是在
 *   「仙道侧不可用」的局面下（本仓库的对照实验就会这样摆），
 *   祛障被永久锁死 → 没有修士 → 仙道永远开不了 → 祛障永远开不了。
 *   这就是**互相卡脖子**，也正是本次设计要避免的东西。
 *
 *   现在跨树前置的方向是「仙道依赖凡人」：
 *     仙道「灵田」← 凡人「屯田」
 *     仙道「灵脉感应」← 凡人「探秘者」
 *   而凡人侧的跨树前置（义庄←悬壶、集贤馆←聚灵阵）都是**tier 6–7 的
 *   可选深处**，不挡任何主线。主线的方向永远是「凡人→仙道」单向的。
 *
 * effect 支持的键：见文件末尾的 EFFECT_LABELS，那里登记了全部合法键。
 *   （凡人侧与仙道侧共用一张表；键在这里定义，在 core/formulas.js 里结算。）
 */

const TECH_TIERS = [
  { tier: 1, name: '一 · 立族', hint: '从一姓一户，到有地有业' },
  { tier: 2, name: '二 · 兴家', hint: '起广厦，通银钱' },
  { tier: 3, name: '三 · 拓土', hint: '向外伸手，方有腾挪之地' },
  { tier: 4, name: '四 · 通商', hint: '货通四方，人丁自聚' },
  { tier: 5, name: '五 · 致远', hint: '以术驭势，家业可久' },
  { tier: 6, name: '六 · 祛障', hint: '门开了，就该想着怎么把根扎在城里' },
  { tier: 7, name: '七 · 望郡', hint: '一邑之望，与仙家共此城' },
];

const TECHS = [
  {
    id: 'realestate',
    name: '房地产',
    icon: '宅',
    tier: 1,
    cost: 250,
    requires: [],
    unlocksBuilding: 'estate',
    desc: '摸清了地契、税契与里正的门道，世家终于能在本乡置办田庄宅地。',
  },
  {
    id: 'architecture',
    name: '建筑学',
    icon: '匠',
    tier: 2,
    cost: 320,
    requires: ['realestate'],
    unlocksBuilding: 'house',
    desc: '夯土、榫卯、院落布局——族人不必再挤在一处，可起广厦安置老小。',
  },
  {
    id: 'finance',
    name: '金融',
    icon: '铢',
    tier: 2,
    cost: 700,
    requires: ['realestate'],
    unlocksBuilding: 'bank',
    desc: '懂得了折色、兑付与存息，银钱可以存下来，不必再堆在自家地窖里。',
  },
  {
    id: 'expansion',
    name: '对外扩张',
    icon: '旗',
    tier: 3,
    cost: 1200,
    requires: ['architecture'],
    unlocksBuilding: 'arena',
    desc: '族中子弟走出本乡，与外姓争地争水。立起演武台，方有立威之所。',
  },
  {
    id: 'surveying',
    name: '营造术',
    icon: '矩',
    tier: 3,
    cost: 900,
    requires: ['realestate'],
    effect: { estateDiscount: 0.15 },
    desc: '会看地形、会算工时，同样的银两能置下更多地产。',
  },
  {
    id: 'household',
    name: '户籍',
    icon: '册',
    tier: 4,
    cost: 1600,
    requires: ['architecture'],
    effect: { birthFlat: 0.001 },
    desc: '编户齐民，生子入册。族中生育从此有了章程，人丁滋生更稳。',
  },
  {
    id: 'trade',
    name: '商路',
    icon: '驼',
    tier: 4,
    cost: 2600,
    requires: ['finance', 'expansion'],
    unlocksBuilding: 'caravan',
    desc: '摸清了各州关隘与抽分，可设驿站、养商队，让银钱自己跑起来。',
  },
  {
    id: 'tuntian',
    name: '屯田',
    icon: '耒',
    tier: 4,
    cost: 2200,
    requires: ['expansion'],
    effect: { fieldBonus: 0.25 },
    /**
     * 跨树前置：屯田要「引灵」。
     * 理由是叙事上的：引灵台把灵气引到田里，屯田才真的能多养人。
     * 数值上它让「凡人篇的农业」与「仙道篇的灵气」第一次接上。
     */
    requiresImmortal: ['yinling'],
    desc: '设屯田、修水利，同一块田地能养活更多人。'
      + '引灵台的水先过一遍田垄，收成便不只多一成。',
  },
  {
    id: 'seeker',
    name: '探秘者',
    icon: '探',
    tier: 4,
    cost: 1800,
    requires: ['trade'],
    /** 拿银两与人命换消息。 */
    effect: { tradeIncome: -0.3, deathFlat: 0.004, secretChance: 0.05 },
    desc: '养一批专管打听的人。他们不走货，只走门路——商队赚得少了，人也折得多，'
      + '但山野间的风声听得见了。',
  },
  {
    id: 'arithmetic',
    name: '算学',
    icon: '筹',
    tier: 5,
    cost: 3500,
    requires: ['finance', 'household'],
    effect: { incomeMult: 0.1 },
    desc: '会记帐、会盘库，族中产出不再白白流失。',
  },
  {
    id: 'courier',
    name: '驿道',
    icon: '驿',
    tier: 5,
    cost: 6000,
    requires: ['trade'],
    effect: { tradeSpeed: 0.15 },
    desc: '沿官道设驿、换马不换人，商队往返比别家快上一截。',
  },
  {
    id: 'vault',
    name: '库房',
    icon: '库',
    tier: 5,
    cost: 4800,
    requires: ['finance', 'household'],
    effect: { vaultMult: 1.0 },
    desc: '钱庄只管把银子收进来，库房管的是「收进来之后还数得清」。'
      + '账房分门别类、按季盘库，同一批仓库能装下的银子翻了一倍。'
      + '——坊市那头肯不肯多称几钱灵石，全看你先拿得出多少现银。',
  },
  {
    id: 'quzhang',
    name: '祛障',
    icon: '障',
    tier: 6,
    cost: 6500,
    requires: ['trade', 'household', 'courier'],
    /** 除了前置科技，还要先摸到修行世界的边（集齐秘闻）。 */
    requiresSecrets: true,
    unlocksPill: 'quzhangdan',
    unlocksPillName: '祛障丹',
    desc: '凡人篇的最后一道门。障一破，方见天光——但破障要拿命去试。',
  },
  {
    id: 'marketexp',
    name: '坊市扩建',
    icon: '廛',
    tier: 6,
    cost: 8000,
    requires: ['trade', 'courier', 'surveying', 'vault'],
    effect: { tradeStoneMult: 0.25 },
    desc: '把云深谷那头的小集扩成一条街。本家的银钱递过去，'
      + '对面肯多称几钱灵石——兑率这东西，向来是人多的一方说了算。',
  },
  {
    id: 'yizhuang',
    name: '义庄',
    icon: '棺',
    tier: 6,
    cost: 9000,
    requires: ['household', 'seeker'],
    effect: { deathFlat: -0.0012, birthFlat: 0.0008 },
    /** 跨树前置：义庄要「悬壶」（仙家的医药）。见 data/immortal-techs.js。 */
    requiresImmortal: ['xuanhu'],
    desc: '在城外立一处义庄，收殓无主的尸骨，也给族里老弱一口热粥。'
      + '悬壶堂的药先紧着老人孩子，死的人少了，活着的人也就敢多生。',
  },
  {
    id: 'jixian',
    name: '集贤馆',
    icon: '贤',
    tier: 6,
    cost: 11000,
    requires: ['arithmetic', 'household'],
    effect: { incomeMult: 0.12, secretChance: 0.03, explorePerSecFlat: 0.00012 },
    /**
     * 跨树前置：集贤馆要「聚灵阵」。
     * 馆里养的不是普通读书人，是**替仙家记档、递帖子的人** ——
     * 所以它顺带给了「修士自动寻秘」，这也是城里唯一一项
     * 「仙道进度直接变成凡人科技的产出」。
     */
    requiresImmortal: ['julingzhen'],
    desc: '养几个读书人，管账、修谱、也管往山外递帖子。'
      + '馆里清静，日子久了，什么话都能听见——哪怕说话的人不在城里。',
  },
  {
    id: 'xiangxian',
    name: '乡贤祠',
    icon: '乡',
    tier: 7,
    cost: 45000,
    requires: ['jixian', 'yizhuang'],
    terminal: true,
    effect: { incomeMult: 0.25, birthFlat: 0.0015, secretChance: 0.04 },
    desc: '一姓在此地传了七代，里正见你祖父要叫一声老太爷。'
      + '祠堂里的牌位比县衙的卷宗还厚——这城里的事，一半在族中过。',
  },
  {
    id: 'mutualmarket',
    name: '仙凡互市',
    icon: '互',
    tier: 7,
    cost: 60000,
    requires: ['marketexp', 'quzhang'],
    /**
     * 跨树前置：仙凡互市要仙道「界墟」。
     * 城里想开一条两边通用的街，先得对面**认你的字号** ——
     * 界墟给的正是这个。这是凡人线最深处的一处「非仙不成」，
     * 也是本树唯一一处会卡住玩家的跨树前置（因此它必须落在 tier 7 的可选深处）。
     */
    requiresImmortal: ['jiexu'],
    terminal: true,
    unlocksBuilding: 'immortalmarket',
    effect: { tradeIncome: 0.35, tradeStoneMult: 0.35 },
    desc: '凡人卖药、卖铁、卖纸，仙家收的是灵石；仙家卖丹、卖符、卖法器，'
      + '凡人拿银钱接。两边的账本第一次并成了一本'
      + '——但那条街得等云深谷那头先认了本家的字号。',
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
  tradeSpeed: (v) => `商队耗时 −${Math.round(v * 100)}%`,
  fieldBonus: (v) => `田地效果 +${Math.round(v * 100)}%`,
  tradeIncome: (v) => `商路银两收益 ${signedPct(v)}`,
  deathFlat: (v) => `死亡率 ${signedFlat(v)}%/秒`,
  secretChance: (v) => `秘闻概率 ${signedPct(v)}`,
  explorePerSecFlat: (v) => `修士自动寻秘 +${(v * 100000).toFixed(1)} 条/万秒`,
  vaultMult: (v) => `银两上限 ${signedPct(v)}`,

  /* ── 仙道侧 ── */
  immortalCapFlat: (v) => `名册容量 ${signedAbs(v)} 人`,
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
