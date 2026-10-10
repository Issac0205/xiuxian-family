/**
 * 凡人科技线。
 *
 * 设计原则：
 *  - 开局只会「种地」——田地是唯一不需要科技的营造项。
 *  - 其余五类建筑全部由科技解锁，其中「房地产 / 建筑学 / 对外扩张」的命名与顺序
 *    由需求指定，钱庄与驿站对应的「金融 / 商路」是同一风格补齐的。
 *  - 除解锁建筑外，还有若干「精进」类科技直接改数值，让这条线有纵深。
 *
 * effect 支持的键（可在 config / formulas 里扩展）：
 *   estateDiscount  地产价格下降比例
 *   birthFlat       基础出生率加成（每秒绝对值）
 *   incomeMult      银两产出加成
 *   tradeSpeed      商队耗时下降比例
 *   fieldBonus      田地效果加成比例
 */

const TECH_TIERS = [
  { tier: 1, name: '一 · 立族', hint: '从一姓一户，到有地有业' },
  { tier: 2, name: '二 · 兴家', hint: '起广厦，通银钱' },
  { tier: 3, name: '三 · 拓土', hint: '向外伸手，方有腾挪之地' },
  { tier: 4, name: '四 · 通商', hint: '货通四方，人丁自聚' },
  { tier: 5, name: '五 · 致远', hint: '以术驭势，家业可久' },
  { tier: 6, name: '六 · 祛障', hint: '破凡俗之障，方见天光' },
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
    desc: '设屯田、修水利，同一块田地能养活更多人。',
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
    id: 'quzhang',
    name: '祛障',
    icon: '障',
    tier: 6,
    cost: 5000,
    requires: ['trade'],
    /** 除了前置科技，还要先摸到修行世界的边（集齐秘闻）。 */
    requiresSecrets: true,
    unlocksPill: 'quzhangdan',
    unlocksPillName: '祛障丹',
    desc: '凡人篇的最后一道门。障一破，方见天光——但破障要拿命去试。',
  },
];

const TECH_MAP = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/** 效果键 → 展示文案。 */
const EFFECT_LABELS = {
  estateDiscount: (v) => `地产价格 −${Math.round(v * 100)}%`,
  birthFlat: (v) => `基础出生率 +${(v * 100).toFixed(2)}%/秒`,
  incomeMult: (v) => `银两产出 +${Math.round(v * 100)}%`,
  tradeSpeed: (v) => `商队耗时 −${Math.round(v * 100)}%`,
  fieldBonus: (v) => `田地效果 +${Math.round(v * 100)}%`,
  tradeIncome: (v) => `商路银两收益 ${v < 0 ? '−' : '+'}${Math.abs(Math.round(v * 100))}%`,
  deathFlat: (v) => `死亡率 +${(v * 100).toFixed(2)}%/秒`,
  secretChance: (v) => `秘闻概率 +${Math.round(v * 100)}%`,
};

/** 一项科技的全部收益文案。 */
function techGainText(tech, buildingName) {
  const out = [];
  if (tech.unlocksBuilding) out.push(`解锁营造「${buildingName || tech.unlocksBuilding}」`);
  if (tech.unlocksPill) out.push(`解锁「${tech.unlocksPillName || tech.unlocksPill}」`);
  for (const [key, val] of Object.entries(tech.effect || {})) {
    if (EFFECT_LABELS[key]) out.push(EFFECT_LABELS[key](val));
  }
  return out;
}
