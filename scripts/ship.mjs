#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：一条命令跑完「构建 → 校验 → 测试 → 界面审查 → 推送前置检查 → 提交 → 推送」
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
 *   ⚠ 2026-10-11 又吃了一亏：整条凡人科技线（18 项，含房地产）在界面上不可见，
 *     而冒烟测试 **805 项全绿** —— 因为 DOM 垫片不计算可见性，
 *     `#tech-list .tech[data-tech].length === 18` 照样通过（节点确实在，只是被
 *     `hidden` 祖先罩住）。缺陷被推上 GitHub，是**用户**发现的。
 *   ⇒ 结论：**「断言绿」不是放行条件。** 推送前必须真的在浏览器里看一眼。
 *     第 4 步（界面可见性审查）与第 5 步（推送前置检查）就是为此加的。
 *
 * 原则：
 *   1. **任何一步失败就整体停下**，绝不把没通过审查的东西推上去。
 *   2. 用 stdio:'inherit' 而不是 'pipe' —— 这个环境里管道抓子进程输出会 EPERM。
 *      所以「有没有改动」靠 `git diff --cached --quiet` 的**退出码**判断，
 *      而不是去解析输出。
 *   3. 不加 shell —— 提交说明里可能有引号等字符，交给 shell 会被二次解析。
 *   4. **绝不 force push**。分叉时正确动作是 merge，不是覆盖远端。
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };
const TOTAL = 7;

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

/** 跑一条命令并把 stdout 收回来（只在输出确定很短时用）。 */
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

/** node 用 process.execPath，免得依赖 PATH。 */
const NODE = process.execPath;

function step(n, title) {
  console.log(`\n${C.gold}[${n}/${TOTAL}]${C.off} ${title}`);
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

// ── 审查门 ①：界面可见性（真实浏览器）──
// 「断言绿」只说明数据接对了，不说明玩家看得见。这一项就是两者的差值。
step(4, '界面可见性审查（真实浏览器 Edge headless）');
run(NODE, ['scripts/uicheck.mjs']);

// ── 审查门 ②：推送前置检查 ──
step(5, '推送前置检查（分叉 + 产物卫生）');
{
  // 5a. 分叉：本地必须是「领先」远端，而不是与它分叉。
  //     分叉时 push 必被 non-fast-forward 拒绝，且**与网络无关** —— 原地重试一万次也没用。
  const ancestor = run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFail: true });
  if (!ancestor) {
    const remoteOnly = capture('git', ['log', '--oneline', 'HEAD..origin/main']);
    console.error(`\n${C.red}✗ 本地与 origin/main 已分叉 —— 拒绝了这次推送。${C.off}`);
    console.error(`${C.dim}  远端独有：\n${remoteOnly || '    （空）'}${C.off}`);
    console.error(`${C.dim}  正确动作：git merge origin/main（解决冲突后重跑 ship）${C.off}`);
    console.error(`${C.dim}  ❌ 绝不要 git push --force / --force-with-lease —— 会抹掉别人的提交${C.off}`);
    process.exit(1);
  }

  // 5b. 产物卫生：git add -A 会把**没被 gitignore 覆盖的一次性产物**一起提交。
  //     这条判据来自真实事故：_bal-*.txt / _smoke-*.txt / _dbg-*.txt 都曾差点被提交。
  //     用退出码/文件名自查，不靠肉眼。
  const dirty = capture('git', ['status', '--porcelain'])
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const untracked = dirty.filter((l) => l.startsWith('??')).map((l) => l.replace(/^\?\?\s+/, '').replace(/^"|"$/g, ''));
  const TMP = /(^|[\\/])_[^\\/]*$|\.(txt|log|tmp|png)$/i;
  const suspicious = untracked.filter((p) => TMP.test(p));
  if (suspicious.length) {
    console.error(`\n${C.red}✗ 有 ${suspicious.length} 个疑似一次性产物未被忽略，git add -A 会把它们提交进仓库：${C.off}`);
    for (const p of suspicious) console.error(`${C.dim}    ${p}${C.off}`);
    console.error(`${C.dim}  处理：删掉它，或往 .gitignore 加规则。${C.off}`);
    console.error(`${C.dim}  自查：git check-ignore -v <文件>（退出码 0=已忽略 / 1=未忽略）${C.off}`);
    process.exit(1);
  }
  if (untracked.length) {
    console.log(`${C.dim}  未跟踪（将被 add -A 纳入）：${untracked.length} 个${C.off}`);
    for (const p of untracked) console.log(`${C.dim}    ${p}${C.off}`);
  }
  console.log(`${C.green}✓ 无分叉、无一一次性产物${C.off}`);
}

step(6, '提交');
run('git', ['add', '-A']);
// 把将提交的文件列出来 —— 多 agent 共用工作区时，「扫走了别人的半成品」是最常见的翻车。
const staged = capture('git', ['diff', '--cached', '--name-only']);
if (!staged) {
  console.log(`${C.dim}  工作区没有改动，跳过提交${C.off}`);
} else {
  console.log(`${C.dim}  将提交 ${staged.split('\n').filter(Boolean).length} 个文件：${C.off}`);
  for (const p of staged.split('\n').filter(Boolean)) console.log(`${C.dim}    ${p}${C.off}`);
  run('git', ['commit', '-m', message]);
  console.log(`${C.green}✓ 已提交${C.off}`);
}

step(7, '推送到 GitHub');
const pushed = run('git', ['push'], { allowFail: true });
if (pushed) {
  console.log(`${C.green}✓ 已推送${C.off}`);
} else {
  // 提交已经在本地了，这一点必须说清楚，否则用户会以为东西丢了
  console.error(`\n${C.red}✗ 推送失败${C.off} —— 但**提交已经在本地**，没有丢失。`);
  console.error(`${C.dim}  先分层判定，别急着动凭据：${C.off}`);
  console.error(`${C.dim}    ① 分叉？ git log --oneline HEAD..origin/main（非空 = 分叉，需 merge）${C.off}`);
  console.error(`${C.dim}    ② 链路？ node --use-system-ca -e "fetch('https://github.com').catch(e=>console.log(e.message))"${C.off}`);
  console.error(`${C.dim}  链路抖动时原地重试即可，不要重装凭据、不要改 remote、不要 rebase。${C.off}`);
  process.exit(1);
}

console.log(`\n${C.green}全部完成 ✓${C.off}`);
