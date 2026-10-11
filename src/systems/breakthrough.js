
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
  if (!gate) return { kind: 'progressing', index: idx, need };
  const xp = Math.max(0, Number(person?.xp) || 0);
  if (xp < need) return { kind: 'filling', index: idx, need, gate, remaining: need - xp };
  return { kind: 'blocked', index: idx, need, gate };
}

/** 按 id 找修士。 */
function findCultivator(state, personId) {
  const id = Number(personId);
  return (state.cultivation?.cultivators || []).find((p) => p.id === id) || null;
}

/**
 * 询价：这个人现在能不能突破、要花什么、成功率多少。
 * 与 commitBreakthrough 分离，所以界面上写的代价与实际扣除的永远一致
 * （与凡尘篇的 plan/commit 是同一套约定）。
 */
function breakthroughPlan(state, personId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };

  const st = breakthroughState(person);
  if (st.kind === 'max') return { ok: false, reason: `${person.name}已至此界尽头` };
  if (st.kind === 'progressing') return { ok: false, reason: '同档内会自动晋阶，无需冲关' };
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
  };
}

/**
 * 兑现一次冲关。
 * 失败也要消耗材料 —— 所以「准备充分再冲」是有意义的决策，而不是无脑连点。
 */
function commitBreakthrough(state, personId, now = Date.now(), rng = Math.random) {
  const plan = breakthroughPlan(state, personId);
  if (!plan.ok) return plan;

  const person = findCultivator(state, personId);
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.stones);
  state.cultivation.clues = Math.max(0, (state.cultivation.clues || 0) - plan.clues);
  // 丹药失败也照扣 —— 这是「备足材料再冲」的意义所在
  if (plan.pill) addPills(state, plan.pill, -1);
  // 冲关符是一次性的：无论成败都用掉
  const runeUsed = consumePending(state, 'break');
  const runeNote = runeUsed > 0 ? `（冲关符生效 +${(runeUsed * 100).toFixed(0)}%）` : '';

  if (rng() < plan.rate) {
    person.realmIndex += 1;
    person.xp = 0;
    person.breakFailures = 0;
    pushLog(state, `${person.name}冲关成功${runeNote}，晋升${realmName(person.realmIndex)}！`, 'cultivate', null, now);
    return {
      ok: true, success: true, name: person.name, runeUsed,
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

/**
 * 「下一步该让谁去冲关」——给界面的建议。
 * 优先返回成功率最高的那个；都不行就返回 null。
 */
function bestBreakthroughCandidate(state) {
  let best = null;
  for (const p of state.cultivation?.cultivators || []) {
    const plan = breakthroughPlan(state, p.id);
    if (!plan.ok) continue;
    if (!best || plan.rate > best.rate) best = plan;
  }
  return best;
}
