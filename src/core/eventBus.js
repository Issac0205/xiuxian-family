
/* ────────────────────────────────────────────────────────────────
 * 区块：事件总线（EventBus）
 * 职责：让系统之间**互相不知道对方存在**。A 系统只广播「发生了什么」，
 *       谁关心谁自己订阅。
 * 依赖：无。**纯内存**：不碰 state、不碰 DOM、不碰计时器。
 * 文档：docs/103-架构分层与事件总线.md
 *
 * 为什么要有它（用户建议 · 第三阶段）：
 *   现在「修士入册」这个动作会**顺带**把族谱日志写了 —— 于是修士系统必须
 *   知道族谱存在。以后再加成就、任务、音效，就得每次回头改修士系统。
 *   改成一个 emit + 各自订阅之后，系统之间不再有横向依赖。
 *
 * ⚠ 三条硬约束（都是本项目已经踩过的坑，不是理论洁癖）：
 *   1. **订阅者抛错绝不许影响 emit 的调用方** —— 一个写坏的成就系统不能把
 *      整帧 tick 炸掉。这条必须可验证（断言里真的让订阅者抛错）。
 *   2. **重入要有上限**：同一事件在订阅者里再 emit 同一事件，超过深度就掐掉
 *      并告警，防止无声死循环把页面卡死。
 *   3. **事件只做通知**。顺序敏感的记账仍留在系统内部，不要搬进订阅者 ——
 *      否则「谁先谁后」变成隐式契约，比直接调用更难查。
 * ──────────────────────────────────────────────────────────────── */

/**
 * 事件名常量表。
 * ⚠ 一律用它，**不许在各处写裸字符串** —— 拼错了不报错，只是不触发，
 *   而这正是本项目最怕的那种「静默失效」。
 */
const GAME_EVENTS = {
  /** 有人入册成为修士。payload: {state,name,qi,innate,now} */
  CULTIVATOR_JOINED: 'CULTIVATOR_JOINED',
  /** 炼成一炉丹。payload: {state,recipeId,name,n,prof,profUp} */
  PILL_CRAFTED: 'PILL_CRAFTED',
  /** 炼废一炉丹。payload: {state,recipeId,name,rate} */
  PILL_CRAFT_FAILED: 'PILL_CRAFT_FAILED',
  /** 族人出门探索。payload: {state,id,name,people,now} */
  EXPEDITION_SENT: 'EXPEDITION_SENT',
  /** 探索队归来。payload: {state,id,name,sent,survivors,lost,silver,overflow,secret,now} */
  EXPEDITION_RETURNED: 'EXPEDITION_RETURNED',
};

/** 事件名 → 订阅者数组。 */
const eventListeners = new Map();
/** 事件名 → 当前 emit 深度（防重入死循环）。 */
const eventDepth = new Map();
/** 重入深度上限：超过就掐掉并告警。 */
const EVENT_DEPTH_MAX = 8;

/**
 * 订阅一个事件。
 * @returns {function} 退订函数（`const off = on(...); off();`）
 */
function on(type, fn) {
  if (typeof type !== 'string' || !type) throw new Error('[eventBus] 事件名必须是字符串');
  if (typeof fn !== 'function') throw new Error(`[eventBus] ${type} 的订阅者必须是函数`);
  const list = eventListeners.get(type);
  if (list) list.push(fn);
  else eventListeners.set(type, [fn]);
  return function off() { offEvent(type, fn); };
}

/** 退订。 */
function offEvent(type, fn) {
  const list = eventListeners.get(type);
  if (!list) return false;
  const i = list.indexOf(fn);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) eventListeners.delete(type);
  return true;
}

/**
 * 广播。**同步**执行所有订阅者。
 *
 * ⚠ 约束 1：任何订阅者抛错都被就地吞掉并告警 —— 广播方永远不受影响。
 *   （这是「一个系统的 bug 不许传染给另一个系统」的机制保证。）
 */
function emitEvent(type, payload) {
  const list = eventListeners.get(type);
  if (!list || !list.length) return 0;

  const depth = (eventDepth.get(type) || 0) + 1;
  if (depth > EVENT_DEPTH_MAX) {
    console.warn(`[eventBus] 「${type}」重入超过 ${EVENT_DEPTH_MAX} 层，已掐断（疑似死循环）`);
    return 0;
  }
  eventDepth.set(type, depth);

  let delivered = 0;
  // 复制一份再遍历：订阅者在自己回调里退订/新订都不该打乱本次投递
  for (const fn of list.slice()) {
    try {
      fn(payload);
      delivered += 1;
    } catch (err) {
      console.warn(`[eventBus] 「${type}」的订阅者抛错，已隔离：`, err && err.message);
    }
  }

  if (depth === 1) eventDepth.delete(type);
  else eventDepth.set(type, depth - 1);
  return delivered;
}

/** 某个事件当前有几个订阅者（测试与自查用）。 */
function listenerCount(type) {
  const list = eventListeners.get(type);
  return list ? list.length : 0;
}

/** 全部事件的订阅数快照（测试与自查用）。 */
function busSnapshot() {
  const out = {};
  for (const [type, list] of eventListeners) out[type] = list.length;
  return out;
}

/** 清空总线（测试用：模拟「重新加载页面」）。 */
function resetEventBus() {
  eventListeners.clear();
  eventDepth.clear();
}
