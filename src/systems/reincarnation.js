
/* ────────────────────────────────────────────────────────────────
 * 区块：轮回规则
 * 职责：轮回门槛与点数结算、轮回重置（保留元进度）、金手指的解锁与生效。
 * 依赖：data/reincarnation.js（表）、data/realms.js、core/state.js 的 createState
 * 调参：数值全在 data/reincarnation.js，本文件不含魔法数字。
 * 文档：docs/60_周目与金手指.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 轮回重置时**必须保留**的顶层字段。
 *
 * 这份名单是这一区块最容易出错的地方：漏掉一个就会被玩家当成「我的进度没了」。
 *   meta                 —— 元进度本身，不保留就等于没有周目系统
 *   settings             —— 难度、答题频率、倍速，这些是玩家偏好不是进度
 *   quiz / wordStats     —— 答题的学习记录。**英语单词掌握程度不该因为重开而清空**
 *   customQuizStats / customWrongBooks —— 同上，自定义题库的错题本
 *   ui                   —— 界面偏好（买法、折叠状态）
 */
const REINCARNATION_KEEP = [
  'meta', 'settings', 'quiz', 'wordStats',
  'customQuizStats', 'customWrongBooks', 'ui',
];

/** 本局的最高境界。 */
function topRealmIndexOf(state) {
  let top = 0;
  for (const p of state.cultivation?.cultivators || []) {
    top = Math.max(top, Math.floor(p.realmIndex) || 0);
  }
  return top;
}

/**
 * 结算这一局的轮回点。
 * 刻意做成「看得见的算式」——玩家应当能预期重开能拿多少。
 */
function reincarnationReward(state) {
  const held = worldOf(state).held.length;
  const manuals = (state.cultivation?.manuals || []).length;
  const top = topRealmIndexOf(state);
  const fromHold = held * REINCARNATION_POINT_PER_HOLD;
  const fromManuals = Math.floor(manuals / REINCARNATION_POINT_PER_MANUALS);
  const fromRealm = Math.max(0, Math.floor((top - REINCARNATION_MIN_INDEX) / REINCARNATION_POINT_PER_REALM));
  return {
    base: REINCARNATION_POINT_BASE,
    fromHold, held,
    fromManuals, manuals,
    fromRealm, top,
    total: REINCARNATION_POINT_BASE + fromHold + fromManuals + fromRealm,
  };
}

/** 能不能轮回、能拿多少点。 */
function reincarnationProgress(state) {
  const top = topRealmIndexOf(state);
  const reward = reincarnationReward(state);
  if (top < REINCARNATION_MIN_INDEX) {
    return {
      canEnd: false, top, reward,
      reason: `需有族人修至 ${realmName(REINCARNATION_MIN_INDEX)}（现最高 ${top ? realmName(top) : '凡人'}）`,
    };
  }
  return { canEnd: true, top, reward, reason: '' };
}

/* ── 金手指 ── */

/** 已解锁的金手指定义。 */
function unlockedFingers(state) {
  return metaOf(state).unlocked.map((id) => GOLDEN_FINGER_MAP[id]).filter(Boolean);
}

/** 花轮回点永久解锁一个金手指。 */
function unlockFinger(state, id) {
  const f = GOLDEN_FINGER_MAP[id];
  if (!f) return { ok: false, reason: '并无此物' };
  const m = metaOf(state);
  if (m.unlocked.includes(id)) return { ok: false, reason: `${f.name}已经解锁` };
  if (m.points < f.cost) {
    return { ok: false, reason: `需 ${f.cost} 点轮回（现 ${m.points} 点）` };
  }
  m.points -= f.cost;
  m.unlocked.push(id);
  return { ok: true, name: f.name, cost: f.cost, points: m.points, reason: `解锁${f.name}，耗 ${f.cost} 点轮回` };
}

/**
 * 指定下一周目携带哪些金手指。
 * 只能从**已解锁**里挑，且不超过 GOLDEN_FINGER_SLOTS 个。
 */
function setActiveFingers(state, ids) {
  const m = metaOf(state);
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => GOLDEN_FINGER_MAP[id]))];
  const notOwned = wanted.filter((id) => !m.unlocked.includes(id));
  if (notOwned.length) {
    return { ok: false, reason: `尚未解锁：${notOwned.map((id) => GOLDEN_FINGER_MAP[id].name).join('、')}` };
  }
  if (wanted.length > GOLDEN_FINGER_SLOTS) {
    return { ok: false, reason: `最多只能带 ${GOLDEN_FINGER_SLOTS} 件金手指` };
  }
  m.active = wanted;
  return { ok: true, active: m.active.slice(), reason: `已选 ${wanted.length} 件金手指` };
}

/**
 * 轮回后应用金手指的开局效果。
 * 目前只有「前世记忆」需要动初始状态（科技与已知地点）。
 */
function applyFingerStart(state, now = Date.now()) {
  const notes = [];
  for (const f of activeFingers(state)) {
    for (const t of f.fx?.startTechs || []) {
      if (!state.techs.includes(t)) { state.techs.push(t); notes.push(`已知${TECH_MAP[t]?.name || t}`); }
    }
    for (const nodeId of f.fx?.startReached || []) {
      if (MAP_NODE_MAP[nodeId]) mapReach(state, nodeId);
    }
  }
  if (notes.length) {
    pushLog(state, `前世记忆苏醒：${notes.join('、')}。`, 'unlock', null, now);
  }
  return notes;
}

/**
 * 轮回。
 *
 * ⚠️ 这是全篇唯一会**销毁玩家进度**的操作，所以：
 *   1. 它必须由玩家显式确认（界面上有二次确认）
 *   2. 保留名单写在 REINCARNATION_KEEP，且测试里逐项验过
 *   3. 结算完点数与金手指之后才重置，任何一步失败都不会留下半个状态
 */
function commitReincarnation(state, chosenIds, now = Date.now()) {
  const prog = reincarnationProgress(state);
  if (!prog.canEnd) return { ok: false, reason: prog.reason };

  const m = metaOf(state);
  const picks = [...new Set((Array.isArray(chosenIds) ? chosenIds : m.active).filter((id) => GOLDEN_FINGER_MAP[id]))]
    .filter((id) => m.unlocked.includes(id))
    .slice(0, GOLDEN_FINGER_SLOTS);
  const reward = prog.reward;

  // 先把要保留的东西拿出来
  const kept = {};
  for (const k of REINCARNATION_KEEP) kept[k] = state[k];

  // 重建一局全新的
  const fresh = createState();
  for (const k of Object.keys(fresh)) state[k] = fresh[k];
  for (const k of REINCARNATION_KEEP) {
    if (kept[k] !== undefined) state[k] = kept[k];
  }
  // ⚠️ createState 只给骨架，丹房 / 器坊 / 符房 / 地图世界都是惰性初始化的。
  //    重置之后必须归一化一次，否则新周目的头几帧会读到 undefined。
  repairCultivation(state);

  // 元进度结算（在重置之后写回，免得被 fresh 覆盖）
  state.meta = {
    ...m,
    cycle: m.cycle + 1,
    cleared: m.cleared + 1,
    points: m.points + reward.total,
    active: picks,
    history: [...m.history, { cycle: m.cycle, top: reward.top, points: reward.total, at: now }].slice(-20),
  };
  metaOf(state);

  const notes = applyFingerStart(state, now);
  pushLog(state, `第 ${m.cycle} 世终了，重入轮回。得轮回点 ${reward.total}。`, 'unlock', null, now);
  return {
    ok: true, cycle: state.meta.cycle, gained: reward.total,
    points: state.meta.points, active: picks.slice(), notes,
    reason: `轮回第 ${state.meta.cycle} 世，得 ${reward.total} 点轮回`,
  };
}

/* ── 效果出口：其它区块只调这几个函数 ── */

/** 药材 / 矿料 / 符文 的产出倍率（掌天瓶）。 */
function metaMaterialMult(state) { return fingerFx(state, 'materialMult', 1); }
/** 全族修炼倍率（掌天瓶的代价、天生道体的增益）。 */
function metaTrainMult(state) { return fingerFx(state, 'trainMult', 1); }
/** 冲关成功率加成（戒中老者）。 */
function metaBreakBonus(state) { return fingerFx(state, 'breakBonus', 0); }
/** 洞天生还率加成（气运加身）。 */
function metaSurvivalBonus(state) { return fingerFx(state, 'survivalBonus', 0); }
/** 灵石产出倍率（气运加身的代价）。 */
function metaStoneMult(state) { return fingerFx(state, 'stoneMult', 1); }
