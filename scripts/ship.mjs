#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：成员用 ——「构建 → 校验 → 冒烟 → 界面审查 → 前置检查 → 提交」
 *
 * 用法：
 *   npm run ship -- "feat: 说明"
 *
 * ⚠⚠ 本脚本**不推送**。推送由主策专用脚本 `npm run release` 执行。
 *
 * 为什么把推送权收归主策（2026-10-11 用户决定）：
 *   这一天连吃两次亏 —— 整条凡人科技线（18 项，含房地产）在界面上不可见，
 *   而冒烟测试 **805 项全绿**（DOM 垫片不计算可见性），缺陷被推上 GitHub，
 *   是**用户**发现的；随后又发现投帖问路与金丹「晋升」两处界面入口是死的。
 *   共同点：**断言绿 ≠ 玩家能用**。所以放行必须有人在真浏览器里看过。
 *   ⇒ 成员负责「把改动做对并提交」，主策负责「确认无误后推给世界」。
 *     单点闸门，而不是每个成员各推一次。
 *
 * 原则：
 *   1. **任何一步失败就整体停下**，绝不提交没通过审查的东西。
 *   2. 用 stdio:'inherit' 而不是 'pipe' —— 这个环境里管道抓子进程输出会 EPERM。
 *      所以「有没有改动」靠 `git diff --cached --quiet` 的**退出码**判断。
 *   3. 不加 shell —— 提交说明里可能有引号等字符，交给 shell 会被二次解析。
 *   4. **绝不 force push**（本脚本已无推送能力，由 release.mjs 统一把关）。
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };
const TOTAL = 6;

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

const NODE = process.execPath;

function step(n, title) {
  console.log(`\n${C.gold}[${n}/${TOTAL}]${C.off} ${title}`);
}

// ⚠ 参数分两段：`ship -- "提交说明" -- <文件1> <文件2> …`
//   多 agent **共用一个工作区**，所以绝不 `git add -A` —— 那会把别人正在改的
//   半成品一起提交（本项目真实事故：策划者交付 docs/97 时，工作区有 11 个文件
//   是程序负责人的 WIP，跑 ship 会连带提交并用 WIP 重建 game.html）。
//   所以本脚本**要求显式列出要提交的文件**；不列就拒绝，并把工作区改动打出来
//   让你自己挑。（全局规则 longtask-and-diagnostics R18/R21）
const rawArgs = process.argv.slice(2);
const sep = rawArgs.indexOf('--');
const message = (sep >= 0 ? rawArgs.slice(0, sep) : rawArgs).join(' ').trim();
const PATHS = sep >= 0 ? rawArgs.slice(sep + 1).filter(Boolean) : [];
if (!message) {
  console.error(`${C.red}缺少提交说明。${C.off}`);
  console.error('用法： npm run ship -- "feat: 做了什么" -- <要提交的文件…>');
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

// ── 审查门 ②：推送前置检查（提前做，免得等主策放行时才发现分叉）──
step(5, '推送前置检查（分叉 + 产物卫生）');
{
  // 5a. 分叉：本地必须是「领先」远端，而不是与它分叉。
  //     分叉时 push 必被 non-fast-forward 拒绝，且**与网络无关** —— 原地重试一万次也没用。
  const ancestor = run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFail: true });
  if (!ancestor) {
    const remoteOnly = capture('git', ['log', '--oneline', 'HEAD..origin/main']);
    console.error(`\n${C.red}✗ 本地与 origin/main 已分叉 —— 请先解决，不要提交。${C.off}`);
    console.error(`${C.dim}  远端独有：\n${remoteOnly || '    （空）'}${C.off}`);
    console.error(`${C.dim}  正确动作：git merge origin/main（解决冲突后重跑 ship）${C.off}`);
    console.error(`${C.dim}  ❌ 绝不要 git push --force / --force-with-lease —— 会抹掉别人的提交${C.off}`);
    process.exit(1);
  }

  // 5b. 产物卫生：git add -A 会把**没被 gitignore 覆盖的一次性产物**一起提交。
  const dirty = capture('git', ['status', '--porcelain'])
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const untracked = dirty.filter((l) => l.startsWith('??')).map((l) => l.replace(/^\?\?\s+/, '').replace(/^"|"$/g, ''));
  const TMP = /(^|[\\/])_[^\\/]*$|\.(txt|log|tmp|png)$/i;
  const suspicious = untracked.filter((p) => TMP.test(p));
  if (suspicious.length) {
    console.error(`\n${C.red}✗ 有 ${suspicious.length} 个疑似一次性产物未被忽略，git add -A 会把它们提交进仓库：${C.off}`);
    for (const p of suspicious) console.error(`${C.dim}    ${p}${C.off}`);
    console.error(`${C.dim}  处理：删掉它，或往 .gitignore 加规则。${C.off}`);
    process.exit(1);
  }
  if (untracked.length) {
    console.log(`${C.dim}  未跟踪（将被 add -A 纳入）：${untracked.length} 个${C.off}`);
    for (const p of untracked) console.log(`${C.dim}    ${p}${C.off}`);
  }
  console.log(`${C.green}✓ 无分叉、无一一次性产物${C.off}`);
}

step(6, '提交你显式列出的文件（提交到本地，不推送）');
{
  const dirty = capture('git', ['status', '--porcelain']).split('\n').filter(Boolean);
  if (!PATHS.length) {
    console.error(`\n${C.red}✗ 没有指定要提交的文件 —— 本脚本拒绝 git add -A。${C.off}`);
    console.error(`${C.dim}  多 agent 共用一个工作区，add -A 会把别人正在改的半成品一起提交，`);
    console.error(`${C.dim}  还可能用 WIP 重建 game.html（全局规则 R18/R21）。${C.off}`);
    if (dirty.length) {
      console.error(`${C.dim}  工作区现有 ${dirty.length} 项改动，请挑出属于你的：${C.off}`);
      for (const l of dirty.slice(0, 40)) console.error(`${C.dim}    ${l}${C.off}`);
    }
    console.error(`\n${C.gold}  重跑： npm run ship -- "说明" -- <你的文件…>${C.off}`);
    console.error(`${C.dim}  提交前用 git diff --cached --name-only 确认暂存区只有你的文件。${C.off}`);
    process.exit(1);
  }
  run('git', ['add', '--', ...PATHS]);
  const staged = capture('git', ['diff', '--cached', '--name-only']);
  if (!staged) {
    console.log(`${C.dim}  这些文件没有改动，跳过提交${C.off}`);
  } else {
    const files = staged.split('\n').filter(Boolean);
    console.log(`${C.dim}  将提交 ${files.length} 个文件（应全部是你指定的）：${C.off}`);
    for (const p of files) console.log(`${C.dim}    ${p}${C.off}`);
    const unexpected = dirty.filter((l) => !/^[MADRC?]{1,2}\s/.test(l) && false);
    if (unexpected.length) console.error(`${C.dim}${unexpected}${C.off}`);
    run('git', ['commit', '-m', message]);
    console.log(`${C.green}✓ 已提交到本地${C.off}`);
  }
}

const ahead = capture('git', ['log', '--oneline', 'origin/main..HEAD']).split('\n').filter(Boolean);
console.log(`\n${C.green}审查门全过，已提交到本地 ✓${C.off}`);
console.log(`${C.dim}  尚未推送（本脚本**不会**推送）—— 本地领先远端 ${ahead.length} 个提交：${C.off}`);
for (const l of ahead) console.log(`${C.dim}    ${l}${C.off}`);
console.log(`\n${C.gold}  ⚠ 推送由主策专用脚本执行：${C.off}${C.green}npm run release${C.off}`);
console.log(`${C.dim}    请把「改动做了什么、玩家会看到什么不同」报给主策，由主策复核审查输出后放行。${C.off}`);
console.log(`${C.dim}    ❌ 不要直接 git push —— 那会绕过界面审查这条唯一的放行闸门。${C.off}`);
