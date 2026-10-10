/**
 * 六类凡人建筑。
 *
 * 字段说明：
 *  - baseCost / growth : 第 n 座的价格 = baseCost * growth^n
 *  - slots             : 占用的建筑容量（地产为 0，它提供容量）
 *  - tech              : 解锁所需科技 id；null 表示开局即可营造
 *  - effectText(n, d)  : 已建 n 座时，本建筑提供的总效果文案
 *  - perText           : 每座的效果说明
 *  - accent            : 卡片配色
 */
const BUILDINGS = [
  {
    id: 'field',
    name: '田地',
    icon: '禾',
    accent: 'wheat',
    tagline: '垦荒开垄，仓廪足而人丁旺',
    lore: '田地养人。这是世家立身的第一件事，也是唯一不需要门道的营生。',
    baseCost: 70,
    growth: 1.17,
    slots: 1,
    tech: null,
    perText: `出生率 +${fmtPercent(FIELD_BIRTH, 2)}/秒`,
    effectText: (n) => `出生率 +${fmtPercent(FIELD_BIRTH * n, 2)}/秒`,
  },
  {
    id: 'estate',
    name: '地产',
    icon: '⛰',
    accent: 'gold',
    tagline: '田庄宅地，家族立身之本',
    lore: '置下地产，方可营造屋舍、开辟田垄。地产愈广，能容纳的建筑愈多。',
    baseCost: 80,
    growth: 1.22,
    slots: 0,
    tech: 'realestate',
    perText: `建筑容量 +${ESTATE_SLOTS}`,
    effectText: (n) => `建筑容量 +${ESTATE_SLOTS * n}`,
  },
  {
    id: 'house',
    name: '房产',
    icon: '⌂',
    accent: 'jade',
    tagline: '广厦千间，安置族中老小',
    lore: '房产愈多，凡人家族容纳量愈高；但地价随之而起，此后一切营造皆会变贵。',
    baseCost: 60,
    growth: 1.18,
    slots: 1,
    tech: 'architecture',
    perText: `容纳量 +${HOUSE_CAPACITY}，全局造价 +${fmtPercent(HOUSE_INFLATION, 0)}`,
    effectText: (n) => `容纳量 +${HOUSE_CAPACITY * n}`,
  },
  {
    id: 'bank',
    name: '钱庄',
    icon: '铢',
    accent: 'silver',
    tagline: '汇通银钱，库中有余粮',
    lore: '钱庄扩大家中银库，抬高银两的囤积上限，免得岁入白白流失。',
    baseCost: 200,
    growth: 1.24,
    slots: 1,
    tech: 'finance',
    perText: `银两上限 +${fmt(BANK_CAPACITY)}`,
    effectText: (n) => `银两上限 +${fmt(BANK_CAPACITY * n)}`,
  },
  {
    id: 'arena',
    name: '演武台',
    icon: '戟',
    accent: 'ember',
    tagline: '族中子弟习武之所',
    lore: '演武台前立威名，乡里不敢抬价。但走出去争地的子弟，回不来的人也多了。'
      + '折扣是递减的——第一座最划算，越往后越难再压价。',
    baseCost: 400,
    growth: 1.3,
    slots: 1,
    tech: 'expansion',
    perText: `地产折扣递减（趋近 −${fmtPercent(ARENA_DISCOUNT_MAX, 0)}），死亡率 +${fmtPercent(ARENA_DEATH, 2)}/秒`,
    effectText: (n, d) =>
      `地产价格 −${fmtPercent(d.estateDiscountTotal, 1)} · 死亡率 +${fmtPercent(ARENA_DEATH * n, 2)}/秒`,
    footnote: () => `第 ${ARENA_DISCOUNT_HALF} 座正好拿到一半折扣`,
  },
  {
    id: 'caravan',
    name: '商队驿站',
    icon: '驮',
    accent: 'violet',
    tagline: '驼铃西去，货通四方',
    lore: '立起驿站，便可派出商队行商。只是商路凶险，走的人未必都回得来。',
    baseCost: 800,
    growth: 1.28,
    slots: 1,
    tech: 'trade',
    perText: `商队位 +${CARAVAN_SLOTS_PER}，死亡率 +${fmtPercent(CARAVAN_DEATH, 2)}/秒`,
    effectText: (n) =>
      `商队位 +${CARAVAN_SLOTS_PER * n} · 死亡率 +${fmtPercent(CARAVAN_DEATH * n, 2)}/秒`,
  },
];

/** id -> 定义 的索引表。 */
const BUILDING_MAP = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/** 占用建筑容量的建筑。 */
const SLOT_BUILDINGS = BUILDINGS.filter((b) => b.slots > 0);

/** 开局即可营造的建筑。 */
const STARTING_BUILDINGS = BUILDINGS.filter((b) => !b.tech);

/** 建筑展示顺序。 */
const BUILDING_ORDER = BUILDINGS.map((b) => b.id);
