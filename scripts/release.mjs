#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：**主策专用** ——「重新过一遍审查门 → 推送到 GitHub」
 *
 * 用法：
 *   npm run release
 *   node scripts/release.mjs --yes      # 跳过交互确认（自动化用）
 *
 * 为什么单独一个脚本（2026-10-11 用户决定）：
 *   用户明确要求「推送只能由队长进行」。成员跑 `npm run ship` 只提交到本地，
 *   够不到远端；放行是**单点闸门**。
 *
 *   理由不是流程洁癖，而是当天两次真实事故：整条凡人科技线（18 项）在界面上
 *   不可见 + 投帖问路/金丹晋升两处入口是死的，而冒烟 **805 项全绿**。
 *   **断言绿 ≠ 玩家能用** —— 放行必须有人在真浏览器里看过。
 *
 * 本脚本与 ship.mjs 的区别（重要）：
 *   ship.mjs 在**改动提交之前**跑审查门，审的是工作区；
 *   本脚本在**推送之前**重跑一遍，审的是**即将推出去的那个提交**。
 *   中间可能有人又改了东西 —— 所以必须重审，不能复用 ship 的结论。
 *
 * 步骤：
 *   0. 工作区必须干净（推送的是提交，不是工作区）
 *   1. 构建产物必须与 src/ 一致（防「改了源码忘了 build」）
 *   2. 冒烟测试
 *   3. 界面可见性审查（真实浏览器）
 *   4. 分叉检查（分叉时 push 必被拒，且与网络无关）
 *   5. 推送
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };
const TOTAL = 6;
const SKIP_CONFIRM = process.argv.includes('--yes');

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok && !allowFail) {
    console.error(`\n${C.red}✗ 失败：${cmd} ${args.join(' ')}${C.off}`);
    process.exit(1);
  }
  return ok;
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const NODE = process.execPath;
const step = (n, t) => console.log(`\n${C.gold}[${n}/${TOTAL}]${C.off} ${t}`);

/* ── 步骤 0：工作区必须干净 ── */
step(0, '工作区状态检查');
{
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) {
    console.error(`${C.red}✗ 工作区有未提交改动 —— 推送的必须是提交，不是工作区。${C.off}`);
    for (const l of dirty.split('\n').filter(Boolean)) console.error(`${C.dim}    ${l}${C.off}`);
    console.error(`${C.dim}  先跑 npm run ship -- "说明" 把它们提交掉。${C.off}`);
    process.exit(1);
  }
  const ahead = capture('git', ['log', '--oneline', 'origin/main..HEAD']).split('\n').filter(Boolean);
  if (!ahead.length) {
    console.log(`${C.green}✓ 没有待推送的提交，已是最新${C.off}`);
    process.exit(0);
  }
  console.log(`${C.dim}  待推送 ${ahead.length} 个提交：${C.off}`);
  for (const l of ahead) console.log(`${C.dim}    ${l}${C.off}`);
}

/* ── 步骤 1-3：重跑审查门（审的是即将推出去的那个提交）── */
step(1, '校验构建产物与 src/ 一致');
run(NODE, ['scripts/build.mjs', '--check']);

step(2, '冒烟测试');
run(NODE, ['scripts/smoke.mjs']);

step(3, '界面可见性审查（真实浏览器 Edge headless）');
run(NODE, ['scripts/uicheck.mjs']);

/* ── 步骤 4：存档兼容（老玩家的进度还在不在）── */
// 挂机游戏的命根子：玩家的存档可能挂了几十小时，一次不兼容的更新就全废了。
// 这一步查冒烟查不到的三件事：数据表 id 只增不减、存档键未变、白名单无漏字段。
step(4, '存档兼容审查（老存档的解锁内容是否仍然有效）');
run(NODE, ['scripts/savecompat.mjs']);

/* ── 步骤 5：分叉检查 ── */
step(5, '分叉检查');
run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
console.log(`${C.green}✓ 无分叉，可快进${C.off}`);

/* ── 步骤 6：推送 ── */
step(6, '推送到 GitHub');
// 注意：这里**不做交互确认**。理由：本脚本会被非交互地调用（自动化/agent），
// 一个等待输入的 prompt 会让它永久挂住，比没有确认更糟。
// 真正的闸门是上面 1-4 步（尤其第 3 步的真实浏览器审查），不是这一行提示。
console.log(`${C.dim}  即将推送上面的提交（本脚本无交互确认，闸门在上面 1-4 步）。${C.off}`);

const pushed = run('git', ['push'], { allowFail: true });
if (pushed) {
  console.log(`${C.green}✓ 已推送${C.off}`);
} else {
  // 提交已经在本地了，这一点必须说清楚，否则会以为东西丢了
  console.error(`\n${C.red}✗ 推送失败${C.off} —— 但**提交已经在本地**，没有丢失。`);
  console.error(`${C.dim}  先分层判定，别急着动凭据：${C.off}`);
  console.error(`${C.dim}    ① 分叉？ git log --oneline HEAD..origin/main（非空 = 分叉，需 merge）${C.off}`);
  console.error(`${C.dim}    ② 链路？ node --use-system-ca -e "fetch('https://github.com').catch(e=>console.log(e.message))"${C.off}`);
  console.error(`${C.dim}  链路抖动时原地重试即可（重跑本脚本），不要重装凭据、不要改 remote、不要 rebase。${C.off}`);
  process.exit(1);
}

const head = capture('git', ['rev-parse', '--short', 'HEAD']);
console.log(`\n${C.green}已发布 ✓${C.off}  HEAD = ${head}`);
