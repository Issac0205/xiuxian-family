
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
 *
 * 【修复 t4 缺陷②】再新增第四个参数 `force`（默认 false）：
 * 金丹期「晋升」按钮走的就是 `force = true` —— 无风险直接进阶、不消耗本层的火候机会。
 * ⚠ 形参只能往**后面**加：smoke 里仍按第 3 个位置传 siteId，改位置会静默错位。
 */
function breakthroughPlan(state, personId, siteId, force = false) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };

  const st = breakthroughState(person);
  if (st.kind === 'max') return { ok: false, reason: `${person.name}已至此界尽头` };
  // 【策划 C11 / 任务 T-8】化神期的三次晋升走的是**天劫**，不是 `REALM_GATES`。
  // ⚠ **必须排在 `progressing` 那一句之前**：化神三层在 `REALM_GATES` 里没有条目，
  //   于是 `breakthroughState()` 会给它们 `progressing`（「同档内自动晋升」）——
  //   若按正常顺序早退，天劫这一整条路就永远不会被走到（而且不会报错）。
  //   我第一版就把它写在后面，`tribulationPlan` 一次都没被调用过。
  // 转发而不是复制：plan/commit 的分离约定与界面入口都不变，
  // 只是「这一层要付什么」换了一套算法（见 tribulationPlan）。
  // 第 4 个形参 `force` 在这里充当 loadout（`{territory,wardens,artifact}`）——
  // 天劫没有「无风险跳过」这一说，所以 force 的语义在这一层不存在。
  if (isTribulationRealm(person.realmIndex)) {
    return tribulationPlan(state, personId, force && typeof force === 'object' ? force : undefined);
  }
  if (st.kind === 'progressing') return { ok: false, reason: '同档内会自动晋阶，无需冲关' };
  // 【策划 C6 / 任务 T-6】金丹期修为满时走的是结丹那条路，不是冲关
  if (st.kind === 'folding') {
    // 【修复 t4 缺陷②】folding 是「晋升 or 结丹」的二选一，不是「只能结丹」。
    // force 就是「晋升」那一支：无风险、无消耗、不占本层的火候机会。
    if (force) {
      return {
        ok: true,
        kind: 'promote',
        force: true,
        personId: person.id,
        name: person.name,
        fromName: realmName(person.realmIndex),
        toName: realmName(person.realmIndex + 1),
        stones: 0, clues: 0, pill: null, pillName: null,
        rate: 1,
        runeBonus: 0, metaBonus: 0, techBonus: 0,
        loss: 0,
        currency: 'stones',
        cost: 0,
      };
    }
    return { ok: false, reason: `${person.name}已可结丹：晋升还是结丹，由你定`, folding: true };
  }
  if (st.kind === 'filling') {
    return {
      ok: false,
      reason: `修为未满（还需 ${Math.ceil(st.remaining)} 点）`,
      remaining: st.remaining,
      // 【策划 C16 / 任务 T-9 验收标准 4】`miss` 是失败的**起因标签**，
      //   由这里产出、由念白消费（`RITE_MISS_WORDS` 把它翻成「修为」这个词）。
      //   写在这里而不是渲染层：渲染层只能从文案里猜，而猜错就是「败念白不点名」。
      miss: 'xp',
    };
  }

  const gate = st.gate;
  // 丹药是主材料：没有对应的丹，连试都试不了
  // 【策划 C16 / 任务 T-9 验收标准 4】`miss` 是失败的**起因标签**，交给念白消费
  //   （`RITE_MISS_WORDS` 把 'pill' 翻成「丹」这个词）。放在这里而不是渲染层：
  //   渲染层只能从 reason 的中文里猜起因，猜错的表现就是「败念白不点名」。
  if (gate.pill && pillCount(state, gate.pill) < 1) {
    const pillName = ALCHEMY_RECIPE_MAP[gate.pill]?.name || gate.pill;
    return { ok: false, reason: `冲关需一枚${pillName}（尚无）`, needsPill: gate.pill, miss: 'pill' };
  }
  if ((state.spiritStones || 0) < gate.stones) {
    return { ok: false, reason: `冲关需 ${gate.stones} 灵石（现有 ${Math.floor(state.spiritStones || 0)}）`, miss: 'stones' };
  }
  const clues = state.cultivation?.clues || 0;
  if (clues < gate.clues) {
    return { ok: false, reason: `冲关需 ${gate.clues} 条秘闻线索（现有 ${clues}）`, miss: 'clues' };
  }

  // 【策划 C4 / 任务 T-5】炼气九层那一道要择地：没有选到地就不放行。
  // ⚠ 这里**必须**要求显式传入 siteId（不能默默取候选清单的第一项）——
  //   否则「先择地再奠基」这一步就被跳过，玩家会在不知情的情况下把道基压在第一块地上。
  //   界面上的下拉框本来就默认选中第一项，所以正常路径不受影响。
  let site = null;
  if (gate.requiresSite) {
    const sites = foundationSiteOptions(state);
    if (!sites.length) return { ok: false, reason: '还没有走到过任何一处地方，先出门探一探', needsSite: true, sites: [], miss: 'site' };
    if (!siteId) {
      return {
        ok: false, reason: '请先择地筑基：挑一块走到过的地，再奠基',
        needsSite: true, sites, miss: 'site',
      };
    }
    const fp = foundationPlan(state, personId, siteId);
    if (!fp.ok) return { ok: false, reason: fp.reason, needsSite: true, sites: fp.sites || sites, miss: 'site' };
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
function commitBreakthrough(state, personId, now = Date.now(), rng = Math.random, siteId, force = false) {
  // 【修复 t4 缺陷②】金丹期「晋升」：force 分支必须在 plan 之前拦下。
  //   folding 的语义是「这一份修为拿去升境界，还是烧成丹纹」——**二选一，不是只能结丹**。
  //   无风险、无消耗、且**不写 core.used**（火候机会留给别的层），这与 T-6 的
  //   「同一层最多结丹一次」不冲突：玩家只是把这一层的机会放弃了而已。
  //   ⚠ 若不修：修为停在 need、自动晋升又只吃「超出 need 的部分」（`xp -= need`），
  //     于是 `xp === need` 永不自愈 ⇒ 金丹期满修为后不结丹就**永远出不去**，
  //     4 次火候机会从「可选下注」变成「必经流程」，
  //     反过来架空 docs/91 §三 T-6「绑成晋升的替代、防止反复结丹刷丹纹」那条硬上限论证。
  if (force) {
    const fp = breakthroughPlan(state, personId, siteId, true);
    if (!fp.ok) return fp;
    const p = findCultivator(state, personId);
    p.realmIndex += 1;
    p.xp = 0;
    p.breakFailures = 0;
    // 【策划 C14 / 任务 T-2b】晋升即重置「入此境之年」，寿量从满开始算
    p.realmEnteredYear = Math.max(0, Number(state.clock?.year) || 0);
    pushLog(state, `${p.name}自择晋升${realmName(p.realmIndex)}（未结丹）。`, 'cultivate', null, now);
    return {
      ok: true, success: true, promoted: true, name: p.name,
      realm: realmName(p.realmIndex), realmIndex: p.realmIndex,
    };
  }

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
    // 【策划 C16 / 任务 T-9】成功念白：挂过场，并照验收标准 3 再写一条族谱纪事
    const riteWin = riteOf(person.realmIndex - 1, 'win', {
      name: person.name, to: realmName(person.realmIndex),
    });
    setRite(state, { phase: 'win', index: person.realmIndex - 1, name: person.name, to: realmName(person.realmIndex), text: riteWin });
    if (riteWin) pushLog(state, riteWin, 'rite', null, now);
    return {
      ok: true, success: true, name: person.name, runeUsed, foundation, rite: riteWin,
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
  // 【策划 C16 / 任务 T-9 验收标准 4、5】失败念白必须**点名起因**并**播报补偿**：
  //   `miss` 由询价阶段「缺什么」决定（丹 / 灵石 / 线索 / 地基 / 修为 / 天时），
  //   `mercy` 取 REALM_FAIL_MERCY —— 文案里的「+8%」由它算出来，**不写魔数**，
  //   于是改补偿率时文案自动跟着变（否则又是一处「两处各算一遍」）。
  const riteLose = riteOf(person.realmIndex, 'lose', {
    name: person.name, loss: plan.loss, next,
    failures: person.breakFailures, mercy: REALM_FAIL_MERCY,
    miss: plan.miss || 'luck',
  });
  setRite(state, { phase: 'lose', index: person.realmIndex, name: person.name, loss: plan.loss, next, text: riteLose });
  if (riteLose) pushLog(state, riteLose, 'rite', null, now);
  return {
    ok: true, success: false, name: person.name, runeUsed,
    loss: plan.loss, nextRate: next, failures: person.breakFailures, rite: riteLose,
  };
}

/**
 * 【策划 C16 / 任务 T-9 验收标准 2】把一段念白挂进过场队列，由界面播完再清掉。
 *
 * ⚠ **两件事必须分开存**（这一点是被断言逼出来的）：
 *   · `ritesSeen`（「这个门槛看过没有」）→ 进 `state.ui`，**随存档走**；
 *     否则刷新一次就忘了，玩家的期望是「看过一次就不必再看」。
 *   · **待播的那一段念白本身** → 只放**模块级变量**，**不进 state**。
 *     它是纯 UI 瞬态：写进 `state` 会立刻被「全字段往返值比对」断言抓住
 *     （读档后它不会被还原 ⇒ ui 字段前后不等），而「把它也持久化」更糟 ——
 *     那等于让玩家每次开档都重播一段上辈子听过的过场。
 */
let pendingRite = null;

function setRite(state, rite) {
  if (!state || !rite) return null;
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  if (!state.ui.ritesSeen || typeof state.ui.ritesSeen !== 'object') state.ui.ritesSeen = {};
  const key = String(rite.index);
  rite.firstTime = state.ui.ritesSeen[key] !== true;
  state.ui.ritesSeen[key] = true;
  pendingRite = rite;
  return rite;
}

/** 取当前挂着的念白（界面播完清掉）。 */
function takeRite(state) {
  const r = pendingRite;
  pendingRite = null;
  return r || null;
}

/** 只看不取（界面渲染时判断要不要播过场）。 */
function peekRite() { return pendingRite; }

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
  // 【修复 t4 缺陷③ / 策划裁决 docs/91 §十二.3】`mercy` 的语义是**护纹**，不是成率补偿。
  //   历史：原实现只累加 `mercy`、只写进文案，骰子从不读它 ⇒ 界面承诺「补偿 +12 个百分点」
  //   而结算从不兑现（docs/92 §五 缺陷③）。
  //   ⚠ **不能**把它接进成率：四次的累计期望会变成 武火 7.68 / 真火 8.04，
  //   武火被真火全面压过、三档退化成两档（docs/91 §十二.3 的实算表）。
  //   裁决采用「护纹」：失败时若 mercy > 0 → 本次**不掉纹**且清零，否则掉一纹并置 1。
  //   成率因此**完全不碰**（三档次序与「五品概率」表都保住），
  //   而 mercy 从「只写字段」变成**真实消费点在 commitFold 里**。
  //   `rate` 是唯一来源：commitFold 的骰子读同一个 `plan.rate`。
  const mercy = Math.max(0, Number(core.mercy) || 0);
  return {
    ok: true, kind: 'fold', personId: person.id, name: person.name,
    foldId: fold.id, foldName: fold.name,
    rate: fold.rate,
    /** 当前是否持有一次护纹（护纹在下次丹裂时抵消掉一纹的损失）。 */
    mercy,
    hasWard: mercy > 0,
    marks: fold.marks, cap: fold.cap,
    herb: fold.herb, stones: fold.stones,
    coreMarks: core.marks, grade: grade.name, gradeId: grade.grade,
    chancesLeft: coreChancesLeft(person),
    /** 失败后果明文（界面与 confirm 文案共用）。
     *  【裁决 1 · 强制】这里**不许**再出现「补偿 +N 个百分点」——承诺了却不兑现
     *  比没有承诺更糟，玩家会把失败归因成 bug。文案只描述**护纹**这个真实机制。 */
    failText: mercy > 0
      ? `丹裂：本次有护纹，不掉纹（当前 ${core.marks} 纹保住），护纹用掉`
      : `丹裂掉一纹（当前 ${core.marks} → ${Math.max(0, core.marks - 1)}），并记下一次护纹`,
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
 * 失败：**护纹**语义 —— 有护纹则本次不掉纹且护纹用掉，无护纹则掉一纹并记下一次护纹。
 *       （docs/91 §十二.3 裁决；不再写「mercy += 0.12」那种成率补偿。）
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

  // 【修复 t4 缺陷③ / 策划裁决 docs/91 §十二.3】失败分支 = **护纹**（不是成率补偿）。
  //   若手上已有一次护纹（mercy > 0）→ 本次不掉纹、护纹用掉（mercy = 0）；
  //   否则掉一纹、并记下一次护纹（mercy = CORE_WARD_COUNT）。
  //   ⚠ `mercy` 是**次数**语义（有/无），不是可累积的百分点 —— 取值 0 / 1。
  //     设计者按更新过程算过：这个语义下三档期望 文火 3.6575 / 武火 5.80738125 / 真火 5.33203125，
  //     与「五品概率」0% / 16.64% / 26.17% 都经过 16 条序列的**精确枚举**双路径确认。
  const warded = core.mercy > 0;
  const marks = warded ? core.marks : Math.max(0, core.marks - 1);
  person.core = { marks, mercy: warded ? 0 : CORE_WARD_COUNT, used };
  const grade = coreGradeOf(marks);
  // 【策划 C16 / 任务 T-9】结丹失败也有念白（三档各一段）。
  //   把「从几纹落到几纹」与「护纹有没有挡下」都传进去 —— 这两件事玩家最需要看清。
  const riteLose = typeof fold.lose === 'function'
    ? fold.lose({ foldName: fold.name, rate: fold.rate, marksFrom: core.marks, marksTo: marks, warded })
    : '';
  setRite(state, { phase: 'lose', index: `fold-${fold.id}`, name: person.name, loss: warded ? 0 : 1, text: riteLose });
  if (riteLose) pushLog(state, riteLose, 'rite', null, now);
  pushLog(
    state,
    warded
      ? `${person.name}以${fold.name}结丹失败，丹裂 —— 但护纹挡下，${marks} 纹未损。`
      : `${person.name}以${fold.name}结丹失败，丹裂掉纹（余 ${marks} 纹 · ${grade.name}）。`,
    'cultivate', null, now,
  );
  return { ok: true, success: false, name: person.name, marks, warded, grade: grade.name, gradeId: grade.grade, mercy: person.core.mercy, used };
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
 * ══════════════════ 【策划 C11 / 任务 T-8】天劫 ══════════════════
 *
 * 化神期的三次晋升（初期→中期→后期→圆满）**不再走 `REALM_GATES`**，
 * 而是「准备界面 + 一次引雷结算」。这是本节点与**科技线**的第二处功能性联动：
 *   减免来源里，领地取自地图线、法器取自器坊线（`artifactBonus`）、
 *   护身符取自符房线（`runePending`）、护法取自名册 —— 也就是**化神能不能过，
 *   取决于玩家前 40 小时在凡人/仙道两条科技线上攒下了什么**。
 *   不准备就必死（基础 9 点、0 减免 ⇒ 落入 `perish` 档），这是刻意的门槛。
 *
 * 数值出处：docs/91-落地任务清单.md §三 T-8 与 src/data/tribulation.js。
 */

/** 收集本次天劫的全部减免来源（**纯读**，不动状态）。 */
function tribulationSources(state, personId, loadout) {
  const lo = loadout || {};
  const w = worldOf(state);
  const out = [];

  // ① 封地：已占领 **且有效镇守** 的领地各 −8%（上限 4 = 可占领节点数）
  const held = (w.held || []).filter((id) => mapIsPacified(state, id));
  const terrOn = lo.territory !== false;
  const terrCount = terrOn ? Math.min(TRIBULATION_SOURCES[0].max, held.length) : 0;
  out.push({
    id: 'territory', name: TRIBULATION_SOURCES[0].name,
    value: terrCount * TRIBULATION_SOURCES[0].per,
    count: terrCount, available: held.length,
    note: terrCount ? `${terrCount} 处领地（暂停赋税 1 小时）` : '没有有效镇守的领地',
  });

  // ② 护法：元婴及以上的修士结阵，每人 −6%（上限 6）
  //    与镇守同构但用**独立字段** `world.wardens`（验收标准 8 明确要求独立）
  //    ⚠ **要渡劫的本人不能给自己当护法** —— 他正在雷里，不可能同时结阵。
  //      这个洞我第一版漏了：装上之后 `available` 会把本人算进去，
  //      于是「护法数」永远比玩家能真正动员的人多 1。
  const me = Math.floor(Number(personId)) || 0;
  const pool = (state.cultivation?.cultivators || []).filter((p) => hasNascent(p) && p.id !== me);
  const chosen = Array.isArray(lo.wardens)
    ? lo.wardens.map((id) => Number(id))
    : pool.slice(0, TRIBULATION_SOURCES[1].max).map((p) => p.id);
  const wardenIds = chosen
    .filter((id) => pool.some((p) => p.id === id))
    .slice(0, TRIBULATION_SOURCES[1].max);
  out.push({
    id: 'warden', name: TRIBULATION_SOURCES[1].name,
    value: wardenIds.length * TRIBULATION_SOURCES[1].per,
    count: wardenIds.length, available: pool.length, ids: wardenIds,
    note: wardenIds.length ? `${wardenIds.length} 位护法结阵` : '没有可结阵的元婴修士',
  });

  // ③ 法器承雷：每件装备中的法器 −10%（上限 3 = FORGE_SLOT 的位数）
  const art = artifactBonus(state);
  const equipped = Object.keys(forgeOf(state).equipped || {}).length;
  const artOn = lo.artifact !== false;
  const artCount = artOn ? Math.min(TRIBULATION_SOURCES[2].max, equipped) : 0;
  out.push({
    id: 'artifact', name: TRIBULATION_SOURCES[2].name,
    value: artCount * TRIBULATION_SOURCES[2].per,
    count: artCount, available: equipped,
    note: artCount ? `${artCount} 件法器（天劫后耐久清零）` : '没有可用的法器',
  });

  // ④ 道心：≥70 减 10%；≤30 反而 **+15%**（「诛邪神雷」—— 恶名招雷）
  const mor = moralityOf(state);
  let morVar = 0;
  let morNote = `道心 ${Math.round(mor)}（中庸，无加减）`;
  if (mor >= TRIBULATION_MORALITY.goodAt) { morVar = TRIBULATION_MORALITY.goodBonus; morNote = `道心 ${Math.round(mor)} —— 天道不罚善人`; }
  else if (mor <= TRIBULATION_MORALITY.evilAt) { morVar = TRIBULATION_MORALITY.evilBonus; morNote = `道心 ${Math.round(mor)} —— 诛邪神雷`; }
  out.push({ id: 'merit', name: '道心', value: morVar, count: morVar ? 1 : 0, note: morNote });

  // ⑤ 护身符：免**一道落城的雷**（不是减雷伤）—— 所以它单独一格，不进减免合计
  const hasRune = runePending(state, 'tribulation') > 0;
  out.push({
    id: 'rune', name: TRIBULATION_SOURCES[3].name,
    value: 0, count: hasRune ? 1 : 0, isBolt: true,
    note: hasRune ? '一张护身符（免一道落城的雷，一次性）' : '没有挂护身符',
  });
  return out;
}

/**
 * 询价：这次天劫会发生什么。**纯计算，不动状态**（验收标准 2 的 plan/commit 分离）。
 *
 * @param {object} loadout 可选：`{territory?, wardens?, artifact?}` 决定这次投入什么。
 *   不传 = 把**现有可用的**全部投入（界面默认；不传就是「尽力准备」）。
 */
function tribulationPlan(state, personId, loadout) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  const idx = Math.floor(Number(person.realmIndex) || 0);
  const base = tribulationBase(idx);
  if (!base) return { ok: false, reason: `${person.name}当前不必渡劫` };
  const st = breakthroughState(person);
  // ⚠ 化神三层在 `REALM_GATES` 里没有条目，所以 `breakthroughState()` 会给它们 `progressing`
  //   （「同档内自动晋升」）—— 不能用 `st.kind !== 'blocked'` 来判「能不能渡劫」，
  //   否则天劫永远询价失败。真正的判据是「本层修为是否已满」。
  const need = realmXpNeeded(idx);
  if (Number.isFinite(need) && person.xp < need) {
    return { ok: false, reason: `修为未满（还需 ${Math.ceil(need - person.xp)} 点）`, remaining: need - person.xp };
  }
  if (!Number.isFinite(need)) return { ok: false, reason: `${person.name}已至此界尽头` };

  const sources = tribulationSources(state, personId, loadout);
  // 减免合计 = 各来源相加（道心可能是负数加成，也就是 +雷）
  const reductionRaw = sources.reduce((a, s) => a + s.value, 0);
  const reduction = Math.max(0, reductionRaw);
  // 实际雷伤 = round(基础 × (1 − 减免))；减免 >100% 时夹到 0（满减免 = 完全卸雷）
  const damage = Math.max(0, Math.round(base * Math.max(0, 1 - reduction)));
  const tier = tribulationTierOf(damage);
  // 落城的雷：每 2 点缺口一道；护身符再免掉一道（下限 0）
  const runeSaved = sources.some((s) => s.id === 'rune' && s.count > 0) ? 1 : 0;
  const boltsRaw = tribulationBolts(damage);
  const bolts = Math.max(0, boltsRaw - runeSaved);
  const popLoss = Math.max(0, Math.round((Number(state.population) || 0) * TRIBULATION_BOLT_POP_LOSS)) * bolts;

  return {
    ok: true, kind: 'tribulation',
    personId: person.id, name: person.name,
    fromName: realmName(idx), toName: realmName(idx + 1),
    base, reduction, reductionRaw, damage,
    tier: tier.id, tierName: tier.name, tierDesc: tier.desc,
    sources,
    /** 缺口 = 实际雷伤（界面上「此劫需卸 X 点、你能卸 Y 点」的那两个数） */
    threshold: base, covered: Math.round(base * reduction * 100) / 100,
    bolts, boltsRaw, runeSaved, popLoss,
    perish: tier.perish === true,
    xpLoss: tier.xpLossRatio ? Math.floor(realmXpNeeded(idx) * tier.xpLossRatio) : 0,
    trainMult: tier.trainMult || 1, trainHours: tier.trainHours || 0,
    /** 界面用的一句话（明写缺口与落雷） */
    verdict: `${tier.name} —— 缺口 ${damage} 点${bolts > 0 ? `，城内落雷 ${bolts} 道` : '，城内无事'}`,
  };
}

/**
 * 兑现一次天劫（验收标准 2 的 commit 半边）。
 * 无论成败都**消耗掉这次晋升机会**（与金丹结丹同一约定：渡劫没有第二次）。
 */
function commitTribulation(state, personId, now = Date.now(), rng = Math.random, loadout) {
  const plan = tribulationPlan(state, personId, loadout);
  if (!plan.ok) return plan;
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };

  // ① 对价：投入的东西当场付出（这是「卸雷不是免费的」的落点）
  if (plan.sources.find((s) => s.id === 'territory')?.count > 0) {
    state.cultivation.world = state.cultivation.world || {};
    const w = worldOf(state);
    w.unrestPauseUntil = now + 3600 * 1000;   // 领地暂停赋税 1 小时
  }
  if (plan.sources.find((s) => s.id === 'artifact')?.count > 0) {
    wearArtifacts(state, 'tribulation');      // 耐久清零（reason 参数已存在）
  }
  if (plan.sources.find((s) => s.id === 'rune')?.count > 0) {
    consumePending(state, 'tribulation');
  }
  const wardenIds = plan.sources.find((s) => s.id === 'warden')?.ids || [];
  if (wardenIds.length) {
    const w = worldOf(state);
    if (!Array.isArray(w.wardens)) w.wardens = [];
    w.wardens = wardenIds.slice();
  }

  // ② 落城的雷（先落，再算人的下场 —— 与文档「缺口每 2 点，城里落一道雷」一致）
  let killed = 0;
  if (plan.bolts > 0) {
    const pop = Number(state.population) || 0;
    let remain = pop;
    for (let i = 0; i < plan.bolts; i += 1) remain = Math.max(0, remain - remain * TRIBULATION_BOLT_POP_LOSS);
    killed = Math.max(0, Math.round(pop - remain));
    state.population = Math.max(0, Math.round(remain));
    state.stats.deaths = (Number(state.stats.deaths) || 0) + killed;
    pushLog(state, `天劫的余雷落进城里 —— ${plan.bolts} 道，死了 ${killed} 人。`, 'cultivate', null, now);
  }

  // ③ 分档结算
  const tier = tribulationTierOf(plan.damage);
  if (tier.perish) {
    // 陨落**保留传承**（验收标准 5）：10 条秘闻 + 30 灵石由 removeCultivator(inherit=true) 发放。
    // ⚠ 我第一版在这里又减了一次 TRIBULATION_INHERIT_CLUES，等于把刚发的传承倒扣回去
    //   （净效果 0，而且不报错）—— 典型的「两处各写一遍同一笔账」。
    //   现在这笔账**只有一处**：`removeCultivator` 的 inherit 分支。
    removeCultivator(state, person, now, true);
    pushLog(state, `${person.name}渡劫失败，形神俱灭于雷下。此劫要了你一个人。`, 'cultivate', null, now);
    return {
      ok: true, success: false, perish: true, name: person.name,
      damage: plan.damage, tier: tier.id, bolts: plan.bolts, killed,
      inherit: { clues: TRIBULATION_INHERIT_CLUES, stones: 30 },
    };
  }

  if (tier.id === 'broken') {
    person.xp = Math.max(0, person.xp - plan.xpLoss);
    person.breakFailures = (person.breakFailures || 0) + 1;
    pushLog(state, `${person.name}渡劫撑住了，但道基受损，修为倒退 ${plan.xpLoss} 点。`, 'cultivate', null, now);
    return { ok: true, success: true, name: person.name, damage: plan.damage, tier: tier.id, loss: plan.xpLoss, bolts: plan.bolts, killed };
  }

  // calm / shaken：晋升成功（shaken 附加一段修炼减速）
  person.realmIndex += 1;
  person.xp = 0;
  person.breakFailures = 0;
  person.realmEnteredYear = Number(state.clock?.year) || 0;
  if (tier.id === 'shaken') {
    person.stalled = Math.max(Number(person.stalled) || 0, (tier.trainHours || 1) * 3600);
  }
  pushLog(state, `${person.name}渡过天劫，晋升${realmName(person.realmIndex)}！${plan.bolts > 0 ? `（城内落雷 ${plan.bolts} 道）` : ''}`, 'cultivate', null, now);
  return {
    ok: true, success: true, name: person.name, realm: realmName(person.realmIndex),
    realmIndex: person.realmIndex, damage: plan.damage, tier: tier.id, bolts: plan.bolts, killed,
  };
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
