/**
 * 科技线对照实验（紧凑版）。
 *
 *   node scripts/techcompare.mjs 40              # 三条策略，改前改后各一遍
 *   node scripts/techcompare.mjs 40 greedy       # 只跑一条（省时间）
 *   node scripts/techcompare.mjs 40 greedy before # 只跑对照盘（不研习仙道）
 *   node scripts/techcompare.mjs 40 greedy after  # 只跑完整盘
 *
 * 为什么不是直接跑 balance.mjs：
 *   完整报告的格式化（境界驻留条形图、里程碑、卡点明细）对「科技线值不值」
 *   这个问题并不提供额外信息，却让每次跑要好几分钟。
 *   这里只取**能回答那个问题的几个数**，并且**逐行打印** ——
 *   进程被时限掐掉时也要留下已有结果。
 *
 * 对照组怎么来：`immortal: false` 时 AI 不研习仙道科技，于是连城坊建筑
 * 也解锁不了 —— 剩下的就是「旧世界 + 新的凡人树」。
 * 两者之差就是仙道线（以及它对凡人线的反哺）的净贡献。
 */
import * as BAL from './balance.mjs';

const B = new Proxy({}, { get: (_, k) => BAL.B[k] });
const arg = Number(process.argv[2]);
const HOURS = arg > 0 ? arg : 40;
const ONLY = process.argv[3];
const MODE = process.argv[4];   // 'before' | 'after' | undefined（两个都跑）
const STRATEGIES = ONLY ? [ONLY] : ['greedy', 'trade', 'farm'];

const fmt = (v, n = 0) => Number(v).toFixed(n);

function measure(strategy, immortal) {
  const label = immortal ? '改后(凡18+仙23)' : '改前(只凡18)';
  const t0 = Date.now();
  const r = BAL.run(strategy, { maxHours: HOURS, immortal });
  const s = r.s;
  const c = s.cultivation || {};
  const ps = c.cultivators || [];
  return {
    label, strategy,
    realm: r.topRealmName,
    mortal: r.techs.length,
    immortal: (r.immortalTechs || []).length,
    stones: fmt(r.stones, 0),
    cultivators: ps.length,
    held: r.held.length,
    exch: r.exchangeCount,
    waste: fmt(r.wasteRatio * 100, 0),
    stalls: r.stalls.length,
    secs: ((Date.now() - t0) / 1000).toFixed(0),
  };
}

function printRow(r) {
  console.log(
    `${r.strategy.padEnd(7)} ${r.label.padEnd(16)} ${r.realm.padEnd(12, '　')} `
    + `${String(r.mortal).padStart(4)} ${String(r.immortal).padStart(5)} `
    + `${String(r.stones).padStart(7)} ${String(r.cultivators).padStart(5)} `
    + `${String(r.held).padStart(4)} ${String(r.exch).padStart(4)} `
    + `${String(r.waste).padStart(5)} ${String(r.stalls).padStart(5)} ${String(r.secs).padStart(5)}s`,
  );
}

console.log(`\n《修仙世家》科技线对照实验 · ${HOURS} 游戏小时/局`);
console.log('策略    组别             最高境界      凡人术 仙道术  灵石   修士  领地 兑换 损银%  卡点  用时');
const pairs = [];
for (const st of STRATEGIES) {
  const a = MODE === 'after' ? null : measure(st, false);
  if (a) printRow(a);
  const b = MODE === 'before' ? null : measure(st, true);
  if (b) printRow(b);
  if (a && b) pairs.push({ st, a, b });
}

if (pairs.length) {
  console.log('\n差额（改后 − 改前）：');
  for (const { st, a, b } of pairs) {
    console.log(
      `  ${st.padEnd(7)} 凡人术 +${b.mortal - a.mortal}  仙道术 +${b.immortal - a.immortal}  `
      + `灵石 ${b.stones}(前 ${a.stones})  修士 ${b.cultivators}(前 ${a.cultivators})  `
      + `领地 ${b.held}(前 ${a.held})  境界 ${a.realm} → ${b.realm}`,
    );
  }
}
console.log('\n完成。\n');
