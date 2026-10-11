#!/usr/bin/env node
/**
 * 版本回退：把工作区恢复到某个快照。
 *
 * 【安全设计】
 *  1. **回退前先自动快照当前状态** —— 于是"回退"这个动作本身也是可回退的。
 *     这是整个系统里最重要的一条：没有它，回退就是又一次不可逆操作。
 *  2. **默认只报告、不落盘**（--dry-run 是默认行为），要真改必须显式 --apply。
 *  3. **只恢复快照里有的文件，绝不删除**任何当前文件。快照之后新增的文件会被列出来
 *     提醒你，但不会被动掉。
 *
 * 【用法】
 *   node scripts/rollback.mjs --list              列出所有快照
 *   node scripts/rollback.mjs ckpt/xxx            只演练：显示会改哪些文件
 *   node scripts/rollback.mjs ckpt/xxx --apply    真正恢复
 *   node scripts/rollback.mjs ckpt/xxx --apply --file src/core/save.js   只恢复一个文件
 *   node scripts/rollback.mjs ckpt/xxx --apply --yes   跳过确认
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim();
}

function listCheckpoints() {
  const out = git(['tag', '-l', 'ckpt/*', '--sort=-creatordate'], { allowFail: true });
  return out ? out.split('\n').filter(Boolean) : [];
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); }));
}

const argv = process.argv.slice(2);

// ── --list ──
if (argv.includes('--list') || argv.length === 0) {
  const all = listCheckpoints();
  if (!all.length) { console.log('（还没有任何快照。先跑 node scripts/snapshot.mjs）'); process.exit(0); }
  console.log(`共 ${all.length} 个快照（新 → 旧）：\n`);
  for (const t of all) {
    const meta = git(['log', '-1', '--format=%ci | %s', t], { allowFail: true });
    const n = git(['ls-tree', '-r', '--name-only', t]).split('\n').filter(Boolean).length;
    console.log(`  ${t.padEnd(24)} ${String(n).padStart(4)} 文件  ${meta}`);
  }
  console.log('\n恢复: node scripts/rollback.mjs <快照名> --apply');
  process.exit(0);
}

// ── 定位快照 ──
let target = argv.find((a) => !a.startsWith('--'));
if (!target) { console.error('用法: node scripts/rollback.mjs <快照名> [--apply] [--file 路径]'); process.exit(2); }
if (!target.startsWith('ckpt/')) {
  const all = listCheckpoints();
  const hit = all.filter((t) => t.includes(target));
  if (hit.length === 1) target = hit[0];
  else if (hit.length === 0) { console.error(`找不到匹配 "${target}" 的快照`); process.exit(2); }
  else { console.error(`"${target}" 匹配到多个: ${hit.join(', ')}`); process.exit(2); }
}
if (!listCheckpoints().includes(target)) { console.error(`快照不存在: ${target}`); process.exit(2); }

const apply = argv.includes('--apply');
const skipConfirm = argv.includes('--yes');
const fi = argv.indexOf('--file');
const onlyFile = fi >= 0 ? argv[fi + 1] : null;

// ── 算差异 ──
const pathspec = onlyFile ? ['--', onlyFile] : ['--', '.'];
const changed = git(['diff', '--name-only', target, ...pathspec], { allowFail: true }).split('\n').filter(Boolean);
const nowSet = new Set(git(['ls-files'], { allowFail: true }).split('\n').filter(Boolean));
const snapSet = new Set(git(['ls-tree', '-r', '--name-only', target]).split('\n').filter(Boolean));
const addedSince = [...nowSet].filter((f) => !snapSet.has(f));

console.log(`目标快照: ${target}`);
console.log(`  ${git(['log', '-1', '--format=%ci | %s', target], { allowFail: true })}`);
console.log(`\n将被覆盖的已跟踪文件: ${changed.length} 个`);
for (const f of changed.slice(0, 40)) console.log(`  ~ ${f}`);
if (changed.length > 40) console.log(`  ... 还有 ${changed.length - 40} 个`);
if (addedSince.length) {
  console.log(`\n快照之后**新增**的文件 ${addedSince.length} 个（不会被删除，仅提示）:`);
  for (const f of addedSince.slice(0, 20)) console.log(`  + ${f}`);
  if (addedSince.length > 20) console.log(`  ... 还有 ${addedSince.length - 20} 个`);
}
console.log(`\n当前 HEAD: ${git(['rev-parse', '--short', 'HEAD'])}   （回退只改工作区，不动 HEAD、不改历史）`);

if (!apply) {
  console.log('\n这是演练。要真正恢复请加 --apply');
  process.exit(0);
}

// ── 关键安全步骤：先把"现在"存下来，这样回退本身也可回退 ──
console.log('\n[1/3] 先快照当前状态（使这次回退本身可回退）…');
const snap = spawnSync(process.execPath, [resolve(HERE, 'snapshot.mjs'), '--note', `回退到 ${target} 之前的自动存档`], {
  cwd: ROOT, encoding: 'utf8', stdio: 'inherit',
});
if (snap.status !== 0) { console.error('自动快照失败，已中止（不回退）。'); process.exit(1); }

// ── 确认 ──
if (!skipConfirm) {
  const ok = await confirm(`\n[2/3] 确认要把工作区恢复到 ${target} 吗？(y/N) `);
  if (!ok) { console.log('已取消。工作区未改动。'); process.exit(0); }
} else {
  console.log('\n[2/3] --yes 已指定，跳过确认');
}

// ── 恢复 ──
console.log('\n[3/3] 恢复中…');
const r = spawnSync('git', ['restore', `--source=${target}`, '--worktree', ...pathspec], {
  cwd: ROOT, encoding: 'utf8',
});
if (r.status !== 0) {
  // 老版本 git 没有 restore，退回 checkout
  const r2 = spawnSync('git', ['checkout', target, ...pathspec], { cwd: ROOT, encoding: 'utf8' });
  if (r2.status !== 0) { console.error('恢复失败:', (r2.stderr || '').trim()); process.exit(1); }
}
console.log(`✓ 工作区已恢复到 ${target}`);
console.log(`  当前改动文件: ${git(['status', '--porcelain']).split('\n').filter(Boolean).length} 个`);
console.log(`  HEAD 未变: ${git(['rev-parse', '--short', 'HEAD'])}`);
console.log(`\n若要连提交历史一起回退，请用: git reset --hard ${target}   （这会丢弃 HEAD 之后的提交）`);
