#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────
 * 脚本：存档兼容审查 ——「这次更新会不会毁掉正在玩的人的进度」
 *
 * 用法：
 *   node scripts/savecompat.mjs            # 审查（基线不符则退出码 1）
 *   node scripts/savecompat.mjs --init     # 把当前 id 集合记为基线
 *   node scripts/savecompat.mjs --report   # 只打印差异，不判失败
 *
 * 为什么单独一个脚本（用户要求）：
 *   「我希望每次推送新的版本尽量让正在游玩的玩家保留他们当前的进度。」
 *   挂机游戏的存档可能挂了几十小时，一次不兼容的更新就全废了。
 *
 * 本脚本查三件**冒烟测试查不到**的事：
 *
 *   ① **数据表 id 只增不减。** 存档里存的是 id（`techs: ['realestate']`、
 *      `buildings: { house: 3 }`）。**改 id 的名字或删掉 id，就等于玩家的
 *      解锁内容静默消失** —— 不报错、不崩、`hydrate()` 会老老实实把它过滤掉
 *      （见 `src/core/save.js:69` 的 `.filter(id => TECH_MAP[id])`）。
 *      这是最难发现也最伤人的一类回归，所以必须用基线钉住。
 *
 *   ② **存档键不变。** `localStorage` 的键里带着版本号，**换键 = 玩家进度
 *      直接读不到**（不是丢失，是"看起来像新游戏"）。换键必须是有意的迁移，
 *      不能顺手改。
 *
 *   ③ **新增字段必须都是可选的。** 靠 `hydrate()` 的默认值兜底 ——
 *      本脚本检查 `createState()` 的每个顶层字段都出现在 `serialize()` 里
 *      （反向漏字段会让「写进去又读不回来」，本项目真踩过：`meta`）。
 *
 * 基线与真实存档样本都放在仓库外的 `D:\harness\.snapshots\savecompat\`，
 * 避免污染仓库；基线文件本身是**应该入库的资产**，所以放在 `fixtures/`。
 * ──────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE = resolve(ROOT, 'fixtures', 'save-ids.json');

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', gold: '\x1b[33m', off: '\x1b[0m' };
const INIT = process.argv.includes('--init');
const REPORT_ONLY = process.argv.includes('--report');

let failed = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failed += 1;
};

/* ── 采集当前 id 集合 ── */

/** data 目录下每个文件里 `id: 'xxx'` 的集合。 */
function collectIds() {
  const dir = resolve(ROOT, 'src', 'data');
  const out = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    const ids = [...src.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
    if (ids.length) out[f] = [...new Set(ids)].sort();
  }
  return out;
}

/**
 * 存档键与 serialize() 的字段面。
 * ⚠ SAVE_KEY 定义在 `src/core/config.js`（save.js 只是引用它）—— 所以要扫两个文件，
 *   只扫 save.js 会拿到「未找到」，让①号检查变成一条永远通过的假断言。
 */
function collectSaveFacts() {
  const saveSrc = readFileSync(resolve(ROOT, 'src', 'core', 'save.js'), 'utf8');
  const cfgSrc = readFileSync(resolve(ROOT, 'src', 'core', 'config.js'), 'utf8');
  const key = (saveSrc + cfgSrc).match(/SAVE_KEY\s*=\s*['"`]([^'"`]+)['"`]/)?.[1] || '(未找到)';
  // serialize() 手写白名单里的键 —— 用来和 createState 的顶层字段对账
  const at = saveSrc.indexOf('function serialize');
  const ser = saveSrc.slice(at, at + 2500);
  const serKeys = [...ser.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]);
  return { key, serKeys: [...new Set(serKeys)].sort() };
}

/* ── 主流程 ── */

const ids = collectIds();
const facts = collectSaveFacts();
const totalIds = Object.values(ids).reduce((n, a) => n + a.length, 0);

console.log(`\n${C.gold}存档兼容审查${C.off}`);
console.log(`${C.dim}  数据表 ${Object.keys(ids).length} 张 / id ${totalIds} 个   存档键 ${facts.key}${C.off}\n`);

/* ① 存档键 */
console.log('── ① 存档键 ──');
if (!existsSync(BASELINE)) {
  console.log(`${C.dim}  基线不存在，稍后由 --init 建立${C.off}`);
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  ok('存档键未变（换键 = 玩家进度读不到）', base.saveKey === facts.key,
    base.saveKey === facts.key ? facts.key : `基线 ${base.saveKey} → 现在 ${facts.key}`);
}

/* ② id 只增不减 */
console.log('\n── ② 数据表 id 只增不减（改名/删除 = 玩家解锁内容静默消失）──');
if (!existsSync(BASELINE)) {
  console.log(`${C.dim}  基线不存在，稍后由 --init 建立${C.off}`);
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  for (const [file, nowIds] of Object.entries(ids)) {
    const oldIds = base.tables[file];
    if (!oldIds) { console.log(`${C.dim}  · ${file}（基线里没有，新增表）${C.off}`); continue; }
    const lost = oldIds.filter((id) => !nowIds.includes(id));
    const added = nowIds.filter((id) => !oldIds.includes(id));
    ok(`${file}（${oldIds.length} → ${nowIds.length}${added.length ? `，+${added.length}` : ''}）`,
      lost.length === 0,
      lost.length ? `🔴 丢失/改名 ${lost.length} 个：${lost.join(', ')} —— 存档里这些 id 会被 hydrate 静默过滤掉` : '');
  }
  // 基线里有、现在整个文件都没了的表
  for (const file of Object.keys(base.tables)) {
    if (!ids[file]) ok(`${file}（整张表还在）`, false, '🔴 整张数据表消失了');
  }
}

/* ③ serialize 白名单 vs createState 顶层字段（反向漏字段） */
console.log('\n── ③ serialize() 白名单完整性 ──');
{
  const stateSrc = readFileSync(resolve(ROOT, 'src', 'core', 'state.js'), 'utf8');
  const body = stateSrc.slice(stateSrc.indexOf('function createState'));
  const end = body.indexOf('\n}');
  const keys = [...body.slice(0, end).matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)].map((m) => m[1]);
  const missing = keys.filter((k) => !facts.serKeys.includes(k));
  // handlers/functions 不算存档字段
  const real = missing.filter((k) => !['handlers'].includes(k));
  ok('createState() 的每个顶层字段都在 serialize() 里', real.length === 0,
    real.length ? `🔴 漏了：${real.join(', ')} —— 写不出去，读档时静默回默认值` : `${keys.length} 个字段`);
}

/* ── --init：写基线 ── */
if (INIT) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({
    _comment: '存档兼容基线。由 scripts/savecompat.mjs --init 生成。id 只允许增加，不允许删除或改名。',
    saveKey: facts.key,
    tables: ids,
    serializeKeys: facts.serKeys,
  }, null, 2) + '\n', 'utf8');
  console.log(`\n${C.green}✓ 基线已写入 fixtures/save-ids.json${C.off}（${Object.keys(ids).length} 张表 / ${totalIds} 个 id）`);
  process.exit(0);
}

/* ── 收尾 ── */
if (failed) {
  console.log(`\n${C.red}✗ 存档兼容审查未通过：${failed} 项${C.off}`);
  console.log(`${C.dim}  若某个 id 是**有意改名/删除**，必须同时写迁移代码把老 id 映射到新 id，`);
  console.log(`  然后跑 --init 更新基线。**绝不要只跑 --init 了事** —— 那等于宣布老存档作废。${C.off}`);
  process.exit(REPORT_ONLY ? 0 : 1);
}
console.log(`\n${C.green}✓ 存档兼容审查通过${C.off}（老存档的解锁内容全部仍有效）`);
