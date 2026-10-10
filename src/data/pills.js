
/* ────────────────────────────────────────────────────────────────
 * 区块：丹药表（祛障丹）与炼气篇门槛
 * 原属 src/data/cultivation.js 第 1–28 行
 * ──────────────────────────────────────────────────────────────── */
/**
 * 修仙侧的物品。
 *
 * 目前只有一枚「祛障丹」——它是凡人篇的最后一道门：
 * 用灵石买丹，服下后有概率诞生炼气人口，世家自此踏入炼气篇。
 * 后续功法、灵根、法器之类都会长在这个文件旁边。
 */

const PILLS = [
  {
    id: 'quzhangdan',
    name: '祛障丹',
    icon: '丹',
    desc: '服之可祛凡俗之障。成与不成，看各人的命数。',
    /** 需要研习的科技。 */
    requiresTech: 'quzhang',
    /** 价格（灵石）。 */
    stoneCost: PILL_STONE_COST,
    /** 服下后诞生一名炼气人口的概率。 */
    qiChance: PILL_QI_CHANCE,
  },
];

const PILL_MAP = Object.fromEntries(PILLS.map((p) => [p.id, p]));

/** 炼气篇的门槛：只要有一个人踏入炼气，就算开篇。 */
const QI_CHAPTER_THRESHOLD = 1;
