
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

/**
 * 【凡人篇 I1】探索队归来。
 * 文案由「商队归来，得银 N 两」改成「人回来了」—— 派出的是族人，先报生死再报钱。
 * 秘闻不在这里写：它由 `grantSecret` 自己播报（且要优先），与旧版一致。
 */
on(GAME_EVENTS.EXPEDITION_RETURNED, (e) => {
  if (!e || !e.state) return;
  const parts = [`「${e.name}」的人回来了：${e.survivors} / ${e.sent} 人`];
  if (e.lost > 0) parts.push(`折损 ${e.lost} 人`);
  parts.push(`带回银 ${fmt(e.silver)} 两`);
  if (e.overflow > 0.5) parts.push(`库房已满，溢出 ${fmt(e.overflow)} 两`);
  pushLog(e.state, parts.join('，'), 'trade', null, e.now);
});
