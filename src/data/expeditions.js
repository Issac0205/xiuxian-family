
/* ────────────────────────────────────────────────────────────────
 * 区块：寻仙探索（数据表）
 * 【凡人篇重构 I1 / 《凡人篇重构需求文档 v1.0》四、取消商队系统】
 *
 * 原来凡人侧只有一条「凡人商路」：交本钱 → 等 25 秒 → 领银两，
 * 外加 1% 的秘闻。用户判定「本质是挂机领奖励，与修仙世界观不符合」。
 *
 * 改成**派遣族人出门打探**：派出去的人这段时间不在族中，
 * 回来时带回秘闻（凡人接触仙道的唯一桥梁）、银两与见闻。
 *
 * 三条设计约定（改这张表前先读）：
 *   1. **银两是净支出**：cost 扣掉、silver 只回一部分 ⇒ 探索是秘闻的**代价**，
 *      不是印钞机。银两的正经来源始终是「人口 → 产业」（见 core/formulas.js）。
 *      否则「探索」会盖过整条经济线，变成唯一的最优解。
 *   2. **秘闻是主收益**，且**没有总量上限**（全局规则 S1：唯一来源不许封顶）。
 *      产出速率对齐原商路的量级（原为 0.01 × 科技加成），
 *      不能因为改了名字就把 10/15/20 三道门（坊市 / 寻龙尺 / 抽干池）变松或变卡。
 *   3. **风险只折损人**：派出 people 人，成功率之外的部分按 risk 折损（不返还）。
 *      风险递增 ⇒ 收益递增，但低风险那条永远能跑（不许出现「高风险跑不动就卡死」）。
 *
 * ⚠ id 一旦发布不许改名或删除（老存档的 expeditions 里按 id 记账），
 *   口径与 scripts/savecompat.mjs 第 ① 条一致。
 * ──────────────────────────────────────────────────────────────── */

/**
 * 探索地点。
 *   people     派出的人数（**从人口里扣**，回来时只返还存活的那部分）
 *   cost       本钱（银两，扣掉不返）
 *   silver     回来时带回的银两（**低于 cost** ⇒ 净支出）
 *   duration   全程多少「游戏秒」（按游戏秒记账，改倍速会自然跟着走）
 *   risk       折损率：派出去的人有这么多比例回不来
 *   secretChance 带回一条秘闻的基础概率（科技的 secretChance 加在这上面）
 */
const EXPEDITIONS = [
  {
    id: 'qingshan',
    name: '青山访闻',
    icon: '闻',
    tier: 1,
    desc: '族人往青山一带走村串镇，听山民闲谈、记茶棚闲话。路熟人多，最稳妥的一条。',
    people: 5,
    cost: 200,
    silver: 150,
    duration: 30,
    risk: 0.02,
    secretChance: 0.02,
    finds: '民间传闻、旧档残页',
  },
  {
    id: 'guji',
    name: '古迹探查',
    icon: '古',
    tier: 2,
    desc: '循着废观、断碑与旧县志里的地名翻找前朝遗迹。费钱费人，但翻得出真东西。',
    people: 12,
    cost: 800,
    silver: 620,
    duration: 90,
    risk: 0.06,
    secretChance: 0.07,
    finds: '古籍、修士遗迹线索',
  },
  {
    id: 'shenshan',
    name: '深山寻踪',
    icon: '踪',
    tier: 3,
    desc: '往人迹不到的深山里寻访踪迹。山里有不该有的东西，去的人未必都回得来。',
    people: 25,
    cost: 2000,
    silver: 1600,
    duration: 240,
    risk: 0.12,
    secretChance: 0.18,
    finds: '修士踪迹、洞府消息、灵物线索',
  },
];

const EXPEDITION_MAP = Object.fromEntries(EXPEDITIONS.map((e) => [e.id, e]));

/**
 * 一趟探索跑完，人数还剩多少（风险折损后的存活人数）。
 *
 * ⚠ 这是折损的**唯一实现**：归来结算（systems/expeditions.js 的 advanceExpeditions）
 *   也调它，不许在那边再抄一份 —— 抄两份的下场是「改了一处、另一处还是老数」，
 *   而这个项目的变异测试正是靠「改了必须变红」来抓这种事的。
 *
 * @param {number} n 实际派出去的人数（整批派遣 / 老档折算时可能不等于 def.people）
 */
function expeditionSurvivors(def, rng = Math.random, n = def.people) {
  const sent = Math.max(0, Number(n) || 0);
  const lost = sent * def.risk;
  // 折损按概率取整：小数部分按概率进位，保证「期望 = sent × risk」
  const whole = Math.floor(lost);
  const frac = lost - whole;
  return Math.max(0, sent - whole - (rng() < frac ? 1 : 0));
}
