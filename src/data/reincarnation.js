
/* ────────────────────────────────────────────────────────────────
 * 区块：周目与金手指
 * 职责：轮回的门槛与结算、金手指表、以及每个金手指的规则改动与代价。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   REINCARNATION_MIN_INDEX  —— 修到哪一境界才允许轮回
 *   REINCARNATION_POINT_*    —— 轮回点的结算公式
 *   GOLDEN_FINGERS           —— 金手指表。每个都必须**同时**有 rule 与 price
 * 文档：docs/60-周目与金手指.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 轮回门槛：踏入化神初期（realmIndex 22）即可。
 *
 * 为什么不是化神圆满：圆满要跑满 44 小时，而轮回的意义是「再来一局」。
 * 让人在 26 小时左右就能选择重开，比逼他跑完更尊重他的时间。
 */
const REINCARNATION_MIN_INDEX = 22;

/** 轮回点结算。基础 1 点，其余按这一局的成就加。 */
const REINCARNATION_POINT_BASE = 1;
/** 每占领一块领地加多少点。 */
const REINCARNATION_POINT_PER_HOLD = 1;
/** 每收录这么多本功法加 1 点。 */
const REINCARNATION_POINT_PER_MANUALS = 5;
/** 最高境界每高出轮回门槛这么多级，加 1 点。 */
const REINCARNATION_POINT_PER_REALM = 1;

/**
 * 金手指。
 *
 * **设计原则：金手指改变的是「规则」，不是「数值」。**
 * 第二周目的体验应当与第一周目不同，而不是同样的游戏数字大一点。
 * 所以每一项都写成「解锁了一个第一周目不存在的做法」，并且**都必须有代价**——
 * 白送的金手指会让轮回变成纯粹的数值膨胀。
 *
 * cost  解锁需要花掉的轮回点
 * rule  它改变了什么规则（正面）
 * price 代价（负面）。每一项都必须有，否则测试会挂
 * fx    效果的实际数值，由 systems/reincarnation.js 读取
 */
const GOLDEN_FINGERS = [
  {
    id: 'bottle',
    name: '掌天瓶',
    subtitle: '韩立的小绿瓶',
    cost: 3,
    rule: '瓶中自成一方水土。**一切药材、矿料、符文的产出 ×2.5**——'
      + '别人等三个时辰才够一炉的料，你一个时辰就攒齐了。',
    price: '瓶不离身则修行分心：<b>全族修炼速度 −10%</b>。',
    lore: '一只不起眼的青色小瓶，瓶底积着一层碧绿的灵液。'
      + '第一世捡到它的人，到死都没弄明白那层液体是什么。',
    fx: { materialMult: 2.5, trainMult: 0.90 },
  },
  {
    id: 'ring',
    name: '戒中老者',
    subtitle: '一枚旧戒',
    cost: 4,
    rule: '指上旧戒里栖着一位残魂。**所有大境界冲关的成功率 +12 个百分点**，'
      + '而且他见过太多人死在关隘上，会把该走哪条路说得很清楚。',
    price: '残魂有所求：<b>每次冲关成功后，额外消耗一枚同阶丹药</b>。',
    lore: '戒面早磨得看不出纹样了。戴上它的第一夜，你会梦见一个背影在雾里站着。',
    fx: { breakBonus: 0.12 },
  },
  {
    id: 'memory',
    name: '前世记忆',
    subtitle: '醒着的梦',
    cost: 2,
    rule: '你记得这一世会发生什么。**开局即解锁三项基础科技，并已知晓两处洞天**，'
      + '不必再从头摸索。',
    price: '知其然而不知其所以然：<b>答题带来的增益减半</b>。',
    lore: '有些事你分明没做过，却知道下一步该往哪走。'
      + '族中老人说这是好兆头，你却没敢说自己记得他们每一个人的死期。',
    fx: { startTechs: ['realestate', 'architecture', 'finance'], startReached: ['mosscave', 'valley'] },
  },
  {
    id: 'luck',
    name: '气运加身',
    subtitle: '命不该绝',
    cost: 2,
    rule: '该塌的山洞不塌，该断的绳索不断。**洞天生还率 +15 个百分点**，'
      + '命中注定的那一口气总能吊住。',
    price: '气运不能两头占：<b>灵石产出 −20%</b>。',
    lore: '你活过了太多本该活不过的关口。到后来，连你自己都开始怀疑这是运气还是别的什么。',
    fx: { survivalBonus: 0.15, stoneMult: 0.80 },
  },
];
const GOLDEN_FINGER_MAP = Object.fromEntries(GOLDEN_FINGERS.map((g) => [g.id, g]));

/** 每周目最多同时携带几个金手指。 */
const GOLDEN_FINGER_SLOTS = 2;

/* ── 查表 ── */

function goldenFinger(id) { return GOLDEN_FINGER_MAP[id] || null; }

/** 元进度：跨周目保留的那一份。 */
function metaOf(state) {
  if (!state.meta || typeof state.meta !== 'object') {
    state.meta = { cycle: 1, points: 0, cleared: 0, unlocked: [], active: [], history: [] };
  }
  const m = state.meta;
  m.cycle = Math.max(1, Math.floor(Number(m.cycle) || 1));
  m.points = Math.max(0, Math.floor(Number(m.points) || 0));
  m.cleared = Math.max(0, Math.floor(Number(m.cleared) || 0));
  if (!Array.isArray(m.unlocked)) m.unlocked = [];
  if (!Array.isArray(m.active)) m.active = [];
  if (!Array.isArray(m.history)) m.history = [];
  // 清掉不再存在的 id
  m.unlocked = [...new Set(m.unlocked.filter((id) => GOLDEN_FINGER_MAP[id]))];
  m.active = [...new Set(m.active.filter((id) => GOLDEN_FINGER_MAP[id]))];
  return m;
}

/** 当前周目挂着的金手指定义列表。 */
function activeFingers(state) {
  return metaOf(state).active.map((id) => GOLDEN_FINGER_MAP[id]).filter(Boolean);
}

/** 把某个金手指的某一项效果加起来（同一项可能被多个金手指改）。 */
function fingerFx(state, key, fallback) {
  let v = fallback;
  for (const f of activeFingers(state)) {
    const x = f.fx?.[key];
    if (x === undefined) continue;
    // 倍率类相乘，加法类相加
    if (key.endsWith('Mult')) v *= x;
    else v += x;
  }
  return v;
}

/** 是否带了某个效果开关（比如「宗门永不收你族中人」）。 */
function fingerHas(state, key) {
  return activeFingers(state).some((f) => f.fx?.[key]);
}
