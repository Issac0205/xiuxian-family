
/* ────────────────────────────────────────────────────────────────
 * 区块：功法规则：加成聚合、参悟、换装、洞天生还率
 * 原属 src/data/cultivation.js 第 111–219 行
 * ──────────────────────────────────────────────────────────────── */
function manualEffectAt(state, id, ratio) {
  const m = CULTIVATION_MANUAL_MAP[id];
  if (!m) return {};
  const k = ratio * (1 + MANUAL_ATTUNE_STEP * manualAttune(state, id));
  const out = {};
  for (const [key, v] of Object.entries(m.effect || {})) out[key] = v * k;
  return out;
}

/** 主修 + 辅修合并后的总加成。这是全族共享的，与具体修士无关。 */
const MANUAL_EFFECT_KEYS = ['training', 'power', 'labor', 'explore', 'survive', 'stones'];
function manualBonus(state) {
  const acc = {};
  for (const k of MANUAL_EFFECT_KEYS) acc[k] = 0;
  const c = state.cultivation;
  if (!c) return acc;
  const owned = Array.isArray(c.manuals) ? c.manuals : [];
  const add = (id, ratio) => {
    if (!id || !owned.includes(id)) return;
    const e = manualEffectAt(state, id, ratio);
    for (const k of MANUAL_EFFECT_KEYS) acc[k] += (e[k] || 0);
  };
  add(c.equippedManual, 1);
  if (c.assistManual !== c.equippedManual) add(c.assistManual, MANUAL_ASSIST_RATIO);
  return acc;
}

/**
 * 某本功法对**某个人**的实际效果。
 *
 * 与 manualEffectAt 的区别：这里要过灵根。
 *   - 灵根不合（比如火灵根去修「御守」的金系功法）→ 返回 null，一点都吃不到
 *   - 天灵根对本系功法有专精倍率（×1.5）
 * 家族可以装备任意功法，但只有灵根对得上的族人才真能得到好处 ——
 * 所以「族人灵根够杂」本身就是一种资产。
 */
function manualEffectForPerson(state, person, id, ratio) {
  const m = CULTIVATION_MANUAL_MAP[id];
  if (!m) return null;
  if (!rootCanLearn(person, m)) return null;
  const k = ratio * (1 + MANUAL_ATTUNE_STEP * manualAttune(state, id)) * rootFocusMult(person, m);
  const out = {};
  for (const [key, v] of Object.entries(m.effect || {})) out[key] = v * k;
  return out;
}

/** 某个人实际吃到的功法总加成（已过灵根与专精）。 */
function manualBonusFor(state, person) {
  const acc = {};
  for (const k of MANUAL_EFFECT_KEYS) acc[k] = 0;
  const c = state.cultivation;
  if (!c || !person) return acc;
  const owned = Array.isArray(c.manuals) ? c.manuals : [];
  const add = (id, ratio) => {
    if (!id || !owned.includes(id)) return;
    const e = manualEffectForPerson(state, person, id, ratio);
    if (!e) return;
    for (const k of MANUAL_EFFECT_KEYS) acc[k] += (e[k] || 0);
  };
  add(c.equippedManual, 1);
  if (c.assistManual !== c.equippedManual) add(c.assistManual, MANUAL_ASSIST_RATIO);
  return acc;
}

/** 某本功法当前的参悟度。 */
function manualAttune(state, id) {
  const v = Number(state.cultivation?.attune?.[id]);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MANUAL_ATTUNE_MAX, Math.floor(v)));
}

/**
 * 家族修炼倍率（不过滤灵根，是「这套功法理论上能给的量」）。
 * 用于功法阁展示与旧调用点；实际每人吃到的以 manualTrainingMultiplierFor 为准。
 * 只作用于「闭关」修士——宗门修的是宗门的法，家族功法传不进山门。
 */
function manualTrainingMultiplier(state) {
  return 1 + manualBonus(state).training;
}

/** 某个人实际吃到的修炼倍率（过了灵根与专精）。 */
function manualTrainingMultiplierFor(state, person) {
  return 1 + manualBonusFor(state, person).training;
}

/**
 * 洞天生还率。
 *
 * 早先这个公式在「结算 / 面板预估 / 确认框」三处各写了一遍，
 * 加了「涉险」功法加成之后立刻就会三处不一致、UI 对玩家撒谎。
 * 现在只有这一份，三处都调它。
 */
function caveSurvival(state, person, cave) {
  // 「涉险」加成要过这个人的灵根：火灵根才吃得到
  const mb = manualBonusFor(state, person);
  // 法宝（太虚镜之类）额外保命，全族共享
  const art = artifactBonus(state);
  // 护身符挂着的「下一次」加成
  const rune = runePending(state, 'cave');
  // 金手指「气运加身」的常驻加成
  const meta = metaSurvivalBonus(state);
  // 道心（低则天谴）与剑修流派（好斗，进洞天反而吃亏）
  const moral = moralityCaveBonus(state) + schoolFx(state, 'caveBonus');
  // 层差按全局 realmIndex 算。炼气期的 index 与「层数」同值，所以既有的配平不变。
  const levelGap = Math.max(0, (cave?.realm || 1) - (person?.realmIndex || 1));
  const base = .82 * Math.exp(-.78 * levelGap) * (person?.talent || 1);
  return Math.max(.015, Math.min(.98, base + mb.survive + art.survive + rune + meta + moral));
}

/** 该道途当前是否已被某个位置占用（同途不可两立）。 */function manualDaoTaken(state, dao, exceptId) {
  const c = state.cultivation;
  if (!c) return false;
  for (const id of [c.equippedManual, c.assistManual]) {
    if (!id || id === exceptId) continue;
    if (CULTIVATION_MANUAL_MAP[id]?.dao === dao) return true;
  }
  return false;
}

/** 换装：主修 / 辅修。返回 {ok, reason}。 */
function equipManual(state, id, slot) {
  const c = state.cultivation;
  if (!CULTIVATION_MANUAL_MAP[id]) return { ok:false, reason:'并无此功法' };
  if (!c.manuals.includes(id)) return { ok:false, reason:'尚未收录该功法' };
  const isAssistSlot = slot === 'assist';
  // 已经在目标位置上了就别重复设。界面会把按钮禁掉，但接口自己也得挡住——
  // 否则从控制台或未来的新入口进来就会写出一条无意义的日志。
  if (isAssistSlot ? c.assistManual === id : c.equippedManual === id) {
    return { ok:false, reason:`《${CULTIVATION_MANUAL_MAP[id].name}》已列为${isAssistSlot ? '辅修' : '主修'}` };
  }
  const dao = CULTIVATION_MANUAL_MAP[id].dao;
  const other = isAssistSlot ? c.equippedManual : c.assistManual;
  if (other === id) {
    return { ok:false, reason:`《${CULTIVATION_MANUAL_MAP[id].name}》已占${isAssistSlot ? '主修' : '辅修'}位` };
  }
  if (manualDaoTaken(state, dao, id)) {
    return { ok:false, reason:`${MANUAL_DAOS[dao].name}一途不可同时占两位` };
  }
  if (isAssistSlot) c.assistManual = id; else c.equippedManual = id;
  const where = isAssistSlot ? '辅修' : '主修';
  return { ok:true, reason:`《${CULTIVATION_MANUAL_MAP[id].name}》已列为${where}` };
}

/** 主动参悟：花灵石与秘闻线索换一层。 */
function attuneManual(state, id, rng) {
  const c = state.cultivation;
  if (!CULTIVATION_MANUAL_MAP[id]) return { ok:false, reason:'并无此功法' };
  if (!c.manuals.includes(id)) return { ok:false, reason:'尚未收录该功法' };
  const cur = manualAttune(state, id);
  if (cur >= MANUAL_ATTUNE_MAX) return { ok:false, reason:'此功法已参悟至圆满' };
  if (state.spiritStones < MANUAL_ATTUNE_STONE_COST) {
    return { ok:false, reason:`参悟需 ${MANUAL_ATTUNE_STONE_COST} 灵石` };
  }
  if (c.clues < MANUAL_ATTUNE_CLUE_COST) {
    return { ok:false, reason:`参悟需 ${MANUAL_ATTUNE_CLUE_COST} 条秘闻线索` };
  }
  state.spiritStones -= MANUAL_ATTUNE_STONE_COST;
  c.clues -= MANUAL_ATTUNE_CLUE_COST;
  c.attune[id] = cur + 1;
  return { ok:true, reason:`《${CULTIVATION_MANUAL_MAP[id].name}》参悟至 ${cur + 1} 层` };
}