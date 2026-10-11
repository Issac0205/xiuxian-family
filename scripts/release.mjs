#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：**主策专用** ——「重新过一遍审查门 → 推送到 GitHub」
 *
 * 用法：
 *   npm run release                    # 常规：工作区必须干净，重跑全部审查
 *   node scripts/release.mjs --docs-only   # 只推「不含 src/UI 改动」的批次
 *
 * 为什么单独一个脚本（2026-10-11 用户决定）：
 *   用户明确要求「推送只能由队长进行」。成员跑 `npm run ship` 只提交到本地，
 *   够不到远端；放行是**单点闸门**。
 *
 *   理由不是流程洁癖，而是当天两次真实事故：整条凡人科技线（18 项）在界面上
 *   不可见 + 投帖问路/金丹晋升两处入口是死的，而冒烟 **805 项全绿**。
 *   **断言绿 ≠ 玩家能用** —— 放行必须有人在真浏览器里看过。
 *
 * 为什么要有 `--docs-only`（而不是「偷偷 push 一下」）：
 *   第 1–3 步都跑在**工作区**上。多 agent 共用一个工作区时，别人正在改
 *   `src/**`（本项目常态），此时跑 gate 验证的**不是要推的东西** —— 这正是
 *   这道门存在的原因。但「一批提交只含 docs / 工具脚本、完全不含 src 与 UI」
 *   是**可机械判定**的情形，对它们跑界面审查是空集。
 *   所以不搞例外、不偷偷绕过，而是**把这条通道写进门里并自我验证**：
 *   它先断言 `origin/main..HEAD` 的改动不碰任何 src/UI 文件，碰了就拒绝。
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };
const DOCS_ONLY = process.argv.includes('--docs-only');
const TOTAL = DOCS_ONLY ? 3 : 6;

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

if (DOCS_ONLY) {
  console.log(`${C.gold}模式：--docs-only${C.off}${C.dim}（只放行不含 src/UI 改动的提交批次）${C.off}`);
}

/* ── 步骤 1：批次判定 ── */
step(1, DOCS_ONLY ? '断言本批提交不含 src / UI 改动' : '工作区状态检查');
{
  const nCommits = Number(capture('git', ['rev-list', '--count', 'origin/main..HEAD']) || '0');
  if (!nCommits) {
    console.log(`${C.green}✓ 没有待推送的提交，已是最新${C.off}`);
    process.exit(0);
  }
  // ⚠ **判据必须是提交数（rev-list），不能用内容差异（git diff 是否为空）。**
  //   本项目真实踩过：一次 merge 提交的内容与远端逐字节相同 ⇒ `git diff` 为空 ⇒
  //   旧写法报「没有待推送」并直接 exit 0，把那个提交**静默留在本地**。
  //   三点 `origin/main...HEAD` 取「本批带来的内容变化」，仅用于列文件。
  const files = capture('git', ['diff', '--name-only', 'origin/main...HEAD']).split('\n').filter(Boolean);
  console.log(`${C.dim}  待推送 ${nCommits} 个提交，涉及 ${files.length} 个文件：${C.off}`);
  for (const f of files) console.log(`${C.dim}    ${f}${C.off}`);

  if (DOCS_ONLY) {
    // 会改变玩家所见的路径：src/**、构建产物、页面骨架、以及三个"审查器"自身。
    // 其余（docs/**、.gitignore、package.json、ship/release/savecompat/snapshot/rollback/balance）
    // 不影响界面，故对它们跑界面审查是空集。
    const RISKY = /^(src\/|game\.html$|scripts\/(smoke|uicheck|dom-shim)\.mjs$)/;
    const risky = files.filter((f) => RISKY.test(f));
    if (risky.length) {
      console.error(`\n${C.red}✗ 本批提交动了会改变玩家所见的东西 —— --docs-only 拒绝放行：${C.off}`);
      for (const f of risky) console.error(`${C.dim}    ${f}${C.off}`);
      console.error(`${C.dim}  这些必须走完整门（要求工作区干净，好让 build/smoke/uicheck 验证的`);
      console.error(`${C.dim}  就是要推的东西）。等改 src 的人收工后跑 npm run release。${C.off}`);
      process.exit(1);
    }
    console.log(`${C.green}✓ 本批不含 src / UI 改动 —— 界面与存档审查对其为空集${C.off}`);
  } else {
    const dirty = capture('git', ['status', '--porcelain']);
    if (dirty) {
      console.error(`${C.red}✗ 工作区有未提交改动 —— 推送的必须是提交，不是工作区。${C.off}`);
      for (const l of dirty.split('\n').filter(Boolean).slice(0, 12)) console.error(`${C.dim}    ${l}${C.off}`);
      console.error(`${C.dim}  原因：第 2–4 步跑在工作区上，脏工作区会让它们验证的不是要推的东西。${C.off}`);
      console.error(`${C.dim}  先让在改 src 的人跑 npm run ship 提交，或改用 --docs-only（仅当本批不含 src/UI）。${C.off}`);
      process.exit(1);
    }
  }
}

/* ── 步骤 2–4：完整模式才跑的审查（都依赖工作区 == 待推内容）── */
if (!DOCS_ONLY) {
  step(2, '校验构建产物与 src/ 一致');
  run(NODE, ['scripts/build.mjs', '--check']);

  step(3, '冒烟测试');
  run(NODE, ['scripts/smoke.mjs']);

  step(4, '界面可见性审查（真实浏览器 Edge headless）');
  run(NODE, ['scripts/uicheck.mjs']);

  step(5, '存档兼容审查（老存档的解锁内容是否仍然有效）');
  run(NODE, ['scripts/savecompat.mjs']);
} else {
  console.log(`${C.dim}  · 已跳过 build/smoke/uicheck/savecompat：它们跑在工作区上，`);
  console.log(`    而工作区此刻可能正被改 src 的成员占用 —— 跑了也验证不到本批提交。${C.off}`);
}

/* ── 分叉检查（两种模式都跑）── */
step(DOCS_ONLY ? 2 : 5, '分叉检查');
run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
{
  const remoteOnly = capture('git', ['log', '--oneline', 'HEAD..origin/main']);
  if (remoteOnly) {
    console.error(`${C.red}✗ 远端有本地没有的提交 —— 先 git merge origin/main。${C.off}`);
    console.error(`${C.dim}${remoteOnly}${C.off}`);
    process.exit(1);
  }
  console.log(`${C.green}✓ 无分叉，可快进${C.off}`);
}

/* ── 推送 ── */
step(DOCS_ONLY ? 3 : 6, '推送到 GitHub');
console.log(`${C.dim}  即将推送上面的提交（本脚本无交互确认，闸门在上面的步骤）。${C.off}`);

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
