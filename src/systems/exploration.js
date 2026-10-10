
/* ────────────────────────────────────────────────────────────────
 * 区块：地图与征伐
 * 职责：
 *   1. 抵达与相邻 —— 只能对「已抵达节点的邻居」动手
 *   2. 探险（洞天）与攻伐（势力）的判定与结算
 *   3. 占领与镇守 —— 占下来的势力节点要派人镇守才有产出，
 *      镇守不足会积累民怨，满了就叛离
 * 依赖：data/map.js（地图表）、systems/manuals.js（洞天生还率）、
 *       systems/roots.js、data/realms.js
 * 调参：数值全在 data/map.js，本文件不含魔法数字。
 * 文档：docs/40-地图与征伐.md
 * ──────────────────────────────────────────────────────────────── */

/** 取（并初始化）世界状态。旧的 conquests 会被迁移成 held。 */
function worldOf(state) {
  const c = state.cultivation;
  if (!c) return { reached: [], held: [], garrison: {}, unrest: {} };
  if (!c.world || typeof c.world !== 'object') c.world = {};
  const w = c.world;
  if (!Array.isArray(w.reached)) w.reached = [];
  // 旧存档的占领记录在 conquests 里，迁移过来
  if (!Array.isArray(w.held)) w.held = Array.isArray(c.conquests) ? c.conquests.slice() : [];
  w.held = w.held.filter((id) => MAP_NODE_MAP[id] && MAP_NODE_MAP[id].kind === 'foe');
  if (!w.garrison || typeof w.garrison !== 'object') w.garrison = {};
  if (!w.unrest || typeof w.unrest !== 'object') w.unrest = {};
  w.reached = w.reached.filter((id) => MAP_NODE_MAP[id]);
  // 站在起点上：只要踏入了炼气篇，起点就算抵达
  if (w.reached.length === 0 && (c.cultivators || []).length > 0) {
    w.reached.push(MAP_START_ID);
  }
  // 清掉指向不存在节点的镇守记录
  for (const id of Object.keys(w.garrison)) {
    if (!MAP_NODE_MAP[id] || !w.held.includes(id)) delete w.garrison[id];
  }
  return w;
}

/** 这个节点玩家到了没。 */
function mapReached(state, nodeId) { return worldOf(state).reached.includes(nodeId); }

/** 这个节点打下来没。 */
function mapHeld(state, nodeId) { return worldOf(state).held.includes(nodeId); }

/**
 * 能不能对这个节点动手：必须已经抵达，或者有一个已抵达的邻居。
 * 这是整张地图唯一的门槛 —— 想深入就得先打通相邻那一格。
 */
function mapAccessible(state, nodeId) {
  const node = mapNode(nodeId);
  if (!node) return false;
  const w = worldOf(state);
  if (w.reached.includes(nodeId)) return true;
  return mapNeighbors(node).some((n) => w.reached.includes(n.id));
}

/** 抵达一个节点（探险或攻伐成功后调用）。 */
function mapReach(state, nodeId) {
  const w = worldOf(state);
  if (MAP_NODE_MAP[nodeId] && !w.reached.includes(nodeId)) w.reached.push(nodeId);
}

/**
 * 节点的界面状态：
 *   'locked' 还不能去（没有已抵达的邻居）
 *   'open'   可以去，但还没拿下
 *   'cleared'洞天已探明（洞天没有「占领」，探过就是探过）
 *   'held'   势力已占领
 */
function mapNodeStatus(state, nodeId) {
  const node = mapNode(nodeId);
  if (!node) return 'locked';
  const w = worldOf(state);
  if (node.kind === 'foe' && w.held.includes(nodeId)) return 'held';
  if (!mapAccessible(state, nodeId)) return 'locked';
  return 'open';
}

/* ── 战力换算 ── */

/** 单个修士的战力（含灵根带来的功法加成；不含驻守的 +50%）。 */
function cultivatorPower(state, person) {
  if (!person) return 0;
  const idx = Math.max(0, Math.min(cultivateLevelCap(person), person.realmIndex || 0));
  return cultivateBasePower(idx) * (1 + manualBonusFor(state, person).power);
}

/** 某节点当前的镇守战力。 */
function mapHoldStrength(state, nodeId) {
  const w = worldOf(state);
  const pid = w.garrison[nodeId];
  if (pid === undefined) return 0;
  const p = findCultivator(state, pid);
  if (!p) return 0;
  return cultivatorPower(state, p);
}

/** 势力节点当前是否被有效镇守。 */
function mapIsPacified(state, nodeId) {
  const node = mapNode(nodeId);
  if (!node || node.kind !== 'foe') return false;
  return mapHoldStrength(state, nodeId) >= mapHoldPower(node);
}

/** 所有已占领节点的产出合计（灵石/秒）。镇守不足的不产出。 */
function mapYieldPerSec(state) {
  const w = worldOf(state);
  const tax = moralityTaxMult(state);
  let total = 0;
  for (const id of w.held) {
    if (!mapIsPacified(state, id)) continue;
    total += (mapNode(id)?.yield || 0) * tax;
  }
  return total;
}

/* ── 镇守指派 ── */

/** 可以被派去镇守的人（宗门修士不可）。 */
function mapGarrisonCandidates(state) {
  return (state.cultivation?.cultivators || []).filter((p) => p.job !== 'sect');
}

/**
 * 派人镇守某节点。会自动把他从原来的位置调过来（原先镇守别处则解除）。
 */
function mapAssignGarrison(state, nodeId, personId) {
  const node = mapNode(nodeId);
  if (!node || node.kind !== 'foe') return { ok: false, reason: '只有势力领地需要镇守' };
  const w = worldOf(state);
  if (!w.held.includes(nodeId)) return { ok: false, reason: '尚未占领此地' };
  const p = findCultivator(state, personId);
  if (!p) return { ok: false, reason: '修士不存在' };
  if (p.job === 'sect') return { ok: false, reason: '宗门修士不可调回' };
  // 一个人只能镇守一处
  for (const id of Object.keys(w.garrison)) {
    if (w.garrison[id] === p.id) delete w.garrison[id];
  }
  w.garrison[nodeId] = p.id;
  p.job = 'garrison';
  return { ok: true, reason: `${p.name}前往${node.name}镇守（战力 ${Math.round(cultivatorPower(state, p))} / 需 ${mapHoldPower(node)}）` };
}

/** 撤掉某节点的镇守。 */
function mapClearGarrison(state, nodeId) {
  const w = worldOf(state);
  const pid = w.garrison[nodeId];
  if (pid === undefined) return { ok: false, reason: '此地向无镇守' };
  const p = findCultivator(state, pid);
  delete w.garrison[nodeId];
  if (p && p.job === 'garrison') p.job = 'retreat';
  return { ok: true, reason: `${p ? p.name : '镇守者'}已撤回` };
}

/* ── 每帧推进：产出与民怨 ── */

/**
 * 领地结算。放在时间推进里每步调用。
 * 已占领但镇守不足的节点会积累民怨，涨满 1 就叛离（从 held 里去掉）。
 */
function advanceTerritories(state, dt, now = Date.now()) {
  const w = worldOf(state);
  if (!w.held.length || !(dt > 0)) return;
  for (const id of w.held.slice()) {
    const node = mapNode(id);
    if (!node) continue;
    if (mapIsPacified(state, id)) {
      // 金手指：掌天瓶翻材料、气运加身砍灵石；再乘一层道心的民心倍率
      // —— 魔道能打，但治下的人不肯交粮
      state.spiritStones = (state.spiritStones || 0) + (node.yield || 0) * dt * metaStoneMult(state) * moralityTaxMult(state);
      // 药材、矿料、符文跟赋税同规则：只有当有效镇守时才产出
      const matMult = metaMaterialMult(state);
      if (node.herb) addHerbs(state, node.herb, (node.herbYield || 0) * dt * matMult);
      if (node.ore) addOres(state, node.ore, (node.oreYield || 0) * dt * matMult);
      if (node.rune) addRuneMats(state, node.rune, (node.runeYield || 0) * dt * matMult);
      w.unrest[id] = Math.max(0, (Number(w.unrest[id]) || 0) - MAP_CALM_PER_SEC * dt);
      continue;
    }
    const next = (Number(w.unrest[id]) || 0) + MAP_UNREST_PER_SEC * dt;
    if (next >= 1) {
      delete w.unrest[id];
      const pid = w.garrison[id];
      delete w.garrison[id];
      const p = pid === undefined ? null : findCultivator(state, pid);
      if (p && p.job === 'garrison') p.job = 'retreat';
      w.held = w.held.filter((x) => x !== id);
      state.cultivation.conquests = w.held.slice();
      pushLog(state, `${node.name}镇守不足，民心离散，已叛离。`, 'cultivate', null, now);
      continue;
    }
    w.unrest[id] = next;
  }
  state.cultivation.conquests = w.held.slice();
}

/* ── 询价 ── */

/**
 * 对这个节点能做什么。界面据此决定按钮文案与禁用态。
 * 与 commit 分离，所以界面上写的代价与实际扣除的一致。
 */
function mapPlan(state, nodeId) {
  const node = mapNode(nodeId);
  if (!node) return { ok: false, reason: '并无此地' };
  const w = worldOf(state);
  const status = mapNodeStatus(state, nodeId);
  if (status === 'locked') return { ok: false, reason: '与此地不相邻，需先打通沿途', status };

  if (node.kind === 'cave') {
    if ((state.spiritStones || 0) < node.fee) {
      return { ok: false, reason: `需 ${node.fee} 灵石`, status };
    }
    if ((state.cultivation?.clues || 0) < node.clues) {
      return { ok: false, reason: `需 ${node.clues} 条秘闻线索`, status };
    }
    return {
      ok: true, kind: 'cave', node, status,
      name: node.name, tier: node.tier,
      fee: node.fee, clues: node.clues, suggested: realmName(node.realm),
      cost: node.fee, currency: 'stones',
    };
  }

  // 势力
  if (w.held.includes(nodeId)) {
    return { ok: false, reason: '已占领此地', status };
  }
  if (!(state.cultivation?.cultivators || []).length) {
    return { ok: false, reason: '至少需要一名修士', status };
  }
  const power = derive(state).totalPower;
  // 破阵符挂着的「下一次」加成（百分点，直接加在胜算上）；
  // 道心的「凶名」（魔道守方先怯）与剑修的攻伐加成也加在这里
  const rune = runePending(state, 'attack');
  const moral = moralityWarBonus(state) + schoolFx(state, 'warBonus');
  const rate = Math.max(.05, Math.min(.95, power / (power + node.power) + rune + moral));
  return {
    ok: true, kind: 'foe', node, status,
    name: node.name, tier: node.tier,
    enemyPower: node.power, rate, runeBonus: rune,
    power, stones: node.stones,
    holdPower: mapHoldPower(node), yield: node.yield,
    cost: 0, currency: 'none',
  };
}

/* ── 结算 ── */

/** 探险一处洞天。失败会永久失去该修士。 */
function commitExplore(state, nodeId, personId, now = Date.now(), rng = Math.random) {
  const plan = mapPlan(state, nodeId);
  if (!plan.ok || plan.kind !== 'cave') return plan;
  const node = plan.node;
  const c = state.cultivation;
  const p = findCultivator(state, personId);
  if (!p) return { ok: false, reason: '请选择修士' };
  if (p.job === 'sect') return { ok: false, reason: '宗门修士不可擅自离宗探险' };

  state.spiritStones -= node.fee;
  c.clues = Math.max(0, c.clues - node.clues);
  c.caveRuns = (c.caveRuns || 0) + 1;
  mapReach(state, nodeId);

  const mb = manualBonusFor(state, p);
  const survival = caveSurvival(state, p, node);
  // 护身符是一次性的：用掉就没了
  const runeUsed = consumePending(state, 'cave');
  if (runeUsed > 0) c.runes.used = (c.runes.used || 0) + 1;
  const runeNote = runeUsed > 0 ? `（护身符生效 +${(runeUsed * 100).toFixed(0)}%）` : '';
  // 进洞天会磨损法器（法宝尤其）
  const broken = wearArtifacts(state, 'cave');
  const wearNote = broken.length ? `；${broken.join('、')}耐久耗尽，已失其效` : '';
  if (rng() > survival) {
    c.cultivators = c.cultivators.filter((v) => v !== p);
    c.qi = c.cultivators.length;
    return {
      ok: true, success: false, name: p.name, node: node.name, survival, broken, runeUsed,
      reason: `${p.name}探索${node.name}失踪，生还概率为${(survival * 100).toFixed(1)}%${runeNote}，修士永久损失！${wearNote}`,
    };
  }
  const reward = node.stones * (.7 + rng() * .65) * (1 + mb.stones);
  state.spiritStones += reward;
  let reason = `${p.name}平安归来，获得 ${reward.toFixed(2)} 灵石${runeNote}${wearNote}`;
  let drop = null;
  if (rng() < node.manual) {
    drop = grantManual(state, Math.min(3, node.tier), rng);
    reason += manualDropText(drop);
  }
  return { ok: true, success: true, name: p.name, node: node.name, reward, survival, drop, broken, runeUsed, reason };
}

/**
 * 攻伐一处势力。
 *
 * 与旧版最大的区别：**占领之后要派人镇守才有产出**，
 * 镇守不足会积累民怨直至叛离。所以「打下来」不再是终点。
 */
function commitAttack(state, nodeId, now = Date.now(), rng = Math.random) {
  const plan = mapPlan(state, nodeId);
  if (!plan.ok || plan.kind !== 'foe') return plan;
  const node = plan.node;
  const c = state.cultivation;
  const w = worldOf(state);
  // 破阵符是一次性的：无论胜负都用掉
  const runeUsed = consumePending(state, 'attack');
  const runeNote = runeUsed > 0 ? `（破阵符生效 +${(runeUsed * 100).toFixed(0)}%）` : '';

  if (rng() < plan.rate) {
    w.held.push(nodeId);
    c.conquests = w.held.slice();
    mapReach(state, nodeId);
    state.spiritStones += node.stones;
    // 攻城也会磨损法器（护甲尤其）
    const broken = wearArtifacts(state, 'attack');
    let reason = `攻下${node.name}${runeNote}，获得 ${node.stones} 灵石`;
    if (rng() < node.manual) reason += manualDropText(grantManual(state, Math.min(3, node.tier), rng));
    reason += `。需派修士镇守（战力 ${mapHoldPower(node)}）方能收取赋税`;
    if (broken.length) reason += `；${broken.join('、')}耐久耗尽，已失其效`;
    return { ok: true, success: true, node: node.name, stones: node.stones, holdPower: mapHoldPower(node), broken, runeUsed, reason };
  }

  const broken = wearArtifacts(state, 'attack');
  const wearNote = broken.length ? `；${broken.join('、')}耐久耗尽` : '';
  const defenders = (c.cultivators || []).filter((p) => p.job !== 'sect' && p.job !== 'garrison');
  if (defenders.length && rng() < .65) {
    const victim = defenders[Math.floor(rng() * defenders.length)];
    c.cultivators = c.cultivators.filter((p) => p !== victim);
    c.qi = c.cultivators.length;
    return { ok: true, success: false, node: node.name, reason: `攻伐${node.name}败退${runeNote}，${victim.name}阵亡！${wearNote}` };
  }
  return { ok: true, success: false, node: node.name, reason: `攻伐${node.name}失利${runeNote}，幸无修士阵亡${wearNote}` };
}
