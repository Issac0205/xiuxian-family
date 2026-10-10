
/* ────────────────────────────────────────────────────────────────
 * 区块：道心规则
 * 职责：读写道心值、按档位给出三个后果（洞天/攻伐/赋税）、以及「施粥赈济」。
 * 依赖：data/morality.js（表）、systems/schools.js（漂移方向来自主修流派）
 * 调参：数值全在 data/morality.js，本文件不含魔法数字。
 * 文档：docs/85-流派与道心.md
 * ──────────────────────────────────────────────────────────────── */

/** 取（并夹取）当前道心。旧存档没有这个字段，按中庸补上。 */
function moralityOf(state) {
  const v = Number(state?.morality);
  if (!Number.isFinite(v)) {
    state.morality = MORALITY_START;
    return MORALITY_START;
  }
  const clamped = Math.max(MORALITY_MIN, Math.min(MORALITY_MAX, v));
  if (clamped !== v) state.morality = clamped;
  return clamped;
}

/** 当前档位。 */
function moralityTierOf(state) { return moralityTier(moralityOf(state)); }

/** 增减道心，自动夹取。返回实际变化量。 */
function addMorality(state, delta) {
  const before = moralityOf(state);
  const after = Math.max(MORALITY_MIN, Math.min(MORALITY_MAX, before + (Number(delta) || 0)));
  state.morality = after;
  return after - before;
}

/* ── 三个后果：其它区块只调这三个 ── */

/** 洞天生还率的百分点修正。 */
function moralityCaveBonus(state) { return moralityTierOf(state).caveBonus; }
/** 攻伐胜算的百分点修正。 */
function moralityWarBonus(state) { return moralityTierOf(state).warBonus; }
/** 领地赋税的倍率。 */
function moralityTaxMult(state) { return moralityTierOf(state).taxMult; }

/* ── 每步漂移 ── */

/**
 * 道心随时间漂移。
 *
 *   主修邪修功法 → 按 MORALITY_DRIFT_EVIL **持续下坠**，不设底
 *   其余情况     → **回归中道**（离 50 越远回得越快），而不是无限爬升
 *
 * 「回归中道」是刻意的：如果不主动做善事就能一路爬到「道心通明」，
 * 那正道档位就变成了白送的加成，魔道也就没有存在意义。
 * 现在想守住正道必须**持续施粥**，而堕落只需要换一本功法。
 */
function advanceMorality(state, dt, now = Date.now()) {
  if (!(dt > 0)) return;
  const evil = schoolDrift(state);
  let rate;
  if (evil !== 0) {
    rate = evil;
  } else {
    const toward = MORALITY_START - moralityOf(state);
    if (toward === 0) return;
    // 离中道越远，回得越快（上限就是 MORALITY_DRIFT_GOOD）
    const scale = Math.min(1, Math.abs(toward) / 20);
    rate = Math.sign(toward) * MORALITY_DRIFT_GOOD * scale;
  }
  const before = moralityOf(state);
  addMorality(state, rate * dt);
  // 跨档位时记一条 —— 这是玩家该被提醒的时刻
  const t0 = moralityTier(before);
  const t1 = moralityTierOf(state);
  if (t0.id !== t1.id) {
    pushLog(state, `道心${rate < 0 ? '下坠' : '回升'}至「${t1.name}」：${t1.desc}`, 'unlock', null, now);
  }
}

/* ── 施粥赈济：花银两买道心 ── */

/** 询价：能不能施粥。 */
function goodDeedPlan(state) {
  const have = Math.floor(state.silver || 0);
  if (have < GOOD_DEED_SILVER) {
    return { ok: false, reason: `需 ${fmt(GOOD_DEED_SILVER)} 两银（现有 ${fmt(have)}）` };
  }
  if (moralityOf(state) >= MORALITY_MAX) {
    return { ok: false, reason: '道心已至圆满，无需再施' };
  }
  return {
    ok: true, kind: 'good-deed',
    silver: GOOD_DEED_SILVER, gain: GOOD_DEED_GAIN,
    cost: GOOD_DEED_SILVER, currency: 'silver',
    tier: moralityTierOf(state).name,
  };
}

/** 兑现：施粥赈济。 */
function commitGoodDeed(state, now = Date.now()) {
  const plan = goodDeedPlan(state);
  if (!plan.ok) return plan;
  state.silver -= plan.silver;
  const gained = addMorality(state, plan.gain);
  const tier = moralityTierOf(state);
  pushLog(state, `开仓施粥，散银 ${fmt(plan.silver)} 两，道心 +${gained.toFixed(1)}（${tier.name}）。`, 'unlock', null, now);
  return { ok: true, gained, tier: tier.name, reason: `施粥赈济，道心 +${gained.toFixed(1)}，现为「${tier.name}」` };
}
