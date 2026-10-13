/**
 * 区块：坊市与通商（数据表）
 * 【策划 docs/96-坊市与通商.md、docs/104-凡人篇重构.md §I2】
 *
 * 四条设计约定（改这张表前先读）：
 *   1. **坊市开放权来自征伐**：打下一座势力城 → 开放对应坊市。判据用「已占据」
 *      （`worldOf(state).held`），**不用 `mapReach`** —— 地图是「战力门」不是
 *      「路径门」（`commitExplore` 在生还判定之前就调 `mapReach`，送死也能解锁）。
 *   2. **每件商品要用 1 条秘闻解锁，而且是消耗掉**：解锁永久有效，但秘闻一去不回。
 *      ⚠ **唯一的例外是「免秘闻」那一段**（`unlockSecrets: 0`）：0 条累计秘闻时
 *      `secretsAvailable()` 就是 0，那一段再要 1 条秘闻，就是又一道「一步都迈不出去」
 *      的循环门 —— 和「免秘闻段却收灵石」是同一类错。
 *   3. **江南坊市（id 仍是 `yunshen`）按累计秘闻分六段显现**（见 `MARKET_SEGMENTS`）。
 *      门槛一律读**累计** `state.secrets.length`，不是「可用秘闻」—— 花掉的秘闻
 *      不会把已经显现的段关回去。
 *   4. **三座城坊市的 `requiresHeld` 通道原样不动**：剿城开市是炼气期的奖励，
 *      不属于凡人篇重构的范围。
 *
 * ⚠ 商品 id 一旦发布**不许改名或删除**（老存档里按 id 记着解锁状态）。
 */

/** 每件商品解锁要花的秘闻数。 */
const MARKET_UNLOCK_SECRETS = 1;

/**
 * 【凡人篇 I2】分段显现表。
 *
 * 为什么必须分段：「云深谷坊市」原来是一道 10 条秘闻的整门 —— 门开之前，
 * 里面有什么玩家一个字都看不见，也不知道自己在往哪儿走。现在 **0 条就能进市集**，
 * 之后每 2 条秘闻往后推一段；界面把**没到的段也摆出来**（灰着 + 「需 N 条秘闻」），
 * 而不是整段藏起来。
 *
 *   needSecrets：显现这一段需要的**累计**秘闻数（`state.secretsUsed` 不参与判定）
 *   desc：界面直接印的一句话（段名下面那行）
 */
const MARKET_SEGMENTS = {
  yunshen: [
    { id: 'shiji', name: '市集', needSecrets: 0, desc: '免秘闻的凡货摊子：只收银两，谁也不拦你。' },
    { id: 'hidden', name: '隐藏坊市', needSecrets: 10, desc: '柜上只认灵石 —— 银两到这儿才换得动（灵石交易）。' },
    { id: 'gongfa', name: '炼气功法', needSecrets: 12, desc: '黄阶功法摆上架子，炼气期现成的入门货。' },
    { id: 'zhenqi', name: '聚灵阵阵旗', needSecrets: 14, desc: '聚灵阵的阵旗：插上就聚气，省一场采料画符。' },
    { id: 'pozhang', name: '破障丹', needSecrets: 16, desc: '冲关破障用的丹，不必自己开炉。' },
    { id: 'lingkuang', name: '灵矿灵池', needSecrets: 18, desc: '灵池蓝图与矿上的营生，最后才现。' },
  ],
};

/**
 * 反向兑换的折价：卖出价 = 买入价 × 0.8。
 * 【策划 docs/96】灵石→银两是本块**新开的边**（现存代码里没有），所以反套利必须自己守。
 * 0.8 ⇒ 「银两→灵石→银两」任一回路**严格亏 20%**，且与笔数、与科技培率都无关。
 */
const MARKET_SELL_RATIO = 0.8;

/**
 * 商品表。
 *   currency：'stones'（`price` 单位是**灵石**）/ 'silver'（`price` 单位是**银两**）
 *     —— 【凡人篇 I2】免秘闻那一段必须是银两计价：灵石要到隐藏坊市（累计 10 条秘闻）
 *        才换得到，拿灵石给第一段标价，等于把还没到 10 条的玩家锁在门外。
 *        银两由人口自然产出，与秘闻、与坊市都无关 ⇒ 那一段真的迈得出去。
 *   segment：落在哪一段（段未显现 ⇒ 既买不到也解锁不了；id 见 MARKET_SEGMENTS）
 *   effect.kind：pill / pool-blueprint / clue / silver / population / manual / rune
 *     （只允许挂在**已有**的字段上，避免再造一套库存）
 */
const MARKET_GOODS = [
  {
    id: 'quzhangdan', market: 'yunshen', segment: 'shiji', name: '祛障丹',
    currency: 'silver', price: 2000, unlockSecrets: 0,
    desc: '直接购得一枚祛障丹（计入祛障丹存量，服下后有机会让族人踏入炼气）。免秘闻、只收银两。',
    // ⚠ 存量字段是旧的 `cultivation.pills`，出口在 systems/alchemy.js 的 pillCount，
    //   它按 id `'quzhang'` 分流（不是 `'quzhangdan'`）—— 写成 `quzhangdan` 会静默进
    //   丹房那份表，而界面读的是旧字段 ⇒ 买了没反应。
    effect: { kind: 'pill', pill: 'quzhang', n: 1 },
  },
  {
    id: 'liumin', market: 'yunshen', segment: 'shiji', name: '招募流民',
    currency: 'silver', price: 1500, unlockSecrets: 0,
    desc: '从城外招 3 名流民入籍（直接加凡人人口）。人来了才有人手与银钱。',
    effect: { kind: 'population', n: 3 },
  },
  {
    id: 'poolblueprint', market: 'yunshen', segment: 'lingkuang', name: '灵池蓝图',
    currency: 'stones', price: 2, unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '凭蓝图即可营造灵池 —— 后天祛障的第二条路。',
    effect: { kind: 'pool-blueprint' },
  },
  {
    id: 'lianqi_gongfa', market: 'yunshen', segment: 'gongfa', name: '炼气功法·吐纳真诀',
    currency: 'stones', price: 3, unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '黄阶《吐纳真诀》，炼气期的入门功法（族中已有则不必再买）。',
    // ⚠ 功法 id 一律取自 `data/manuals.js` 的 `CULTIVATION_MANUALS`（`breath` = 吐纳真诀），
    //   本块只**引用**，不改功法表。
    effect: { kind: 'manual', manual: 'breath' },
  },
  {
    id: 'juling_zhenqi', market: 'yunshen', segment: 'zhenqi', name: '聚灵阵阵旗',
    currency: 'stones', price: 4, unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '聚灵阵的阵旗 —— 一张现成的「聚灵符」（保质期与自家画的符相同）。',
    // ⚠ 符 id 取自 `data/runes.js` 的 `RUNE_ITEMS`（`juling` = 聚灵符），只引用不改表。
    effect: { kind: 'rune', rune: 'juling', n: 1 },
  },
  {
    id: 'pozhang_dan', market: 'yunshen', segment: 'pozhang', name: '筑基丹',
    currency: 'stones', price: 5, unlockSecrets: MARKET_UNLOCK_SECRETS,
    desc: '破障这一段卖的是现成的筑基丹（`data/alchemy.js` 里那味），省去采药起炉。',
    // ⚠ 「破障丹」这个名字在丹表里**没有**对应 id（炼气及以后的系统本轮不许动），
    //   所以这一段卖的是**既有**的丹 id `zhuji`（筑基的门槛丹，见 REALM_GATES）。
    //   要卖别的丹，先改丹表，别在这里新造 id。
    effect: { kind: 'pill', pill: 'zhuji', n: 1 },
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
  //     marketUnlocks、以及全部 effect kind 都还在原地。
  // ⚠ 【凡人篇 I2】新加的四件货也必须过这一关：祛障丹与招募流民是银两买的
  //   **实物/人口**；功法、阵旗、破障丹都是修行线上真会用到的东西。
  //   段 10「隐藏坊市（灵石交易）」**故意没有货**：那一段开的是兑换那条边本身
  //   （`CULTIVATOR_MARKET.requiresSecrets` 恰好也是 10）。
  // ⚠ 老存档里可能还记着被删的三个 id，读取端必须容忍未知 id（见 systems/markets.js）。
  // ══════════════════════════════════════════════════════════════════
];

/**
 * 坊市表。
 *   requiresSecrets：秘闻门槛（读**累计**秘闻）
 *   requiresHeld：需要占据的势力城数（剿城开市，**本轮不动**）
 *
 * 【凡人篇 I2】江南坊市的 `requiresSecrets` 从 `SECRET_UNLOCK`(10) 收到 0：
 *   整门交给 `MARKET_SEGMENTS` 分段把关，第一段（市集）免秘闻。
 * ⚠ 「灵石交易」（银两 → 灵石）的门槛**不在**这张表里，它一直是
 *   `data/trade.js` 的 `CULTIVATOR_MARKET.requiresSecrets`（= `SECRET_UNLOCK`），
 *   恰好与段 10「隐藏坊市」同一个门槛 —— 那条边本轮一个字没动。
 */
const MARKETS = [
  {
    id: 'yunshen', name: '江南坊市', requiresSecrets: 0, requiresHeld: 0,
    desc: '江南的坊市分六进：头一进是免秘闻的市集，只收银两；越往里，柜上越只认灵石。',
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
