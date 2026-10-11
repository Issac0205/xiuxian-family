
/* ────────────────────────────────────────────────────────────────
 * 区块：可见性策略
 * 职责：决定「此刻该让玩家看到什么」。
 *       游戏后期会有很多栏目（七个页签、九个仙途分块），
 *       一上来全摆出来只会让人觉得复杂。所以**没到用得上它的时候就不显示**，
 *       让界面跟着玩家的进度一点点长出来。
 * 依赖：core/state.js 的 PAGES、systems/reincarnation.js、systems/exploration.js
 * 调参：加新页签 / 新分块时，往下面两个 switch 里加一条即可。
 * 文档：docs/01-工程结构.md §可见性
 * ──────────────────────────────────────────────────────────────── */

/**
 * 这个页签现在该不该出现。
 *
 * 原则：**只在玩家已经有东西可做、或者已经被这件事影响过之后才显示**。
 * 宁可晚一点出现，也不要一开局就摆出七个栏目。
 *
 * ⚠️ 一旦可见就不要再让它消失（除非重开）——栏目忽隐忽现比一直显示更让人困惑。
 */
function pageVisible(state, page) {
  switch (page) {
    case 'home':
    case 'techs':
    case 'trade':
      return true;

    // 治学：答题是核心玩法，从一开始就该在
    case 'study':
      return true;

    // 百科：**【修复 用户实机缺陷 ②】不得有任何前置**。
    // 用户原话：「我甚至不知道怎么才能开放百科」—— 一个纯查阅性质的栏目，
    // 把它锁在进度后面，等于让玩家在最需要「这是什么」的时候找不到答案。
    // 原先的条件（`unlocked || qi > 0`）就是那个「不知道怎么开放」的来源。
    case 'codex':
      return true;

    // 轮回：要么已经能轮回，要么已经轮回过，要么已经解锁过金手指。
    // 换句话说 —— 直到「轮回」这件事真的与玩家有关，才让他看见这个页签
    case 'cycle': {
      const m = metaOf(state);
      return reincarnationProgress(state).canEnd
        || m.cleared > 0
        || m.unlocked.length > 0
        || m.cycle > 1;
    }

    // 仙途：**【修复 用户实机缺陷 ①·仙途死锁】判据是「他现在有没有事可做」，
    // 不是「他有没有修士」**。原先两处都写成 `unlocked || qi > 0`，于是：
    //   玩家攒够 1 灵石 → 买不到祛障丹（购买入口在仙途页里）→ 永远没有第一个修士
    //   → `qi` 永远是 0 → 仙途页永远不出现 ⇒ **自锁**。
    // 现在改成 immortalAccessible()：只要仙途里存在**任何一件他能做的事**就可见。
    case 'immortal':
      return immortalAccessible(state);

    default:
      return true;
  }
}

/** 当前可见的页签列表，顺序与 PAGES 一致。 */
function visiblePages(state) { return PAGES.filter((p) => pageVisible(state, p)); }

/**
 * 【修复 用户实机缺陷 ①·仙途死锁】仙途页此刻该不该可见。
 *
 * 事故链（用户实机）：攒够 1 灵石 → 仙途页因为「没有修士」而隐藏 →
 *   **而买祛障丹的入口就在仙途页里** → 永远拿不到第一个修士 → `qi` 永远是 0
 *   → 仙途页永远不出现。**自锁，且全程不报错**（页面只是"不在那里"）。
 *
 * 判据要点：问「他现在有没有事可做」，而不是「他有没有修士」。
 *   · `PILL_STONE_COST` 是那个入口的价格 —— **买得起就必须让他看见入口**；
 *   · 一旦做过任何仙途相关的事（有修士 / 有线索 / 已解锁 / 已有仙道术 / 已有祛障丹 /
 *     已抵达过任何一处地方），**不许把入口藏回去**（沿用本文件 §19 那条约定：
 *     栏目忽隐忽现比一直显示更让人困惑）。
 */
function immortalAccessible(state) {
  const c = state?.cultivation;
  if (!c) return false;
  if (c.unlocked) return true;
  if ((c.qi || 0) > 0) return true;
  // ★ 买得起祛障丹 —— 这是修复本条的那个条件
  if ((Number(state.spiritStones) || 0) >= PILL_STONE_COST) return true;
  // ★ 「不许藏回去」的那几种痕迹
  if ((Number(c.clues) || 0) > 0 || (Number(c.cluePool) || 0) > 0) return true;
  if ((state.immortalTechs || []).length > 0) return true;
  if ((c.pills?.quzhang || 0) > 0) return true;
  if (worldOf(state).reached.length > 0) return true;
  return false;
}

/**
 * 仙途页里某个分块现在该不该出现。
 *
 * 三条新的生产线（丹房 / 器坊 / 符房）的原料**全部来自已占领的领地**，
 * 所以一块地都没有的时候，这三个面板摆出来只会让人困惑：
 * 点进去什么也做不了，还看不见原因。
 */
function immortalBlockVisible(state, key) {
  const held = worldOf(state).held.length;
  switch (key) {
    // 人丹：主修血煞一脉才出现。没走这条路的人不该看见「献祭凡人」的按钮
    case 'humanPill':
      return schoolUnlocks(state, 'humanPill') || humanPillCount(state) > 0;
    case 'alchemy':
      return held > 0 || (state.cultivation?.alchemy?.crafts || 0) > 0;
    case 'forge':
      return held > 0 || (state.cultivation?.forge?.crafts || 0) > 0;
    case 'runes':
      return held > 0 || (state.cultivation?.runes?.crafts || 0) > 0;
    default:
      return true;
  }
}

/** 有没有任何一条生产线已经露出来了（给「还没打通商路」的统一提示用）。 */
function anyCraftingVisible(state) {
  return ['alchemy', 'forge', 'runes'].some((k) => immortalBlockVisible(state, k));
}

/**
 * 【策划 C15 / 任务 T-2 验收标准 1、2】境界仪表盘：首页顶部**随境界换一块表**。
 *
 * 返回此刻应当渲染的那一格（**只返回一格**），以及它的 key。
 *   ''            凡人：不显示（沿用现有 overview）
 *   'qi'          炼气（1–9） 行气条
 *   'foundation'  筑基（10–13）道基牌位
 *   'core'        金丹（14–17）丹图
 *   'nascent'     元婴（18–21）元婴列表（第二阶段 T-7 填充）
 *   'tribulation' 化神（22–25）法旨行 + 天劫预告（第二阶段 T-8 填充）
 *
 * 口径取自最高境界：取全族 `realmIndex` 的最大值（没有修士时按凡人算）。
 * 未解锁的境界格**根本不渲染**（DOM 里不存在），而不是渲染成空 ——
 * 与 pageVisible() / immortalBlockVisible() 是同一套思路。
 * 出处：docs/91-落地任务清单.md §三 T-2 验收标准 1、2 与「数值设计」那张对应表。
 */
function highestRealmIndex(state) {
  let top = 0;
  for (const p of state?.cultivation?.cultivators || []) {
    const i = Math.floor(Number(p.realmIndex) || 0);
    if (i > top) top = i;
  }
  return top;
}

/** 现在该渲染哪一格仪表；凡人返回 null。 */
function realmDashboardKey(state) {
  const top = highestRealmIndex(state);
  if (top <= 0) return null;
  const tier = realmInfo(top).tierId;
  switch (tier) {
    case 'qi': return 'qi';
    case 'zhuji': return 'foundation';
    case 'jindan': return 'core';
    case 'yuanying': return 'nascent';
    case 'huashen': return 'tribulation';
    default: return null;
  }
}

/** 某一格仪表现在该不该出现（界面与测试共用同一个判据）。 */
function dashboardVisible(state, key) {
  return realmDashboardKey(state) === key;
}
