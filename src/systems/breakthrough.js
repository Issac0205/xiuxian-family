
/* ────────────────────────────────────────────────────────────────
 * 区块：突破规则
 * 职责：大境界的冲关判定。小境界在同一大档内自动晋升（见 systems/cultivation.js），
 *       跨大档必须由玩家主动点「突破」——这是把决策权交还给玩家的地方。
 * 依赖：data/realms.js（境界表与门槛）、core/engine.js 的 pushLog
 * 调参：门槛数值在 data/realms.js 的 REALM_GATES 里，本文件不含魔法数字。
 * 文档：docs/10-境界与突破.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 修士当前的修为状态。四种之一：
 *
 *   { kind:'max' }          已至此界尽头（化神圆满）
 *   { kind:'progressing' }  同档内，修为满了会自动晋升，玩家不用管
 *   { kind:'filling' }      卡在大档最后一层，修为还没满 —— 继续挂机
 *   { kind:'blocked' }      卡在大档最后一层且修为已满 —— **等玩家点突破**
 *
 * UI 应当只在 blocked 时显示突破按钮，并把缺什么写清楚。
 */
function breakthroughState(person) {
  const idx = Math.floor(Number(person?.realmIndex) || 0);
  if (isRealmMax(idx)) return { kind: 'max', index: idx };
  const gate = realmGate(idx);
  const need = realmXpNeeded(idx);
  // 【策划 C6 / 任务 T-6 验收标准 1】进入金丹后，修为满不再自动晋升：
  // 本层尚未结丹时先给「结丹」这个新态（folding），由玩家在「晋升 / 结丹」之间选。
  // 出处：docs/91-落地任务清单.md §三 T-6（「必须把它绑成晋升的二选一，且同一层只能用一次」）。
  // 注意顺序：`folding` 必须在 `progressing` 之前判 —— 金丹档的 gate 为 null，
  // 落到下面那一行就会返回 progressing。
  if (!gate && coreFoldableIndex(idx) && !coreUsedHere(person, idx) && need > 0) {
    const xpF = Math.max(0, Number(person?.xp) || 0);
    if (xpF >= need) return { kind: 'folding', index: idx, need };
  }
  if (!gate) return { kind: 'progressing', index: idx, need };
  const xp = Math.max(0, Number(person?.xp) || 0);
  if (xp < need) return { kind: 'filling', index: idx, need, gate, remaining: need - xp };
  return { kind: 'blocked', index: idx, need, gate };
}

/**
 * 【策划 C15 / 任务 T-2】修士状态的**唯一**出口。
 *
 * 为什么要有它：卡片上原来直接读 `breakthroughState()` 的四态，而 T-3/T-4/T-6
 * 要各自再贴一个标记上去 —— 于是同一张卡上可能出现两个互相矛盾的状态标签。
 * 收敛到一个函数之后，后面每条任务只往这里加一行。
 *
 * 返回**恰好一个**字符串：
 *   'mortal'      还没有此人（id 找不到）
 *   'out'         【T-4】出门在外（差事）：不涨修为、不能被派去镇守或探险
 *   'stalled'     【T-3】气机滞住：走火后的恢复期，本层修为暂停
 *   'folding'     【T-6】金丹期修为已满且本层未结丹：等玩家选「晋升 / 结丹」
 *   'max' / 'progressing' / 'filling' / 'blocked' —— 与 breakthroughState 的旧四态**逐位一致**
 *
 * ⚠ 新函数是旧函数的**严格超集**，不是重写：除 'folding'（新态）之外的四种，
 *   一律转发 breakthroughState()，所以老断言不需要改。
 * 出处：docs/91-落地任务清单.md §三 T-2 验收标准 3。
 */
function personState(person) {
  if (!person) return 'mortal';
  if (person.job === 'errand') return 'out';
  if ((Number(person.stalled) || 0) > 0) return 'stalled';
  return breakthroughState(person).kind;
}

/** 状态 → 界面上的中文名与配色 class（卡片上的唯一一处状态标记）。 */
const PERSON_STATE_LABELS = {
  mortal: { text: '—', cls: 'st-mortal' },
  out: { text: '差事在外', cls: 'st-out' },
  stalled: { text: '气机滞住', cls: 'st-stalled' },
  folding: { text: '丹成待决', cls: 'st-folding' },
  max: { text: '已至此界尽头', cls: 'st-max' },
  progressing: { text: '修炼中', cls: 'st-progressing' },
  filling: { text: '待冲关', cls: 'st-filling' },
  blocked: { text: '瓶颈 · 可冲关', cls: 'st-blocked' },
};

/** personState 的全部合法返回值。smoke 用它做「只返回这九个之一」的断言。 */
const PERSON_STATES = Object.keys(PERSON_STATE_LABELS);

/** 按 id 找修士。 */
function findCultivator(state, personId) {
  const id = Number(personId);
  return (state.cultivation?.cultivators || []).find((p) => p.id === id) || null;
}

/**
 * 询价：这个人现在能不能突破、要花什么、成功率多少。
 * 与 commitBreakthrough 分离，所以界面上写的代价与实际扣除的永远一致
 * （与凡尘篇的 plan/commit 是同一套约定）。
 *
 * 【策划 C4 / 任务 T-5】新增第三个参数 `siteId`：炼气九层那道门槛要求「择地」，
 * 候选清单来自 worldOf(state).reached（只有**走到过**的地才能选）。
 * 出处：docs/91-落地任务清单.md §三 T-5 验收标准 1。
 */
function breakthroughPlan(state, personId, siteId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };

  const st = breakthroughState(person);
  if (st.kind === 'max') return { ok: false, reason: `${person.name}已至此界尽头` };
  if (st.kind === 'progressing') return { ok: false, reason: '同档内会自动晋阶，无需冲关' };
  // 【策划 C6 / 任务 T-6】金丹期修为满时走的是结丹那条路，不是冲关
  if (st.kind === 'folding') return { ok: false, reason: `${person.name}已可结丹：晋升还是结丹，由你定`, folding: true };
  if (st.kind === 'filling') {
    return {
      ok: false,
      reason: `修为未满（还需 ${Math.ceil(st.remaining)} 点）`,
      remaining: st.remaining,
    };
  }

  const gate = st.gate;
  // 丹药是主材料：没有对应的丹，连试都试不了
  if (gate.pill && pillCount(state, gate.pill) < 1) {
    const pillName = ALCHEMY_RECIPE_MAP[gate.pill]?.name || gate.pill;
    return { ok: false, reason: `冲关需一枚${pillName}（尚无）`, needsPill: gate.pill };
  }
  if ((state.spiritStones || 0) < gate.stones) {
    return { ok: false, reason: `冲关需 ${gate.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）` };
  }
  const clues = state.cultivation?.clues || 0;
  if (clues < gate.clues) {
    return { ok: false, reason: `冲关需 ${gate.clues} 条秘闻线索（现有 ${clues}）` };
  }

  // 【策划 C4 / 任务 T-5】炼气九层那一道要择地：没有选到地就不放行。
  // ⚠ 这里**必须**要求显式传入 siteId（不能默默取候选清单的第一项）——
  //   否则「先择地再奠基」这一步就被跳过，玩家会在不知情的情况下把道基压在第一块地上。
  //   界面上的下拉框本来就默认选中第一项，所以正常路径不受影响。
  let site = null;
  if (gate.requiresSite) {
    const sites = foundationSiteOptions(state);
    if (!sites.length) return { ok: false, reason: '还没有走到过任何一处地方，先出门探一探', needsSite: true, sites: [] };
    if (!siteId) {
      return {
        ok: false, reason: '请先择地筑基：挑一块走到过的地，再奠基',
        needsSite: true, sites,
      };
    }
    const fp = foundationPlan(state, personId, siteId);
    if (!fp.ok) return { ok: false, reason: fp.reason, needsSite: true, sites: fp.sites || sites };
    site = fp.site;
  }

  // 冲关符挂着的「下一次」加成（百分点）；金手指「戒中老者」是常驻加成；
  // 仙道科技（筑基之道/金丹大道/元婴大道/化神大道）给的是**永久**加成，
  // 所以越到后面，「备足材料再冲」这件事越有意义 —— 而不再是纯赌命。
  const rune = runePending(state, 'break');
  const meta = metaBreakBonus(state);
  const tech = techEffects(state).breakBonusFlat;
  const rate = Math.min(0.99, realmBreakRate(person.realmIndex, person.talent, person.breakFailures, rootBreakBonus(person)) + rune + meta + tech);
  return {
    ok: true,
    kind: 'breakthrough',
    personId: person.id,
    name: person.name,
    fromName: realmName(person.realmIndex),
    toName: realmName(person.realmIndex + 1),
    stones: gate.stones,
    clues: gate.clues,
    pill: gate.pill || null,
    pillName: gate.pill ? (ALCHEMY_RECIPE_MAP[gate.pill]?.name || gate.pill) : null,
    rate,
    runeBonus: rune,
    metaBonus: meta,
    techBonus: tech,
    /** 失败时回退的修为点数。 */
    loss: Math.floor(st.need * gate.failLoss),
    currency: 'stones',
    cost: gate.stones,
    // 【策划 C4 / 任务 T-5】择地那一份：界面拿它写下拉框与三行字，commit 照它落库
    siteId: site ? site.id : null,
    siteName: site ? site.name : null,
    sites: gate.requiresSite ? foundationPlan(state, personId, siteId).sites || [] : [],
    foundationPreview: site ? foundationPreview(person, site.id, site.held) : null,
  };
}

/**
 * 兑现一次冲关。
 * 失败也要消耗材料 —— 所以「准备充分再冲」是有意义的决策，而不是无脑连点。
 *
 * 【策划 T-0 / docs/91-落地任务清单.md §三 T-0 验收标准 3】
 * **失败不再扣线索**：线索是别处（REALM_GATES）的硬通货，重复扣除会让
 * 「修为满了、丹药有了、灵石够了，就是没有线索」变成死局。
 * 灵石与丹药照扣 —— 「备足材料再冲」的意义不变，变的只是不再二次惩罚线索。
 *
 * 【策划 C4 / 任务 T-5】新增 siteId：择地筑基那一关成功后把
 * `person.foundation = { nodeId, element, grade }` 落库。
 */
function commitBreakthrough(state, personId, now = Date.now(), rng = Math.random, siteId) {
  const plan = breakthroughPlan(state, personId, siteId);
  if (!plan.ok) return plan;

  const person = findCultivator(state, personId);
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.stones);
  // 线索只在**成功后**扣。失败分支刻意不动 cultivation.clues（见上方注释）。
  // 丹药失败也照扣 —— 这是「备足材料再冲」的意义所在
  if (plan.pill) addPills(state, plan.pill, -1);
  // 冲关符是一次性的：无论成败都用掉
  const runeUsed = consumePending(state, 'break');
  const runeNote = runeUsed > 0 ? `（冲关符生效 +${(runeUsed * 100).toFixed(0)}%）` : '';

  if (rng() < plan.rate) {
    state.cultivation.clues = Math.max(0, (state.cultivation.clues || 0) - plan.clues);
    person.realmIndex += 1;
    person.xp = 0;
    person.breakFailures = 0;
    // 【策划 C14 / 任务 T-2b】晋升即重置「入此境之年」，寿元余量从满开始算
    person.realmEnteredYear = Math.max(0, Number(state.clock?.year) || 0);
    // 【策划 C4 / 任务 T-5】择地筑基：把地块烧成一张符落进族谱
    let foundation = null;
    if (plan.siteId) {
      const node = mapNode(plan.siteId);
      const held = mapHeld(state, plan.siteId) && mapIsPacified(state, plan.siteId);
      const grade = foundationGrade(node.tier, held);
      foundation = { nodeId: node.id, element: node.earthQi || 'tu', grade: grade.tier };
      person.foundation = foundation;
    }
    pushLog(state, `${person.name}冲关成功${runeNote}，晋升${realmName(person.realmIndex)}！`, 'cultivate', null, now);
    return {
      ok: true, success: true, name: person.name, runeUsed, foundation,
      realm: realmName(person.realmIndex), realmIndex: person.realmIndex,
    };
  }

  person.xp = Math.max(0, person.xp - plan.loss);
  person.breakFailures = (person.breakFailures || 0) + 1;
  const next = realmBreakRate(person.realmIndex, person.talent, person.breakFailures, rootBreakBonus(person));
  pushLog(
    state,
    `${person.name}冲关失败${runeNote}，修为倒退 ${plan.loss} 点。下一次成功率提升到 ${(next * 100).toFixed(0)}%。`,
    'cultivate', null, now,
  );
  return {
    ok: true, success: false, name: person.name, runeUsed,
    loss: plan.loss, nextRate: next, failures: person.breakFailures,
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C4 / 任务 T-5】择地筑基
 *
 * 把「炼气九层 → 筑基初期」那一次冲关从**一步**变成**两步**：
 * 先在冲关面板上选一块自己走到过的地，再由 commitBreakthrough 把
 * `person.foundation = { nodeId, element, grade }` 落库。
 * 数值出处：docs/91-落地任务清单.md §三 T-5（品阶 ×1.00/1.10/1.25/1.50，
 * 相合 ×1.5 / 相冲 ×0.6 / 地块丢失 ×0.5；散功重修 = 回退到 9 + 修为清零 +
 * 3 游戏小时不能修炼 + 道心 −5）。
 * ⚠ 沿革 docs/10-境界与突破.md §4.4 的 plan/commit 分离约定：
 *   计划里把品阶与词条算好，兑现时照扣，绝不各算一套。
 * ══════════════════════════════════════════════════════════════════ */

/** 这块地现在能不能作为道基：必须已抵达。 */
function foundationSiteOptions(state) {
  return worldOf(state).reached
    .map((id) => mapNode(id))
    .filter(Boolean)
    .map((node) => ({
      id: node.id,
      name: node.name,
      tier: node.tier,
      earthQi: node.earthQi || 'earth',
      held: mapHeld(state, node.id) && mapIsPacified(state, node.id),
    }));
}

/**
 * 某块地对某个人的道基预览。plan 里算好，界面拿它写字，commit 照它落库。
 * @param {object} person
 * @param {string} nodeId
 * @param {boolean} held 该地块是否已占领且有效镇守（可晋一档）
 */
function foundationPreview(person, nodeId, held) {
  const node = mapNode(nodeId);
  if (!node) return null;
  const grade = foundationGrade(node.tier, held);
  const earthQi = node.earthQi || 'earth';
  const qi = EARTH_QI[earthQi];
  const element = (person?.root?.elements || [])[0] || null;
  const rel = earthQiRelation(element, earthQi);
  const relMult = rel === 'match' ? FOUNDATION_MATCH_MULT : rel === 'clash' ? FOUNDATION_CLASH_MULT : 1;
  const mult = grade.mult * relMult;
  return {
    nodeId: node.id, nodeName: node.name,
    element: earthQi, elementName: qi.name,
    grade: grade.tier, gradeName: grade.name, gradeMult: grade.mult,
    relation: rel, relationMult: relMult,
    /** 词条在**这块地 + 这个人**身上的最终倍率（界面上写的 ×1.5 / ×0.6 就是它）。 */
    entryMult: mult,
    label: qi.label,
    pp: qi.pp * mult, pct: qi.pct * mult,
    held: Boolean(held),
  };
}

/**
 * 询价：这个人现在能不能择地筑基、能选哪些地（返回给界面的下拉框用）。
 * `siteId` 省略时返回候选清单，`siteId` 给定时连预览一起返回。
 */
function foundationPlan(state, personId, siteId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  const sites = foundationSiteOptions(state);
  if (!sites.length) return { ok: false, reason: '还没有走到过任何一处地方，先出门探一探' };
  const chosen = siteId ? sites.find((s) => s.id === siteId) : sites[0];
  if (!chosen) return { ok: false, reason: '此地尚未抵达，不能在此立道基', sites };
  return {
    ok: true, sites, site: chosen,
    preview: foundationPreview(person, chosen.id, chosen.held),
  };
}

/**
 * 散功重修：不可逆决策的后悔药。
 * 代价（docs/91 §三 T-5「散功重修」表）：境界回退到炼气九层、修为清零、
 * 该修士 3 游戏小时不能修炼、家族道心 −5。
 * 保留：地块选择权、家族资源、功法。
 */
function dissolveFoundationPlan(state, personId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  if (!person.foundation) return { ok: false, reason: `${person.name}尚未择地筑基` };
  if (person.realmIndex < 10) return { ok: false, reason: `${person.name}已不在筑基以上，无需散功` };
  return {
    ok: true, personId: person.id, name: person.name,
    toIndex: 9, hours: (Number(person.stalled) || 0) > 0 ? 0 : FOUNDATION_DISSOLVE_HOURS,
    morality: FOUNDATION_DISSOLVE_MORALITY,
    nodeName: mapNode(person.foundation.nodeId)?.name || person.foundation.nodeId,
  };
}

function commitDissolveFoundation(state, personId, now = Date.now()) {
  const plan = dissolveFoundationPlan(state, personId);
  if (!plan.ok) return plan;
  const person = findCultivator(state, personId);
  person.realmIndex = plan.toIndex;
  person.xp = 0;
  person.breakFailures = 0;
  person.foundation = null;
  // 3 游戏小时不能修炼 —— 用 T-3 已有的 stalled 计数器表达，不新增字段。
  if (plan.hours > 0) person.stalled = Math.max(Number(person.stalled) || 0, plan.hours * 3600);
  addMorality(state, plan.morality);
  pushLog(
    state,
    `${person.name}散去${plan.nodeName}的地气，重归炼气九层 —— 需缓 ${plan.hours} 游戏时辰方可再修。`,
    'cultivate', null, now,
  );
  return { ok: true, name: person.name, nodeName: plan.nodeName, morality: plan.morality, hours: plan.hours };
}

/* ══════════════════════════════════════════════════════════════════
 * 【策划 C6 / 任务 T-6】结丹的询价与兑现
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 询价：这个人现在能不能结丹、三档火候各要什么、代价与失败后果。
 * 与 commitFold 分离（同一套 plan/commit 约定），所以界面上写的与实际算的一致。
 */
function foldPlan(state, personId, foldId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  const idx = Math.floor(Number(person.realmIndex) || 0);
  if (!coreFoldableIndex(idx)) {
    return { ok: false, reason: '结丹只在金丹期可行', folds: CORE_FOLDS };
  }
  const need = realmXpNeeded(idx);
  if (!(Number(person.xp) >= need)) {
    return {
      ok: false, reason: `修为未满（还需 ${Math.ceil(need - (Number(person.xp) || 0))} 点）`,
      folds: CORE_FOLDS, remaining: need - (Number(person.xp) || 0),
    };
  }
  if (coreUsedHere(person, idx)) {
    return { ok: false, reason: `本层已结过丹（每层只有一次机会）`, folds: CORE_FOLDS };
  }
  const fold = foldId ? CORE_FOLD_MAP[foldId] : null;
  const core = coreOf(person);
  const grade = coreGradeOf(core.marks);
  const base = {
    ok: false, folds: CORE_FOLDS, need,
    marks: core.marks, grade: grade.name, gradeId: grade.grade,
    /** 本层剩余的结丹机会（4 层减去已用过的层数）。 */
    chancesLeft: CORE_GRADES && coreFoldableIndex(idx) ? coreChancesLeft(person) : 0,
  };
  if (!fold) return { ...base, reason: '请选择一种火候' };
  if ((state.spiritStones || 0) < fold.stones) {
    return { ...base, reason: `${fold.name}需 ${fold.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）` };
  }
  if (fold.herb > 0 && herbCount(state, 'grass') < fold.herb) {
    return { ...base, reason: `${fold.name}需 ${fold.herb} 份药草（现有 ${Math.floor(herbCount(state, 'grass'))}）` };
  }
  return {
    ok: true, kind: 'fold', personId: person.id, name: person.name,
    foldId: fold.id, foldName: fold.name,
    rate: fold.rate, marks: fold.marks, cap: fold.cap,
    herb: fold.herb, stones: fold.stones,
    coreMarks: core.marks, grade: grade.name, gradeId: grade.grade,
    chancesLeft: coreChancesLeft(person),
    /** 失败后果明文（界面与 confirm 文案共用）。 */
    failText: `丹裂掉一纹（当前 ${core.marks} → ${Math.max(0, core.marks - 1)}），补偿 +${Math.round(CORE_FAIL_MERCY * 100)} 个百分点`,
    desc: fold.desc,
    cost: fold.stones, currency: 'stones',
  };
}

/** 金丹期还剩几次结丹机会（4 层减去已用过的层数）。出处：docs/91 §三 T-6「4 次机会」。 */
function coreChancesLeft(person) {
  const total = (REALM_TIER_MAP[CORE_TIER_ID]?.stages || []).length || 4;
  const used = Object.keys(coreOf(person).used).length;
  return Math.max(0, total - used);
}

/**
 * 兑现一次结丹。
 * 成功：+marks（受 cap 限制，文火止于 6 纹）、mercy 归零；
 * 失败：丹纹 −1（最低 0）、mercy += 0.12。
 * **无论成败都吃掉本层的唯一一次机会** —— 这是硬上限的数学保证。
 */
function commitFold(state, personId, foldId, now = Date.now(), rng = Math.random) {
  const plan = foldPlan(state, personId, foldId);
  if (!plan.ok) return plan;

  const person = findCultivator(state, personId);
  const core = coreOf(person);
  const fold = CORE_FOLD_MAP[plan.foldId];
  const idx = Math.floor(Number(person.realmIndex) || 0);

  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.stones);
  if (fold.herb > 0) addHerbs(state, 'grass', -fold.herb);
  // 本层记账 + 修为清零：结丹就是「把这一层攒下的修为烧掉」
  const used = { ...core.used, [String(idx)]: true };
  person.xp = 0;

  if (rng() < plan.rate) {
    let marks = core.marks + fold.marks;
    if (fold.cap !== null) marks = Math.min(fold.cap, marks);
    person.core = { marks, mercy: 0, used };
    const grade = coreGradeOf(marks);
    pushLog(
      state,
      `${person.name}以${fold.name}结丹，得 ${fold.marks} 纹（共 ${marks} 纹 · ${grade.name}）。`,
      'cultivate', null, now,
    );
    return { ok: true, success: true, name: person.name, gain: fold.marks, marks, grade: grade.name, gradeId: grade.grade, used };
  }

  const marks = Math.max(0, core.marks - 1);
  person.core = { marks, mercy: core.mercy + CORE_FAIL_MERCY, used };
  const grade = coreGradeOf(marks);
  pushLog(
    state,
    `${person.name}以${fold.name}结丹失败，丹裂掉纹（余 ${marks} 纹 · ${grade.name}）。`,
    'cultivate', null, now,
  );
  return { ok: true, success: false, name: person.name, marks, grade: grade.name, gradeId: grade.grade, mercy: core.mercy + CORE_FAIL_MERCY, used };
}

/** 丹图：给界面用的当前状态摘要。 */
function coreDashboard(state) {
  const people = (state.cultivation?.cultivators || []).filter((p) => coreOf(p).marks > 0 || coreFoldableIndex(p.realmIndex));
  return people.map((p) => ({
    id: p.id, name: p.name, realmIndex: p.realmIndex,
    marks: coreOf(p).marks, grade: coreGradeOf(coreOf(p).marks).name,
    chancesLeft: coreChancesLeft(p),
    used: Object.keys(coreOf(p).used).map(Number).sort((a, b) => a - b),
  }));
}

/**
 * 「下一步该让谁去冲关」——给界面的建议。
 * 优先返回成功率最高的那个；都不行就返回 null。
 *
 * 【策划 C4 / 任务 T-5】择地那一道需要 siteId；给定时按它询价，
 * 没给时（或者某人不要求择地）按「不带地」询价 —— 于是要求择地的人会被自然排除。
 */
function bestBreakthroughCandidate(state, siteId) {
  let best = null;
  for (const p of state.cultivation?.cultivators || []) {
    const plan = breakthroughPlan(state, p.id, siteId);
    if (!plan.ok) continue;
    if (!best || plan.rate > best.rate) best = plan;
  }
  return best;
}
