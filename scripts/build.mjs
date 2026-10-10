/**
 * 由分区块源码合成单文件产物 game.html。
 *
 *   node scripts/build.mjs            # 构建
 *   node scripts/build.mjs --check    # 只校验产物与源码一致，不写文件
 *
 * 拼接顺序由 src/_manifest.json 决定（extract.mjs 生成的）。
 * 想加一个新区块：在 src/ 下建文件 → 往 manifest 里插一条 → 重跑构建。
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const MANIFEST = 'src/_manifest.json';
const OUT = 'game.html';
const CHECK_ONLY = process.argv.includes('--check');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const head = readFileSync('src/_shell-head.html', 'utf8');
const pre = readFileSync('src/_shell-pre.js', 'utf8');
const tail = readFileSync('src/_shell-tail.html', 'utf8');
const EOL = head.includes('\r\n') ? '\r\n' : '\n';

const parts = [head, pre];
const report = [];
for (const entry of manifest) {
  const code = readFileSync(entry.path, 'utf8');
  parts.push(`${entry.marker}${EOL}${code}${EOL}`);
  report.push({ path: entry.path, lines: code.split(EOL).length, bytes: Buffer.byteLength(code) });
}
parts.push(tail);
const out = parts.join('');

const prev = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return null; } })();

console.log(`${manifest.length} 个区块 → ${OUT}`);
for (const r of report) {
  console.log(`  ${String(r.lines).padStart(5)} 行  ${String(Math.round(r.bytes / 1024)).padStart(4)} KB  ${r.path}`);
}
console.log(`  ${String(out.split(EOL).length).padStart(5)} 行  ${String(Math.round(Buffer.byteLength(out) / 1024)).padStart(4)} KB  合计`);

if (CHECK_ONLY) {
  console.log(prev === out ? '\n✓ 产物与源码一致' : '\n✗ 产物与源码不一致（需要重新构建）');
  process.exit(prev === out ? 0 : 1);
}

writeFileSync(OUT, out, 'utf8');
const size = statSync(OUT).size;
console.log(`\n✓ 已写出 ${OUT}（${(size / 1024).toFixed(1)} KB）`);
if (prev !== null && prev !== out) {
  console.log(`  与上一版不同：${prev.length} → ${out.length} 字符`);
}
