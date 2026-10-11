/**
 * 十类凡人与仙凡两用的建筑。
 *
 * 字段说明：
 *  - baseCost / growth : 第 n 座的价格 = baseCost * growth^n
 *  - slots             : 占用的建筑容量（地产为 0，它提供容量）
 *  - tech              : 解锁所需科技 id；null 表示开局即可营造。
 *                        **可以是仙道科技的 id**（见 immortal-techs.js），
 *                        于是「仙家设的坊市，凡人才能去摆摊」这类关系能直接表达。
 *  - perText           : 每座的效果说明
 *  - effectText(n, d)  : 已建 n 座时，本建筑提供的总效果文案
 *  - accent            : 卡片配色
 *
 * ⚠ 后五类是「仙凡经济」的落点：它们不产银两，产的是**仙道生产线的原料**
 *   与**兑率**。所以城里该不该多盖一座药圃，取决于山那边炼丹缺不缺药——
 *   这就是两条科技线要咬合的地方。数值口径见 core/config.js 的仙凡经济一节。
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

  /* ══════════ 仙凡经济：城里的作坊 ══════════
   *
   * 这五座建筑是「两条线互相咬合」在凡人侧的全部落点。
   * 它们**不产银两**，产的是仙道生产线的原料与兑率：
   *   药圃 → 药材（丹方原料）    矿寮 → 矿料（法器原料）
   *   纸坊 → 符料（符箓原料）    坊市 → 银两换灵石的兑率
   *   灵石矿场 → 直接产灵石，但**吃凡人矿工的命**
   *
   * 全部按「分摊到的人口」计产：人不够时，作坊之间一起摊薄。
   */
  {
    id: 'herbhouse',
    name: '药圃',
    icon: '圃',
    accent: 'jade',
    tagline: '引灵台的水先浇过一遍，再分畦种药',
    lore: '仙家炼一炉丹，要的是山里的灵草；可山里的灵草长在别人家的地盘上。'
      + '族中有见识的人便说：何不自己辟一片药圃？——种出来的药性薄些，但胜在常年不断。',
    baseCost: 1500,
    growth: 1.26,
    slots: 1,
    tech: 'lingtian',
    perText: `每座用工至多 ${CITY_WORKSHOP_WORKERS} 人，产出药材`,
    effectText: (n, d) =>
      `药材 +${(CITY_HERB_PER_SEC * n * (1 + d.fx.cityMaterialMult)).toFixed(3)}/秒（满员）`,
    footnote: () => '人口不足时，各作坊按需求分摊，产量一起摊薄',
  },
  {
    id: 'minestop',
    name: '矿寮',
    icon: '凿',
    accent: 'silver',
    tagline: '城外的石头里，也未必全是石头',
    lore: '山里的矿脉原本是仙家的事。后来族中有人发现，'
      + '凡人在浅层敲下来的那些碎料，送到器坊也能用——只是要拿命去换。',
    baseCost: 2600,
    growth: 1.28,
    slots: 1,
    tech: 'xuanhu',
    perText: `每座用工至多 ${CITY_WORKSHOP_WORKERS} 人，产出矿料`,
    effectText: (n, d) =>
      `矿料 +${(CITY_ORE_PER_SEC * n * (1 + d.fx.cityMaterialMult)).toFixed(3)}/秒（满员）`,
    footnote: () => `做工的凡人有折损：每名用工每秒 ${fmtPercent(CITY_LABOR_DEATH, 4)} 的死亡风险`,
  },
  {
    id: 'papermill',
    name: '纸坊',
    icon: '纸',
    accent: 'ink',
    tagline: '灵木纤维捣浆抄纸，字迹才留得住',
    lore: '画符用的纸与寻常纸不同：要使灵木的纤维，要一遍遍地淘洗。'
      + '这门手艺原本只在山里传，如今城中也有人会了。',
    baseCost: 3600,
    growth: 1.29,
    slots: 1,
    tech: 'xuanhu',
    perText: `每座用工至多 ${CITY_WORKSHOP_WORKERS} 人，产出符料`,
    effectText: (n, d) =>
      `符料 +${(CITY_RUNE_PER_SEC * n * (1 + d.fx.cityMaterialMult)).toFixed(3)}/秒（满员）`,
  },
  {
    id: 'spiritmine',
    name: '灵石矿场',
    icon: '矿',
    accent: 'violet',
    tagline: '城外的深坑里，夜里透出光来',
    lore: '仙家探明了灵脉，凡人负责把它挖出来。'
      + '这是仙凡两地**唯一**一项「凡人亲手生出灵石」的营生——代价写在名册上。',
    baseCost: 9000,
    growth: 1.32,
    slots: 1,
    tech: 'lingmai',
    perText: `每座让已探明的灵脉多出 ${fmtPercent(SPIRIT_MINE_CITY_BONUS_PER, 0)} 的出石`,
    effectText: (n) => `矿脉出石 +${fmtPercent(SPIRIT_MINE_CITY_BONUS_PER * n, 0)}`,
    footnote: () => '须先由修士以寻龙尺探得矿脉，此处方能开采',
  },
  {
    id: 'immortalmarket',
    name: '仙凡坊市',
    icon: '互',
    accent: 'ember',
    tagline: '一边用银钱，一边用灵石，桌子摆在同一条街上',
    lore: '凡人卖药、卖铁、卖纸；仙家卖丹、卖符、卖法器。'
      + '两边的账本第一次并成了一本——市面越大，银钱在这一头就越硬。',
    baseCost: 12000,
    growth: 1.33,
    slots: 1,
    tech: 'mutualmarket',
    perText: `每座用工至多 ${CITY_MARKET_WORKERS_MAX} 人，抬高银两产出与兑率`,
    effectText: (n) =>
      `银两产出 +${fmtPercent((CITY_MARKET_WORKERS_MAX / CITY_WORKSHOP_WORKERS) * n * CITY_MARKET_YIELD_PER_WORKER, 1)}（满员）`,
    footnote: () => '与药圃/矿寮/纸坊抢同一批人手',
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
