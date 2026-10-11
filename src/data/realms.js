
/* ────────────────────────────────────────────────────────────────
 * 区块：境界表（凡人 → 化神）
 * 职责：整个游戏的境界真相源。境界名、修为曲线、战力曲线、突破门槛都在这里。
 *       systems/cultivation.js 只负责「按时涨修为」，涨多少由这张表决定。
 * 依赖：无（纯数据 + 纯查表函数，不读 state）
 * 调参：
 *   REALM_XP_RATE —— 全局节奏总旋钮。改它等于把所有境界的时长等比缩放。
 *   每个 tier 的 xpBase —— 该境界「一层」的修为基数，曲线是 xpBase × 层号²。
 *   每个 tier 的 powerFrom / powerGrowth —— 该境界的战力锚点与境内增速。
 *   REALM_GATES —— 大境界的突破门槛（材料 / 成功率 / 失败惩罚）。
 * 文档：docs/10-境界与突破.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 修为增长的基础速率（点/秒，天赋 1、无功法时）。
 *
 * 这是整个游戏节奏的总旋钮。当前取值 1.0 对应：
 *   炼气一层 → 九层 约 2.5 小时（8 次自动晋升）
 *   凡人 → 化神圆满 约 44 小时（含 4 次大境界突破）
 * 想让整局快一倍就填 2.0，慢一倍就填 0.5。
 */
const REALM_XP_RATE = 1.0;

/**
 * 境界的五个大档。
 *
 * stages        小境界名（长度决定这一档占几个 realmIndex）
 * xpBase        该档「第 1 层」的修为基数；第 n 层需要 xpBase × n²
 * powerFrom     该档第 1 层的单人名基础战力
 * powerGrowth   该档内每上一层的战力倍率
 *
 * ⚠️ 改 stages 的长度会自动改变后面所有境界的 realmIndex，
 *    存档靠 realmIndex 定位，所以**不要在版本之间改动已有档的层数**。
 *    要加新档就往数组末尾加（例如以后加「炼虚」「合体」）。
 */
const REALM_TIERS = [
  {
    id: 'qi', name: '炼气',
    stages: ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层'],
    xpBase: 45, powerFrom: 10, powerGrowth: 1.65,
    desc: '引气入体，祛凡俗之障。此境尚无瓶颈，修为到了自然晋阶。',
  },
  {
    id: 'zhuji', name: '筑基',
    stages: ['初期', '中期', '后期', '圆满'],
    xpBase: 480, powerFrom: 1200, powerGrowth: 1.8,
    desc: '筑道基，寿元渐长。自此每进一步都要冲关，冲不过去便原地打转。',
  },
  {
    id: 'jindan', name: '金丹',
    stages: ['初期', '中期', '后期', '圆满'],
    xpBase: 840, powerFrom: 20000, powerGrowth: 1.9,
    desc: '气凝成丹，可离体斗法。家族要开始为一位金丹修士供养大量凡人。',
  },
  {
    id: 'yuanying', name: '元婴',
    stages: ['初期', '中期', '后期', '圆满'],
    xpBase: 1440, powerFrom: 500000, powerGrowth: 2.0,
    desc: '元婴出窍，肉身可弃。此境的修士已不太把凡人放在眼里。',
  },
  {
    id: 'huashen', name: '化神',
    stages: ['初期', '中期', '后期', '圆满'],
    // ⚠️ 化神是本版的最后一档，「圆满」就是终点，所以这一档只有 3 次晋升
    //    （初期→中期→后期→圆满），比前面几档少一次。
    //    xpBase 因此调得比等差数列更大，才能让这一档仍占设计里的 ~18 小时。
    xpBase: 4630, powerFrom: 15000000, powerGrowth: 2.1,
    desc: '神游太虚，一念千里。走到这一步，凡尘的账就该算总账了。',
  },
];

/**
 * 大境界的突破门槛。
 *
 * 键 = **突破前的 realmIndex**（该大档的最后一层）。
 * 例：键 9 是「炼气九层」，突破后进入 index 10「筑基初期」。
 *
 * pill            必需的丹药 id（见 data/alchemy.js 的 ALCHEMY_RECIPES）
 * stones / clues  每次尝试消耗（失败也扣）
 * baseRate        基础成功率；天赋、灵根与失败累积会在此基础上加成
 * failLoss        失败后修为回退的比例（相对本层所需）
 *
 * R5 回填：原来这四个门槛的灵石数是暂定值（20/80/300/800），
 * 因为当时没有丹药。炼丹上线后改成「以丹药为主、灵石为辅」——
 * 丹药来自地图上已占领的势力节点，所以**想突破就得先打通商路**。
 */
/**
 * 【策划 C4 / 任务 T-5】`requiresSite`：这道门槛必须先「择地」才能冲。
 * 出处：docs/91-落地任务清单.md §三 T-5 涉及文件（`REALM_GATES[9]` 加 `requiresSite: true`）。
 * ⚠ 只加这一个开关，既有的 stones / clues / pill / baseRate / failLoss **一个都没动**
 *   （docs/91 §八 非目标 3 明确要求）。
 */
const REALM_GATES = {
  /* ── 【策划 C16 / 任务 T-9】四段念白（before / during / win / lose）────────
   * 每段第一句用【…】标出它对应的数值口径，便于复核逐条对照：
   *   before → 门槛材料与 baseRate；during → 成率；win → 新境界；lose → 回退与补偿。 */
  9: {
    toTier: 'zhuji', stones: 8, clues: 2, pill: 'zhuji', baseRate: 0.55, failLoss: 0.35, requiresSite: true,
    rites: {
      before: (c) => `【门槛 8 灵石 / 2 线索 / 一枚筑基丹】你把族人唤到堂前，取出一枚筑基丹。`
        + `此去要把道基压进一块地里，压错了还有退路 —— 只是那退路很贵。`,
      during: (c) => `【成率 ${Math.round((c.rate ?? 0.55) * 100)}%】坛上火起，药力顺着经脉往下走。`
        + `你数着自己的呼吸，一直到再也数不清。`,
      win: (c) => `【晋 ${c.to || '筑基初期'}】地气涌上来，那口气终于有了根。`
        + `从此路上多了一块石头，谁也搬不动它。`,
      lose: (c) => `【回退 ${c.loss ?? '?'} 点 · 下次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%`
        + `${c.failures > 1 ? `（已累计 +${Math.round(c.failures * (c.mercy ?? REALM_FAIL_MERCY) * 100)}%）` : ''}】`
        + `${c.miss ? `差在${RITE_MISS_WORDS[c.miss] || '天时'}上 —— ` : ''}`
        + `药力散了，道基没能落地，修为退回 ${c.loss ?? '?'} 点。`
        + `好在天地留了一线：下一次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%。`,
    },
  },
  13: {
    toTier: 'jindan', stones: 30, clues: 4, pill: 'jindan', baseRate: 0.42, failLoss: 0.40,
    rites: {
      before: (c) => `【门槛 30 灵石 / 4 线索 / 一枚金丹】气已足，只差把它压实。`
        + `丹成则离体斗法，丹败则前功尽弃 —— 这一炉火，你只能点一次。`,
      during: (c) => `【成率 ${Math.round((c.rate ?? 0.42) * 100)}%】丹田里那一团气开始转，越转越紧。`
        + `你不敢动，连念头都压着。`,
      win: (c) => `【晋 ${c.to || '金丹初期'}】气凝成丹，落进丹田时响了一声。`
        + `此后一念可离身，凡尘的事，忽然都轻了。`,
      lose: (c) => `【回退 ${c.loss ?? '?'} 点 · 下次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%`
        + `${c.failures > 1 ? `（已累计 +${Math.round(c.failures * (c.mercy ?? REALM_FAIL_MERCY) * 100)}%）` : ''}】`
        + `${c.miss ? `差在${RITE_MISS_WORDS[c.miss] || '天时'}上 —— ` : ''}`
        + `那一团气在最后一刻散了，修为倒退 ${c.loss ?? '?'} 点。`
        + `丹炉还热着，下一次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%。`,
    },
  },
  17: {
    toTier: 'yuanying', stones: 120, clues: 8, pill: 'yuanying', baseRate: 0.30, failLoss: 0.45,
    rites: {
      before: (c) => `【门槛 120 灵石 / 8 线索 / 一枚元婴丹】丹已凝，接着要在丹里养出一个自己。`
        + `养得成，你便有两条命；养不成，连原来这条都要薄几分。`,
      during: (c) => `【成率 ${Math.round((c.rate ?? 0.30) * 100)}%】丹中隐约有个人形坐着，眉眼还不清。`
        + `你看它，它也在看你。`,
      win: (c) => `【晋 ${c.to || '元婴初期'}】那小人睁了眼，从丹田里站起来。`
        + `肉身忽然成了身外之物 —— 这是第一次，你不太把凡人放在眼里了。`,
      lose: (c) => `【回退 ${c.loss ?? '?'} 点 · 下次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%`
        + `${c.failures > 1 ? `（已累计 +${Math.round(c.failures * (c.mercy ?? REALM_FAIL_MERCY) * 100)}%）` : ''}】`
        + `${c.miss ? `差在${RITE_MISS_WORDS[c.miss] || '天时'}上 —— ` : ''}`
        + `那小人始终没能成形，散回气里，修为倒退 ${c.loss ?? '?'} 点。`
        + `下一次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%。`,
    },
  },
  21: {
    toTier: 'huashen', stones: 300, clues: 14, pill: 'huashen', baseRate: 0.20, failLoss: 0.50,
    rites: {
      before: (c) => `【门槛 300 灵石 / 14 线索 / 一枚化神丹】元婴已足，再往上就是神游太虚。`
        + `走到这一步，凡尘的账该算总账了 —— 包括你自己欠下的。`,
      during: (c) => `【成率 ${Math.round((c.rate ?? 0.20) * 100)}%】神念离体，越走越远。`
        + `你回头看了一眼自己的肉身，它像一件旧衣裳。`,
      win: (c) => `【晋 ${c.to || '化神初期'}】一念千里，山河在脚下缩成一张图。`
        + `从此天地开始收你的账 —— 你越强，它越要收。`,
      lose: (c) => `【回退 ${c.loss ?? '?'} 点 · 下次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%`
        + `${c.failures > 1 ? `（已累计 +${Math.round(c.failures * (c.mercy ?? REALM_FAIL_MERCY) * 100)}%）` : ''}】`
        + `${c.miss ? `差在${RITE_MISS_WORDS[c.miss] || '天时'}上 —— ` : ''}`
        + `神念在半途断了，跌回肉身里，修为倒退 ${c.loss ?? '?'} 点。`
        + `下一次成率 +${Math.round((c.mercy ?? REALM_FAIL_MERCY) * 100)}%。`,
    },
  },
};

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C16 / 任务 T-9】冲关仪式：四次大境界冲关各四段念白
 *
 * 目标：冲关前 / 冲关中 / 成 / 败 四段，让「过场」成为全篇情绪的最高点。
 * 十六段（4 门槛 × 4 段）+ 结丹三档的失败念白三段 = 十九段。
 *
 * 三条硬约定（docs/91 §三 T-9）：
 *   ① **文字必须住在这里**，不许硬编码进 app.js —— 否则改文案要动渲染代码；
 *   ② 每段是**函数**（`(c) => string`），因为失败念白必须播报**可算的数字**
 *      （回退多少、下次成率 +8% 与累计值）。写成死字符串就没法播报；
 *   ③ 志书体：克制的白描，**不用感叹号**（docs/00 §4.9）。
 *
 * 每段都用一个 `【…】` 前缀标出**它对应哪个数值**（连击/成率/回退/补偿）——
 * 这既是给玩家的氛围，也是给复核者的索引。
 * ══════════════════════════════════════════════════════════════════ */

/** 失败的四种起因 → 念白里的那个「具体词」。
 *  ⚠ 验收标准 4 要求：缺丹药时含「丹」、修为不足时含「修为」——
 *    所以**起因词必须是数据**，不能在渲染层按字符串猜。 */
const RITE_MISS_WORDS = {
  pill: '丹', stones: '灵石', clues: '线索', site: '地基', xp: '修为', luck: '天时',
};

/**
 * 生成一段念白。
 * @param {number} index  晋升**前**的 realmIndex（9/13/17/21）
 * @param {'before'|'during'|'win'|'lose'} phase
 * @param {object} c     上下文：{name, from, to, rate, loss, next, failures, miss, extra}
 */
function riteOf(index, phase, c = {}) {
  const gate = REALM_GATES[index];
  const own = gate && gate.rites && gate.rites[phase];
  if (typeof own === 'function') return own(c);
  return '';
}

/** 对某个门槛取齐四段（给界面/测试用；不传 ctx 时给的是「模板文字」）。 */
function ritesOf(index, c) {
  return {
    before: riteOf(index, 'before', c),
    during: riteOf(index, 'during', c),
    win: riteOf(index, 'win', c),
    lose: riteOf(index, 'lose', c),
  };
}

/** 天赋对突破成功率的加成上限（天赋 1 + 这个数就到顶）。 */
const REALM_TALENT_BONUS_MAX = 0.25;
/** 每次失败给下一次累积的成功率补偿，避免连续倒运劝退。 */
const REALM_FAIL_MERCY = 0.08;
/** 成功率硬上限。 */
const REALM_RATE_MAX = 0.95;
/** 成功率硬下限 —— 再差的灵根也留一线，不至于永远冲不过去。 */
const REALM_RATE_MIN = 0.02;

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C14 / 任务 T-2b】寿元表（收窄版：只做上限 + 显示，不做老死）
 *
 * 尺度出处：docs/91-落地任务清单.md §三 T-2b「数值设计」——
 *   **1 游戏小时 = 25 年**，一周目 44.6 h = 1115 年；
 *   同表给的境界上限就是 80 / 120 / 300 / 700 / 1500 / 3000。
 * 设计意图（同文档）：正常推进时寿元永远够用（「数字稳稳长大」），
 *   磨蹭到设计时长的 3–4 倍才会把余量吃干。**炼气期最紧（余 26%）是有意的** ——
 *   新手区就该有紧迫感，而炼气期修士很容易卡在九层等线索、等丹药。
 * ⚠ 本表**不产生任何惩罚**：没有老死、没有冲关 ±8pp、不进轮回门槛。
 * ══════════════════════════════════════════════════════════════════ */

/** 每游戏小时折合的「年」数。出处：docs/91 §三 T-2b（1 h = 25 年）。 */
const YEARS_PER_GAME_HOUR = 25;

/** 各大档的寿元上限（年）。键是大档 id，凡人单列。 */
const REALM_LIFESPAN = {
  mortal: 80,
  qi: 120,
  zhuji: 300,
  jindan: 700,
  yuanying: 1500,
  huashen: 3000,
};

/** 某个 realmIndex 的寿元上限（年）。凡人（index 0）取 mortal 那一档。 */
function realmLifespan(index) {
  const info = realmInfo(index);
  return REALM_LIFESPAN[info.tierId] || REALM_LIFESPAN.mortal;
}

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C4 / 任务 T-5】择地筑基：品阶表 + 五行地气词条
 *
 * 数值出处：docs/91-落地任务清单.md §三 T-5「数值设计」：
 *   品阶由地块 tier 推导（黄 1.00 / 玄 1.10 / 地 1.25 / 天 1.50），
 *   已占领**且**有效镇守再晋一档；
 *   五条地气词条各接一个已存在的消费点，基准值 +8pp / −30% / +8pp / +50% / +25%，
 *   相合 ×1.5、相冲 ×0.6、地块丢失再 ×0.5。
 * ⚠ 相合判定用 **person.root.elements[0]（灵根主系）**，不是主修功法系别 ——
 *   因为 data/roots.js 的 MANUAL_DAO_ELEMENT 里木系没有功法，木系永远无法相合
 *   （docs/91 §七.3 第 3 条）。
 * ══════════════════════════════════════════════════════════════════ */

/** 品阶表：tier 1..4 → 黄/玄/地/天。出处：docs/91 §三 T-5 品阶倍率表。 */
const FOUNDATION_GRADES = [
  { tier: 1, id: 'huang', name: '黄品', mult: 1.00 },
  { tier: 2, id: 'xuan', name: '玄品', mult: 1.10 },
  { tier: 3, id: 'di', name: '地品', mult: 1.25 },
  { tier: 4, id: 'tian', name: '天品', mult: 1.50 },
  { tier: 5, id: 'xian', name: '仙品', mult: 1.65 },
];
const FOUNDATION_GRADE_MAP = Object.fromEntries(FOUNDATION_GRADES.map((g) => [g.tier, g]));

/** 据点丢失（或镇守不足）时，词条效果减半。出处：docs/91 §三 T-5 验收标准 7。 */
const FOUNDATION_LOST_MULT = 0.5;
/** 相合 / 相冲倍率。出处：docs/91 §三 T-5「相合 / 相冲的判定依据」。 */
const FOUNDATION_MATCH_MULT = 1.5;
const FOUNDATION_CLASH_MULT = 0.6;

/**
 * 五行相克：`克者 → 被克者`（金克木、木克土、土克水、水克火、火克金）。
 * 出处：docs/91 §三 T-5（原文列的就是这一张表）。
 */
const ELEMENT_CLASH = { metal: 'wood', wood: 'earth', earth: 'water', water: 'fire', fire: 'metal' };

/**
 * 五条地气词条。`pp` 表示「加 N 个百分点」，`pct` 表示「乘 (−N%)」——
 * 两条口径分开写，免得界面与结算各写一套。
 * 每个 id 的消费点（docs/91 §三 T-5 验收标准 4）：
 *   mu   → systems/alchemy.js     recipeRate()      （+8pp 炼丹成功率）
 *   jin  → systems/forge.js       wearArtifacts()   （−30% 耐久损耗）
 *   shui → systems/manuals.js     caveSurvival()    （+8pp 洞天生还率）
 *   huo  → systems/runes.js       runeExpiresIn()   （+50% 符箓保质期）
 *   tu   → systems/exploration.js mapYieldOf()      （+25% 领地赋税与材料）
 *
 * ⚠ 键名用 `data/roots.js` 的 ROOT_ELEMENTS 口径（metal/wood/water/fire/earth），
 *   **不是拼音**。这样 `person.root.elements[0]` 与 `node.earthQi` 可以直接比较，
 *   不必在两套命名之间来回翻译 —— 那是「相合判定永远是 neutral」这类静默失败的温床。
 */
const EARTH_QI = {
  wood:  { id: 'wood',  name: '木', kind: 'herb',  pp: 0.08, pct: 0,     label: '炼丹成功率 +8 个百分点' },
  metal: { id: 'metal', name: '金', kind: 'forge', pp: 0,    pct: -0.30, label: '法器耐久损耗 −30%' },
  water: { id: 'water', name: '水', kind: 'cave',  pp: 0.08, pct: 0,     label: '洞天生还率 +8 个百分点' },
  fire:  { id: 'fire',  name: '火', kind: 'rune',  pp: 0,    pct: 0.50,  label: '符箓保质期 +50%' },
  earth: { id: 'earth', name: '土', kind: 'land',  pp: 0,    pct: 0.25,  label: '领地赋税与材料 +25%' },
};
const EARTH_QI_IDS = ['wood', 'metal', 'water', 'fire', 'earth'];

/** 散功重修的冷却（游戏小时）与道心代价。出处：docs/91 §三 T-5「散功重修」表。 */
const FOUNDATION_DISSOLVE_HOURS = 3;
const FOUNDATION_DISSOLVE_MORALITY = -5;

/**
 * 地块品阶：由 tier 推导；`held` 为真时**晋一档**（已占领且有效镇守）。
 *
 * 出处：docs/91-落地任务清单.md §三 T-5 品阶表的最后一行「已占领 **且** 有效镇守 → 晋一档」。
 * ⚠ **晋一档允许越过天品**，所以表里有第 5 档「仙品 ×1.65」——
 *   否则「天品地块 + 已镇守」这个最难达成的组合反而**没有任何回报**，
 *   「能占下来就该占」这条正反馈就断了。越档倍率 = 天品 1.50 + 一档 0.15，
 *   与表中 1.00→1.10→1.25→1.50 的步长（0.10/0.15/0.25）接在同一量级上。
 */
function foundationGrade(tier, held) {
  const t = Math.max(1, Math.min(4, Math.floor(Number(tier) || 1)));
  const bonus = held ? 1 : 0;
  return FOUNDATION_GRADE_MAP[Math.min(5, t + bonus)];
}

/**
 * 地气与灵根主系的关系：'match' 相合 / 'clash' 相冲 / 'neutral' 无关。
 * 相合 = 主系与地气同属；相冲 = 主系克地气（金克木…）。
 */
function earthQiRelation(element, earthQi) {
  if (!element || !EARTH_QI[earthQi]) return 'neutral';
  if (element === earthQi) return 'match';
  return ELEMENT_CLASH[element] === earthQi ? 'clash' : 'neutral';
}

/**
 * 某人的道基词条倍率（已含品阶 / 相合相冲 / 地块丢失减半）。
 * 这是 T-5 唯一的「结算入口」：各消费点都调它，保证界面上写的与算的一致。
 */
function foundationEntryMult(person, site, siteHeld = true) {
  const f = person?.foundation;
  if (!f) return 1;
  // ⚠ 品阶必须**按当前地块状态重算**，不能只读落库时冻结的 `f.grade`：
  //   落库时那块地可能还没被占领（黄品），后来打下来了就该晋一档（玄品），
  //   反过来丢了地就该掉回去（并且再吃一次减半）。
  //   `f.grade` 只当作地块 id 失效时的兜底。
  const grade = site
    ? foundationGrade(site.tier, siteHeld)
    : (FOUNDATION_GRADE_MAP[f.grade] || FOUNDATION_GRADE_MAP[1]);
  const element = (person.root?.elements || [])[0] || null;
  // ⚠ 字段名是 `f.element`（落库时的形状：{ nodeId, element, grade }），
  //   不是 f.earthQi —— 写成后者会静默退化成「永远是 neutral ×1.0」。
  const rel = earthQiRelation(element, f.element);
  const relMult = rel === 'match' ? FOUNDATION_MATCH_MULT : rel === 'clash' ? FOUNDATION_CLASH_MULT : 1;
  const lost = siteHeld ? 1 : FOUNDATION_LOST_MULT;
  return grade.mult * relMult * lost;
}

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C6 / 任务 T-6】结丹：三档火候 + 丹纹档位表
 *
 * 数值出处：docs/91-落地任务清单.md §三 T-6「数值设计」：
 *   文火 +1 纹 / 95% / **止于 6 纹** / 无额外消耗；
 *   武火 +3 纹 / 55% / 上限 12 纹 / 1 药材 + 10 灵石；
 *   三昧真火 +6 纹 / 25% / 无上限 / 3 药材 + 60 灵石。
 * ⚠ **不许再用连续式均值估这三档**（docs/91 §十二.9 + 新规则 numeric-verification.md）：
 *   结算带 **cap**（文火止于 6）、**下限**（丹纹夹 0：0 纹时失败不掉纹）、**机会次数**（4 次），
 *   三者叠加会让连续式算错。以**实现的状态机精确枚举 2⁴ 条序列**为准：
 *     期望（护纹）：文火 **3.6575** / 武火 **5.80738125** / 真火 **5.33203125**
 *     期望（无护纹）：文火 3.65524375 / 武火 5.5846 / 真火 5.05078125
 *     ≥9 纹（五品）：文火 **0%** / 武火 **16.64%** / 真火 **26.17%**
 * ⚠ **真火不是「期望最低」的那个** —— 最低的是**文火 3.6575**。
 *   正确说法是：**在两个付费档之间**，真火主动**用均值换上限**
 *   （5.33203125 < 武火 5.80738125，但只有它没有 cap、能突破 12 纹）。
 *   （「真火期望最低」这个说法曾同时写错在注释与文档里，比较范围必须写清。）
 * ⚠ 武火的 ≥9 纹是 **16.64%** 而不是 0.55⁴ = 9.15%：还要算上
 *   「首败（0 纹不掉纹）+ 后三次全成 = 9 纹」那条 7.49% 的路径。
 * 丹纹档位表按「4 次尝试的真实分布」重排，五品门槛从点子库的 12 纹改成 **9 纹**
 *   （12 纹要 0.25⁴ = 0.39%，等于把后续内容锁死）。
 * ══════════════════════════════════════════════════════════════════ */

/** 金丹大档的 id —— 结丹只在这里可用。 */
const CORE_TIER_ID = 'jindan';
/** 结丹失败时记下的「一次护纹」的次数取值。**次数语义（0/1），不是百分点。**
 *  出处：docs/91 §十二.3 裁决 —— mercy 的语义是**护纹**（失败时抵消掉一纹的损失）。
 *  ⚠ 不许把它接进成率：接进去会让三档退化成两档（docs/91 §十二.3 的枚举表）。
 *  ⚠ 也别把它写成 0.12 那种百分点 —— 它是「有没有一次护纹」，取值只有 0 / 1。 */
const CORE_WARD_COUNT = 1;
/** @deprecated 数值补偿语义已废除（会崩三档平衡）。保留常量只为兼容旧存档里的
 *  `core.mercy` 标量读取；新代码一律用 `CORE_WARD_COUNT`。 */
const CORE_FAIL_MERCY = CORE_WARD_COUNT;

/** 三档火候。`cap` 为 null 表示无上限。 */
const CORE_FOLDS = [
  {
    id: 'wen', name: '文火', marks: 1, rate: 0.95, cap: 6,
    herb: 0, stones: 0,
    desc: '细火慢养，成算最高，但止于六纹（六品）—— 它买的是稳，不是高。',
    // 【策划 C16 / 任务 T-9】结丹失败的念白（三档各一段，共 19 段里的后 3 段）。
    //   第一句标出「这一档对应的成率」——它同时是氛围与复核索引。
    lose: (c) => `【${c.foldName || '文火'} 成率 ${Math.round((c.rate ?? 0.95) * 100)}%】火太缓，丹没凝住。`
      + `丹纹从 ${c.marksFrom ?? '?'} 落到 ${c.marksTo ?? '?'}。稳也是会输的，只是输得慢。`,
  },
  {
    id: 'wu', name: '武火', marks: 3, rate: 0.55, cap: 12,
    herb: 1, stones: 10,
    desc: '猛火逼丹，成算五成半；成则三纹，败则丹裂掉一纹。上限十二纹。',
    lose: (c) => `【武火 成率 55% · 耗 10 灵石 + 1 药草】火急了，丹皮先裂。`
      + `丹纹从 ${c.marksFrom ?? '?'} 落到 ${c.marksTo ?? '?'}`
      + `${c.warded ? '，好在上一炉留的护纹替你挡了这一下' : ''}。`,
  },
  {
    id: 'zhen', name: '三昧真火', marks: 6, rate: 0.25, cap: null,
    herb: 3, stones: 60,
    desc: '三火齐发，四分之一的机会一次六纹且没有上限 —— 只有它能突破十二纹。',
    lose: (c) => `【三昧真火 成率 25% · 耗 60 灵石 + 3 药草】三火齐发，丹没撑住。`
      + `丹纹从 ${c.marksFrom ?? '?'} 落到 ${c.marksTo ?? '?'}`
      + `${c.warded ? '，上一炉的护纹替你挡了这一下' : ''}。`
      + `它贵六倍、均值还更低 —— 你买的是那个没有上限的可能。`,
  },
];
const CORE_FOLD_MAP = Object.fromEntries(CORE_FOLDS.map((f) => [f.id, f]));

/** 丹纹档位表。出处：docs/91 §三 T-6「丹纹 → 品阶」。 */
const CORE_GRADES = [
  { min: 0,  max: 1,  grade: 9, name: '九品', power: 1.00, train: 1.00 },
  { min: 2,  max: 3,  grade: 8, name: '八品', power: 1.06, train: 1.04 },
  { min: 4,  max: 5,  grade: 7, name: '七品', power: 1.12, train: 1.08 },
  { min: 6,  max: 8,  grade: 6, name: '六品', power: 1.20, train: 1.12 },
  { min: 9,  max: 12, grade: 5, name: '五品', power: 1.30, train: 1.18 },
  { min: 13, max: 17, grade: 4, name: '四品', power: 1.42, train: 1.24 },
  { min: 18, max: 20, grade: 3, name: '三品', power: 1.54, train: 1.30 },
  { min: 21, max: 23, grade: 2, name: '二品', power: 1.66, train: 1.36 },
  { min: 24, max: Infinity, grade: 1, name: '一品', power: 1.80, train: 1.45 },
];

/** 丹纹 → 品阶档。超出表尾按一品处理（数学上限是 24）。 */
function coreGradeOf(marks) {
  const m = Math.max(0, Math.floor(Number(marks) || 0));
  for (const g of CORE_GRADES) if (m >= g.min && m <= g.max) return g;
  return CORE_GRADES[CORE_GRADES.length - 1];
}

/** 这个 realmIndex 是不是金丹档（结丹只在这里开放）。出处：docs/91 §三 T-6 验收标准 1。 */
function coreFoldableIndex(index) {
  const info = realmInfo(index);
  return Boolean(info.tier) && info.tier.id === CORE_TIER_ID;
}

/** 某人当前的丹纹状态（缺字段时退化为「零纹、未结丹」）。老存档没有 person.core。 */
function coreOf(person) {
  const c = person?.core;
  return {
    marks: Math.max(0, Math.floor(Number(c?.marks) || 0)),
    mercy: Math.max(0, Number(c?.mercy) || 0),
    used: c && typeof c.used === 'object' && c.used ? c.used : {},
  };
}

/** 该层是否已经结过丹（同一层最多一次）。 */
function coreUsedHere(person, index) {
  return Boolean(coreOf(person).used[String(index)]);
}

/* ── 索引表：由上面的表自动展开，避免手写 realmIndex ── */
/**
 * realmIndex 的含义：
 *   0      凡人
 *   1..9   炼气一~九层
 *   10..13 筑基初期~圆满
 *   14..17 金丹初期~圆满
 *   18..21 元婴初期~圆满
 *   22..25 化神初期~圆满
 *
 * @type {Array<{index:number,tierId:string,tierName:string,stageName:string,fullName:string,tier:object|null,local:number}>}
 */
const REALM_AT = [];
REALM_AT[0] = {
  index: 0, tierId: 'mortal', tierName: '凡人', stageName: '',
  fullName: '凡人', tier: null, local: 0,
};
let realmCursorEnd = 1;
{
  let cursor = 1;
  for (const tier of REALM_TIERS) {
    tier.startIndex = cursor;
    tier.endIndex = cursor + tier.stages.length - 1;
    tier.stages.forEach((stage, i) => {
      REALM_AT[cursor] = {
        index: cursor, tierId: tier.id, tierName: tier.name, stageName: stage,
        fullName: `${tier.name}${stage}`, tier, local: i + 1,
      };
      cursor += 1;
    });
  }
  realmCursorEnd = cursor - 1;
}
/** 当前版本能走到的最高境界。加新档时它会自动跟着变。 */
const REALM_MAX_INDEX = realmCursorEnd;
const REALM_TIER_MAP = Object.fromEntries(REALM_TIERS.map((t) => [t.id, t]));

/* ── 查表函数 ── */

/** 取某个 realmIndex 的完整信息；越界时夹到合法范围。 */
function realmInfo(index) {
  const i = Math.max(0, Math.min(REALM_MAX_INDEX, Math.floor(Number(index) || 0)));
  return REALM_AT[i] || REALM_AT[0];
}

/** 「筑基中期」这样的完整称谓。 */
function realmName(index) { return realmInfo(index).fullName; }

/** 该境界属于哪一大档（凡人的 tier 为 null）。 */
function realmTierOf(index) { return realmInfo(index).tier; }

/** 一个大档内部是第几层（炼气一层 = 1；凡人 = 0）。 */
function realmLocalOf(index) { return realmInfo(index).local; }

/**
 * 从 index 升到 index+1 需要多少修为。
 * 已到顶（化神圆满）返回 Infinity。
 */
function realmXpNeeded(index) {
  const info = realmInfo(index);
  if (!info.tier) return Infinity;
  if (info.index >= REALM_MAX_INDEX) return Infinity;
  return info.tier.xpBase * info.local * info.local;
}

/** 该境界的单人基础战力（不含功法、不含驻守加成）。 */
function realmPower(index) {
  const info = realmInfo(index);
  if (!info.tier) return 0;
  return info.tier.powerFrom * Math.pow(info.tier.powerGrowth, info.local - 1);
}

/**
 * 从 index 突破出去的门槛；没有门槛（同一大档内的小境界）返回 null。
 * 炼气九层之前都不会有。
 */
function realmGate(index) {
  const gate = REALM_GATES[index];
  if (!gate) return null;
  return { ...gate, fromIndex: index, fromName: realmName(index), toName: realmName(index + 1) };
}

/** 该境界是否已经顶到当前版本的尽头（化神圆满）。 */
function isRealmMax(index) { return Math.floor(Number(index) || 0) >= REALM_MAX_INDEX; }

/**
 * 突破成功率。
 * @param {number} index     当前境界
 * @param {number} talent    修士天赋
 * @param {number} failures  已连续失败次数（给补偿）
 * @param {number} rootBonus 灵根修正（见 systems/roots.js 的 rootBreakBonus）
 */
function realmBreakRate(index, talent, failures = 0, rootBonus = 0) {
  const gate = realmGate(index);
  if (!gate) return 1;
  const talentBonus = Math.min(REALM_TALENT_BONUS_MAX, Math.max(0, (Number(talent) || 1) - 1) * 0.25);
  const mercy = Math.max(0, Math.floor(failures) || 0) * REALM_FAIL_MERCY;
  const root = Number(rootBonus) || 0;
  return Math.max(REALM_RATE_MIN, Math.min(REALM_RATE_MAX, gate.baseRate + talentBonus + mercy + root));
}

/* ── 供文档与测试用的节奏数据 ── */

/**
 * 逐大境界的耗时预览（秒），按当前 REALM_XP_RATE、天赋 1、无功法计算。
 *
 * 用来核对「一周目总时长」是否落在设计区间里：
 *   node -e "…" 或在控制台 __xiuxian.realm.pacing()
 *
 * ⚠️ 这只是「足不出户闭关」的下限。实际会更快（功法倍率、宗门 3.5×），
 *    也会更慢（大境界冲关失败要重补修为）。
 */
function realmPacing() {
  const tiers = [];
  let total = 0;
  for (const tier of REALM_TIERS) {
    let secs = 0;
    for (let i = tier.startIndex; i <= tier.endIndex; i += 1) {
      const need = realmXpNeeded(i);
      if (!Number.isFinite(need)) continue;
      secs += need / REALM_XP_RATE;
    }
    total += secs;
    tiers.push({
      id: tier.id, name: tier.name,
      from: realmName(tier.startIndex), to: realmName(tier.endIndex),
      secs, cumulative: total,
      gate: realmGate(tier.endIndex),
    });
  }
  return { tiers, total };
}
