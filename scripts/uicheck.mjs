#!/usr/bin/env node
/**
 * 界面可见性审查（真实浏览器）。
 *
 *   node scripts/uicheck.mjs            # 审查；通过退出码 0，失败 1
 *   node scripts/uicheck.mjs --json     # 机读输出
 *   node scripts/uicheck.mjs --keep     # 保留临时探针文件便于排查
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 【为什么必须有这个脚本】
 * 2026-10-11：`#tech-list`（凡人科技列表容器）被包进 `<div ... hidden>`，而 JS 是往
 * 它**内部**重建列表的 —— 整条凡人科技线（18 项，含房地产）在浏览器里一条都不显示。
 *
 * 此时 `scripts/smoke.mjs` 的 **805 项断言全绿**，因为：
 *     `#tech-list .tech[data-tech].length === 18` —— DOM 里确实有 18 个子节点。
 * **无头 DOM 垫片不计算可见性。断言数对了 ≠ 玩家看得见。**
 * 这个缺陷因此被推上了 GitHub，是**用户**发现的。
 *
 * 所以审查必须在**真实浏览器**里做，问的不是「元素在不在」，而是「玩家看得见吗」。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 【两条设计纪律 —— 都是本项目真实踩过的坑】
 *
 * 1. **每轮用全新 profile**。第一版用了固定的 `--user-data-dir`，Edge 把上一轮的
 *    localStorage 存档留下来，于是 `ui.techLine` 停在上次的值上，审查报出
 *    「凡人科技线 display:none」这种**假失败** —— 审查自己污染了被审查的对象。
 *    现在每轮 mkdtemp + 载入前清 localStorage，保证状态确定。
 *
 * 2. **必须能被证明会失败**。脚本内置阳性对照（种一个确定不可见的元素，审查必须
 *    报出来）。没有对照，就可能出现「审查恒过」这种最危险的假安全感 ——
 *    本项目在补断言时已经踩过一次（拿骨架里带 hidden 的静态元素当正样本，
 *    结果对照失败，说明检测函数恒返回 null）。
 *    ⚠ 改这个脚本之后，务必跑一次反向验证：把 `ph.hidden = false` 改成 `true`
 *       再跑，审查**必须**变红。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const GAME = join(ROOT, 'game.html');
const WORK = mkdtempSync(join(tmpdir(), 'uicheck-'));
const PROBE = join(WORK, 'probe.html');
const PROFILE = join(WORK, 'profile');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

if (!existsSync(GAME)) {
  console.error('✗ 找不到 game.html，请先跑 node scripts/build.mjs');
  process.exit(1);
}

/* ── 注入的审查代码：跑在真实浏览器里 ── */
const PROBE_JS = `
<script type="module">
// 确定性：清掉可能残留的存档（子会话里的 localStorage 也可能被上一轮写入）
try { localStorage.clear(); } catch (e) {}
const out = { checks: [], control: null, error: null };
const add = (name, bad) => out.checks.push({ name, ok: !bad, why: bad || '' });

/** 返回到第一个把它藏起来的祖先的原因；可见则返回 null。 */
function vis(el) {
  if (!el) return '元素不存在';
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none') return 'display:none（.' + (n.className || n.id || n.tagName) + '）';
    if (cs.visibility === 'hidden') return 'visibility:hidden';
    if (n.hasAttribute('hidden')) return 'hidden 属性（.' + (n.className || n.id || n.tagName) + '）';
  }
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return '零尺寸';
  return null;
}

try {
  const X = window.__xiuxian;
  const PAGES = ['home', 'techs', 'trade', 'immortal', 'study', 'codex', 'cycle'];

  // ── ① 两个科技列表：显式来回切，两个方向都要对 ──
  const LINE = [
    ['mortal', 'tech-list', X.data.techs, '凡人科技线'],
    ['immortal', 'immortal-tech-list', X.data.immortalTechs, '仙道科技线'],
  ];
  for (const [line, host, table, label] of LINE) {
    const other = line === 'mortal' ? 'immortal-tech-list' : 'tech-list';
    if (X.actions.setPage) X.actions.setPage('techs');
    if (X.ui.setTechLine) X.ui.setTechLine(line);
    const el = document.getElementById(host);
    add(label + '：切到本线时容器可见', vis(el));
    const rows = el ? el.querySelectorAll('.tech[data-tech]').length : 0;
    add(label + '：行数与数据表一致（' + table.length + '）', rows === table.length ? null : '实际 ' + rows);
    const first = el && el.querySelector('.tech[data-tech]');
    add(label + '：首行真的看得见（不只是存在）', first ? vis(first) : '一行都没有');
    const otherEl = document.getElementById(other);
    add(label + '：切走之后另一条线收起', vis(otherEl) ? null : '另一条仍然可见 —— 两条线会同时铺开');
  }

  // ── ② 每个**已解锁**页面：切过去，页面容器与至少一个面板必须可见 ──
  const unlocked = (X.visible && X.visible.pages) ? X.visible.pages() : PAGES;
  for (const pg of PAGES) {
    if (!unlocked.includes(pg)) { out.checks.push({ name: '页面 ' + pg + '：未解锁（按设计不展示）', ok: true, skip: true }); continue; }
    if (X.actions.setPage) X.actions.setPage(pg);
    const sec = document.querySelector('.page[data-page="' + pg + '"]');
    if (!sec) { add('页面 ' + pg + '：容器存在', '找不到 .page[data-page]'); continue; }
    add('页面 ' + pg + '：切换后容器可见', vis(sec));
    const panels = [...sec.querySelectorAll('.panel')];
    const shown = panels.filter((p) => !vis(p));
    add('页面 ' + pg + '：有可见面板（' + shown.length + '/' + panels.length + '）',
      shown.length === 0 ? '一个面板都看不见' : null);
  }

  // ── ③ 建筑卡：数量与数据表一致，且每一张都看得见 ──
  if (X.actions.setPage) X.actions.setPage('home');
  const cards = [...document.querySelectorAll('.bcard')];
  add('建筑卡张数 = 数据表 ' + X.data.buildings.length, cards.length === X.data.buildings.length ? null : '实际 ' + cards.length);
  const badCard = cards.find((c) => vis(c));
  add('建筑卡每一张都可见', badCard ? (cards.filter((c) => vis(c)).length + ' 张不可见，例：' + vis(badCard)) : null);

  // ── ④ 任何带 hidden 属性的元素，computed display 必须是 none ──
  //     作者样式里的 display 会盖过 UA 的 [hidden]{display:none}，这是整类缺陷的温床。
  const hiddenEls = [...document.querySelectorAll('[hidden]')];
  const broken = hiddenEls.filter((e) => getComputedStyle(e).display !== 'none');
  add('hidden 属性都真的生效（' + hiddenEls.length + ' 个）',
    broken.length ? broken.length + ' 个被作者样式盖掉，例：.' + (broken[0].className || broken[0].id) : null);

  // ── ⑤ 阳性对照：种一个确定不可见的元素，审查必须报出来 ──
  const d = document.createElement('div');
  d.id = '__uicheck_control__';
  d.style.display = 'none';
  document.body.appendChild(d);
  const got = vis(document.getElementById('__uicheck_control__'));
  out.control = { detected: got === 'display:none（.' + '' + '）' || String(got).startsWith('display:none'), got };
  d.remove();
} catch (e) {
  out.error = String((e && e.stack) || e);
}
document.title = 'UICHECK:' + JSON.stringify(out).replace(/&/g, '\\\\u0026').replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e');
</script>`;

writeFileSync(PROBE, readFileSync(GAME, 'utf8') + PROBE_JS, 'utf8');

const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('✗ 找不到 Edge，无法做界面可见性审查'); rmSync(WORK, { recursive: true, force: true }); process.exit(1); }

const r = spawnSync(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1400,1200', '--virtual-time-budget=9000',
  '--dump-dom', `file:///${PROBE.replace(/\\/g, '/')}`,
], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const dom = r.stdout || '';
const m = dom.match(/<title>UICHECK:(.*?)<\/title>/s);
if (!m) {
  console.error('✗ 没能从浏览器取回审查结果（页面可能没跑起来）');
  console.error('  stderr 尾部：' + (r.stderr || '').split('\n').slice(-4).join('\n'));
  if (process.argv.includes('--keep')) console.error('  探针文件保留在 ' + PROBE);
  else rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
}
let result;
try {
  result = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
} catch (e) {
  console.error('✗ 审查结果解析失败：' + m[1].slice(0, 300));
  process.exit(1);
}

const failed = result.error ? 1 : result.checks.filter((c) => !c.ok).length;
const ctlOk = Boolean(result.control && result.control.detected);

if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log('\n── 界面可见性审查（真实浏览器 Edge headless，全新 profile）──');
  if (result.error) console.log('  ✗ 审查代码抛错：\n' + result.error);
  for (const c of result.checks) {
    if (c.skip) console.log(`  · ${c.name}`);
    else console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '  — ' + c.why}`);
  }
  console.log(`  ${ctlOk ? '✓' : '✗'} （阳性对照）审查能发现不可见元素${ctlOk ? '' : '  — 恒过！审查本身不可信（got=' + (result.control && result.control.got) + '）'}`);
}

if (!process.argv.includes('--keep')) rmSync(WORK, { recursive: true, force: true });

if (failed || !ctlOk) {
  console.log(`\n✗ 界面审查未通过：断言失败 ${failed} 项${ctlOk ? '' : ' + 阳性对照失效'}\n`);
  process.exit(1);
}
console.log('\n✓ 界面审查通过\n');
