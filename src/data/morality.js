
/* ────────────────────────────────────────────────────────────────
 * 区块：道心（道德值）
 * 职责：一个 0–100 的全局轴。它不是「善恶评分」，而是**你在这个世界里
 *       被当成什么人**——凶名在外能镇住人，也会招来天谴。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   MORALITY_START      初始道心（中庸）
 *   MORALITY_TIERS      五个档位与各自的后果
 *   MORALITY_DRIFT_*    每秒漂移速率（邪修功法拉低、无邪修时回升）
 *   MORALITY_GOOD_DEED  施粥赈济：花银两买道心
 * 文档：docs/85-流派与道心.md
 * ──────────────────────────────────────────────────────────────── */

/** 道心从 50（中庸）开始。 */
const MORALITY_START = 50;
const MORALITY_MAX = 100;
const MORALITY_MIN = 0;

/**
 * 五个档位。
 *
 * caveBonus   洞天生还率的**百分点**增减 —— 道心越低，天谴越重
 * warBonus    攻伐胜算的百分点增减 —— 凶名在外，守方先怯
 * taxMult     领地赋税倍率 —— 民心归附才交得出粮
 *
 * 这三条构成一组真正的取舍：**魔道能打但养不起地，正道养得起但打不动。**
 */
const MORALITY_TIERS = [
  {
    id: 'demon', name: '魔道', min: 0, max: 19,
    caveBonus: -0.25, warBonus: 0.10, taxMult: 0.70,
    desc: '血债缠身。入洞天如入鬼门，但凶名所至，守方未战先怯。',
  },
  {
    id: 'heretic', name: '旁门', min: 20, max: 39,
    caveBonus: -0.10, warBonus: 0.05, taxMult: 0.85,
    desc: '走在边缘。族中老人开始不安，但手段确实比旁人狠。',
  },
  {
    id: 'neutral', name: '中庸', min: 40, max: 60,
    caveBonus: 0, warBonus: 0, taxMult: 1.00,
    desc: '不功不过。既不招天谴，也不得民心。',
  },
  {
    id: 'upright', name: '正道', min: 61, max: 80,
    caveBonus: 0.05, warBonus: -0.03, taxMult: 1.15,
    desc: '乡里称善。领地愿交粮，但正道中人讲究规矩，出手没那么利落。',
  },
  {
    id: 'saint', name: '道心通明', min: 81, max: 100,
    caveBonus: 0.10, warBonus: -0.06, taxMult: 1.30,
    desc: '问心无愧。天不降灾，人愿归附，代价是你下不去狠手。',
  },
];

/** 每秒漂移：邪修功法生效时按住 MORALITY_DRIFT_EVIL（负），否则按 GOOD 回升。 */
const MORALITY_DRIFT_EVIL = -0.010;
const MORALITY_DRIFT_GOOD = 0.004;

/** 炼一枚人丹的道心代价。 */
const MORALITY_HUMAN_PILL_COST = -8;

/** 施粥赈济：花银两买道心。 */
const GOOD_DEED_SILVER = 60000;   // 每次消耗银两
const GOOD_DEED_GAIN = 6;         // 每次加多少道心
const GOOD_DEED_PER_SEC_LIMIT = 1; // 每秒最多几次（防连点）

/** 取某个道心值所属的档位。 */
function moralityTier(v) {
  const n = Math.max(MORALITY_MIN, Math.min(MORALITY_MAX, Number(v) || 0));
  for (const t of MORALITY_TIERS) if (n >= t.min && n <= t.max) return t;
  return MORALITY_TIERS[MORALITY_TIERS.length - 1];
}
