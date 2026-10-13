
/* ────────────────────────────────────────────────────────────────
 * 区块：族谱纪事（Chronicle）—— 以**订阅者**身份存在
 * 职责：谁入册了、谁没了、炼成了什么 —— 这些「叙事」不再由各系统自己写，
 *       而是各系统广播事件，这里负责落到 `state.log`。
 * 依赖：core/eventBus.js（on / GAME_EVENTS）、core/engine.js 的 pushLog
 * 文档：docs/103-架构分层与事件总线.md
 *
 * ⚠ 搬家时守住的一条铁律：**文案与位置逐字照搬**。
 *   原来 `addCultivator` 里是这么写的（systems/cultivation.js 旧代码）：
 *       if (!silent) { pushLog(state, person.origin==='innate' ? `天降灵根！…` : `…祛障成功…`, 'cultivate', null, now); }
 *   现在改成 emit，而订阅者是**同步**执行的 ⇒ 日志的相对顺序、`pushLog` 的
 *   「同 key 4 秒内合并计数」行为都不变。改这一块时请拿 `state.log` 的首条
 *   逐字比对，别只看「有没有日志」。
 * ──────────────────────────────────────────────────────────────── */

on(GAME_EVENTS.CULTIVATOR_JOINED, (e) => {
  if (!e || !e.state) return;
  pushLog(e.state,
    e.innate
      ? `天降灵根！${e.name}生而通灵，成为家族第 ${e.qi} 位炼气修士。`
      : `${e.name}祛障成功，成为家族第 ${e.qi} 位炼气修士。`,
    'cultivate', null, e.now);
});
