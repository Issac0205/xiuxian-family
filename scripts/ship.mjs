#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：成员用 ——「构建 → 校验 → 冒烟 → 界面审查 → 前置检查 → 提交」
 *
 * 用法（**必须显式列出要提交的文件**）：
 *   npm run ship -- "feat: 说明" -- src/data/names.js src/systems/cultivation.js
 *   npm run ship -- "docs: 说明" -- docs/97-修士命名与离线.md
 *
 * ⚠⚠ 本脚本**不推送**。推送由主策专用脚本 `npm run release` 执行。
 *
 * ── 为什么要求显式列文件（2026-10-11）──────────────────────────
 *   多 agent **共用一个工作区**。原先第 6 步是 `git add -A`，真实事故：
 *   策划者交付一份纯文档时，工作区有 11 个文件是程序负责人的 WIP，
 *   跑 ship 会连带提交它们、并用 WIP 重建 game.html（R18/R21）。
 *   ⇒ 现在不列文件就**拒绝执行**，把工作区改动全打出来让人自己挑。
 *
 * ── 两种路径（2026-10-11 由策划者指出后补）─────────────────────
 *   PATHS 里**没有** `src/**` / `game.html` / `src/_shell-head.html` 时走
 *   **文档快路径**：跳过第 1–4 步。理由是多 agent 场景下那四步会拿**别人的
 *   WIP** 当被测对象 —— 既可能被别人的半成品拦死，也可能被它放过（"审查
 *   通过"其实审的是别人能不能跑）。快路径**明确打印**，绝不静默跳过。
 *   ⚠ 快路径只在"本批不含会改变玩家所见的文件"时成立，这一点由 PATHS 判定，
 *     不靠人声明。
 *
 * 原则：
 *   1. **任何一步失败就整体停下**，绝不提交没通过审查的东西。
 *   2. 用 stdio:'inherit' 而不是 'pipe' —— 这个环境里管道抓子进程输出会 EPERM。
 *   3. 不加 shell —— 提交说明里可能有引号等字符，交给 shell 会被二次解析。
 *   4. **绝不 force push**（本脚本已无推送能力，由 release.mjs 统一把关）。
 * ──────────────────────────────────────────────────────────────── */

import { spawnSync } from 'node:child_process';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };

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
function cap(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const NODE = process.execPath;

/* ── 参数解析：`ship -- "说明" -- <文件…>` ── */
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
if (!PATHS.length) {
  const dirty = cap('git', ['status', '--porcelain']).split('\n').filter(Boolean);
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

/* ── 路径判定：本批会不会改变玩家所见 ── */
const RISKY = /^(src\/|game\.html$)/;
const riskyPaths = PATHS.filter((p) => RISKY.test(p));
const DOCS_ONLY = riskyPaths.length === 0;

const FULL_STEPS = 6;
const DOCS_STEPS = 3;
const TOTAL = DOCS_ONLY ? DOCS_STEPS : FULL_STEPS;
let stepNo = 0;
const step = (title) => { stepNo += 1; console.log(`\n${C.gold}[${stepNo}/${TOTAL}]${C.off} ${title}`); };

console.log(`${C.dim}  将提交 ${PATHS.length} 个文件：${C.off}`);
for (const p of PATHS) console.log(`${C.dim}    ${p}${C.off}`);

if (DOCS_ONLY) {
  console.log(`\n${C.gold}⚠ 文档快路径${C.off}${C.dim} —— 本批不含 src/ 或 game.html，跳过 build/校验/冒烟/界面审查。`);
  console.log(`  原因：那四步跑在**共用工作区**上，会拿别人的 WIP 当被测对象；`);
  console.log(`  既可能被别人的半成品拦死，也可能被它放过（"审查通过"其实审的是别人能不能跑）。`);
  console.log(`  ⇒ 本次**没有**跑冒烟与界面审查，这是明确跳过、不是静默通过。${C.off}`);
} else {
  console.log(`\n${C.dim}  本批含 ${riskyPaths.length} 个会影响玩家所见的文件（如 ${riskyPaths[0]}）⇒ 走完整门。${C.off}`);
}

/* ── 完整门才跑的四步 ── */
if (!DOCS_ONLY) {
  step('构建 game.html');
  run(NODE, ['scripts/build.mjs']);

  step('校验产物与源码一致');
  run(NODE, ['scripts/build.mjs', '--check']);

  step('跑冒烟测试');
  run(NODE, ['scripts/smoke.mjs']);

  step('界面可见性审查（真实浏览器 Edge headless）');
  run(NODE, ['scripts/uicheck.mjs']);
}

/* ── 推送前置检查（两种路径都跑）── */
step('推送前置检查（分叉 + 产物卫生）');
{
  const ancestor = run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { allowFail: true });
  if (!ancestor) {
    const remoteOnly = cap('git', ['log', '--oneline', 'HEAD..origin/main']);
    console.error(`\n${C.red}✗ 本地与 origin/main 已分叉 —— 请先解决，不要提交。${C.off}`);
    console.error(`${C.dim}  远端独有：\n${remoteOnly || '    （空）'}${C.off}`);
    console.error(`${C.dim}  正确动作：git merge origin/main（解决冲突后重跑 ship）${C.off}`);
    console.error(`${C.dim}  ❌ 绝不要 git push --force / --force-with-lease —— 会抹掉别人的提交${C.off}`);
    process.exit(1);
  }

  // 产物卫生：**降级为警告**（2026-10-11 由策划者指出）。
  // 第 6 步只提交 PATHS 里显式列出的文件 ⇒ 这些未跟踪产物**根本进不了提交**，
  // 拦死一次合法提交是错的。除非它们出现在 PATHS 里。
  const untracked = cap('git', ['status', '--porcelain'])
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('??'))
    .map((l) => l.replace(/^\?\?\s+/, '').replace(/^"|"$/g, ''));
  const TMP = /(^|[\\/])_[^\\/]*$|\.(txt|log|tmp)$/i;
  const suspicious = untracked.filter((p) => TMP.test(p));
  const committed = suspicious.filter((p) => PATHS.includes(p));
  if (committed.length) {
    console.error(`\n${C.red}✗ 你显式列出的文件里有疑似一次性产物：${C.off}`);
    for (const p of committed) console.error(`${C.dim}    ${p}${C.off}`);
    console.error(`${C.dim}  要么别提交它，要么往 .gitignore 加规则。${C.off}`);
    process.exit(1);
  }
  if (suspicious.length) {
    console.log(`${C.gold}  ⚠ 工作区有 ${suspicious.length} 个未跟踪的疑似产物（本次不会提交它们）${C.off}`);
    for (const p of suspicious) console.log(`${C.dim}    ${p}${C.off}`);
    console.log(`${C.dim}    提醒：它们不会被提交，但可能该进 .gitignore。${C.off}`);
  }
  console.log(`${C.green}✓ 无分叉${C.off}`);
}

/* ── 提交：只提交显式列出的文件 ── */
step('提交你显式列出的文件（提交到本地，不推送）');
{
  run('git', ['add', '--', ...PATHS]);
  const staged = cap('git', ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  if (!staged.length) {
    console.log(`${C.dim}  这些文件没有改动，跳过提交${C.off}`);
  } else {
    console.log(`${C.dim}  已暂存 ${staged.length} 个文件：${C.off}`);
    for (const p of staged) console.log(`${C.dim}    ${p}${C.off}`);

    // ⚠ 真检查（原先这里写的是 `&& false`，恒为空数组 —— 一条永远不失败的"保险"，
    //   由策划者 2026-10-11 指出）。判据必须是 **已暂存** 的文件是否都在 PATHS 里，
    //   而不是全部工作区改动。
    const wanted = new Set(PATHS);
    const unexpected = staged.filter((p) => !wanted.has(p));
    if (unexpected.length) {
      console.error(`\n${C.red}✗ 暂存区里有你没有列出的文件 —— 拒绝提交：${C.off}`);
      for (const p of unexpected) console.error(`${C.dim}    ${p}${C.off}`);
      console.error(`${C.dim}  这通常意味着暂存区里有别人的改动。`);
      console.error(`  处理：git restore --staged <文件> 后再重跑，或把它们也列进 PATHS（若确属你的）。${C.off}`);
      process.exit(1);
    }
    run('git', ['commit', '-m', message]);
    console.log(`${C.green}✓ 已提交到本地${C.off}`);
  }
}

/* ── 收尾：交给主策放行 ── */
const ahead = cap('git', ['log', '--oneline', 'origin/main..HEAD']).split('\n').filter(Boolean);
console.log(`\n${C.green}已提交到本地 ✓${C.off}`);
if (DOCS_ONLY) {
  console.log(`${C.gold}  ⚠ 本次走的是文档快路径：没有跑冒烟与界面审查（明确跳过，非静默通过）。${C.off}`);
}
console.log(`${C.dim}  尚未推送（本脚本**不会**推送）—— 本地领先远端 ${ahead.length} 个提交：${C.off}`);
for (const l of ahead.slice(0, 10)) console.log(`${C.dim}    ${l}${C.off}`);
console.log(`\n${C.gold}  ⚠ 推送由主策专用脚本执行：${C.off}${C.green}npm run release${C.off}`);
console.log(`${C.dim}    请把「改动做了什么、玩家会看到什么不同」报给主策，由主策复核后放行。${C.off}`);
console.log(`${C.dim}    ❌ 不要直接 git push —— 那会绕过界面审查与存档兼容这两道唯一的放行闸门。${C.off}`);
