#!/usr/bin/env node
/**
 * 存档快照：把当前工作区（**含未提交改动**）打成一个可随时回退的检查点。
 *
 * 【为什么需要它】
 * 这个项目由多个 agent 成员并行改代码，一份工作往往要跨几十分钟才提交一次。
 * 在这段时间里，工作区是**最容易丢的**：成员改崩、进程被掐、误覆盖，都没有退路。
 *
 * 【原理：临时 git 索引】
 * 用 GIT_INDEX_FILE 指向一个临时索引文件，把工作区写成一棵 tree，
 * 再用 commit-tree 生成提交对象并打标签 ckpt/<时间戳>。
 * 全程**不碰工作区文件、不碰真实索引、不移动 HEAD** —— 所以**在成员正在改代码时也能安全运行**。
 * 普通的 `git commit` 会污染分支历史，`git stash` 会改工作区，两者都不适合这里。
 *
 * 【用法】
 *   node scripts/snapshot.mjs                 打一个快照
 *   node scripts/snapshot.mjs --note "说明"    附一句说明
 *   node scripts/snapshot.mjs --list          列出已有快照
 *   node scripts/snapshot.mjs --prune 40      只保留最近 40 个
 *
 * 【回退】
 *   node scripts/rollback.mjs --list          看有哪些快照
 *   node scripts/rollback.mjs ckpt/xxx        回退到某个快照（会先自动再快照一次）
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SNAP_DIR = resolve(ROOT, '..', '.snapshots');   // 仓库之外，不会被 git add 扫到
const KEEP_DEFAULT = 40;

let IDENT = null;
/**
 * 提交者身份：优先用仓库已配置的 user.name/user.email，没有再兜底。
 * 必须显式给 —— `git commit-tree` 在**没有配置身份的环境**里会直接失败
 * （实测：新克隆里报 `fatal: unable to auto-detect email address`）。
 * 原仓库恰好配过身份，所以这个坑只在克隆/新机器上暴露。
 */
function identity() {
  if (IDENT) return IDENT;
  const pick = (key, fb) => {
    const r = spawnSync('git', ['config', '--get', key], { cwd: ROOT, encoding: 'utf8' });
    return (r.status === 0 && (r.stdout || '').trim()) || fb;
  };
  const name = pick('user.name', 'xiuxian-checkpoint');
  const mail = pick('user.email', 'checkpoint@localhost');
  IDENT = {
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: mail,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: mail,
  };
  return IDENT;
}

/** 跑一条 git 命令；env 用于注入临时索引。 */
function git(args, env = {}, { allowFail = false } = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...identity(), ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} 失败(${r.status}): ${(r.stderr || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

function listCheckpoints() {
  const out = git(['tag', '-l', 'ckpt/*', '--sort=-creatordate'], {}, { allowFail: true });
  return out ? out.split('\n').filter(Boolean) : [];
}

/** 打一个快照，返回 {tag, commit, files}。 */
export function snapshot(note = '') {
  mkdirSync(SNAP_DIR, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const tag = `ckpt/${stamp}`;
  const idx = join(SNAP_DIR, `idx-${stamp}-${process.pid}`);
  const env = { GIT_INDEX_FILE: idx };

  const parent = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);

  git(['add', '-A'], env);
  // 被 .gitignore 排除的一次性脚本/产物也要进快照 —— 它们同样是"这会儿的工作成果"
  for (const f of ['scripts/_uat.mjs', 'scripts/_dbg.mjs', '_uat-out.txt']) {
    if (existsSync(join(ROOT, f))) git(['add', '-f', '--', f], env, { allowFail: true });
  }
  const tree = git(['write-tree'], env);
  const msg = `checkpoint ${stamp}${note ? '  ' + note : ''}\n\n未提交改动 ${status ? status.split('\n').length : 0} 个文件；HEAD=${parent.slice(0, 8)}`;
  const commit = git(['commit-tree', tree, '-p', parent, '-m', msg]);
  git(['tag', '-f', tag, commit]);

  const files = git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean).length;
  return { tag, commit, files, dirty: status ? status.split('\n').length : 0, parent: parent.slice(0, 8) };
}

/** 只保留最近 keep 个快照标签，更老的删掉（对象由 git gc 回收）。 */
function prune(keep = KEEP_DEFAULT) {
  const all = listCheckpoints();
  const drop = all.slice(keep);
  for (const t of drop) git(['tag', '-d', t], {}, { allowFail: true });
  return drop;
}

// ── 命令行入口 ──
const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  const all = listCheckpoints();
  if (!all.length) console.log('（还没有任何快照）');
  else {
    console.log(`共 ${all.length} 个快照（新 → 旧）：\n`);
    for (const t of all) {
      const meta = git(['log', '-1', '--format=%ci | %s', t], {}, { allowFail: true });
      const n = git(['ls-tree', '-r', '--name-only', t]).split('\n').filter(Boolean).length;
      console.log(`  ${t.padEnd(24)} ${String(n).padStart(4)} 文件  ${meta}`);
    }
  }
} else {
  const ni = argv.indexOf('--note');
  const note = ni >= 0 ? (argv[ni + 1] || '') : '';
  const r = snapshot(note);
  console.log(`✓ 快照已建: ${r.tag}`);
  console.log(`  提交     : ${r.commit.slice(0, 12)}  (父 ${r.parent})`);
  console.log(`  收录文件 : ${r.files} 个（含当时未提交的 ${r.dirty} 个改动）`);
  console.log(`  标签目录 : ${SNAP_DIR}`);
  console.log(`\n回退方式 : node scripts/rollback.mjs ${r.tag}`);
  const dropped = prune(KEEP_DEFAULT);
  if (dropped.length) console.log(`\n（已裁剪 ${dropped.length} 个过老快照，保留最近 ${KEEP_DEFAULT} 个）`);
}
