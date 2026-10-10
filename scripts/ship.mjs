#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：一条命令跑完「构建 → 校验 → 测试 → 提交 → 推送」
 *
 * 用法：
 *   npm run ship -- "feat: 说明"
 *   node scripts/ship.mjs "feat: 说明"
 *
 * 设计意图：
 *   这个项目吃过一次「没有版本历史、只能从乱码里逆向」的亏。
 *   从此每次改动都必须留下可回退的点，而且要真的传到远端 ——
 *   本地提交不算数，本地提交只有一块硬盘记得住。
 *
 * 原则：
 *   1. **任何一步失败就整体停下**，绝不把没通过测试的东西推上去。
 *   2. 用 stdio:'inherit' 而不是 'pipe' —— 这个环境里管道抓子进程输出会 EPERM。
 *      所以「有没有改动」靠 `git diff --cached --quiet` 的**退出码**判断，
 *      而不是去解析输出。
 *   3. 不加 shell —— 提交说明里可能有引号等字符，交给 shell 会被二次解析。
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };

/** 跑一条命令，输出直接继承到终端。返回是否成功。 */
function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok && !allowFail) {
    console.error(`\n${C.red}✗ 失败：${cmd} ${args.join(' ')}${C.off}`);
    process.exit(1);
  }
  return ok;
}

/** node 用 process.execPath，免得依赖 PATH。 */
const NODE = process.execPath;

function step(n, title) {
  console.log(`\n${C.gold}[${n}/5]${C.off} ${title}`);
}

const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error(`${C.red}缺少提交说明。${C.off}`);
  console.error('用法： npm run ship -- "feat: 做了什么"');
  process.exit(1);
}
if (message.length < 6) {
  console.error(`${C.red}提交说明太短（至少 6 个字符）。${C.off}`);
  process.exit(1);
}

step(1, '构建 game.html');
run(NODE, ['scripts/build.mjs']);

step(2, '校验产物与源码一致');
run(NODE, ['scripts/build.mjs', '--check']);

step(3, '跑冒烟测试');
run(NODE, ['scripts/smoke.mjs']);

step(4, '提交');
run('git', ['add', '-A']);
// 退出码 0 = 暂存区没有改动。用退出码而不是解析输出，见文件头说明。
const hasStaged = !run('git', ['diff', '--cached', '--quiet'], { allowFail: true });
if (hasStaged) {
  run('git', ['commit', '-m', message]);
  console.log(`${C.green}✓ 已提交${C.off}`);
} else {
  console.log(`${C.dim}  工作区没有改动，跳过提交${C.off}`);
}

step(5, '推送到 GitHub');
const pushed = run('git', ['push'], { allowFail: true });
if (pushed) {
  console.log(`${C.green}✓ 已推送${C.off}`);
} else {
  // 提交已经在本地了，这一点必须说清楚，否则用户会以为东西丢了
  console.error(`\n${C.red}✗ 推送失败${C.off} —— 但**提交已经在本地**，没有丢失。`);
  console.error(`${C.dim}  排查：git remote -v / git status / git log origin/main..main${C.off}`);
  process.exit(1);
}

console.log(`\n${C.green}全部完成 ✓${C.off}`);
