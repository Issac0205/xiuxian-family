/**
 * 区块：坊市与通商（数据表）
 * 【策划 docs/96-坊市与通商.md】
 *
 * 三条设计约定（改这张表前先读）：
 *   1. **坊市开放权来自征伐**：打下一座势力城 → 开放对应坊市。判据用「已占据」
 *      （`worldOf(state).held`），**不用 `mapReach`** —— 地图是「战力门」不是
 *      「路径门」（`commitExplore` 在生还判定之前就调 `mapReach`，送死也能解锁）。
 *   2. **每件商品要用 1 条秘闻解锁，而且是消耗掉**：解锁永久有效，但秘闻一去不回。
 *   3. **云深谷沿用旧门槛**（秘闻 ≥ SECRET_UNLOCK），不打仗也能进 —— 否则零征伐
 *      的玩家会连祛障丹都买不到，主线直接断掉。
 *
 * ⚠ 商品 id 一旦发布**不许改名或删除**（老存档里按 id 记着解锁状态）。
 */

/** 每件商品解锁要花的秘闻数。 */
const MARKET_UNLOCK_SECRETS = 1;

/**
 * 反向兑换的折价：卖出价 = 买入价 × 0.8。
 * 【策划 docs/96】灵石→银两是本块**新开的边**（现存代码里没有），所以反套利必须自己守。
 * 0.8 ⇒ 「银两→灵石→银两」任一回路**严格亏 20%**，且与笔数、与科技培率都无关。
 */
const MARKET_SELL_RATIO = 0.8;

/**
 * 商品表。
 *   currency：'stones'（灵石）—— 目前只有灵石计价，银两走反向兑换那条边。
 *   effect.kind：pill / pool-blueprint / clue / silver
 *     （只允许挂在**已有**的字段上，避免再造一套库存）
 */
const MARKET_GOODS = [
  {
    id: 'quzhangdan', market: 'yunshen', name: '祛障丹', currency: 'stones', price: 1,
    unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '直接购得一枚祛障丹（计入祛障丹存量，服下后有机会让族人踏入炼气）。',
    // ⚠ 存量字段是旧的 `cultivation.pills`，出口在 systems/alchemy.js 的 pillCount，
    //   它按 id `'quzhang'` 分流（不是 `'quzhangdan'`）—— 写成 `quzhangdan` 会静默进
    //   丹房那份表，而界面读的是旧字段 ⇒ 买了没反应。
    effect: { kind: 'pill', pill: 'quzhang', n: 1 },
  },
  {
    id: 'poolblueprint', market: 'yunshen', name: '灵池蓝图', currency: 'stones', price: 2,
    unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '凭蓝图即可营造灵池 —— 后天祛障的第二条路。',
    effect: { kind: 'pool-blueprint' },
  },
  // ══════════════════════════════════════════════════════════════════
  // 【用户实测 2026-10-11】这里原本还有三件商品：线索袋 / 银两袋 / 线索匣。
  //   用户判定「完全是不对的」，并给了口径：
  //     「暂时不卖别的东西，想到再卖，先要有这个框架，但是不要卖无意义的东西」
  //   为什么它们无意义（记下来，免得以后又想加）：
  //     · 银两袋 —— 与已有的「灵石 → 银两」兑换**功能重复**，等于同一条边卖两次。
  //     · 线索袋 / 线索匣 —— 把「拿灵石买消耗品」当商品，可替代自家探索与参悟，
  //       而且同一件事拆成两档（1 条 / 3 条）纯属凑数。
  //   ⇒ 三件商品已删。**框架保留**：MARKET_GOODS 表、秘闻解锁、按 id 记账的
  //     marketUnlocks、以及 effect 的四种 kind（pill / pool-blueprint / clue /
  //     silver）都还在原地 —— 以后想到真正像「坊市货」的东西，往表里加一条即可。
  // ⚠ 老存档里可能还记着这三个 id，读取端必须容忍未知 id（见 systems/markets.js）。
  // ══════════════════════════════════════════════════════════════════
];

/**
 * 坊市表。
 *   requiresSecrets：秘闻门槛（云深谷沿用旧门槛，保证零征伐也能起步）
 *   requiresHeld：需要占据的势力城数（剿城开市）
 */
const MARKETS = [
  {
    id: 'yunshen', name: '云深谷坊市', requiresSecrets: SECRET_UNLOCK, requiresHeld: 0,
    desc: '山里人拿石头当钱使的地方。不打仗也能进 —— 前提是先攒够秘闻。',
  },
  {
    id: 'qingmu', name: '青木集市', requiresSecrets: 0, requiresHeld: 1,
    desc: '打下第一座势力城之后，商路自然通到这里。',
  },
  {
    id: 'heishi', name: '黑石城坊', requiresSecrets: 0, requiresHeld: 2,
    desc: '两座城到手，黑石城才肯把货摆出来。',
  },
  {
    id: 'wanxiang', name: '万象楼', requiresSecrets: 0, requiresHeld: 3,
    desc: '三城在握者，才有资格上万象楼。',
  },
];
