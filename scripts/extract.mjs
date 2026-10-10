/**
 * 把单文件产物 game.html 拆成分区块源码。
 *
 *   node scripts/extract.mjs
 *
 * 产物是「另存为完整 HTML」留下的形态：内联 <script type="module"> 里
 * 用 `/* ══════ src/xxx.js ══════ *​/` 注释切成若干伪模块。
 * 本脚本按这些标记切出 src/ 下的真实文件，并**自校验能否逐字节还原**。
 *
 * 只跑一次。之后改代码改 src/，用 build.mjs 合成。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'game.html';
const html = readFileSync(SRC, 'utf8');
const EOL = html.includes('\r\n') ? '\r\n' : '\n';

/* ── 1. 定位内联脚本 ── */

const OPEN = '<script type="module">';
const openAt = html.indexOf(OPEN);
if (openAt < 0) throw new Error('找不到内联 <script type="module">');

// 末尾还有一个「另存为」留下的外链 script，它的 </script> 在内联脚本之后。
// 内联脚本的闭合标签 = 外链 script 之前的最后一个 </script>。
const externalAt = html.indexOf('<script', openAt + OPEN.length);
const searchEnd = externalAt < 0 ? html.length : externalAt;
const closeAt = html.lastIndexOf('</script>', searchEnd);
if (closeAt < 0) throw new Error('找不到内联脚本的 </script>');

const head = html.slice(0, openAt + OPEN.length);   // 到 <script type="module"> 为止
const tail = html.slice(closeAt);                    // 从 </script> 到文件末尾
const body = html.slice(openAt + OPEN.length, closeAt);

/* ── 2. 按模块标记切分 ── */

const MARKER = /\/\* ═+ (src\/[\w./-]+) ═+ \*\//g;
const hits = [...body.matchAll(MARKER)];
if (hits.length < 10) throw new Error(`模块标记太少（${hits.length} 个），可能格式变了`);

const pre = body.slice(0, hits[0].index);   // 第一个标记之前（空行）
const sections = hits.map((h, i) => {
  const contentStart = h.index + h[0].length;
  const contentEnd = i + 1 < hits.length ? hits[i + 1].index : body.length;
  let chunk = body.slice(contentStart, contentEnd);
  // 规范化：砍掉内容前后各一个换行，文件里只留纯代码
  if (chunk.startsWith(EOL)) chunk = chunk.slice(EOL.length);
  if (chunk.endsWith(EOL)) chunk = chunk.slice(0, -EOL.length);
  return { marker: h[0], path: h[1], code: chunk };
});

/* ── 3. 写文件 ── */

if (existsSync('src')) rmSync('src', { recursive: true, force: true });
mkdirSync('src', { recursive: true });
writeFileSync('src/_shell-head.html', head, 'utf8');
writeFileSync('src/_shell-tail.html', tail, 'utf8');
writeFileSync('src/_shell-pre.js', pre, 'utf8');

// 构建清单：顺序 + 标记文本，build.mjs 照它拼回去
const manifest = sections.map((s) => ({ path: s.path, marker: s.marker }));
writeFileSync('src/_manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

for (const s of sections) {
  // s.path 形如 "src/core/config.js"，相对项目根目录
  mkdirSync(dirname(s.path), { recursive: true });
  writeFileSync(s.path, s.code, 'utf8');
}

/* ── 4. 自校验：能不能拼回原样 ── */

const rebuilt = head + pre
  + sections.map((s) => `${s.marker}${EOL}${s.code}${EOL}`).join('')
  + tail;

const same = rebuilt === html;
console.log(`模块数: ${sections.length}`);
for (const s of sections) {
  const lines = s.code.split(EOL).length;
  console.log(`  ${String(lines).padStart(5)} 行  ${s.path}`);
}
console.log(`\nhead ${head.length} / pre ${pre.length} / tail ${tail.length} 字符`);

if (same) {
  console.log('\n✓ 逐字节还原成功 —— 拆分是无损的');
} else {
  console.log('\n✗ 还原后与原文不一致');
  let i = 0;
  while (i < Math.min(rebuilt.length, html.length) && rebuilt[i] === html[i]) i += 1;
  console.log(`  第一个差异在第 ${i} 字符`);
  console.log(`  原文: ${JSON.stringify(html.slice(i - 40, i + 40))}`);
  console.log(`  重建: ${JSON.stringify(rebuilt.slice(i - 40, i + 40))}`);
  console.log(`  长度 原文 ${html.length} / 重建 ${rebuilt.length}`);
  process.exitCode = 1;
}
