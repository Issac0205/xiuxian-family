
/* ────────────────────────────────────────────────────────────────
 * 区块：天劫表（化神期的三次晋升）
 * 职责：**纯数据**。化神期的晋升不再是「点一下冲关」，而是一次「引雷」结算：
 *       基础雷伤 − 家族能卸掉的减免 = 实际雷伤，按实际雷伤分档。
 *       「准备到什么程度才安全」全部由这张表决定，逻辑在 systems/breakthrough.js。
 * 依赖：无（只有查表函数；减免来源的**取值**由 breakthrough.js 从各子系统读）
 * 调参：TRIBULATION_BASE 三档基础雷伤 → 决定「不准备必死」的门槛。
 * 文档：docs/91-落地任务清单.md §三 T-8
 *       （数值已按 docs/90 的勘误修正：领地只有 4 处可占领，不是 8 处）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 【策划 C11 / 任务 T-8】三次天劫的基础雷伤。
 * 键 = 晋升**前**的 `realmIndex`（22 化神初期 / 23 中期 / 24 后期）。
 * 出处：docs/91 §三 T-8「三次天劫的强度」——初期 6 / 中期 7 / 后期 9。
 */
const REALM_TRIALS = { 22: 6, 23: 7, 24: 9 };

/**
 * 减免来源表。**每一条都是已有的东西**（doc 明确：不新增任何货币或资源）。
 *
 * `per` 是每条来源的减免比例，`max` 是条数上限。
 * ⚠ 领地那一行是 4 而不是点子库原写的 8 ——
 *   `MAP_NODES` 里 `kind:'foe'`（可占领）的节点**只有 4 个**，
 *   另 4 个是 `kind:'cave'`（洞天，不可占领）。这是 docs/91 §七.3 的勘误第 1 条。
 */
const TRIBULATION_SOURCES = [
  {
    id: 'territory', name: '封地卸雷',
    per: 0.08, max: 4,
    desc: '每一处已占领且有效镇守的领地替你挡下一分雷意',
    cost: '该领地暂停赋税 1 小时',
  },
  {
    id: 'warden', name: '护法列阵',
    per: 0.06, max: 6,
    desc: '近境修士在雷下结阵，替你分担',
    cost: '护法者一小时内不做别的',
  },
  {
    id: 'artifact', name: '法器承雷',
    per: 0.10, max: 3,
    desc: '把法器送进雷里 —— 它们替你碎',
    cost: '天劫后法器耐久清零',
  },
  {
    id: 'rune', name: '护身符',
    per: 0, max: 1,
    desc: '一张护身符免去一道雷',
    cost: '一次性消耗',
  },
  {
    id: 'merit', name: '道心清白',
    per: 0.10, max: 1,
    desc: '道心 ≥ 70 —— 天道不罚善人',
    cost: '——',
  },
];

/** 道心修正的门槛与数值。
 *  ⚠ 符号约定：这一列是**减免**（正数 = 少挨雷）。
 *    我第一版把「善」写成 −0.10，于是道心清白反而让雷更重（静默反向）。
 *    出处：docs/91 §三 T-8 减免表（道心 ≥70 → −10% 雷伤；≤30 → +15% 雷伤）。 */
const TRIBULATION_MORALITY = {
  goodAt: 70, goodBonus: 0.10,
  evilAt: 30, evilBonus: -0.15,
};

/**
 * 实际雷伤的分档后果。键是档位 id，`upTo` 是上界（含）。
 * 出处：docs/91 §三 T-8 验收标准 4 ——
 *   0–3 无事 / 4–6 该修士 1 小时修炼 −50% / 7–8 修为回退 40% / 9+ 陨落。
 */
const TRIBULATION_TIERS = [
  { id: 'calm', upTo: 3, name: '雷息云散', desc: '此劫卸得干净，天地无言。' },
  { id: 'shaken', upTo: 6, name: '道体受震', trainMult: 0.5, trainHours: 1, desc: '雷意入了体，一时半刻提不起气。' },
  { id: 'broken', upTo: 8, name: '道基受损', xpLossRatio: 0.40, desc: '道基裂了一道缝，修为散去了四成。' },
  { id: 'perish', upTo: Infinity, name: '形神俱灭', perish: true, desc: '此劫有去无回。' },
];

/** 每几点缺口落一道雷（落到城里）。出处：docs/91 §三 T-8 验收标准 6。 */
const TRIBULATION_BOLT_PER = 2;
/** 每道落城之雷的人口损失比例。出处：同上（人口 ×0.5%）。 */
const TRIBULATION_BOLT_POP_LOSS = 0.005;
/** 陨落时留给家族的传承。出处：docs/91 §三 T-8 验收标准 5。 */
const TRIBULATION_INHERIT_CLUES = 10;

/** 取某次天劫的基础雷伤；不是天劫层（化神三次以外）返回 0。 */
function tribulationBase(index) { return Number(REALM_TRIALS[index]) || 0; }

/** 这一层是不是「要渡劫」的层。 */
function isTribulationRealm(index) { return tribulationBase(index) > 0; }

/**
 * 按实际雷伤取分档。
 * @param {number} damage 实际雷伤（已扣减免，四舍五入后的整数）
 */
function tribulationTierOf(damage) {
  const d = Math.max(0, Number(damage) || 0);
  for (const t of TRIBULATION_TIERS) if (d <= t.upTo) return t;
  return TRIBULATION_TIERS[TRIBULATION_TIERS.length - 1];
}

/** 缺口落到城里的雷数。出处：每 2 点缺口一道。 */
function tribulationBolts(damage) {
  return Math.max(0, Math.floor(Math.max(0, Number(damage) || 0) / TRIBULATION_BOLT_PER));
}
