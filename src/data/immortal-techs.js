/**
 * 仙道科技线。
 *
 * 与 techs.js（凡人篇）是**两条平行但互相咬合**的线：
 *
 *   · 凡人篇花**银两**，长在城里：人口、房产、商路、营造。
 *   · 仙道篇花**灵石**，长在修士身上：境界、战力、镇守、洞天。
 *
 * 咬合点（本文件最重要的部分，也是 auditTechs 会逐条列出来的）：
 *
 *   凡人 → 仙道：多个仙道科技把凡人科技写进 requires。
 *      · 灵田、养炉、悬壶、聚灵阵 都要「屯田」「营造术」「户籍」这类城里的本事，
 *        理由是同一条：**仙家不是凭空修出来的，要有城供着**。
 *      · 灵脉感应要「探秘者」——找矿脉是凡人打听出来的风声。
 *   仙道 → 凡人：见 techs.js 里的 requiresImmortal（祛障、集贤馆、仙凡互市）。
 *
 * 与凡人侧的第二个区别：仙道科技**兼容旧存档**。
 *   凡人侧靠 techs 数组，老存档里没有的 id 就是没研习。
 *   仙道侧靠 immortalTechs 数组，字段不存在时 repairCultivation 补一个空数组，
 *   所以 1.0 的老存档读进来就是「仙道篇未开启」，不会崩。
 *
 * effect 支持的键（全部在 core/formulas.js 的 techEffects / cultivationEffects
 * 里真实结算，并在 EFFECT_LABELS 里登记，否则界面上显示不出来）：
 *   immortalCapMult    名册容量 ×(1+N)（**只能放大人口给的名额，不能另开一份**）
 *                      ⚠ 这里原本是 `immortalCapFlat`（直接 +150 人）。那等于给名册
 *                      开了一份与凡人人口无关的额度，玩家报的「离线回来修士暴涨」
 *                      就是它放出来的 —— 详见 systems/cultivation.js cultivatorLimit()。
 *   innateBirthMult    凡人生育中诞生天生灵根的倍率
 *   mineDeathMult      灵脉矿场矿工死亡倍率
 *   mineYieldMult      灵脉矿场出石倍率
 *   territoryYieldMult 领地赋税/材料产出倍率（乘法叠加）
 *   territoryHoldMult  领地镇守所需战力的倍率（越低越省人）
 *   garrisonCapFlat    可同时镇守的领地数 +N
 *   exploreSurviveBonus 洞天生还率加成（加到生还率上）
 *   breakBonusFlat     大境界冲关成功率加成（加到成功率上）
 *   tradeStoneMult     坊市银两→灵石 的兑率倍率（城市越强，换得越多）
 *   cityMaterialMult   城中作坊（药圃/矿寮/纸坊）的产出倍率
 *   runeBenchFree      符台等级 +N（免费升阶，不花灵石银两）
 *   alchemyRateBonus   炼丹成功率加成
 *
 * 成本口径：cost 是**银两**，stones 是**灵石**。两者都必须付。
 * 设计上灵石是主门槛（银两只是「城里拿得出这笔钱」的资格线），
 * 因为银两在中期会撞上限，灵石才是真正稀缺的那一种。
 */

const IMMORTAL_TECH_TIERS = [
  { tier: 1, name: '一 · 开脉', hint: '破障之后，先要能养得住人' },
  { tier: 2, name: '二 · 筑基', hint: '立起根基，方谈攻守' },
  { tier: 3, name: '三 · 结丹', hint: '一丹既成，术法始有锋芒' },
  { tier: 4, name: '四 · 元婴', hint: '神通离体，山川皆可往来' },
  { tier: 5, name: '五 · 化神', hint: '化神之后，族与城都不必再分开算' },
];

const IMMORTAL_TECHS = [
  /* ══════════════ 一 · 开脉 ══════════════ */
  {
    id: 'kaimai',
    name: '开脉',
    icon: '脉',
    tier: 1,
    cost: 3000,
    stones: 12,
    requires: [],
    effect: { immortalCapMult: 0.50, mineYieldMult: 0.25 },
    desc: '把祛障散出来的那口浊气理顺，替后来者把经脉先开一寸。'
      + '名册能多挂一百五十人，山里的矿脉也认得出谁是自家人。',
  },
  {
    id: 'yinling',
    name: '引灵',
    icon: '引',
    tier: 1,
    cost: 4500,
    stones: 18,
    requires: [],
    effect: { innateBirthMult: 0.6, cityMaterialMult: 0.25 },
    desc: '在祠堂后园起一座引灵台，把山中逸散的灵气往族里引。'
      + '灵根落进婴儿身上的机会多些，园里种的药也长得壮些。',
  },
  {
    id: 'lingtian',
    name: '灵田',
    icon: '畦',
    tier: 1,
    cost: 6000,
    stones: 25,
    requires: ['tuntian', 'yinling'],
    unlocksBuilding: 'herbhouse',
    effect: { cityMaterialMult: 0.5 },
    desc: '屯田的法子搬到灵田上用——引灵台的水先浇过一遍，'
      + '再分畦种药。从此族中自有的药材不必全指着山外那几处商路。',
  },

  /* ══════════════ 二 · 筑基 ══════════════ */
  {
    id: 'zhuji',
    name: '筑基之道',
    icon: '筑',
    tier: 2,
    cost: 12000,
    stones: 45,
    requires: ['kaimai', 'lingtian'],
    effect: { breakBonusFlat: 0.06, immortalCapMult: 0.35 },
    desc: '把炼气九层冲关的那一步讲明白，写成册子发给全族。'
      + '此后冲关不再是各人摸黑，成功率高出一截。'
      + '——册子里头一半讲的是「药从哪来」，所以它要灵田先立起来。',
  },
  {
    id: 'lingxu',
    name: '灵枢',
    icon: '枢',
    tier: 2,
    cost: 15000,
    stones: 55,
    requires: ['yinling'],
    effect: { innateBirthMult: 0.9, mineDeathMult: -0.35 },
    desc: '灵枢者，一身气机之总汇。教族人调息、教矿工换气——'
      + '生下来的孩子资质好些，死在矿下的人也少些。',
  },
  {
    id: 'zhenyue',
    name: '镇岳',
    icon: '岳',
    tier: 2,
    cost: 18000,
    stones: 70,
    requires: ['kaimai'],
    effect: { territoryHoldMult: -0.30, garrisonCapFlat: 2 },
    desc: '镇守一地，不必以力压人。立祠、定契、许以岁给，'
      + '凡人自会替你看着这片山——守一处所需的人手因此少三成。',
  },
  {
    id: 'danfang',
    name: '药圃联营',
    icon: '炉',
    tier: 2,
    cost: 21000,
    stones: 85,
    requires: ['lingtian', 'lingxu'],
    effect: { cityMaterialMult: 0.70, alchemyRateBonus: 0.05 },
    // 【用户实测 2026-10-11】原来叫「丹药房」，读起来像「研习了它才能开丹房」——
    //   那是错的：**炼丹完全不需要任何科技**（占下一块领地就开炉，见 data/alchemy.js
    //   的丹方表，只有凝丹丸/九转丹才带科技前置）。用户的选择就是「炼丹完全脱离科技线」，
    //   所以这里改成纯粹的**产线加成**，名字也不再暗示解锁。
    desc: '把药圃、丹炉、库房排到一条线上：采下来就入炉，出炉就上架。'
      + '（炼丹本身不需要任何科技 —— 占下一块领地就能开炉；这一条只让产线更顺、成功率更高。）',
  },

  /* ══════════════ 三 · 结丹 ══════════════ */
  {
    id: 'yujian',
    name: '御剑术',
    icon: '剑',
    tier: 3,
    cost: 26000,
    stones: 110,
    requires: ['zhenyue'],
    effect: { breakBonusFlat: 0.05, familyPowerMult: 0.20 },
    desc: '剑修入门的那一手。族中子弟学过之后，'
      + '出门不必再带一队人——一个人就是一队人。',
  },
  {
    id: 'qidao',
    name: '器道',
    icon: '锻',
    tier: 3,
    cost: 29000,
    stones: 125,
    requires: ['danfang'],
    effect: { cityMaterialMult: 0.45, alchemyRateBonus: 0.04 },
    desc: '矿寮敲出来的碎料，原本大半是废的。器道一成，'
      + '同一批料能多出几件趁手的家伙——城外的碎石也就有了去处。',
  },
  {
    id: 'xuanhu',
    name: '悬壶',
    icon: '壶',
    tier: 3,
    cost: 30000,
    stones: 130,
    requires: ['lingxu'],
    unlocksBuilding: 'minestop',
    effect: { cityMaterialMult: 0.35 },
    desc: '丹道里最不起眼的一路：不炼长生丹，只炼救人的药。'
      + '族中设一壶堂，凡人病了有药、伤了有医，做工的手也就稳了。',
  },
  {
    id: 'julingzhen',
    name: '聚灵阵',
    icon: '阵',
    tier: 3,
    cost: 33000,
    stones: 150,
    requires: ['lingxu'],
    effect: { trainMult: 0.15, runeBenchFree: 1 },
    desc: '以三十六块引灵石为眼，圈住一方灵气。'
      + '人在阵中闭关，一日抵得两日；画符的案子也连上了阵眼，不必另起炉灶。',
  },

  /* ══════════════ 四 · 元婴 ══════════════ */
  {
    id: 'jindan',
    name: '金丹大道',
    icon: '丹',
    tier: 3,
    cost: 52000,
    stones: 260,
    requires: ['yujian', 'julingzhen', 'zhuji'],
    effect: { breakBonusFlat: 0.08, alchemyRateBonus: 0.08 },
    unlocksPill: 'ningdan',
    unlocksPillName: '凝丹丸',
    desc: '气凝成丹的关窍，连同炉温火候一并写定。'
      + '丹房从此少炸几炉，冲关的人也总算有依凭。',
  },
  {
    id: 'fudi',
    name: '福地',
    icon: '福',
    tier: 3,
    cost: 46000,
    stones: 230,
    requires: ['qidao'],
    effect: { cityMaterialMult: 0.60, innateBirthMult: 0.35 },
    desc: '把城外的几处泉眼、风口、土坡圈起来，按地势改一改。'
      + '一方水土养一方人——作坊出得多了，孩子生下来也带着点灵气。',
  },
  {
    id: 'tanxue',
    name: '探穴',
    icon: '穴',
    tier: 3,
    cost: 41000,
    stones: 210,
    requires: ['xuanhu'],
    // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「涉及文件」】
    // 目的：给线索经济补上**可再生**的那条腿（原来只有 SECRETS 一次性 20 条）。
    // 数值出处：docs/91 T-0 供给侧表 —— 探穴 0.0002 条/秒 = 0.72 条/时，
    // 44.6 小时产出 32 条。与「探穴」语义一致（它本来就面向洞天）。
    effect: { mineYieldMult: 0.30, exploreSurviveBonus: 0.04, cluePerSecFlat: 0.0002 },
    desc: '悬壶的医者最先学会的是看人，其次就是看地——'
      + '哪一处山腹可以进、哪一处进去就出不来。',
  },
  {
    id: 'dongfu',
    name: '洞府',
    icon: '府',
    tier: 4,
    cost: 58000,
    stones: 300,
    requires: ['xuanhu', 'julingzhen'],
    effect: { exploreSurviveBonus: 0.06, territoryYieldMult: 0.20 },
    desc: '在灵脉上头凿一处洞府，前接商路、后倚山险。'
      + '出门探洞天的人有个退路，守在山里的领地也多出一份出息。',
  },
  {
    id: 'lingmai',
    name: '灵脉感应',
    icon: '脉',
    tier: 4,
    cost: 66000,
    stones: 340,
    requires: ['seeker', 'zhenyue'],
    unlocksBuilding: 'spiritmine',
    effect: { mineYieldMult: 0.45, cityMaterialMult: 0.45 },
    desc: '寻龙尺终究只是凡器。感应既成，闭目便知哪一处山腹里有光——'
      + '城里可以正经开一座灵石矿场，不必再靠零星探脉。',
  },

  /* ══════════════ 五 · 化神 ══════════════ */
  {
    // ⚠ 故意**没有** unlocksBuilding：仙凡坊市由凡人侧的「仙凡互市」解锁。
    //   一座建筑只能有一个解锁科技，而「仙家肯开市」这件事
    //   更应该由城里的那条线来兑现 —— 界墟给的是兑率与消息，不是铺面。
    //   （这条约束由 smoke.mjs 的「解锁建筑类科技都有配套的真实建筑（双向对齐）」守着。）
    id: 'jiexu',
    name: '界墟',
    icon: '墟',
    tier: 5,
    cost: 120000,
    stones: 720,
    requires: ['lingmai', 'yuanying'],
    // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「涉及文件」】
    // 数值出处：docs/91 §十二.4「裁决 ④ · 参悟口径」（**不是** §三 T-0 那张旧表）。
    //   旧表把「参悟」按 10 本算 ⇒ 需求 59、余量 +56%；实测是 24 本 × 2 = 48，
    //   旧口径的 +56% **已被设计师撤回**（§十二.4 明令禁止再复述该数字）。
    // 现口径：`见 12.4` 的层级表 —— 硬需求 28、硬需求+洞天 39、一遍全参悟 87、满级 240。
    //   本节点由 0.00025 提到 **0.0004**（+0.54 条/时）：慢路 2.16 条/时 →
    //   全期 20 + 96.3 = 116.3 ⇒ vs 一遍全参悟 87 为 **+34%**（§十二.4 的 P1 建议，紧张点消失），
    //   vs 硬需求 28 为 +315%。**不改变「投帖是加速器、不是必经之路」的定位**（不投帖仍有 +34%）。
    effect: { tradeStoneMult: 0.6, secretChance: 0.02, cluePerSecFlat: 0.0004 },
    desc: '云深谷那头的坊市终于认了本家的字号。'
      + '银钱过手能换回更多灵石，往来的人也捎带些不该说的风声。',
  },
  {
    id: 'yuanying',
    name: '元婴大道',
    icon: '婴',
    tier: 5,
    cost: 92000,
    stones: 520,
    requires: ['jindan', 'dongfu'],
    effect: { breakBonusFlat: 0.10, immortalCapMult: 0.50, trainMult: 0.20 },
    desc: '元婴出窍，从此不惧一城一地的得失。'
      + '这篇道书传给全族，闭关的效率也就跟着上了一层。',
  },
  {
    id: 'lingzhi',
    name: '灵植术',
    icon: '植',
    tier: 5,
    cost: 98000,
    stones: 560,
    requires: ['fudi', 'yuanying'],
    effect: { cityMaterialMult: 0.80, innateBirthMult: 0.30 },
    desc: '药圃里那一套「引灵台的水先浇过一遍」的土法子，'
      + '到这里才成了学问：一株药该在什么时辰采、配哪一路灵气，都有定数。',
  },
  {
    id: 'jiuzhuan',
    name: '九转丹房',
    icon: '转',
    tier: 5,
    cost: 118000,
    stones: 680,
    requires: ['lingzhi', 'jiexu', 'tanxue'],
    effect: { alchemyRateBonus: 0.10, cityMaterialMult: 0.50 },
    unlocksPill: 'jiuzhuandan',
    unlocksPillName: '九转丹',
    desc: '九转之意不在次数，而在「每一转都换一味主药」。'
      + '炼到第九转，整座城的药圃都成了这炉丹的药引。',
  },
  {
    id: 'zhoutian',
    name: '周天搬运',
    icon: '周',
    tier: 5,
    cost: 105000,
    stones: 620,
    requires: ['dongfu', 'lingmai'],
    effect: { territoryYieldMult: 0.35, mineYieldMult: 0.35 },
    desc: '把周天星斗的走势与山川的走势对上，气便在两地之间自流。'
      + '领地赋税与矿场出石，都随之厚了一层。',
  },
  {
    id: 'huashen',
    name: '化神大道',
    icon: '神',
    tier: 5,
    cost: 165000,
    stones: 1050,
    requires: ['yuanying', 'jiexu'],
    effect: { breakBonusFlat: 0.12, immortalCapMult: 0.80 },
    desc: '化神那一关，前人多半死在这里。这一篇把前面几道门槛的得失'
      + '合在一处讲——名册上能挂的人也多出二百五十。',
  },
  {
    id: 'jielu',
    name: '结庐',
    icon: '庐',
    tier: 5,
    cost: 200000,
    stones: 1500,
    requires: ['zhuji', 'huashen', 'zhoutian', 'jiuzhuan'],
    terminal: true,
    effect: { territoryHoldMult: -0.25, territoryYieldMult: 0.30, tradeStoneMult: 0.4 },
    desc: '化神之后，人已经不必住在城里了。在山中结一座草庐，'
      + '四野的灵气、赋税、矿脉自来——族里只需把契书续上。'
      + '这一篇的要诀是「以约代力」，所以它仍要回看筑基那本册子。',
  },
];

const IMMORTAL_TECH_MAP = Object.fromEntries(IMMORTAL_TECHS.map((t) => [t.id, t]));

/**
 * 仙道科技的效果键 → 展示文案。
 *
 * ⚠ 与凡人侧的 EFFECT_LABELS **共用同一张表**（见 techs.js 末尾的合并），
 *   所以这里不重复定义，只在这里声明命名约定：键名一律可读，
 *   不出现 x1 / m2 这种缩写。
 */

/** 一项仙道科技的全部收益文案。 */
function immortalTechGainText(tech, buildingName, pillName) {
  const out = [];
  if (tech.unlocksBuilding) out.push(`解锁营造「${buildingName || tech.unlocksBuilding}」`);
  if (tech.unlocksPill) out.push(`解锁丹方「${pillName || tech.unlocksPill}」`);
  for (const [key, val] of Object.entries(tech.effect || {})) {
    if (EFFECT_LABELS[key]) out.push(EFFECT_LABELS[key](val));
  }
  return out;
}
