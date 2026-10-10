
/* ────────────────────────────────────────────────────────────────
 * 区块：灵根规则
 * 职责：一个人有没有灵根、是什么灵根、这灵根带来什么。
 *       灵根的三个效果 —— 修炼速度、突破修正、境界上限 —— 都从这里出去，
 *       别的区块只调这几个函数，不直接读 data/roots.js 的表。
 * 依赖：data/roots.js（表）、data/realms.js（境界上限要用 REALM_MAX_INDEX 夹取）
 * 调参：数值全在 data/roots.js，本文件不含魔法数字。
 * 文档：docs/20-灵根.md
 * ──────────────────────────────────────────────────────────────── */

/** 取某人的灵根档定义；没有灵根的人退回最差档（不该发生，兜底用）。 */
function rootGradeOf(person) {
  const id = person?.root?.grade;
  return ROOT_GRADE_MAP[id] || ROOT_GRADE_MAP.pseudo;
}

/** 该人拥有哪些属性（id 数组）。 */
function rootElementsOf(person) {
  const els = person?.root?.elements;
  if (!Array.isArray(els)) return [];
  return els.filter((e) => ROOT_ELEMENTS[e]);
}

/** 「火」这样的属性名；无属性返回空串。 */
function elementName(id) { return ROOT_ELEMENTS[id]?.name || ''; }

/**
 * 灵根的显示文案。
 * 例：天灵根（火）／伪灵根（金木水火土）／无灵根
 */
function rootText(person) {
  if (!person?.root) return '无灵根';
  const g = rootGradeOf(person);
  const els = rootElementsOf(person);
  const names = els.map((e) => ROOT_ELEMENTS[e].name).join('');
  return names ? `${g.name}（${names}）` : g.name;
}

/** 修炼速度倍率。 */
function rootSpeedMult(person) { return rootGradeOf(person).speed; }

/** 突破成功率修正。 */
function rootBreakBonus(person) { return rootGradeOf(person).breakBonus; }

/**
 * 这个人能修到的最高 realmIndex。
 * 表里写的是绝对值，这里夹到当前版本的上限，避免以后加境界时表没跟着改而出错。
 */
function rootLevelCap(person) {
  const cap = rootGradeOf(person).capIndex;
  return Math.max(1, Math.min(REALM_MAX_INDEX, Math.floor(cap)));
}

/**
 * 能否修习某本功法。
 * 规则：
 *   1. 无属性功法（炼气道途）—— 人人可修，保证主线不被灵根卡住
 *   2. 天灵根 —— 不拘何系皆可参研
 *   3. 其余 —— 功法的属性必须在自己的灵根里
 */
function rootCanLearn(person, manual) {
  const need = MANUAL_DAO_ELEMENT[manual?.dao];
  if (!need) return true;
  const g = rootGradeOf(person);
  if (g.canLearnAll) return true;
  return rootElementsOf(person).includes(need);
}

/**
 * 天灵根对本系功法的专精倍率；其他档恒为 1。
 * 这是天灵根除了速度之外的第二重优势：同样一本御守功法，金灵根用起来更强。
 */
function rootFocusMult(person, manual) {
  const g = rootGradeOf(person);
  if (g.focus <= 1) return 1;
  const need = MANUAL_DAO_ELEMENT[manual?.dao];
  if (!need) return 1;
  return rootElementsOf(person).includes(need) ? g.focus : 1;
}

/** 这个人的灵根「有多好」，用于重测时不亏的比较。数字越大越好。 */
function rootRank(person) { return ROOT_RANK[rootGradeOf(person).id] || 0; }

/* ── 测灵根（重测） ── */

/** 第 n 次重测的灵石开销。n 从 0 起（这个人已经重测过几次）。 */
function rootRerollCost(person) {
  const n = Math.max(0, Math.floor(Number(person?.root?.rerolls) || 0));
  return ROOT_REROLL_COST_BASE + ROOT_REROLL_COST_STEP * n;
}

/**
 * 询价：能不能给这个人重测灵根。
 */
function rootRerollPlan(state, personId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  const cost = rootRerollCost(person);
  if ((state.spiritStones || 0) < cost) {
    return { ok: false, reason: `测灵根需 ${cost} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）` };
  }
  return {
    ok: true, kind: 'reroll', personId: person.id, name: person.name,
    cost, currency: 'stones', current: rootText(person), rerolls: person.root?.rerolls || 0,
  };
}

/**
 * 兑现一次重测。
 *
 * **保证不亏**：新灵根如果比原来的差，就保留原来的（只扣钱）。
 * 所以这是个稳定的灵石去处，而不是赌博 —— 设计上，
 * 灵根是「花灵石就能慢慢变好」的，赌运气的地方留给洞天。
 */
function commitRootReroll(state, personId, rng = Math.random) {
  const plan = rootRerollPlan(state, personId);
  if (!plan.ok) return plan;
  const person = findCultivator(state, personId);
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.cost);

  const before = rootText(person);
  const beforeRank = rootRank(person);
  const rolled = rollRoot(rng, person.origin === 'innate');
  const rerolls = (person.root?.rerolls || 0) + 1;

  if ((ROOT_RANK[rolled.grade] || 0) > beforeRank) {
    person.root = { ...rolled, rerolls };
    const after = rootText(person);
    pushLog(state, `${person.name}再测灵根：${before} → ${after}。`, 'cultivate', null, Date.now());
    return { ok: true, improved: true, name: person.name, before, after, cost: plan.cost };
  }

  person.root = { ...person.root, rerolls };
  pushLog(state, `${person.name}再测灵根，仍是${before}，未测得更好。`, 'cultivate', null, Date.now());
  return { ok: true, improved: false, name: person.name, before, after: before, cost: plan.cost };
}

/**
 * 给还没有灵根字段的人补一个。
 * 存档迁移用：老存档里的修士都是「灵根未测」，补掷一次；
 * 天生灵根用更好的权重表。
 */
function ensureRoot(person, rng = Math.random) {
  if (person.root && ROOT_GRADE_MAP[person.root.grade]) {
    if (!Array.isArray(person.root.elements) || person.root.elements.length === 0) {
      person.root.elements = pickElements(rootGradeOf(person).count, rng);
    }
    person.root.rerolls = Math.max(0, Math.floor(Number(person.root.rerolls) || 0));
    return person.root;
  }
  person.root = rollRoot(rng, person.origin === 'innate');
  return person.root;
}

/**
 * 宗门引荐礼：把一个修士送进宗门时，宗门给的一次性灵石。
 *
 * 这是「好灵根留不住」的落点 —— 资质越好，宗门越愿意出价。
 * 玩家要在「把他留在族里慢慢养」和「换一笔灵石」之间选。
 * 灵石正是突破门槛的硬通货，所以这个选择是真的。
 */
function sectReferralReward(person) {
  const g = rootGradeOf(person);
  const realmIdx = Math.max(1, Math.floor(person?.realmIndex) || 1);
  const tierNo = Math.max(1, Math.ceil(realmIdx / 4));   // 炼气 1、筑基 2、金丹 3……
  const quality = 1 + (rootRank(person) - 1) * 0.6;      // 伪灵根 1.0 → 天灵根 3.4
  return Math.round(8 * tierNo * tierNo * quality * (Number(person?.talent) || 1));
}
