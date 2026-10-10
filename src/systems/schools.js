
/* ────────────────────────────────────────────────────────────────
 * 区块：流派规则
 * 职责：主修流派的生效与解锁。**只有主修位的流派会生效** ——
 *       辅修只贡献数值，不给机制。所以「主修选哪本」就是「这一世走哪条路」。
 * 依赖：data/schools.js（表）、data/manuals.js、data/realms.js
 * 调参：数值全在 data/schools.js 与 data/morality.js，本文件不含魔法数字。
 * 文档：docs/85-流派与道心.md
 * ──────────────────────────────────────────────────────────────── */

/** 主修位的功法对象（没有则 null）。 */
function mainManualOf(state) {
  const id = state.cultivation?.equippedManual;
  return id ? CULTIVATION_MANUAL_MAP[id] : null;
}

/** 主修功法的流派定义。没有主修、或主修是没标 school 的旧功法，都算玄门正宗。 */
function mainSchoolOf(state) { return schoolOf(mainManualOf(state)); }

/** 倍率类效果的默认值；其余都按加法从 0 起。 */
const SCHOOL_MULT_KEYS = ['birthMult', 'deathMult'];

/**
 * 取当前主修流派在某一项上的效果。
 * @param {string} key fx 的键
 * @param {number} scale 位置比例（目前恒为 1 —— 流派只认主修）
 */
function schoolFx(state, key, scale = 1) {
  const s = mainSchoolOf(state);
  const v = s?.fx?.[key];
  const base = SCHOOL_MULT_KEYS.includes(key) ? 1 : 0;
  if (v === undefined) return base;
  // 倍率类的「缩放」是往 1 靠拢，加法类直接乘
  return SCHOOL_MULT_KEYS.includes(key) ? 1 + (v - 1) * scale : v * scale;
}

/** 主修流派的道心漂移速率（玄门为正统，0）。 */
function schoolDrift(state) { return mainSchoolOf(state)?.drift || 0; }

/** 主修流派是否解锁了某个动作。 */
function schoolUnlocks(state, actionId) {
  return mainSchoolOf(state)?.unlock === actionId;
}

/** 凡人出生率倍率（合欢宗的主场）。 */
function schoolBirthMult(state) { return schoolFx(state, 'birthMult'); }
/** 凡人死亡率倍率（血煞的代价）。 */
function schoolDeathMult(state) { return schoolFx(state, 'deathMult'); }

/* ── 炼人丹 ── */

/** 当前有多少枚人丹。 */
function humanPillCount(state) {
  return Math.max(0, Math.floor(Number(state.cultivation?.humanPills) || 0));
}

/**
 * 询价：能不能炼一枚人丹。
 *
 * 人丹的原料是**人**。所以它同时消耗凡人人口与道心 ——
 * 前者是家族的银两来源，后者是洞天里的保命符。
 * 「用命换修为」在这里是字面意思。
 */
function humanPillPlan(state) {
  if (!schoolUnlocks(state, 'humanPill')) {
    return { ok: false, reason: '需主修「血煞魔功」一脉的功法' };
  }
  const pop = Math.floor(state.population || 0);
  if (pop < HUMAN_PILL_MORTALS + 1) {
    return { ok: false, reason: `需至少 ${HUMAN_PILL_MORTALS + 1} 名凡人（现有 ${pop}）` };
  }
  if ((state.spiritStones || 0) < HUMAN_PILL_STONES) {
    return { ok: false, reason: `需 ${HUMAN_PILL_STONES} 灵石` };
  }
  return {
    ok: true, kind: 'human-pill',
    mortals: HUMAN_PILL_MORTALS, stones: HUMAN_PILL_STONES,
    moralityCost: MORALITY_HUMAN_PILL_COST,
    have: humanPillCount(state),
    cost: HUMAN_PILL_STONES, currency: 'stones',
  };
}

/** 兑现：炼一枚人丹。 */
function commitHumanPill(state, now = Date.now()) {
  const plan = humanPillPlan(state);
  if (!plan.ok) return plan;
  state.population = Math.max(0, (state.population || 0) - plan.mortals);
  state.spiritStones -= plan.stones;
  const c = state.cultivation;
  c.humanPills = humanPillCount(state) + 1;
  const dm = addMorality(state, plan.moralityCost);
  const tier = moralityTierOf(state);
  pushLog(state, `炉开人丹，献祭凡人 ${plan.mortals} 口。道心 ${dm.toFixed(1)}，现为「${tier.name}」。`,
    'cultivate', null, now);
  return {
    ok: true, mortals: plan.mortals, total: c.humanPills,
    morality: dm, tier: tier.name,
    reason: `炼成人丹 ×1（献祭 ${plan.mortals} 名凡人，道心 ${dm.toFixed(1)} → 「${tier.name}」）`,
  };
}

/** 询价：把一枚人丹给某位修士服下。 */
function humanPillUsePlan(state, personId) {
  const person = findCultivator(state, personId);
  if (!person) return { ok: false, reason: '修士不存在' };
  if (humanPillCount(state) < 1) return { ok: false, reason: '没有人丹可用' };
  const need = realmXpNeeded(person.realmIndex);
  if (!Number.isFinite(need)) return { ok: false, reason: '此人已至此界尽头' };
  const headroom = Math.max(0, need - (person.xp || 0));
  if (headroom <= 0) return { ok: false, reason: '此人修为已满，先让他晋阶' };
  return {
    ok: true, kind: 'use-human-pill', personId: person.id, name: person.name,
    realm: realmName(person.realmIndex),
    gain: Math.min(headroom, Math.floor(need * HUMAN_PILL_XP_RATIO)),
    have: humanPillCount(state),
  };
}

/** 兑现：服下人丹。 */
function commitUseHumanPill(state, personId, now = Date.now()) {
  const plan = humanPillUsePlan(state, personId);
  if (!plan.ok) return plan;
  const person = findCultivator(state, personId);
  const c = state.cultivation;
  c.humanPills = humanPillCount(state) - 1;
  person.xp = Math.min(realmXpNeeded(person.realmIndex), (person.xp || 0) + plan.gain);
  pushLog(state, `${person.name}服下人丹，修为暴涨 ${plan.gain} 点。`, 'cultivate', null, now);
  return {
    ok: true, name: person.name, gain: plan.gain, left: c.humanPills,
    reason: `${person.name}服下人丹，修为 +${plan.gain}（余 ${c.humanPills} 枚）`,
  };
}
