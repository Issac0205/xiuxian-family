
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

    // 百科：等踏入仙途之后再出现。开局那几分钟不需要它
    case 'codex':
      return Boolean(state.cultivation?.unlocked) || (state.cultivation?.qi || 0) > 0;

    // 轮回：要么已经能轮回，要么已经轮回过，要么已经解锁过金手指。
    // 换句话说 —— 直到「轮回」这件事真的与玩家有关，才让他看见这个页签
    case 'cycle': {
      const m = metaOf(state);
      return reincarnationProgress(state).canEnd
        || m.cleared > 0
        || m.unlocked.length > 0
        || m.cycle > 1;
    }

    // 仙途：与炼气篇一同出现
    case 'immortal':
      return Boolean(state.cultivation?.unlocked) || (state.cultivation?.qi || 0) > 0;

    default:
      return true;
  }
}

/** 当前可见的页签列表，顺序与 PAGES 一致。 */
function visiblePages(state) { return PAGES.filter((p) => pageVisible(state, p)); }

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
