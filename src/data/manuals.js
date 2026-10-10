
/* ────────────────────────────────────────────────────────────────
 * 区块：功法表：道途 / 品阶 / 十五本 / 参悟调参常量
 * 原属 src/data/cultivation.js 第 39–110 行
 * ──────────────────────────────────────────────────────────────── */
/* ────────────── 秘籍：道途 × 品阶 × 流派，主修 + 辅修 ──────────────
 *
 * 设计要点（详见 docs/秘籍机制策划.md、docs/85-流派与道心.md）：
 *  - 五条「道途」各服务一种玩法，正好对应五种修士职责；
 *  - 三个「品阶」决定数值档位，也决定出处（洞天/攻伐的难度）；
 *  - **流派**给功法一个玩法身份：主修位的流派会带来独有机制与代价。
 *    前十五本（无 school 字段）一律按「玄门正宗」处理 —— 没有机制，也没有代价。
 *  - 主修吃满效果，辅修只吃 45%，且同一道途不可占两个位置 —— 这才是选择；
 *  - **只有主修位的流派生效**，所以「主修选哪本」就是「这一世走哪条路」；
 *  - 重复获得转为「参悟」，也可以花灵石+线索主动参悟，重复掉落不再是废物。
 *
 * 前三个 id（breath/spring/star）沿用旧版的 id 与数值，所以旧存档
 * 里的 manuals / equippedManual 不需要任何迁移就能继续用。
 */

/** 道途：每条道途只强化一个方向。 */
const MANUAL_DAOS = {
  breath: { name: '炼气', desc: '加快闭关修士的修为积累' },
  ward:   { name: '御守', desc: '提升修士战力' },
  trade:  { name: '经营', desc: '提升劳作带来的银两产出' },
  seek:   { name: '寻幽', desc: '提升秘闻的发现速度' },
  peril:  { name: '涉险', desc: '提升洞天生还率与灵石收益' },
};
const MANUAL_DAO_ORDER = ['breath', 'ward', 'trade', 'seek', 'peril'];

/** 品阶：数值档位与出处。 */
const MANUAL_TIERS = [
  { tier: 1, name: '黄阶' },
  { tier: 2, name: '玄阶' },
  { tier: 3, name: '地阶' },
];
const MANUAL_TIER_NAME = { 1: '黄阶', 2: '玄阶', 3: '地阶' };

/**
 * 十五本功法。
 * effect 的键与「生效处」一一对应：
 *   training 闭关修为速度 / power 修士战力 / labor 劳作银两
 *   explore 秘闻发现   / survive 洞天生还率(百分点) / stones 洞天灵石收益
 * 值都是「加成比例」，0.4 表示 +40%。
 */
const CULTIVATION_MANUALS = [
  // 炼气 —— 沿用旧 id 与数值
  { id:'breath', name:'吐纳真诀',   dao:'breath', tier:1, effect:{ training:0.40 } },
  { id:'spring', name:'沧澜引气法', dao:'breath', tier:2, effect:{ training:1.10 } },
  { id:'star',   name:'周天星河诀', dao:'breath', tier:3, effect:{ training:2.20 } },
  // 御守
  { id:'ironbone', name:'铁骨桩功',   dao:'ward', tier:1, effect:{ power:0.25 } },
  { id:'xuanjia',  name:'玄甲护身诀', dao:'ward', tier:2, effect:{ power:0.60 } },
  { id:'mingwang', name:'不动明王经', dao:'ward', tier:3, effect:{ power:1.30 } },
  // 经营
  { id:'jiejian', name:'节用篇',   dao:'trade', tier:1, effect:{ labor:0.20 } },
  { id:'huozhi',  name:'货殖列传', dao:'trade', tier:2, effect:{ labor:0.50 } },
  { id:'taozhu',  name:'陶朱遗书', dao:'trade', tier:3, effect:{ labor:1.10 } },
  // 寻幽
  { id:'wangqi',   name:'望气术',     dao:'seek', tier:1, effect:{ explore:0.30 } },
  { id:'kanzhou',  name:'地脉堪舆图', dao:'seek', tier:2, effect:{ explore:0.75 } },
  { id:'dongtian', name:'洞天指要',   dao:'seek', tier:3, effect:{ explore:1.60 } },
  // 涉险
  { id:'jianxing', name:'健行散',   dao:'peril', tier:1, effect:{ survive:0.08, stones:0.15 } },
  { id:'guixi',    name:'龟息功',   dao:'peril', tier:2, effect:{ survive:0.18, stones:0.35 } },
  { id:'dayan',    name:'大衍遁法', dao:'peril', tier:3, effect:{ survive:0.35, stones:0.70 } },

  /* ── 以下九本带「流派」，独有机制与代价见 data/schools.js ──
     数值普遍比同阶的玄门功法略高一点 —— 代价写在流派上，不写在这里。 */

  // 血煞魔功：以血肉养功。主修任意一本都解锁「炼人丹」
  { id:'xuesha', name:'血煞炼形诀', dao:'ward',  tier:1, school:'demonic', effect:{ power:0.45 } },
  { id:'wanhun', name:'万魂幡',     dao:'ward',  tier:2, school:'demonic', effect:{ power:0.95 } },
  { id:'rendan', name:'人丹要术',   dao:'breath', tier:3, school:'demonic', effect:{ training:1.85 } },

  // 合欢双修：人丁兴旺，进境亦快，但不善斗
  { id:'hehuan', name:'合欢采补术', dao:'breath', tier:1, school:'dual', effect:{ training:0.55 } },
  { id:'huanxi', name:'欢喜禅功',   dao:'breath', tier:2, school:'dual', effect:{ training:1.35 } },

  // 剑修：一剑破万法，但静不下心
  { id:'qinglian', name:'青莲剑歌', dao:'ward', tier:2, school:'sword', effect:{ power:0.80 } },
  { id:'zhanwang', name:'斩妄剑经', dao:'ward', tier:3, school:'sword', effect:{ power:1.55 } },

  // 丹修 / 器修：各自抬高本行的成功率
  { id:'danding',  name:'丹鼎真解', dao:'breath', tier:2, school:'alchemy', effect:{ training:0.85 } },
  { id:'shengong', name:'神工录',   dao:'ward',   tier:2, school:'forge',   effect:{ power:0.55 } },
];
const CULTIVATION_MANUAL_MAP = Object.fromEntries(CULTIVATION_MANUALS.map(m=>[m.id,m]));
/** 兼容旧引用：UI 与存档校验都还叫这个名字。 */
const OBTAINABLE_MANUALS = CULTIVATION_MANUALS;

/** 参悟：重复获得可以累积，也可以通过灵石+线索主动推进。 */
const MANUAL_ATTUNE_MAX = 5;
const MANUAL_ATTUNE_STEP = 0.12;        // 每层参悟 +12%
const MANUAL_ASSIST_RATIO = 0.45;       // 辅修位只吃 45%
const MANUAL_ATTUNE_STONE_COST = 3;
const MANUAL_ATTUNE_CLUE_COST = 2;
const MANUAL_DUPLICATE_STONES = 2;      // 参悟满后重复掉落折算的灵石

/** 一本功法在某位置上的实际效果（已计参悟与位置比例）。 */