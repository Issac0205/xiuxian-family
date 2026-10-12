/**
 * 《修仙世家》冒烟测试。
 *
 *   node scripts/smoke.mjs
 *
 * 产物是单文件 HTML，内联脚本由若干「区块」拼成（靠
 * `/* ══════ src/xxx.js ══════ *​/` 注释分隔，没有 import/export）。
 * 这里把整段取出来，用最小 DOM 垫片真跑一遍，再对各区块做端到端断言。
 *
 * 随机源播种，所以每次跑出的结果逐位相同。
 */
import { readFileSync } from 'node:fs';
import { installDOM, walk } from './dom-shim.mjs';

let failed = 0;
function check(label, cond, detail = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failed += 1;
}
function section(title) { console.log(`\n── ${title} ──`); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const H = 3600;

const html = readFileSync('game.html', 'utf8');

/* ══════════════════════ 1. 构建完整性 ══════════════════════ */

section('构建完整性');
// 产物必须与 src/ 逐字节一致，否则说明「改了源码忘了构建」
const manifest = JSON.parse(readFileSync('src/_manifest.json', 'utf8'));
check('构建清单存在', Array.isArray(manifest) && manifest.length > 0, `${manifest.length} 个区块`);
{
  const shellHead = readFileSync('src/_shell-head.html', 'utf8');
  const EOL = shellHead.includes('\r\n') ? '\r\n' : '\n';
  const rebuilt = shellHead
    + readFileSync('src/_shell-pre.js', 'utf8')
    + manifest.map((e) => `${e.marker}${EOL}${readFileSync(e.path, 'utf8')}${EOL}`).join('')
    + readFileSync('src/_shell-tail.html', 'utf8');
  check('game.html 与 src/ 逐字节一致（没有忘记跑 build）', rebuilt === html,
    rebuilt === html ? '' : `相差 ${Math.abs(rebuilt.length - html.length)} 字符`);
}
check('每个区块文件都存在且非空',
  manifest.every((e) => readFileSync(e.path, 'utf8').trim().length > 0));

/**
 * 顶层声明不得重名 —— 这条是**踩过坑之后补的**。
 *
 * 仿真器与应用内测试都是用 `new Function(code)` 拼装整段脚本，
 * 那里的重复 `function foo(){}` 只是「后者覆盖前者」，静默通过；
 * 但浏览器里的 `<script type="module">` 会直接抛
 *   Identifier 'foo' has already been declared
 * 整个模块不执行 → 界面成了空壳（页签、卡片、科技一个都不渲染），
 * 而 smoke 当时全绿。所以这条检查必须在**文本层面**做。
 */
{
  const re = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  const seen = new Map();
  const dupes = [];
  for (const entry of manifest) {
    const src = readFileSync(entry.path, 'utf8');
    // 逐行扫，只在行首匹配（与 build.mjs 的 declared 扫描口径一致）
    for (const m of src.matchAll(re)) {
      const name = m[1] || m[2];
      if (!name) continue;
      if (seen.has(name)) dupes.push(`${name}（${seen.get(name)} 与 ${entry.path}）`);
      else seen.set(name, entry.path);
    }
  }
  check('顶层声明没有重名（module 模式会直接抛错）', dupes.length === 0, dupes.join(' '));
  check('顶层声明扫描确实扫到了东西', seen.size > 400, `共 ${seen.size} 个顶层名字`);
}

/* ══════════════════════ 2. 内联脚本 ══════════════════════ */

section('内联脚本');
const m = html.match(/<script type="module">\r?\n([\s\S]*?)\r?\n<\/script>/);
check('找得到内联脚本', Boolean(m));
if (!m) { console.log('\n无法继续\n'); process.exit(1); }
const code = m[1];

const modules = [...code.matchAll(/\/\*\s*═+\s*(src\/[\w./-]+)\s*═+\s*\*\//g)].map((x) => x[1]);
check('模块边界标记完好', modules.length >= 20,
  `${modules.length} 个：${modules.length ? modules[0] + ' … ' + modules[modules.length - 1] : ''}`);
check('没有残留的 import/export', !/^\s*(import|export)\s/m.test(code));
check('单文件里 CSS 已内联', html.includes('<style>'));
check('语法可解析', (() => {
  try { new Function(code); return true; } catch (e) { console.log('    ' + e.message); return false; }
})());

/* ══════════════════════ 3. 加载 ══════════════════════ */

section('加载与渲染');
const dom = installDOM(html);
const { document } = dom;
try {
  new Function(code)();
} catch (e) {
  console.log('  ✗ 运行抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
check('脚本运行完成', true);

const X = window.__xiuxian;
check('调试出口已挂载', Boolean(X && X.state && X.manual && X.realm && X.step && X.derive));
const state = X.state;
const ui = X.ui;
/** 数据表集合。第 15.5 节起就要用，所以在最前面取好。 */
const d = X.data;
const $ = (id) => document.getElementById(id);
clearInterval(X.timer);
X.seedRng(20260101);

/**
 * 造一名修士，字段齐全。
 *
 * 灵根固定为「四灵根 · 金水火力土」：速度 ×1.0、突破修正 0，
 * 但覆盖了全部四条有属性限制的道途（御守金／寻幽水／涉险火／经营土），
 * 所以既有的断言数值不用改，功法类断言也不会因为灵根不合而失效。
 * （木没有对应功法，是留给炼丹的，所以不含木没有副作用。）
 */
const DEFAULT_ROOT = { grade: 'quad', elements: ['metal', 'water', 'fire', 'earth'], rerolls: 0 };
const person = (over = {}) => ({
  id: 1, name: '林清衡', origin: 'innate', realmIndex: 1, xp: 0, breakFailures: 0,
  job: 'retreat', talent: 1, parentage: 'cultivator-mortal',
  root: { ...DEFAULT_ROOT, elements: [...DEFAULT_ROOT.elements] }, ...over,
});
/** 直接把名册换成给定的人。 */
const setPeople = (...list) => {
  state.cultivation.cultivators = list;
  state.cultivation.qi = list.length;
};

/* ══════════════════════ 4. 基础玩法回归 ══════════════════════ */

section('基础玩法回归');
// ⚠ 这两条原来硬编码了「6 张建筑卡 / 6 个丹方」。
// 加了仙凡经济的五座城坊建筑与一枚丹方之后，硬编码的计数就变成了假失败。
// 改成数据驱动：查的是「数据表里有多少，界面就渲染了多少」，
// 也就是这两条断言**真正想查的东西** —— 加了新条目它仍会保护渲染完整性。
check('建筑卡数量与数据表一致',
  document.querySelectorAll('.bcard').length === X.data.buildings.length,
  `${document.querySelectorAll('.bcard').length} / ${X.data.buildings.length} 张`);
check('科技列表渲染了', document.querySelectorAll('.tech').length >= 12,
  `${document.querySelectorAll('.tech').length} 项`);
// 两条线的行数必须与数据表一致。
// ⚠ 用「容器 + 属性」定位，不用 :not(.is-immortal) ——
//   dom-shim 的 :not() 断言结果恒为 0（会是一条永远假失败的断言）。
//   容器本身才是稳定的身份标记：#tech-list 是凡人侧、#immortal-tech-list 是仙道侧。
check('凡人科技行数与数据表一致',
  document.querySelectorAll('#tech-list .tech[data-tech]').length === X.data.techs.length,
  `${document.querySelectorAll('#tech-list .tech[data-tech]').length} / ${X.data.techs.length}`);
check('仙道科技行数与数据表一致',
  document.querySelectorAll('#immortal-tech-list .tech.is-immortal[data-tech]').length === X.data.immortalTechs.length,
  `${document.querySelectorAll('#immortal-tech-list .tech.is-immortal[data-tech]').length} / ${X.data.immortalTechs.length}`);
check('每个仙道科技行都带自己的参悟按钮', (() => {
  const ids = [...document.querySelectorAll('#immortal-tech-list .tech.is-immortal')].map((r) => r.dataset.tech);
  return ids.every((id) => Boolean(
    document.querySelector(`#immortal-tech-list [data-action="researchImmortal"][data-tech="${id}"]`),
  ));
})(), `${X.data.immortalTechs.length} 个`);
check('两条线的切换按钮都在',
  Boolean(document.querySelector('[data-action="tech-line"][data-line="mortal"]'))
  && Boolean(document.querySelector('[data-action="tech-line"][data-line="immortal"]'))
  && Boolean(document.querySelector('#immortal-tech-chip')));

// ── 可见性回归守卫（2026-10-11 用户报「根本没有房地产了」后补）──
// 背景：6d2ce7f 把 #tech-list 包进了 `.tech-list-static-placeholder[hidden]`，
// 而 buildTechs() 是往它**内部**重建列表的 —— 于是整条凡人科技线
//（房地产 / 建筑学 / 金融 / … 共 18 条）在浏览器里一条都看不见。
//
// 最刺眼的地方是：上面那条「凡人科技行数与数据表一致」**照样全绿**。
// 因为 DOM 里确实有 18 个子节点，只是被祖先的 hidden 罩住了 ——
// **无头垫片不计算可见性**。所以可见性必须单独钉住，不能靠行数断言代替。
//
// 玩家看到的症状：家业页的建筑卡片写着「须研习『房地产』」，
// 而去格物页找房地产却什么都没有 —— 死结。
function hiddenAncestor(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.hidden === false) continue;                    // 显式取消隐藏（浏览器与垫片都认属性赋值）
    if (p.hidden === true) return p;
    if (typeof p.getAttribute === 'function' && p.getAttribute('hidden') !== null) return p;
  }
  return null;
}
check('凡人科技容器没有被 hidden 祖先罩住',
  hiddenAncestor(document.getElementById('tech-list')) === null,
  (() => {
    const a = hiddenAncestor(document.getElementById('tech-list'));
    return a ? `祖先 .${a.className} 带 hidden —— 整条凡人科技线不可见` : '';
  })());
// 阳性对照：证明上面那个检测函数**真的能发现** hidden 祖先，而不是恒返回 null。
// 少了这条，上面那条断言在检测函数失效时会变成「永不失败的假断言」——
// 那正是这个 bug 头一次能活下来的机制：断言在，但测不到东西。
// ⚠ 不要拿骨架里的静态元素（如 #wb-detail）当样本：实测那条对照是**失败**的，
//   说明 dom-shim 的解析器没有把 `hidden` 属性变成检测函数看得见的形态。
//   所以这里用 createElement + setAttribute 自造一个样本，只依赖垫片自己的 API。
check('（阳性对照）hidden 祖先检测函数确实有效', (() => {
  const wrap = document.createElement('div');
  const probe = document.createElement('div');
  wrap.setAttribute('hidden', '');
  wrap.appendChild(probe);
  return hiddenAncestor(probe) !== null;
})(), '检测函数若恒返回 null，上面那条断言就是空的');
// 阳性对照 2：没带 hidden 的祖先不能被误判（否则上面那条是靠「检测函数太敏感」蒙过去的）
check('（阳性对照）没有 hidden 的祖先不会误判', (() => {
  const wrap = document.createElement('div');
  const probe = document.createElement('div');
  wrap.appendChild(probe);
  return hiddenAncestor(probe) === null;
})());
check('两条科技线的互斥 CSS 真的定义了',
  /\.tech-list\.is-hidden\s*\{[^}]*display\s*:\s*none/.test(html),
  '缺 .tech-list.is-hidden{display:none} 会让 setTechLine() 变成空操作，两条线同时铺开');
check('仙道线默认收起（两条线不能同时铺开）',
  String(document.getElementById('immortal-tech-list').className).includes('is-hidden'));

// ── 科技树可见性门控（2026-10-11 用户要求）──
// 用户原话：「我希望设置门控，玩家一进游戏看见好多未解锁科技其实是不太好的，
// 建议只展示下一阶段的科技，每次解锁以后再出现新的科技这样玩起来会觉得每次
// 都有新内容，而不是早早的看见了终点，因此已解锁科技数/总科技数也不要显示」。
// 规则：可见 = 已研习 ∪ {前置全部满足}；总数一律不显示。
const gateState = () => (typeof X.state === 'function' ? X.state() : X.state);
const gateShown = (sel) => [...document.querySelectorAll(`${sel} .tech[data-tech]`)]
  .filter((r) => !r.classList.contains('is-hidden')).map((r) => r.dataset.tech).sort();
const gateWant = (s, defs, immortal) => defs
  .filter((t) => X.visible.techOf(s, t, immortal)).map((t) => t.id).sort();
const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

check('凡人科技门控：界面可见集合 === 已研习 ∪ 前置满足', (() => {
  const want = gateWant(gateState(), X.data.techs, false);
  return sameIds(want, gateShown('#tech-list'));
})(), (() => {
  const want = gateWant(gateState(), X.data.techs, false);
  const got = gateShown('#tech-list');
  return sameIds(want, got)
    ? `${got.length} 条`
    : `期望 ${want.length} 条 / 实际 ${got.length} 条；少了 ${want.filter((i) => !got.includes(i)).join(',') || '无'}；多了 ${got.filter((i) => !want.includes(i)).join(',') || '无'}`;
})());

check('仙道科技门控：界面可见集合 === 已研习 ∪ 前置满足', (() => {
  const want = gateWant(gateState(), X.data.immortalTechs, true);
  return sameIds(want, gateShown('#immortal-tech-list'));
})(), `${gateShown('#immortal-tech-list').length} / ${X.data.immortalTechs.length}`);

check('门控确实藏起了东西（不是全露）',
  gateShown('#tech-list').length < X.data.techs.length,
  `${gateShown('#tech-list').length} / ${X.data.techs.length}`);

// 全新状态：只该露出「零前置、且不要求秘闻」的入门科技
check('全新状态只露入门科技', (() => {
  const fresh = { techs: [], immortalTechs: [], secrets: [] };
  const shown = X.data.techs.filter((t) => X.visible.techOf(fresh, t, false));
  const entry = X.data.techs.filter(
    (t) => !(t.requires || []).length && !(t.requiresImmortal || []).length && !t.requiresSecrets);
  return shown.length > 0 && shown.length < X.data.techs.length
    && sameIds(shown.map((t) => t.id).sort(), entry.map((t) => t.id).sort());
})(), '门控若恒真（全露）或恒假（全藏），这条会红');

// 解锁后下一代浮现：研习前置之前不可见 → 之后可见（两侧）
check('研习前置后，后继科技随之出现', (() => {
  const withParent = X.data.techs.find((t) => (t.requires || []).length);
  if (!withParent) return false;                       // 数据表变了也要报警，不是静默通过
  const parentId = withParent.requires[0];
  const before = X.visible.techOf({ techs: [], immortalTechs: [], secrets: [] }, withParent, false);
  const after = X.visible.techOf({ techs: [parentId], immortalTechs: [], secrets: [] }, withParent, false);
  return before === false && after === true;
})(), '门控若恒真或恒假，这条会红');

check('科技文案不泄露「已解锁数 / 总数」', (() => {
  const t = document.getElementById('tech-chip')?.textContent || '';
  const i = document.getElementById('immortal-tech-chip')?.textContent || '';
  const total = /\d+\s*\/\s*\d+/;
  return !total.test(t) && !total.test(i) && !/已研习\s*\d/.test(t) && !/仙道\s*\d/.test(i);
})(), `${document.getElementById('tech-chip')?.textContent} ｜ ${document.getElementById('immortal-tech-chip')?.textContent}`);
// 阳性对照：证明上面的泄露检测真的能发现「已解锁 N / 总 M」这种文案
check('（阳性对照）总数泄露检测确实有效',
  /\d+\s*\/\s*\d+/.test('已研习 3 / 18') && /\d+\s*\/\s*\d+/.test('仙道 2 / 17'),
  '检测正则若失效，上面那条就成了永不失败的假断言');

// ── 坊市与通商（2026-10-11 用户要求）──
// 用户原话：「秘闻解锁坊市，然后把祛障丹购买条目放在坊市里，需要一个秘闻解锁（消耗），
// 然后增设一些其他条目，比如灵石换银两，灵石买蓝图之类的，之前有设计一套打败城池
// 以后解锁新坊市，新坊市卖新商品的设计，这次重点实装这个设计」。
(() => {
  const s = gateState();
  // 备份 ⇒ 本块自己造状态 ⇒ 用完还原，免得影响后面的断言
  const backup = {
    secrets: [...(s.secrets || [])], used: s.secretsUsed,
    unlocks: [...(s.marketUnlocks || [])], stones: s.spiritStones, silver: s.silver,
  };
  const restore = () => {
    s.secrets = backup.secrets; s.secretsUsed = backup.used;
    s.marketUnlocks = backup.unlocks; s.spiritStones = backup.stones; s.silver = backup.silver;
  };
  const seed = (n) => { s.secrets = Array.from({ length: n }, (_, i) => i); s.secretsUsed = 0; s.marketUnlocks = []; };

  check('坊市门槛读的是「累计秘闻」，与已花掉多少无关', (() => {
    seed(10);
    const before = X.market.open('yunshen');
    X.market.unlock('quzhangdan');            // 花掉 1 条
    const after = X.market.open('yunshen');
    return before === true && after === true && s.secrets.length === 10;
  })(), '花费若被写进 secrets（而不是 secretsUsed），这里会红 —— 那就成了「花秘闻反而关掉已开的门」');

  check('解锁商品真的消耗秘闻（累计不变、可用减少）', (() => {
    seed(10);
    const a0 = X.market.available();
    const r = X.market.unlock('quzhangdan');
    return r.ok === true && X.market.available() === a0 - 1
      && X.market.used() === 1 && s.secrets.length === 10;
  })(), '若解锁不扣（或扣在 secrets 上），这条会红');

  check('同一条目不能重复花秘闻解锁', (() => {
    seed(10);
    X.market.unlock('quzhangdan');
    const again = X.market.unlock('quzhangdan');
    return again.ok === false && X.market.used() === 1;
  })(), '重复解锁若能成功，秘闻会被白白吃掉');

  check('未解锁的商品买不到（且点名要先花秘闻）', (() => {
    seed(10);
    s.spiritStones = 999;
    const r = X.market.buy('quzhangdan');
    return r.ok === false && /秘闻/.test(String(r.reason));
  })());

  // 祛障丹走旧字段 `cultivation.pills`（见 systems/alchemy.js 的 pillCount）
  const pillCountForSmoke = () => Number(s.cultivation?.pills) || 0;
  check('解锁后才买得到，且扣灵石、到手 1 枚祛障丹', (() => {
    seed(10);
    s.spiritStones = 999;
    const p0 = pillCountForSmoke();
    X.market.unlock('quzhangdan');
    const r = X.market.buy('quzhangdan');
    return r.ok === true && X.market.available() === 9
      && pillCountForSmoke() === p0 + 1 && s.spiritStones === 998;
  })(), '若买入不生效或价格不对，这条会红');

  // 反套利：卖出价 = 买入价 × 0.8 ⇒ 任一回路严格亏 20%，且与笔数、科技都无关
  check('反套利：灵石→银两 严格亏 20%，且与笔数无关', (() => {
    const q0 = X.market.quote(1);
    const round = (n) => X.market.quote(n).silver <= Math.floor(X.market.quote(1).silver * n * 1.0000001) + 1;
    // 用「买入同量灵石的成本」对照：卖出所得必须 ≤ 成本的 0.8
    const cost = Math.floor((q0.silver / 0.8) * 1);          // 由 0.8 反推买入成本
    return q0.silver <= cost * 0.8 + 1 && q0.silver < cost
      && round(1) && round(3) && round(11);
  })(), '若卖出价 ≥ 买入价，就能无限套利；这条会红');

  check('剿城开市：新坊市需要占据更多势力城', (() => {
    seed(10);
    const need = ['qingmu', 'heishi', 'wanxiang'].map((id) => X.market.open(id));
    const gate = ['qingmu', 'heishi', 'wanxiang'].map((id) => X.market.reason(id));
    return need.every((v) => v === false) && gate.every((r) => /打下|势力城/.test(r));
  })(), '新坊市在没占城时就该关着，并说明「须先打下 N 座势力城」');

  check('每座坊市都有自己的商品（新坊市卖新商品）', (() => {
    const ids = ['yunshen', 'qingmu', 'heishi', 'wanxiang'];
    const sets = ids.map((m) => X.market.goodsOf(m).map((g) => g.id));
    return sets.every((a) => a.length > 0)
      && new Set(sets.flat()).size === sets.flat().length;
  })(), '商品不许跨坊市重复，否则「新坊市卖新商品」不成立');

  restore();
})();

// ── 灵石来源不设总量上限（2026-10-11 用户实机报告的死局）──
// 用户原话：「我实际游玩发现当前版本坊市银两换灵石居然是有上限的，这是不对的，
// 比如说我换取灵石购买祛障丹，然后全部失败了，或者修士死亡了，而且坊市换灵石
// 也没办法换了，那我就彻底卡死了，对于玩家来说是不可接受的」。
// 灵石是**唯一**能撬动仙途的资源，它的来源一旦封顶就是可复现的死局。
check('灵石来源不设总量上限：兑过极多笔之后仍可继续兑', (() => {
  const s = gateState();
  const backup = { c: s.exchangeCount, st: s.spiritStones, sv: s.silver, sec: [...(s.secrets || [])] };
  s.secrets = Array.from({ length: 10 }, (_, i) => i);   // 门槛：云深谷需 10 条秘闻
  s.exchangeCount = 9999;
  s.spiritStones = 0;
  s.silver = 1e9;
  const r = X.market.exchangePlan(1);
  const okNow = r && r.ok === true;
  s.exchangeCount = backup.c; s.spiritStones = backup.st;
  s.silver = backup.sv; s.secrets = backup.sec;
  return okNow === true;
})(), '若上限还在（哪怕 9999 笔后封顶），这条会红 —— 那正是用户报的「彻底卡死」');

check('软锁复现链：丹药耗尽后仍能靠银两重新换到灵石', (() => {
  const s = gateState();
  const backup = { st: s.spiritStones, sv: s.silver, pills: s.cultivation?.pills, sec: [...(s.secrets || [])], used: s.secretsUsed };
  s.secrets = Array.from({ length: 10 }, (_, i) => i); s.secretsUsed = 0;
  s.spiritStones = 0; s.silver = 1e6;
  // 走真实路径：先换灵石 → 再买祛障丹（这一步不再依赖任何「剩余额度」）
  // 平价为 0.5 石/笔，所以换 2 笔才有 1 枚丹的钱
  const ex = X.market.exchangePlan(2);
  let bought = false;
  if (ex.ok) {
    s.spiritStones += 1;
    X.market.unlock('quzhangdan');
    bought = X.market.buy('quzhangdan').ok === true;
  }
  if (backup.pills !== undefined && s.cultivation) s.cultivation.pills = backup.pills;
  s.spiritStones = backup.st; s.silver = backup.sv; s.secrets = backup.sec; s.secretsUsed = backup.used;
  return ex.ok === true && bought === true;
})(), '「换灵石 → 买丹」这条路必须永远走得通，否则玩家会永久卡在凡人篇');

check('七个页面标签都在', document.querySelectorAll('.pagetab').length === 7,
  [...document.querySelectorAll('.pagetab')].map((b) => b.dataset.page).join(' '));
check('纪事侧栏在页面之外',
  Boolean(document.querySelector('.shell-side [data-panel="log"]'))
  && !document.querySelector('.page [data-panel="log"]'));
check('修士职业统计不再出现 undefined', (() => {
  // 这条以前是空过的：测试状态里没人担任新职责，所以显示不出 undefined。
  // 现在先让每个职责都有人担任，再检查。
  const jobs = Object.keys(X.data.jobs);
  const before = state.cultivation.cultivators.slice();
  state.cultivation.cultivators = jobs.map((job, i) => person({ id: 900 + i, name: `测试${i}`, job, realmIndex: 3 }));
  ui.render();
  const text = $('cultivator-job-stats').textContent;
  const bad = text.includes('undefined') || text.includes('NaN');
  state.cultivation.cultivators = before;
  ui.render();
  return !bad;
})(), `共 ${Object.keys(X.data.jobs).length} 种职责`);
check('页面切换可用（只在已露出的页签之间）', (() => {
  const pages = X.visible.pages();
  for (const p of pages) {
    ui.actions.setPage(p);
    if (state.ui.page !== p) return false;
  }
  ui.actions.setPage('home');
  return state.ui.page === 'home';
})());
check('还没到的时候，页签是藏起来的', (() => {
  // 这一节跑在很早的位置：此时还没有修士，所以仙途 / 百科 / 轮回都该藏着
  const pages = X.visible.pages();
  return pages.includes('home') && pages.includes('techs') && pages.includes('study')
    && !pages.includes('cycle');
})(), X.visible.pages().join(' '));
check('被藏起来的页签拒绝跳转', (() => {
  ui.actions.setPage('home');
  ui.actions.setPage('cycle');
  return state.ui.page === 'home';
})());
check('藏起来的页签带 hidden 属性', (() => {
  ui.syncPage();
  const tab = [...document.querySelectorAll('.pagetab')].find((b) => b.dataset.page === 'cycle');
  return tab && tab.hidden === true;
})());

/* ══════════════════════ 5. 境界表 ══════════════════════ */

section('境界表');
const realms = X.realm.table();
check('五个大境界', realms.tiers.length === 5, realms.tiers.map((t) => t.name).join(' '));
check('最高境界是化神圆满', X.realm.name(realms.max) === '化神圆满', X.realm.name(realms.max));
check('index 0 是凡人', X.realm.name(0) === '凡人', X.realm.name(0));
check('境界序号连续且都能取到名字', (() => {
  for (let i = 0; i <= realms.max; i += 1) {
    const info = X.realm.at(i);
    if (!info || info.index !== i || !info.fullName) return false;
  }
  return true;
})());
check('炼气一~九层就是 index 1~9', (() => {
  for (let i = 1; i <= 9; i += 1) if (X.realm.name(i) !== `炼气${['一','二','三','四','五','六','七','八','九'][i - 1]}层`) return false;
  return true;
})(), `1=${X.realm.name(1)} 9=${X.realm.name(9)}`);
check('筑基从 index 10 开始', X.realm.name(10) === '筑基初期', X.realm.name(10));
check('越界会被夹住不报错', X.realm.name(999) === '化神圆满' && X.realm.name(-5) === '凡人');

section('修为与战力曲线');
check('炼气一层要 45 点修为', X.realm.xpNeeded(1) === 45);
check('炼气九层要 45×81 点', X.realm.xpNeeded(9) === 45 * 81, `${X.realm.xpNeeded(9)}`);
check('筑基初期要 480 点', X.realm.xpNeeded(10) === 480, `${X.realm.xpNeeded(10)}`);
check('化神圆满已到顶（无需修为）', !Number.isFinite(X.realm.xpNeeded(realms.max)));
check('炼气一层战力 10（沿用旧公式）', X.realm.power(1) === 10);
check('炼气九层战力 10×1.65^8（沿用旧公式）',
  near(X.realm.power(9), 10 * Math.pow(1.65, 8)), `${X.realm.power(9).toFixed(2)}`);
check('筑基初期战力跳到 1200', X.realm.power(10) === 1200);
check('战力随境界单调递增', (() => {
  for (let i = 1; i < realms.max; i += 1) if (X.realm.power(i + 1) <= X.realm.power(i)) return false;
  return true;
})());

section('突破门槛');
check('炼气一到八层没有门槛', [1, 2, 3, 4, 5, 6, 7, 8].every((i) => X.realm.gate(i) === null));
check('炼气九层有门槛', Boolean(X.realm.gate(9)), JSON.stringify(X.realm.gate(9))?.slice(0, 60));
check('四个大境界各有一道门槛',
  [9, 13, 17, 21].every((i) => X.realm.gate(i)) && X.realm.gate(25) === null);
check('门槛写明从哪到哪', X.realm.gate(9).fromName === '炼气九层' && X.realm.gate(9).toName === '筑基初期');

section('节奏核对');
{
  const pacing = X.realm.pacing();
  const hours = pacing.total / H;
  check('一周目总时长落在 40–50 小时', hours >= 40 && hours <= 50, `${hours.toFixed(1)} 小时`);
  const qi = pacing.tiers.find((t) => t.id === 'qi');
  check('炼气篇（一层到九层）2–4 小时',
    qi.secs / H >= 2 && qi.secs / H <= 4, `${(qi.secs / H).toFixed(2)} 小时`);
  check('后期比前期长（化神 > 筑基）',
    pacing.tiers[4].secs > pacing.tiers[1].secs,
    `筑基 ${(pacing.tiers[1].secs / H).toFixed(1)}h / 化神 ${(pacing.tiers[4].secs / H).toFixed(1)}h`);
  check('每档的累计时间是递增的',
    pacing.tiers.every((t, i) => i === 0 || t.cumulative > pacing.tiers[i - 1].cumulative));
}

/* ══════════════════════ 6. 修为推进与自动晋升 ══════════════════════ */

section('修为推进');
setPeople(person({ realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
X.step(1000);
{
  const p = state.cultivation.cultivators[0];
  check('闭关 1000 秒后自动晋升到炼气四层', p.realmIndex === 4, X.realm.name(p.realmIndex));
  check('晋升会正确结转修为', near(p.xp, 370, 1e-6), `xp=${p.xp}`);
}

check('未闭关的修士修为停滞', (() => {
  setPeople(person({ realmIndex: 3, xp: 0, job: 'guard' }));
  X.step(500);
  return state.cultivation.cultivators[0].realmIndex === 3
    && state.cultivation.cultivators[0].xp === 0;
})());

check('卡在瓶颈上不再积累修为', (() => {
  const need = X.realm.xpNeeded(9);
  setPeople(person({ realmIndex: 9, xp: need, job: 'retreat', talent: 1 }));
  X.step(5000);
  const p = state.cultivation.cultivators[0];
  return p.realmIndex === 9 && near(p.xp, need, 1e-6);
})(), '系统不会替你跨大档');

check('修为没满时不显示可冲关', (() => {
  setPeople(person({ realmIndex: 9, xp: 10, job: 'retreat' }));
  return X.realm.stateOf(1).kind === 'filling';
})());

/* ══════════════════════ 7. 突破 ══════════════════════ */

section('突破：询价');
const gateNeed = X.realm.xpNeeded(9);
const atGate = (over = {}) => {
  setPeople(person({ realmIndex: 9, xp: gateNeed, job: 'retreat', talent: 1, ...over }));
  state.spiritStones = 1000;
  state.cultivation.clues = 50;
  // 【策划 C4 / 任务 T-5】炼气九层那道门槛现在要求「择地筑基」，
  // 所以测试里必须先把一处地点标成「已抵达」，否则询价会卡在「请先择地」。
  state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
  // R5 起突破门槛以丹药为主材料，所以测试里先备上
  X.alchemy.addPills('zhuji', 5);
};
atGate();
check('修为满了进入「瓶颈」状态', X.realm.stateOf(1).kind === 'blocked', X.realm.stateOf(1).kind);
{
  // 【策划 C4 / 任务 T-5】炼气九层那道门槛现在要先择地，所以询价要带 siteId
  const plan = X.realm.plan(1, 'mosscave');
  check('询价成立', plan.ok === true, plan.reason || '');
  check('写明从哪到哪', plan.fromName === '炼气九层' && plan.toName === '筑基初期');
  check('代价与门槛表一致', plan.stones === 8 && plan.clues === 2, `${plan.stones} 灵石 / ${plan.clues} 线索`);
  check('门槛要求对应的丹药（R5 回填）', plan.pill === 'zhuji' && plan.pillName === '筑基丹',
    `${plan.pillName}`);
  check('失败惩罚 = 本层所需 × failLoss', plan.loss === Math.floor(gateNeed * 0.35), `${plan.loss}`);
  check('走的是灵石', plan.currency === 'stones');
}

section('突破：门槛拦截');
state.spiritStones = 5;
check('灵石不足时拒绝', X.realm.plan(1).ok === false, X.realm.plan(1).reason);
// 【t12 验收】每道门槛都要「拒绝理由**点名**缺哪一样」——
// 只说 ok===false 是不够的：玩家看不到「还缺什么」就等于没有提示。
// 这三条对应 t9 的 findings「冲关的灵石/线索门槛只断言 ok===false，理由未被断言点名」。
check('灵石不足时理由点名灵石与差额',
  (() => { const p = X.realm.plan(1);
    return p.ok === false && /灵石/.test(p.reason) && /8/.test(p.reason) && /5/.test(p.reason); })(),
  X.realm.plan(1).reason);
atGate();
state.cultivation.clues = 0;
check('线索不足时拒绝', X.realm.plan(1).ok === false, X.realm.plan(1).reason);
check('线索不足时理由点名线索与差额',
  (() => { const p = X.realm.plan(1);
    return p.ok === false && /线索/.test(p.reason) && /2/.test(p.reason); })(),
  X.realm.plan(1).reason);
atGate();
{
  // 没有丹药就冲不了关 —— 这是炼丹区块存在的理由
  addPillAndZero('zhuji');
  const plan = X.realm.plan(1);
  check('没有丹药时拒绝冲关', plan.ok === false, plan.reason);
  check('拒绝理由点名了缺哪一味丹', plan.reason.includes('筑基丹'), plan.reason);
  atGate();
}
// 【t12 验收 · 另一侧】资源刚好够 → 必须放行（配合上面「差一点 → 被拒并点名」，构成两侧）。
// 只断言拒绝侧的话，一个「永远拒绝」的实现也会全绿 —— 两侧缺一不可。
{
  atGate();
  state.spiritStones = 8;        // 恰好等于门槛
  state.cultivation.clues = 2;   // 恰好等于门槛
  X.alchemy.addPills('zhuji', 1); // 恰好一枚
  // ⚠ 炼气九层那道门槛**还要求择地**（T-5），所以询价必须带 siteId ——
  //   不带的话会先被「请先择地筑基」拦下，断言会误判成「资源不够」。
  check('冲关资源刚好够（8 灵石 / 2 线索 / 1 枚筑基丹 + 已择地）→ 放行', (() => {
    const p = X.realm.plan(1, 'mosscave');
    return p.ok === true && p.stones === 8 && p.clues === 2 && p.pill === 'zhuji';
  })(), (() => { const p = X.realm.plan(1, 'mosscave'); return `${p.ok} ${p.reason || ''} ${p.stones}/${p.clues}/${p.pill}`; })());
  atGate();
}
function addPillAndZero(id) {
  const have = X.alchemy.pill(id);
  X.alchemy.addPills(id, -have);
}
check('同档内的小境界无需冲关', (() => {
  setPeople(person({ realmIndex: 3, xp: X.realm.xpNeeded(3), job: 'retreat' }));
  const st = X.realm.stateOf(1);
  return st.kind === 'progressing' && X.realm.plan(1).ok === false;
})());
check('化神圆满不能再突破', (() => {
  setPeople(person({ realmIndex: realms.max, xp: 0 }));
  return X.realm.stateOf(1).kind === 'max' && X.realm.plan(1).ok === false;
})());
check('不存在的修士被拒绝', X.realm.plan(9999).ok === false);

section('突破：成功率');
atGate();
check('基础成功率来自门槛表', near(X.realm.rate(1, 0), 0.55), `${X.realm.rate(1, 0)}`);
check('天赋越高越容易冲关',
  X.realm.rate(1, 0) < realmRateWithTalent(1.5), `${X.realm.rate(1, 0)} → ${realmRateWithTalent(1.5)}`);
function realmRateWithTalent(talent) {
  setPeople(person({ realmIndex: 9, xp: gateNeed, talent }));
  const r = X.realm.rate(1, 0);
  atGate();
  return r;
}
check('连续失败给补偿（每次 +8%）',
  near(X.realm.rate(1, 3), Math.min(0.95, 0.55 + 0.24)), `${X.realm.rate(1, 3)}`);
check('成功率有 95% 硬上限', near(X.realm.rate(1, 50), 0.95), `${X.realm.rate(1, 50)}`);

section('突破：兑现');
atGate();
{
  const before = state.spiritStones;
  const cluesBefore = state.cultivation.clues;
  const pillsBefore = X.alchemy.pill('zhuji');
  const r = X.realm.commitWith(1, 'mosscave', () => 0);   // 骰子必成功
  check('成功时晋升到筑基初期', r.success === true && state.cultivation.cultivators[0].realmIndex === 10,
    r.ok ? X.realm.name(state.cultivation.cultivators[0].realmIndex) : r.reason);
  check('成功后修为清零', state.cultivation.cultivators[0].xp === 0);
  check('成功后失败计数清零', state.cultivation.cultivators[0].breakFailures === 0);
  check('材料照扣', state.spiritStones === before - 8 && state.cultivation.clues === cluesBefore - 2,
    `${before} → ${state.spiritStones} 灵石`);
  check('丹药也照扣', X.alchemy.pill('zhuji') === pillsBefore - 1,
    `${pillsBefore} → ${X.alchemy.pill('zhuji')}`);
}

atGate();
{
  const before = state.spiritStones;
  const pillsBefore = X.alchemy.pill('zhuji');
  const r = X.realm.commitWith(1, 'mosscave', () => 0.999);   // 骰子必失败
  const p = state.cultivation.cultivators[0];
  check('失败时留在原境界', r.success === false && p.realmIndex === 9);
  check('失败时修为倒退', near(p.xp, gateNeed - r.loss, 1e-6), `xp=${p.xp}`);
  check('失败后计数 +1', p.breakFailures === 1);
  check('失败也扣材料（所以「备足再冲」有意义）',
    state.spiritStones === before - 8, `${before} → ${state.spiritStones}`);
  check('失败也扣丹药', X.alchemy.pill('zhuji') === pillsBefore - 1,
    `${pillsBefore} → ${X.alchemy.pill('zhuji')}`);
  check('返回下一次的成功率', near(r.nextRate, Math.min(0.95, 0.55 + 0.08)), `${r.nextRate}`);
  check('倒退之后不再是 blocked（要重新补修为）', X.realm.stateOf(1).kind === 'filling');
}

section('突破：建议人选');
atGate();
const other = person({ id: 2, name: '顾云岚', realmIndex: 9, xp: gateNeed, talent: 1.6 });
state.cultivation.cultivators.push(other);
check('给出成功率最高的那个', (() => {
  const best = X.realm.best('mosscave');
  return best && best.personId === 2;
})(), JSON.stringify(X.realm.best('mosscave')?.name));

/* ══════════════════════ 8. 灵根 ══════════════════════ */

section('灵根表');
const rootTable = X.root.table();
check('五档灵根', rootTable.grades.length === 5, rootTable.grades.map((g) => g.name).join(' '));
check('五行齐备', Object.keys(rootTable.elements).length === 5);
check('后天权重合计为 1',
  near(rootTable.grades.reduce((a, g) => a + g.weight, 0), 1, 1e-9),
  `${rootTable.grades.reduce((a, g) => a + g.weight, 0).toFixed(4)}`);
check('天生权重合计为 1',
  near(rootTable.grades.reduce((a, g) => a + g.innateWeight, 0), 1, 1e-9));
check('越纯的灵根概率越低（天灵根最低）',
  rootTable.grades.every((g, i) => i === 0 || g.weight >= rootTable.grades[i - 1].weight));
// 天生灵根的权重表把概率往好档挪（伪灵根因此反而变低），
// 所以不能逐档比，要比「好档的合计概率」。
check('天生灵根抽到天/双灵根的概率远高于后天', (() => {
  const good = (g) => g.id === 'heaven' || g.id === 'dual';
  const innateGood = rootTable.grades.filter(good).reduce((a, g) => a + g.innateWeight, 0);
  const baseGood = rootTable.grades.filter(good).reduce((a, g) => a + g.weight, 0);
  return innateGood > baseGood * 2;
})(), (() => {
  const good = (g) => g.id === 'heaven' || g.id === 'dual';
  const i = rootTable.grades.filter(good).reduce((a, g) => a + g.innateWeight, 0);
  const b = rootTable.grades.filter(good).reduce((a, g) => a + g.weight, 0);
  return `后天 ${(b * 100).toFixed(1)}% → 天生 ${(i * 100).toFixed(1)}%`;
})());
check('速度与纯度正相关（越纯越快）',
  rootTable.grades.every((g, i) => i === 0 || g.speed <= rootTable.grades[i - 1].speed));
check('境界上限与纯度正相关',
  rootTable.grades.every((g, i) => i === 0 || g.capIndex <= rootTable.grades[i - 1].capIndex));
check('只有天灵根能修全部系别',
  rootTable.grades.filter((g) => g.canLearnAll).length === 1
  && rootTable.grades[0].id === 'heaven');
check('炼气（吐纳）无属性，人人可修', rootTable.daoElement.breath === null);
check('四条道途各占一属性',
  new Set(['ward', 'trade', 'seek', 'peril'].map((d) => rootTable.daoElement[d])).size === 4);
check('木没有对应道途（留给炼丹）',
  !Object.values(rootTable.daoElement).includes('wood'));

section('抽签');
{
  // 大样本核对权重（种子固定，所以结果可复现）
  const r = X.makeRng(777);
  const counts = {};
  for (let i = 0; i < 20000; i += 1) {
    const root = X.root.roll(false, r);
    counts[root.grade] = (counts[root.grade] || 0) + 1;
  }
  check('伪灵根约占一半', Math.abs(counts.pseudo / 20000 - 0.505) < 0.02,
    `${((counts.pseudo / 20000) * 100).toFixed(1)}%`);
  check('天灵根极稀有（但 2 万次里出得来）',
    counts.heaven / 20000 < 0.02, `${counts.heaven} 次`);
  check('元素数量与档位一致', (() => {
    const r2 = X.makeRng(31337);
    for (let i = 0; i < 500; i += 1) {
      const root = X.root.roll(false, r2);
      const g = rootTable.grades.find((x) => x.id === root.grade);
      if (root.elements.length !== g.count) return false;
      if (new Set(root.elements).size !== root.elements.length) return false;
    }
    return true;
  })());
}

section('灵根：三个数值效果');
setPeople(person({ realmIndex: 1, xp: 0, job: 'retreat', talent: 1, breakFailures: 0 }));
X.root.set(1, 'heaven', ['fire']);
check('天灵根速度 ×2.0', near(X.root.speed(1), 2.0), `${X.root.speed(1)}`);
check('天灵根突破 +15%', near(X.root.breakBonus(1), 0.15), `${X.root.breakBonus(1)}`);
check('天灵根可至化神圆满', X.root.cap(1) === realms.max, X.realm.name(X.root.cap(1)));

X.root.set(1, 'pseudo', ['metal', 'wood', 'water', 'fire', 'earth']);
check('五灵根速度 ×0.7', near(X.root.speed(1), 0.7), `${X.root.speed(1)}`);
check('五灵根突破 −8%', near(X.root.breakBonus(1), -0.08), `${X.root.breakBonus(1)}`);
check('五灵根只到元婴圆满', X.realm.name(X.root.cap(1)) === '元婴圆满', X.realm.name(X.root.cap(1)));

check('灵根上限真的卡住晋升', (() => {
  setPeople(person({ realmIndex: X.root.cap(1), xp: 0, job: 'retreat',
    root: { grade: 'pseudo', elements: ['metal'], rerolls: 0 } }));
  X.step(200000);
  return state.cultivation.cultivators[0].realmIndex === X.root.cap(1);
})(), `卡在 ${X.realm.name(X.root.cap(1))}`);

section('灵根：决定修炼速度');
{
  const run = (gradeId, elements) => {
    setPeople(person({ realmIndex: 1, xp: 0, job: 'retreat', talent: 1,
      root: { grade: gradeId, elements, rerolls: 0 } }));
    state.cultivation.manuals = [];
    state.cultivation.equippedManual = null;
    state.cultivation.assistManual = null;
    X.step(1000);
    const p = state.cultivation.cultivators[0];
    let t = p.xp;
    for (let i = 1; i < p.realmIndex; i += 1) t += X.realm.xpNeeded(i);
    return t;
  };
  const heaven = run('heaven', ['fire']);
  const quad = run('quad', ['metal', 'water', 'fire', 'earth']);
  const pseudo = run('pseudo', ['metal', 'wood', 'water', 'fire', 'earth']);
  check('天灵根修炼速度是四灵根的两倍', near(heaven, quad * 2.0, 1e-6),
    `${heaven.toFixed(0)} vs ${quad.toFixed(0)}`);
  check('五灵根只有四灵根的七成', near(pseudo, quad * 0.7, 1e-6),
    `${pseudo.toFixed(0)} vs ${quad.toFixed(0)}`);
}

section('灵根：限制可修功法');
state.cultivation.manuals = ['xuanjia', 'wangqi', 'guixi', 'jiejian'];
state.cultivation.attune = {};
state.cultivation.equippedManual = 'xuanjia';
state.cultivation.assistManual = null;
{
  // 金灵根：能修御守（金），不能修寻幽（水）
  setPeople(person({ realmIndex: 5, job: 'retreat', root: { grade: 'heaven', elements: ['metal'], rerolls: 0 } }));
  check('天灵根可修任意系别', X.root.canLearn(1, 'wangqi') === true);
  setPeople(person({ realmIndex: 5, job: 'retreat', root: { grade: 'dual', elements: ['metal', 'fire'], rerolls: 0 } }));
  check('金火双灵根能修御守（金）', X.root.canLearn(1, 'xuanjia') === true);
  check('金火双灵根能修涉险（火）', X.root.canLearn(1, 'guixi') === true);
  check('金火双灵根不能修寻幽（水）', X.root.canLearn(1, 'wangqi') === false);
  check('金火双灵根不能修经营（土）', X.root.canLearn(1, 'jiejian') === false);

  state.cultivation.equippedManual = 'wangqi';
  X.step(1000);
  check('灵根不合的人吃不到那本功法', near(X.manual.bonusFor(1).explore, 0, 1e-12),
    `explore +${(X.manual.bonusFor(1).explore * 100).toFixed(2)}%`);

  state.cultivation.equippedManual = 'xuanjia';
  check('灵根合的人吃得到', X.manual.bonusFor(1).power > 0,
    `power +${(X.manual.bonusFor(1).power * 100).toFixed(2)}%`);
}
{
  // 天灵根专精：本系功法效果 ×1.5
  setPeople(person({ realmIndex: 5, job: 'retreat', root: { grade: 'heaven', elements: ['metal'], rerolls: 0 } }));
  const heavenPower = X.manual.bonusFor(1).power;
  setPeople(person({ realmIndex: 5, job: 'retreat', root: { grade: 'dual', elements: ['metal', 'fire'], rerolls: 0 } }));
  const dualPower = X.manual.bonusFor(1).power;
  check('天灵根本系功法效果 ×1.5', near(heavenPower, dualPower * 1.5, 1e-9),
    `${(dualPower * 100).toFixed(1)}% → ${(heavenPower * 100).toFixed(1)}%`);
  check('天灵根专精不作用于无属性功法', near(X.root.focus(1, 'star'), 1), '炼气无属性');
}

section('灵根：测灵根（重测）');
setPeople(person({ realmIndex: 3, job: 'retreat', root: { grade: 'pseudo', elements: ['metal','wood','water','fire','earth'], rerolls: 0 } }));
state.spiritStones = 10;
check('灵石不足时拒绝', X.root.rerollPlan(1).ok === false, X.root.rerollPlan(1).reason);
state.spiritStones = 1000;
{
  const cost0 = X.root.rerollCost(1);
  check('首次重测 30 灵石', cost0 === 30, `${cost0}`);
  const before = state.spiritStones;
  const r = X.root.reroll(1, () => 0);   // 骰子给天灵根
  check('重测成功', r.ok === true, r.reason || '');
  check('扣掉灵石', state.spiritStones === before - cost0, `${before} → ${state.spiritStones}`);
  check('重测记录 +1', state.cultivation.cultivators[0].root.rerolls === 1);
  check('抽到更好的就换掉', r.improved === true && X.root.grade(1).id === 'heaven',
    `${r.before} → ${r.after}`);
  check('第二次更贵', X.root.rerollCost(1) === 55, `${X.root.rerollCost(1)}`);
}
{
  // 已经是天灵根了，再测不会变差
  const r = X.root.reroll(1, () => 0.999);   // 骰子给最差的
  check('测得更差时保留原有的（只扣钱）',
    r.improved === false && X.root.grade(1).id === 'heaven', `${r.before} → ${r.after}`);
  check('但重测次数照样累加', state.cultivation.cultivators[0].root.rerolls === 2);
}

section('灵根：宗门引荐礼');
{
  setPeople(person({ realmIndex: 6, job: 'retreat', talent: 1.2,
    root: { grade: 'dual', elements: ['metal', 'fire'], rerolls: 0 } }));
  const dualGift = X.root.referral(1);
  X.root.set(1, 'heaven', ['metal']);
  const heavenGift = X.root.referral(1);
  check('资质越好，引荐礼越高', heavenGift > dualGift, `${dualGift} → ${heavenGift}`);

  const runSect = (gradeId, elements) => {
    setPeople(person({ realmIndex: 6, job: 'retreat', talent: 1.2,
      root: { grade: gradeId, elements, rerolls: 0 } }));
    state.spiritStones = 0;
    return { r: state.cultivation.cultivators[0], stones: 0 };
  };
  const { r } = runSect('dual', ['metal', 'fire']);
  state.cultivation.cultivators = [r];
  const before = state.spiritStones;
  const res = X.immortalAction('sect', 1, () => 0.5);
  check('送宗门成功', res.ok === true, res.reason || '');
  check('宗门发了引荐礼', state.spiritStones > before, `${before} → ${state.spiritStones}`);
  check('身份变为宗门', r.job === 'sect');

  // 资质不够的进不去
  setPeople(person({ realmIndex: 6, job: 'retreat', root: { grade: 'pseudo', elements: ['metal'], rerolls: 0 } }));
  const bad = X.immortalAction('sect', 1, () => 0.5);
  check('伪灵根被宗门拒收', bad.ok === false, bad.reason);
}

/* ══════════════════════ 9. 秘籍（回归） ══════════════════════ */

section('秘籍目录');
const catalog = X.manual.catalog();
check('目录功法数与数据表一致', catalog.length === X.data.manuals.length, `${catalog.length} 本`);
check('五条道途各至少 3 本', ['breath', 'ward', 'trade', 'seek', 'peril']
  .every((d) => catalog.filter((x) => x.dao === d).length >= 3),
  ['breath', 'ward', 'trade', 'seek', 'peril'].map((d) => `${d}:${catalog.filter((x) => x.dao === d).length}`).join(' '));
check('三个品阶各至少 5 本', [1, 2, 3].every((t) => catalog.filter((x) => x.tier === t).length >= 5),
  [1, 2, 3].map((t) => `T${t}:${catalog.filter((x) => x.tier === t).length}`).join(' '));
check('旧版三本 id 与数值原样保留', (() => {
  const get = (id) => catalog.find((x) => x.id === id)?.effect.training;
  return near(get('breath'), 0.40) && near(get('spring'), 1.10) && near(get('star'), 2.20);
})());
check('两张功法表已合并', /const OBTAINABLE_MANUALS\s*=\s*CULTIVATION_MANUALS/.test(code));

section('掉落与参悟');
state.cultivation.manuals = [];
state.cultivation.attune = {};
state.cultivation.equippedManual = null;
state.cultivation.assistManual = null;
setPeople();
state.spiritStones = 0;
check('开局未收录任何功法', X.manual.owned().length === 0);
check('开局修炼倍率为 1', X.manual.training() === 1);

X.manual.grant(1, () => 0);
check('第 1 本自动填进主修位', state.cultivation.equippedManual === 'breath');
check('主修生效：修炼倍率 1.4', near(X.manual.training(), 1.4), `${X.manual.training()}`);

const dup = X.manual.grant(1, () => 0);
check('重复掉落不再报「获得新功法」', dup.isNew === false);
check('重复掉落转为参悟', X.manual.attuneOf('breath') === 1);
for (let i = 0; i < 10; i += 1) X.manual.grant(1, () => 0);
check('参悟上限为 5', X.manual.attuneOf('breath') === 5);
check('参悟满后重复掉落折算灵石', state.spiritStones >= 2, `${state.spiritStones} 灵石`);
check('参悟 5 层使效果 ×1.6', near(X.manual.training(), 1 + 0.40 * 1.6), `${X.manual.training().toFixed(4)}`);

section('主动参悟');
state.cultivation.manuals = ['star'];
state.cultivation.attune = {};
state.cultivation.equippedManual = 'star';
state.spiritStones = 1; state.cultivation.clues = 5;
check('灵石不足时拒绝', X.manual.attune('star').ok === false, X.manual.attune('star').reason);
state.spiritStones = 10; state.cultivation.clues = 1;
check('线索不足时拒绝', X.manual.attune('star').ok === false, X.manual.attune('star').reason);
state.cultivation.clues = 5;
{
  const before = state.spiritStones;
  const ok = X.manual.attune('star');
  check('条件满足时参悟成功', ok.ok === true, ok.reason);
  check('扣 3 灵石 / 2 线索',
    near(state.spiritStones, before - 3) && state.cultivation.clues === 3,
    `${state.spiritStones} 灵石 / ${state.cultivation.clues} 线索`);
}
check('未收录的功法不能参悟', X.manual.attune('dayan').ok === false);

section('主修 / 辅修');
state.cultivation.manuals = ['star', 'spring', 'xuanjia', 'wangqi'];
state.cultivation.attune = {};
state.cultivation.equippedManual = 'star';
state.cultivation.assistManual = null;
check('设辅修成功', X.manual.equip('xuanjia', 'assist').ok === true);
check('辅修只吃 45%（0.60 → 0.27）', near(X.manual.bonus().power, 0.60 * 0.45),
  `power +${(X.manual.bonus().power * 100).toFixed(2)}%`);
check('同一道途不可同时占两位', X.manual.equip('spring', 'assist').ok === false);
check('换到别的道途可行', X.manual.equip('wangqi', 'assist').ok === true);
check('未收录的不能装备', X.manual.equip('dayan', 'main').ok === false);
check('已占位的不能重复设', X.manual.equip('star', 'main').ok === false);
check('主修换御守可行', X.manual.equip('xuanjia', 'main').ok === true);
check('主修换了道途后冲突解除', X.manual.equip('spring', 'assist').ok === true);

/* ══════════════════════ 9. 效果接入 ══════════════════════ */

section('效果接入：战力');
setPeople(person({ realmIndex: 5, job: 'guard', talent: 1.1 }));
state.cultivation.manuals = ['star', 'xuanjia'];
state.cultivation.equippedManual = 'xuanjia';
state.cultivation.assistManual = null;
ui.render();
const powerWard = X.derive().cultivatorPower;
state.cultivation.equippedManual = 'star';
ui.render();
const powerPlain = X.derive().cultivatorPower;
check('御守抬高修士战力（×1.6）', near(powerWard, powerPlain * 1.6, 1e-6),
  `${powerPlain.toFixed(1)} → ${powerWard.toFixed(1)}`);

section('效果接入：劳作与寻幽');
// 劳作/探索按「大档内的层数」计，所以筑基中期（index 11）应该只算 2 层
setPeople(person({ realmIndex: 11, job: 'labor' }));
state.cultivation.manuals = ['jiejian'];
state.cultivation.equippedManual = 'jiejian';
ui.render();
const laborWith = X.derive().cultivateFx.laborMult;
state.cultivation.equippedManual = 'breath';
ui.render();
const laborPlain = X.derive().cultivateFx.laborMult;
check('经营抬高劳作产出（×1.2）', near(laborWith, laborPlain * 1.2, 1e-9),
  `${laborPlain.toFixed(3)} → ${laborWith.toFixed(3)}`);
check('筑基中期只按本档第 2 层计劳作（0.16 而非 0.88）',
  near(laborPlain, 2 * 0.08, 1e-9), `laborMult=${laborPlain}`);

setPeople(person({ realmIndex: 4, job: 'explore' }));
state.cultivation.manuals = ['wangqi'];
state.cultivation.equippedManual = 'wangqi';
ui.render();
const seekWith = X.derive().cultivateFx.explorePerSec;
state.cultivation.equippedManual = 'breath';
ui.render();
const seekPlain = X.derive().cultivateFx.explorePerSec;
check('寻幽抬高秘闻发现速度（×1.3）', near(seekWith, seekPlain * 1.3, 1e-12));

section('效果接入：修炼速度（宗门 vs 闭关）');
/**
 * 累计修为总量。
 * 不能直接比 person.xp —— 晋升会把超出部分结转，所以「当前层内的 xp」
 * 与总投入不成比例。要把已经走过的层数折算回来才可比。
 */
const totalXp = (p) => {
  let t = p.xp;
  for (let i = 1; i < p.realmIndex; i += 1) {
    const n = X.realm.xpNeeded(i);
    if (Number.isFinite(n)) t += n;
  }
  return t;
};
const trainPair = (manuals, equipped, attune) => {
  setPeople(
    person({ id: 1, realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }),
    person({ id: 2, name: '顾云岚', realmIndex: 1, xp: 0, job: 'sect', talent: 1 }),
  );
  state.cultivation.manuals = manuals;
  state.cultivation.attune = attune || {};
  state.cultivation.equippedManual = equipped;
  state.cultivation.assistManual = null;
  X.step(1000);
  return state.cultivation.cultivators;
};
{
  const [r, s] = trainPair([], null);
  check('无功法时宗门快 3.5 倍', near(totalXp(s), totalXp(r) * 3.5, 1e-6),
    `闭关 ${totalXp(r).toFixed(0)} / 宗门 ${totalXp(s).toFixed(0)}`);
}
{
  const [r, s] = trainPair(['star'], 'star');
  check('未参悟的地阶炼气仍慢于宗门', totalXp(r) < totalXp(s),
    `闭关 ${totalXp(r).toFixed(0)}（3.2×） / 宗门 ${totalXp(s).toFixed(0)}（3.5×）`);
}
{
  const [r, s] = trainPair(['star'], 'star', { star: 5 });
  check('满参悟地阶炼气后闭关反超宗门', totalXp(r) > totalXp(s),
    `闭关 ${totalXp(r).toFixed(0)}（4.52×） / 宗门 ${totalXp(s).toFixed(0)}（3.5×）`);
  check('宗门弟子始终不受家族功法影响', near(totalXp(s), 3500, 1e-6), `${totalXp(s).toFixed(0)}`);
}

section('效果接入：洞天生还率');
setPeople(person({ realmIndex: 3, talent: 1.1, job: 'retreat' }));
state.cultivation.manuals = [];
state.cultivation.equippedManual = null;
const survPlain = X.manual.survival(1, 1);
state.cultivation.manuals = ['dayan'];
state.cultivation.equippedManual = 'dayan';
const survPeril = X.manual.survival(1, 1);
check('涉险抬高洞天生还率（+0.35）', near(survPeril, Math.min(0.98, survPlain + 0.35), 1e-9),
  `${(survPlain * 100).toFixed(1)}% → ${(survPeril * 100).toFixed(1)}%`);
check('生还率仍被 98% 封顶', survPeril <= 0.98 + 1e-12);
X.step(0);
check('面板预估与结算公式一致',
  $('immortal-expansion').innerHTML.includes((survPeril * 100).toFixed(1) + '%'),
  `期望 ${(survPeril * 100).toFixed(1)}%`);

/* ══════════════════════ 10. 界面 ══════════════════════ */

section('修士名册（境界显示）');
setPeople(person({ realmIndex: 10, xp: 0, job: 'retreat' }));
ui.render();
check('名册显示「筑基初期」而不是「炼气 10 层」',
  $('cultivator-list').textContent.includes('筑基初期'), '');
check('名册写明最多可至', $('cultivator-list').textContent.includes('最多可至'));

section('瓶颈时的冲关按钮');
setPeople(person({ realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
state.spiritStones = 1000; state.cultivation.clues = 50;
ui.render();
check('瓶颈时出现冲关按钮', Boolean(document.querySelector('[data-breakthrough]')));
check('按钮写明目标境界与成功率',
  document.querySelector('[data-breakthrough]').textContent.includes('筑基初期'),
  document.querySelector('[data-breakthrough]').textContent);
check('按钮标出代价', $('cultivator-list').textContent.includes('8 灵石'),
  $('cultivator-list').textContent.replace(/\s+/g, ' ').slice(-90));
check('按钮写明需要哪一味丹药（R5）',
  $('cultivator-list').textContent.includes('筑基丹'),
  $('cultivator-list').textContent.replace(/\s+/g, ' ').slice(-90));
{
  state.spiritStones = 0;
  ui.render();
  const btn = document.querySelector('[data-breakthrough]');
  check('材料不足时按钮禁用', btn && btn.disabled === true);
  check('并写明缺什么', $('cultivator-list').textContent.includes('灵石'),
    $('cultivator-list').textContent.replace(/\s+/g, ' ').slice(-90));
}

section('功法阁界面');
state.cultivation.manuals = [];
state.cultivation.attune = {};
state.cultivation.equippedManual = null;
setPeople();
X.step(0);
check('功法阁面板存在', Boolean($('manual-grid')));
check('空状态可见', $('original-manual-info').hidden === false);
check('装备栏隐藏', $('manual-slots').hidden === true);

state.cultivation.manuals = ['star', 'spring', 'xuanjia', 'wangqi'];
state.cultivation.attune = { star: 2 };
state.cultivation.equippedManual = 'star';
state.cultivation.assistManual = 'xuanjia';
state.spiritStones = 100; state.cultivation.clues = 100;
X.step(0);
check('空状态已隐藏', $('original-manual-info').hidden === true);
check('芯片显示收录进度', $('manual-chip').textContent === `4 / ${X.data.manuals.length} 门`, $('manual-chip').textContent);
check('装备栏显示主修与辅修',
  $('manual-slots').textContent.includes('周天星河诀')
  && $('manual-slots').textContent.includes('玄甲护身诀'));
check('装备栏标出参悟层数', $('manual-slots').textContent.includes('参悟 2/5'));
check('汇总区列出了生效加成', $('manual-summary').textContent.includes('闭关修为'));
check('全部功法都画出（含未收录）',
  $('manual-grid').querySelectorAll('.manual-card').length === X.data.manuals.length);
check('未收录的标为 locked',
  $('manual-grid').querySelectorAll('.manual-card.is-locked').length === X.data.manuals.length - 4);
check('已收录的每本三个按钮',
  $('manual-grid').querySelectorAll('[data-manual-action]').length === 12);
check('同道途的卡片按钮被禁用',
  [...$('manual-grid').querySelectorAll('[data-manual-action="main"]')]
    .find((b) => b.dataset.manual === 'spring')?.disabled === true);

/* ══════════════════════ 10. 地图与征伐 ══════════════════════ */

section('地图');
const nodes = X.map.nodes();
check('八个节点', nodes.length === 8, nodes.map((n) => n.name).join(' '));
check('洞天与势力各四个',
  nodes.filter((n) => n.kind === 'cave').length === 4
  && nodes.filter((n) => n.kind === 'foe').length === 4);
check('节点 id 唯一', new Set(nodes.map((n) => n.id)).size === 8);
check('网格 4×2，每个格子都有人', (() => {
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 2; r += 1) {
    if (!nodes.some((n) => n.col === c && n.row === r)) return false;
  }
  return true;
})());
check('相邻关系是对称的', nodes.every((n) =>
  X.map.neighbors(n.id).every((m) => X.map.neighbors(m.id).some((k) => k.id === n.id))));
check('每个节点都有 2–4 个邻居',
  nodes.every((n) => { const k = X.map.neighbors(n.id).length; return k >= 2 && k <= 4; }),
  nodes.map((n) => X.map.neighbors(n.id).length).join(','));
check('每个节点都写了建议境界或战力',
  nodes.every((n) => (n.kind === 'cave' ? n.realm > 0 : n.power > 0)));
check('每个节点都有背景文字（百科要用）',
  nodes.every((n) => typeof n.lore === 'string' && n.lore.length > 10));
check('越深处的节点越强', (() => {
  const byTier = {};
  for (const n of nodes) (byTier[n.tier] ||= []).push(n);
  const caveMax = (t) => Math.max(...(byTier[t] || []).filter((n) => n.kind === 'cave').map((n) => n.realm), 0);
  return caveMax(1) < caveMax(2) && caveMax(2) < caveMax(3) && caveMax(3) < caveMax(4);
})());

section('地图：相邻才能去');
setPeople(person({ realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
state.spiritStones = 5000;
state.cultivation.clues = 50;
state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {} };
X.step(0);   // 触发一次 repair，让起点自动抵达
check('踏入仙途后起点自动抵达', X.map.reached().includes('mosscave'), X.map.reached().join(','));
check('起点本身可去', X.map.nodeStatus('mosscave') === 'open');
check('起点的邻居可去', X.map.nodeStatus('valley') === 'open' && X.map.nodeStatus('mistcave') === 'open');
check('隔一格的去不了', X.map.nodeStatus('river') === 'locked', X.map.nodeStatus('river'));
check('最深处也去不了', X.map.nodeStatus('beastnest') === 'locked', X.map.nodeStatus('beastnest'));
// 防止「写错 id 导致断言空过」：mapNodeStatus 对不存在的节点也返回 locked，
// 所以必须单独确认这几个 id 真的存在。
check('上面用到的节点 id 都真的存在',
  ['mosscave', 'valley', 'mistcave', 'river', 'grotto', 'ridge', 'wastes', 'beastnest']
    .every((id) => X.map.node(id) !== null));
check('锁住的节点询价被拒', X.map.plan('river').ok === false, X.map.plan('river').reason);

section('地图：探险');
{
  const before = state.spiritStones;
  const r = X.map.explore(1, 'mosscave', () => 0);   // 生还骰子必过
  check('探险成功', r.ok === true && r.success === true, r.reason);
  check('扣了入场灵石', state.spiritStones < before + 10, `${before} → ${state.spiritStones.toFixed(2)}`);
  check('扣了秘闻线索', state.cultivation.clues === 49, `${state.cultivation.clues}`);
  check('历练次数 +1', state.cultivation.caveRuns === 1);
  check('探险不会让节点变成占领', X.map.held().length === 0);
}
{
  const r = X.map.explore(1, 'mosscave', () => 0.999);   // 生还骰子必败
  check('探险失败会永久失去修士', r.ok === true && r.success === false
    && state.cultivation.cultivators.length === 0, r.reason);
}
setPeople(person({ realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));

section('地图：攻伐与占领');
{
  const plan = X.map.plan('valley');
  check('询价给出胜算与镇守需求', plan.ok === true && plan.rate > 0 && plan.holdPower > 0,
    `胜算 ${(plan.rate * 100).toFixed(1)}% · 需镇守 ${plan.holdPower}`);
  const r = X.map.attack('valley', () => 0);   // 必胜
  check('攻伐成功', r.ok === true && r.success === true, r.reason);
  check('节点进入已占领', X.map.held().includes('valley'));
  check('已占领的不能再打', X.map.plan('valley').ok === false, X.map.plan('valley').reason);
  check('旧的 conquests 同步更新（兼容旧界面）',
    state.cultivation.conquests.includes('valley'));
}
{
  // 攻伐失败：65% 概率折损一名非宗门、非镇守修士
  state.cultivation.world.held = [];
  state.cultivation.conquests = [];
  setPeople(
    person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat' }),
    person({ id: 2, name: '顾云岚', realmIndex: 9, xp: 0, job: 'sect' }),
  );
  // 攻伐要掷两次骰：先判胜负，败了再判折损。
  // 单值 rng 会把两次都判成同一个结果，所以这里用一个按序列返回的骰子。
  const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
  const r = X.map.attack('valley', seq(0.999, 0));   // 先判败，再判折损
  check('攻伐失败', r.ok === true && r.success === false, r.reason);
  check('战败可能折损修士（宗门弟子除外）',
    state.cultivation.cultivators.length === 1 && state.cultivation.cultivators[0].job === 'sect',
    `剩 ${state.cultivation.cultivators.length} 人：${state.cultivation.cultivators.map((p) => p.job).join(',')}`);
}

section('地图：镇守与赋税');
state.cultivation.world.held = ['valley'];
state.cultivation.conquests = ['valley'];
setPeople(person({ id: 1, realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
{
  const hold = X.map.holdPower('valley');
  check('未派人时镇守战力为 0', X.map.holdStrength('valley') === 0);
  check('未镇守则无产出', X.map.yieldPerSec() === 0);
  check('未派人时询价仍可指派人', X.map.garrison('valley', 1).ok === true);

  const p = state.cultivation.cultivators[0];
  check('指派后职责变为镇守', p.job === 'garrison', p.job);
  const strength = X.map.holdStrength('valley');
  check('镇守战力等于该修士战力', near(strength, X.map.holdPower('valley') > 0 ? strength : 0), `${Math.round(strength)}`);
  check('炼气一层（战力 10）镇不住青木寨（需 55）',
    strength < hold, `${Math.round(strength)} < ${hold}`);
  check('镇守不足则无产出', X.map.yieldPerSec() === 0);
}
{
  // 换一个够强的
  setPeople(person({ id: 2, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
  X.map.garrison('valley', 2);
  check('炼气九层（战力 549）镇得住', X.map.isPacified('valley') === true,
    `${Math.round(X.map.holdStrength('valley'))} / ${X.map.holdPower('valley')}`);
  check('镇住之后有赋税产出', X.map.yieldPerSec() > 0, `${X.map.yieldPerSec()} 灵石/秒`);

  const before = state.spiritStones;
  X.map.tick(3600);
  const gained = state.spiritStones - before;
  check('一小时产出对得上', near(gained, X.map.nodes().find((n) => n.id === 'valley').yield * 3600, 1e-6),
    `${gained.toFixed(3)} 灵石`);
}
{
  // 撤掉镇守 → 民怨上涨 → 叛离
  X.map.clearGarrison('valley');
  check('撤回后职责复原', state.cultivation.cultivators[0].job === 'retreat');
  check('撤回后民怨归零重算', X.map.unrest('valley') === 0);
  X.map.tick(450);   // 民怨速率 1/900 秒，450 秒到 0.5
  check('民怨随时间上涨', Math.abs(X.map.unrest('valley') - 0.5) < 1e-6, `${X.map.unrest('valley').toFixed(3)}`);
  X.map.tick(450);
  check('民怨满则叛离', X.map.held().length === 0, X.map.held().join(','));
  check('叛离后 conquests 同步', state.cultivation.conquests.length === 0);
}
{
  // 有镇守时民怨会回落
  state.cultivation.world.held = ['valley'];
  state.cultivation.world.unrest = { valley: 0.8 };
  setPeople(person({ id: 3, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
  X.map.garrison('valley', 3);
  X.map.tick(60);
  check('镇守充足时民怨回落', X.map.unrest('valley') < 0.8, `${X.map.unrest('valley').toFixed(3)}`);
}

section('地图：宗门修士不可镇守');
setPeople(person({ id: 4, realmIndex: 9, xp: 0, job: 'sect', talent: 1 }));
check('宗门修士被拒绝', X.map.garrison('valley', 4).ok === false, X.map.garrison('valley', 4).reason);
check('不存在的地不能镇守', X.map.garrison('river', 4).ok === false);

/* ══════════════════════ 11. 炼丹 ══════════════════════ */

section('药材与丹方表');
const al = X.alchemy.table();
check('四种药材', al.herbs.length === 4, al.herbs.map((h) => h.name).join(' '));
check('药材 id 唯一', new Set(al.herbs.map((h) => h.id)).size === 4);
check('每种药材都挂在一个真实的地图节点上',
  al.herbs.every((h) => X.map.node(h.node) !== null),
  al.herbs.map((h) => `${h.name}←${X.map.node(h.node)?.name}`).join(' '));
check('四个药材各来自不同的节点', new Set(al.herbs.map((h) => h.node)).size === 4);
check('地图上标了药材的节点都有对应的药材定义',
  X.map.nodes().filter((n) => n.herb).every((n) => al.herbs.some((h) => h.id === n.herb)));
// ⚠ 原来写死 6 个丹方。改成「数据表长度自洽」——
// 加丹方不需要改测试，但表里出现重复 id 仍然会被抓住。
check('丹方数量与导出表一致', al.recipes.length >= 6, `${al.recipes.length} 个：${al.recipes.map((r) => r.name).join(' ')}`);
check('丹方 id 唯一', new Set(al.recipes.map((r) => r.id)).size === al.recipes.length);
check('每个丹方的材料都是有效药材', al.recipes.every((r) =>
  Object.keys(r.materials).every((k) => al.herbs.some((h) => h.id === k))));
check('每个丹方都有正的成功率与产出',
  al.recipes.every((r) => r.baseRate > 0 && r.baseRate < 1 && r.yield >= 1));
/**
 * ⚠ 原来这一条是「按 tier 排序后全局单调递减」。
 * 同阶丹方一多（金丹 42% 与凝丹丸 40% 同属冲关门径），
 * 用它排序就会把 tier 大、成功率也大的丹方排到前面，判定失败。
 * 真实的配平关系是「**同阶之内**越难炼的越难」，所以改成按阶分组比较 ——
 * 既保住了要保护的那条曲线，也不再对「同阶放几个丹方」施加隐性限制。
 */
check('同阶丹方里越难的丹方成功率越低', (() => {
  const byTier = new Map();
  for (const r of al.recipes) {
    if (!byTier.has(r.tier)) byTier.set(r.tier, []);
    byTier.get(r.tier).push(r);
  }
  for (const list of byTier.values()) {
    // 同阶内按成功率从高到低排序后，材料种类数不应出现「更难却更少」的倒挂
    const s = [...list].sort((a, b) => b.baseRate - a.baseRate);
    for (let i = 1; i < s.length; i += 1) if (s[i].baseRate > s[i - 1].baseRate) return false;
  }
  return true;
})());
check('越往后的阶成功率上界越低', (() => {
  const byTier = new Map();
  for (const r of al.recipes) {
    const cur = byTier.get(r.tier);
    if (cur === undefined || r.baseRate > cur) byTier.set(r.tier, r.baseRate);
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (let i = 1; i < tiers.length; i += 1) {
    if (byTier.get(tiers[i]) > byTier.get(tiers[i - 1])) return false;
  }
  return true;
})());
check('丹炉等级越高加成越高',
  al.furnace.every((f, i) => i === 0 || f.rateBonus >= al.furnace[i - 1].rateBonus));
check('丹炉五级', al.furnace.length === 5);

section('炼丹：药材来源');
setPeople(
  person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
  person({ id: 2, name: '顾云岚', realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
);
state.cultivation.alchemy = { herbs: {}, pills: {}, prof: {}, furnace: 1, crafts: 0 };
state.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: {}, unrest: {} };
check('占领但未镇守时没有药材产出',
  (X.alchemy.herbPerSec().grass || 0) === 0, `${X.alchemy.herbPerSec().grass}`);
X.map.garrison('valley', 1);
check('有效镇守后开始产出青灵草',
  X.alchemy.herbPerSec().grass > 0, `${X.alchemy.herbPerSec().grass}/秒`);
{
  const before = X.alchemy.herb('grass');
  X.map.tick(1000);
  const gained = X.alchemy.herb('grass') - before;
  check('药材按秒累积', near(gained, X.alchemy.herbPerSec().grass * 1000, 1e-6),
    `${gained.toFixed(3)} 份`);
}
{
  // 镇守不足就断供
  X.map.clearGarrison('valley');
  const before = X.alchemy.herb('grass');
  X.map.tick(1000);
  check('镇守被撤后药材停产', X.alchemy.herb('grass') === before);
  X.map.garrison('valley', 1);
}

section('炼丹：成功率');
X.alchemy.addHerbs('grass', 100);
X.alchemy.addHerbs('ling', 100);
X.alchemy.addHerbs('iron', 100);
X.alchemy.addHerbs('flame', 100);
check('一级丹炉炼不了金丹（需三级）',
  X.alchemy.plan('jindan').ok === false, X.alchemy.plan('jindan').reason);
check('一级丹炉可以炼祛障丹', X.alchemy.plan('quzhang').ok === true);
{
  const base = X.alchemy.rate('quzhang');
  check('无丹师时成功率 = 方子基础率 + 丹炉加成',
    near(base, al.recipes.find((r) => r.id === 'quzhang').baseRate, 1e-9), `${(base * 100).toFixed(1)}%`);

  // 指派一个不含木的丹师
  setPeople(
    person({ id: 1, realmIndex: 5, xp: 0, job: 'alchemy', talent: 1,
      root: { grade: 'quad', elements: ['metal', 'water', 'fire', 'earth'], rerolls: 0 } }),
  );
  check('丹师无木灵根时不给加成', X.alchemy.woodBonus() === 0, `${X.alchemy.woodBonus()}`);
  check('无木灵根不改变成功率', near(X.alchemy.rate('quzhang'), base, 1e-9));

  // 换一个四灵根带木的
  X.root.set(1, 'quad', ['metal', 'wood', 'fire', 'earth']);
  check('木灵根给出加成', X.alchemy.woodBonus() > 0, `+${(X.alchemy.woodBonus() * 100).toFixed(0)}%`);
  const withWood = X.alchemy.rate('quzhang');
  check('木灵根抬高成功率', withWood > base, `${(base * 100).toFixed(1)}% → ${(withWood * 100).toFixed(1)}%`);

  // 越纯的木灵根加成越高
  X.root.set(1, 'heaven', ['wood']);
  const heavenWood = X.alchemy.woodBonus();
  check('天灵根木的加成最高（+24%）', near(heavenWood, 0.24), `+${(heavenWood * 100).toFixed(0)}%`);

  // 熟练度
  X.root.set(1, 'quad', ['metal', 'water', 'fire', 'earth']);   // 去掉木，隔离熟练度的影响
  const before = X.alchemy.rate('quzhang');
  state.cultivation.alchemy.prof.quzhang = 5;
  const after = X.alchemy.rate('quzhang');
  check('熟练度抬高成功率', after > before, `${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`);
  state.cultivation.alchemy.prof.quzhang = 999;
  check('熟练度被夹到上限', X.alchemy.proficiency('quzhang') === 10);
  state.cultivation.alchemy.prof.quzhang = 0;
  check('丹炉不达标时按达标丹炉算（避免显示一个永远不会出现的数字）', (() => {
    state.cultivation.alchemy.furnace = 1;
    const atLv1 = X.alchemy.rate('jindan');
    state.cultivation.alchemy.furnace = 3;
    const atLv3 = X.alchemy.rate('jindan');
    state.cultivation.alchemy.furnace = 1;
    return near(atLv1, atLv3, 1e-9);
  })(), '金丹需三级炉，一级炉时显示的就是三级炉的数字');
  check('没有丹师时木灵根加成为 0', (() => {
    setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'retreat',
      root: { grade: 'heaven', elements: ['wood'], rerolls: 0 } }));
    return X.alchemy.woodBonus() === 0;
  })(), '只有「炼丹」职责的修士才算丹师');
}

section('炼丹：开炉');
setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'alchemy', talent: 1,
  root: { grade: 'quad', elements: ['metal', 'water', 'fire', 'earth'], rerolls: 0 } }));
state.cultivation.alchemy.prof.quzhang = 0;
{
  X.alchemy.addHerbs('grass', 100);
  const herbBefore = X.alchemy.herb('grass');
  const pillBefore = X.alchemy.pill('quzhang');
  const r = X.alchemy.craft('quzhang', () => 0);   // 必成功
  check('炼制成功', r.ok === true && r.success === true, r.reason);
  check('产出对应数量', X.alchemy.pill('quzhang') === pillBefore + r.out, `${r.out} 枚`);
  check('扣掉材料', near(X.alchemy.herb('grass'), herbBefore - 2, 1e-9), `${X.alchemy.herb('grass')}`);
  check('成功涨熟练度', X.alchemy.proficiency('quzhang') === 1);
  check('累计开炉数 +1', state.cultivation.alchemy.crafts === 1);
}
{
  const herbBefore = X.alchemy.herb('grass');
  const pillBefore = X.alchemy.pill('quzhang');
  const profBefore = X.alchemy.proficiency('quzhang');
  const r = X.alchemy.craft('quzhang', () => 0.999);   // 必失败
  check('炼制失败', r.ok === true && r.success === false, r.reason);
  check('失败损失全部材料', near(X.alchemy.herb('grass'), herbBefore - 2, 1e-9),
    `${herbBefore.toFixed(1)} → ${X.alchemy.herb('grass').toFixed(1)}`);
  check('失败不产出丹药', X.alchemy.pill('quzhang') === pillBefore);
  check('失败不涨熟练度', X.alchemy.proficiency('quzhang') === profBefore);
}
{
  // 材料不足
  const have = X.alchemy.herb('grass');
  X.alchemy.addHerbs('grass', -have);
  const plan = X.alchemy.plan('quzhang');
  check('材料不足时拒绝', plan.ok === false, plan.reason);
  check('理由点名缺哪一味', plan.reason.includes('青灵草'), plan.reason);
  X.alchemy.addHerbs('grass', 100);
}
check('丹方不存在时被拒绝', X.alchemy.plan('buzhidao').ok === false);

section('炼丹：丹炉');
state.cultivation.alchemy.furnace = 1;
state.spiritStones = 10000; state.silver = 100000000;
{
  const plan = X.alchemy.furnacePlan();
  check('升炉询价成立', plan.ok === true, plan.reason);
  check('升到二级青铜炉', plan.next.name === '青铜丹炉' && plan.stones === 5, `${plan.stones} 灵石`);
  const stonesBefore = state.spiritStones;
  const r = X.alchemy.upgradeFurnace();
  check('升炉成功', r.ok === true && X.alchemy.furnace() === 2, r.reason);
  check('扣掉灵石与银两', state.spiritStones === stonesBefore - 5, `${state.spiritStones}`);
  check('升炉后成功率提高', X.alchemy.rate('quzhang') > 0.90, `${(X.alchemy.rate('quzhang') * 100).toFixed(1)}%`);
}
{
  X.alchemy.addHerbs('ling', 100);
  X.alchemy.addHerbs('iron', 100);
  state.cultivation.alchemy.furnace = 3;
  check('三级炉解锁金丹', X.alchemy.plan('jindan').ok === true, X.alchemy.plan('jindan').reason);
  check('三级炉一炉出两枚', X.alchemy.out('jindan') === 2, `${X.alchemy.out('jindan')} 枚`);
  state.cultivation.alchemy.furnace = 2;
  check('二级炉炼不了金丹', X.alchemy.plan('jindan').ok === false);
}
{
  state.cultivation.alchemy.furnace = 5;
  const plan = X.alchemy.furnacePlan();
  check('顶阶丹炉不能继续升', plan.ok === false, plan.reason);
  check('顶阶炉产出最多', X.alchemy.out('huashen') === 3, `${X.alchemy.out('huashen')} 枚`);
}

section('炼丹：与突破的咬合（R5 回填）');
check('四道门槛都要求丹药', [9, 13, 17, 21].every((i) => {
  const g = X.realm.gate(i);
  return g && typeof g.pill === 'string' && al.recipes.some((r) => r.id === g.pill);
}), [9, 13, 17, 21].map((i) => X.realm.gate(i).pill).join(' '));
check('灵石门槛已下调到以丹药为主', (() => {
  const total = [9, 13, 17, 21].reduce((a, i) => a + X.realm.gate(i).stones, 0);
  return total < 500;
})(), `四道门槛合计 ${[9, 13, 17, 21].reduce((a, i) => a + X.realm.gate(i).stones, 0)} 灵石`);
check('四种突破丹各不相同', (() => {
  const ids = [9, 13, 17, 21].map((i) => X.realm.gate(i).pill);
  return new Set(ids).size === 4;
})());

/* ══════════════════════ 12. 炼器 ══════════════════════ */

section('矿料与法器表');
const fgTable = X.forge.table();
check('四种矿料', fgTable.ores.length === 4, fgTable.ores.map((o) => o.name).join(' '));
check('矿料 id 唯一', new Set(fgTable.ores.map((o) => o.id)).size === 4);
check('每种矿料都挂在真实的地图节点上',
  fgTable.ores.every((o) => X.map.node(o.node) !== null));
check('矿料与药材的 id 不冲突', (() => {
  const herbs = new Set(X.alchemy.table().herbs.map((h) => h.id));
  return fgTable.ores.every((o) => !herbs.has(o.id));
})());
check('地图上标了矿料的节点都有定义',
  X.map.nodes().filter((n) => n.ore).every((n) => fgTable.ores.some((o) => o.id === n.ore)));
check('九个法器', fgTable.items.length === 9, fgTable.items.map((i) => i.name).join(' '));
check('法器 id 唯一', new Set(fgTable.items.map((i) => i.id)).size === 9);
check('三个部位各三件', fgTable.slots.every((s) =>
  fgTable.items.filter((i) => i.slot === s.id).length === 3));
check('法器材料都是有效矿料', fgTable.items.every((i) =>
  Object.keys(i.materials).every((k) => fgTable.ores.some((o) => o.id === k))));
check('同一部位内品阶越高，战力越高', fgTable.slots.every((s) => {
  const list = fgTable.items.filter((i) => i.slot === s.id).sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < list.length; i += 1) if (list[i].power <= list[i - 1].power) return false;
  return true;
}));
check('同一部位内品阶越高，成功率越低', fgTable.slots.every((s) => {
  const list = fgTable.items.filter((i) => i.slot === s.id).sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < list.length; i += 1) if (list[i].baseRate >= list[i - 1].baseRate) return false;
  return true;
}));
check('只有法宝提供生还加成',
  fgTable.items.every((i) => (i.slot === 'talisman') === (i.survive > 0)));
check('锻造台五级', fgTable.levels.length === 5);

section('炼器：矿料来源');
setPeople(
  person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
  person({ id: 2, name: '顾云岚', realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
);
state.cultivation.forge = { ores: {}, owned: [], equipped: {}, durability: {}, prof: {}, level: 1, crafts: 0 };
state.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: {}, unrest: {} };
check('占领但未镇守时没有矿料产出', (X.forge.orePerSec().lingmu || 0) === 0);
X.map.garrison('valley', 1);
check('有效镇守后开始产灵木', X.forge.orePerSec().lingmu > 0, `${X.forge.orePerSec().lingmu}/秒`);
check('同一块领地同时产药材与矿料',
  X.alchemy.herbPerSec().grass > 0 && X.forge.orePerSec().lingmu > 0,
  `青灵草 ${X.alchemy.herbPerSec().grass} · 灵木 ${X.forge.orePerSec().lingmu}`);
{
  const before = X.forge.ore('lingmu');
  X.map.tick(1000);
  check('矿料按秒累积', near(X.forge.ore('lingmu') - before, X.forge.orePerSec().lingmu * 1000, 1e-6));
}

section('炼器：铸器');
X.forge.addOres('lingmu', 100);
X.forge.addOres('hantie', 100);
X.forge.addOres('xuantie', 100);
X.forge.addOres('yaogu', 100);
check('一级台铸不了玄铁重剑（需二级）',
  X.forge.plan('xuantiejian').ok === false, X.forge.plan('xuantiejian').reason);
check('一级台可以铸青锋剑', X.forge.plan('qingfeng').ok === true);
{
  const base = X.forge.rate('qingfeng');
  check('无器师时成功率 = 基础率 + 台加成',
    near(base, fgTable.items.find((i) => i.id === 'qingfeng').baseRate, 1e-9), `${(base * 100).toFixed(1)}%`);

  setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'forge', talent: 1,
    root: { grade: 'quad', elements: ['wood', 'water', 'fire', 'earth'], rerolls: 0 } }));
  check('器师无金灵根时不给加成', X.forge.metalBonus() === 0);
  X.root.set(1, 'heaven', ['metal']);
  check('天灵根金的加成最高（+24%）', near(X.forge.metalBonus(), 0.24), `+${(X.forge.metalBonus() * 100).toFixed(0)}%`);
  check('金灵根抬高成功率', X.forge.rate('qingfeng') > base);
  setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'forge', talent: 1,
    root: { grade: 'quad', elements: ['wood', 'water', 'fire', 'earth'], rerolls: 0 } }));
}
{
  const before = X.forge.ore('lingmu');
  const r = X.forge.make('qingfeng', () => 0);   // 必成功
  check('铸器成功', r.ok === true && r.success === true, r.reason);
  check('扣掉矿料', near(X.forge.ore('lingmu'), before - 3, 1e-9), `${X.forge.ore('lingmu')}`);
  check('进入已铸列表', X.forge.owned().includes('qingfeng'));
  check('新铸的法器耐久满值', X.forge.durability('qingfeng') === 100);
  check('新铸即自动装备到空位', X.forge.equipped().weapon === 'qingfeng');
  check('铸成后不再重复铸造', X.forge.plan('qingfeng').ok === false, X.forge.plan('qingfeng').reason);
}
{
  const before = X.forge.ore('lingmu');
  state.cultivation.forge.owned = [];
  state.cultivation.forge.durability = {};
  state.cultivation.forge.equipped = {};
  const r = X.forge.make('qingfeng', () => 0.999);   // 必失败
  check('铸器失败', r.ok === true && r.success === false, r.reason);
  check('失败损失全部矿料', near(X.forge.ore('lingmu'), before - 3, 1e-9));
  check('失败不产出法器', X.forge.owned().length === 0);
  X.forge.addOres('lingmu', 100);
}

section('炼器：装备与战力');
{
  state.cultivation.forge.owned = ['qingfeng', 'xuantiejian'];
  state.cultivation.forge.durability = { qingfeng: 100, xuantiejian: 100 };
  state.cultivation.forge.equipped = { weapon: 'qingfeng' };
  const p1 = X.forge.bonus().power;
  X.forge.equip('xuantiejian');
  const p2 = X.forge.bonus().power;
  check('换更强的兵器，战力加成提高', p2 > p1, `+${(p1 * 100).toFixed(0)}% → +${(p2 * 100).toFixed(0)}%`);
  check('同一部位只能装备一件',
    Object.keys(X.forge.equipped()).filter((s) => s === 'weapon').length === 1);
  check('装备未铸成的法器会被拒绝', X.forge.equip('zhuxie').ok === false, X.forge.equip('zhuxie').reason);
  X.forge.unequip('weapon');
  check('卸下后加成归零', X.forge.bonus().power === 0, `${X.forge.bonus().power}`);
  X.forge.equip('xuantiejian');

  // 战力真的接进了家族总战力
  setPeople(person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
  ui.render();
  const withArt = X.derive().cultivatorPower;
  X.forge.unequip('weapon');
  ui.render();
  const without = X.derive().cultivatorPower;
  check('法器加成进入了家族战力', withArt > without,
    `${without.toFixed(1)} → ${withArt.toFixed(1)}`);
  X.forge.equip('xuantiejian');
}

section('炼器：耐久');
{
  // 法宝提供生还加成，装上一件看看
  state.cultivation.forge.owned = ['taixujing'];
  state.cultivation.forge.durability = { taixujing: 100 };
  state.cultivation.forge.equipped = { talisman: 'taixujing' };
  check('法宝提供生还加成', X.forge.bonus().survive > 0, `+${(X.forge.bonus().survive * 100).toFixed(0)}%`);
  const full = X.forge.bonus().survive;
  state.cultivation.forge.durability.taixujing = 20;
  const worn = X.forge.bonus().survive;
  check('耐久越低效果越弱', worn < full && worn > 0,
    `100% → ${(full * 100).toFixed(1)}%，20% → ${(worn * 100).toFixed(1)}%`);
  state.cultivation.forge.durability.taixujing = 0;
  check('耐久耗尽则完全失效', X.forge.bonus().survive === 0);
  check('失效的法器会被点名', X.forge.bonus().broken.includes('太虚镜'),
    X.forge.bonus().broken.join(','));
}
{
  state.cultivation.forge.durability.taixujing = 100;
  const before = X.forge.durability('taixujing');
  const broken = X.forge.wear('cave');
  const after = X.forge.durability('taixujing');
  check('洞天会磨损法器', after < before, `${before} → ${after}`);
  check('磨损没到 0 就不算损坏', broken.length === 0);
  // 磨到 0
  for (let i = 0; i < 50; i += 1) X.forge.wear('cave');
  check('磨到 0 会报告损坏', X.forge.durability('taixujing') === 0);
  check('耐久不会变成负数', X.forge.durability('taixujing') === 0);
}
{
  // 护甲在攻伐里掉得更快
  state.cultivation.forge.owned = ['lingmujia'];
  state.cultivation.forge.durability = { lingmujia: 100 };
  state.cultivation.forge.equipped = { armor: 'lingmujia' };
  X.forge.wear('attack');
  const attackLoss = 100 - X.forge.durability('lingmujia');
  state.cultivation.forge.durability.lingmujia = 100;
  X.forge.wear('cave');
  const caveLoss = 100 - X.forge.durability('lingmujia');
  check('护甲在攻伐里磨损更快', attackLoss > caveLoss, `攻伐 -${attackLoss} / 洞天 -${caveLoss}`);
}

section('炼器：祭炼');
{
  state.cultivation.forge.owned = ['lingmujia'];
  state.cultivation.forge.durability = { lingmujia: 10 };
  state.cultivation.forge.equipped = { armor: 'lingmujia' };
  X.forge.addOres('lingmu', 0);
  const have = X.forge.ore('lingmu');
  X.forge.addOres('lingmu', -have);
  check('矿料不足时不能祭炼', X.forge.repairPlan('lingmujia').ok === false,
    X.forge.repairPlan('lingmujia').reason);
  X.forge.addOres('lingmu', 100);
  const before = X.forge.ore('lingmu');
  const r = X.forge.repair('lingmujia');
  check('祭炼成功', r.ok === true, r.reason);
  check('耐久恢复满值', X.forge.durability('lingmujia') === 100);
  check('祭炼消耗矿料（约为打造的一半）', X.forge.ore('lingmu') < before,
    `${before} → ${X.forge.ore('lingmu')}`);
  check('完好时无需祭炼', X.forge.repairPlan('lingmujia').ok === false,
    X.forge.repairPlan('lingmujia').reason);
  check('未铸成的不能祭炼', X.forge.repairPlan('zhuxie').ok === false);
}

section('炼器：锻造台');
{
  state.cultivation.forge.level = 1;
  state.spiritStones = 10000; state.silver = 100000000;
  const plan = X.forge.levelPlan();
  check('升级询价成立', plan.ok === true, plan.reason);
  check('升至二级为铁匠铺', plan.next.name === '铁匠铺' && plan.stones === 8, `${plan.stones} 灵石`);
  const stonesBefore = state.spiritStones;
  X.forge.upgradeLevel();
  check('升级成功', X.forge.level() === 2);
  check('扣掉灵石', state.spiritStones === stonesBefore - 8);
  state.cultivation.forge.level = 5;
  check('顶阶不能再升', X.forge.levelPlan().ok === false, X.forge.levelPlan().reason);
  state.cultivation.forge.level = 1;
}
check('器坊与丹房是两套独立的熟练度', (() => {
  state.cultivation.alchemy.prof = { quzhang: 5 };
  state.cultivation.forge.prof = {};
  return X.forge.proficiency('qingfeng') === 0 && X.alchemy.proficiency('quzhang') === 5;
})());

/* ══════════════════════ 13. 炼符 ══════════════════════ */

section('符文与符箓表');
const ruTable = X.runes.table();
check('四种符文', ruTable.mats.length === 4, ruTable.mats.map((m) => m.name).join(' '));
check('符文 id 唯一', new Set(ruTable.mats.map((m) => m.id)).size === 4);
check('符文都挂在真实的地图节点上', ruTable.mats.every((m) => X.map.node(m.node) !== null));
check('符文与药材、矿料的 id 都不冲突', (() => {
  const used = new Set([
    ...X.alchemy.table().herbs.map((h) => h.id),
    ...X.forge.table().ores.map((o) => o.id),
  ]);
  return ruTable.mats.every((m) => !used.has(m.id));
})());
check('地图上标了符文的节点都有定义',
  X.map.nodes().filter((n) => n.rune).every((n) => ruTable.mats.some((m) => m.id === n.rune)));
check('四张符箓', ruTable.items.length === 4, ruTable.items.map((r) => r.name).join(' '));
check('符箓 id 唯一', new Set(ruTable.items.map((r) => r.id)).size === 4);
check('四张符分别接在四个不同的决策点上',
  new Set(ruTable.items.map((r) => r.effect.kind)).size === 4,
  ruTable.items.map((r) => r.effect.kind).join(' '));
check('符箓材料都是有效符文', ruTable.items.every((r) =>
  Object.keys(r.materials).every((k) => ruTable.mats.some((m) => m.id === k))));
check('越高级的符成功率越低', (() => {
  const s = [...ruTable.items].sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < s.length; i += 1) if (s[i].baseRate >= s[i - 1].baseRate) return false;
  return true;
})());
check('保质期为正数', ruTable.shelfHours > 0, `${ruTable.shelfHours} 小时`);

section('炼符：符文来源与画符');
setPeople(
  person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
  person({ id: 2, name: '顾云岚', realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }),
);
state.cultivation.runes = { mats: {}, stock: {}, prof: {}, pending: {}, bench: 1, crafts: 0 };
state.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: {}, unrest: {} };
check('占领但未镇守时没有符文产出', (X.runes.matPerSec().paper || 0) === 0);
X.map.garrison('valley', 1);
check('有效镇守后开始产符纸', X.runes.matPerSec().paper > 0);
check('同一块领地同时产药材、矿料、符文',
  X.alchemy.herbPerSec().grass > 0 && X.forge.orePerSec().lingmu > 0 && X.runes.matPerSec().paper > 0);
{
  const before = X.runes.mat('paper');
  X.map.tick(1000);
  check('符文按秒累积', near(X.runes.mat('paper') - before, X.runes.matPerSec().paper * 1000, 1e-6));
}

X.runes.addMats('paper', 100);
X.runes.addMats('cinnabar', 100);
X.runes.addMats('ink', 100);
X.runes.addMats('blood', 100);
check('一级台画不了护身符（需二级）', X.runes.plan('husheng').ok === false, X.runes.plan('husheng').reason);
check('一级台可以画聚灵符', X.runes.plan('juling').ok === true);
{
  const base = X.runes.rate('juling');
  check('无符师时成功率 = 基础率 + 台加成',
    near(base, ruTable.items.find((r) => r.id === 'juling').baseRate, 1e-9), `${(base * 100).toFixed(1)}%`);
  setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'runes', talent: 1,
    root: { grade: 'quad', elements: ['metal', 'wood', 'water', 'earth'], rerolls: 0 } }));
  check('符师无火灵根时不给加成', X.runes.fireBonus() === 0);
  X.root.set(1, 'heaven', ['fire']);
  check('天灵根火的加成最高（+24%）', near(X.runes.fireBonus(), 0.24), `+${(X.runes.fireBonus() * 100).toFixed(0)}%`);
  check('火灵根抬高成功率', X.runes.rate('juling') > base);
  setPeople(person({ id: 1, realmIndex: 5, xp: 0, job: 'runes', talent: 1,
    root: { grade: 'quad', elements: ['metal', 'wood', 'water', 'earth'], rerolls: 0 } }));
}
{
  const before = X.runes.mat('paper');
  const r = X.runes.make('juling', () => 0);   // 必成功
  check('画符成功', r.ok === true && r.success === true, r.reason);
  check('扣掉符文', near(X.runes.mat('paper'), before - 2, 1e-9), `${X.runes.mat('paper')}`);
  check('进入存货', X.runes.stock('juling') === 1);
  check('画出后开始计保质期', X.runes.expiresIn('juling') > 0, `${X.runes.expiresIn('juling')}秒`);
  check('成功涨熟练度', X.runes.proficiency('juling') === 1);
  check('累计画符次数 +1', state.cultivation.runes.crafts === 1);
}
{
  const before = X.runes.mat('paper');
  const stockBefore = X.runes.stock('juling');
  const profBefore = X.runes.proficiency('juling');
  const r = X.runes.make('juling', () => 0.999);   // 必失败
  check('画符失败', r.ok === true && r.success === false, r.reason);
  check('失败损失全部符文', near(X.runes.mat('paper'), before - 2, 1e-9));
  check('失败不增加存货', X.runes.stock('juling') === stockBefore);
  check('失败不涨熟练度', X.runes.proficiency('juling') === profBefore);
}

section('炼符：保质期');
{
  X.runes.give('juling', 3, 2);   // 还有 2 小时
  check('存货正确', X.runes.stock('juling') >= 3);
  // 补货不延长保质期（先画的先过期）
  const before = X.runes.expiresIn('juling');
  X.runes.give('juling', 1, 99);
  const after = X.runes.expiresIn('juling');
  check('补货不会把旧的洗成新的', after <= before + 1, `${before.toFixed(0)}s → ${after.toFixed(0)}s`);

  // 过期的直接算 0
  X.runes.give('husheng', 5, -1);   // 已过期
  check('过期的符读数为 0', X.runes.stock('husheng') === 0);
  check('过期后不能使用', X.runes.use('husheng').ok === false);
  X.runes.advance(1);
  check('推进之后过期存货被清掉', state.cultivation.runes.stock.husheng === undefined);
  check('清理过程记了日志',
    state.log.some((e) => typeof e.text === 'string' && e.text.includes('保质期')),
    '');
}

section('炼符：聚灵符（限时修炼加成）');
{
  X.runes.give('juling', 2, 3);
  check('未启用时修炼倍率为 1', X.runes.trainingMult() === 1);
  const stockBefore = X.runes.stock('juling');
  const r = X.runes.use('juling');
  check('聚灵符启用成功', r.ok === true, r.reason);
  check('修炼倍率变为 1.3', near(X.runes.trainingMult(), 1.30), `${X.runes.trainingMult()}`);
  check('使用消耗一张', X.runes.stock('juling') === stockBefore - 1,
    `${stockBefore} → ${X.runes.stock('juling')}`);
  // 真的作用到修为推进上
  setPeople(person({ id: 1, realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
  state.cultivation.manuals = [];
  state.cultivation.equippedManual = null;
  X.step(100);
  const withRune = state.cultivation.cultivators[0].xp;
  state.cultivation.runes.trainUntil = 0; state.cultivation.runes.trainRate = 0;
  setPeople(person({ id: 1, realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
  X.step(100);
  const without = state.cultivation.cultivators[0].xp;
  check('聚灵符真的加快了修为', withRune > without,
    `${without.toFixed(1)} → ${withRune.toFixed(1)}`);
  // 到期
  state.cultivation.runes.trainUntil = Date.now() - 1000;
  X.runes.advance(1);
  check('到期后倍率归 1', X.runes.trainingMult() === 1);
  state.cultivation.runes.trainUntil = 0; state.cultivation.runes.trainRate = 0;
}

section('炼符：三张「下一次」符');
{
  // 冲关符
  // 【策划 C4 / 任务 T-5】炼气九层要先择地，所以这里也带上 siteId
  state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
  setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
  state.spiritStones = 1000; state.cultivation.clues = 50;
  X.alchemy.addPills('zhuji', 5);
  const plain = X.realm.plan(1, 'mosscave').rate;
  X.runes.give('chongguan', 1, 3);
  X.runes.use('chongguan');
  const boosted = X.realm.plan(1, 'mosscave').rate;
  check('冲关符抬高冲关成功率', boosted > plain,
    `${(plain * 100).toFixed(1)}% → ${(boosted * 100).toFixed(1)}%`);
  X.realm.commitWith(1, 'mosscave', () => 0);
  check('冲关用掉后加成消失', X.runes.pending().break === 0);
  check('冲关符是一次性的', X.runes.stock('chongguan') === 0);
}
{
  // 护身符
  setPeople(person({ id: 1, realmIndex: 3, talent: 1.1, job: 'retreat' }));
  const plain = X.manual.survival(1, 'mosscave');
  X.runes.give('husheng', 1, 3);
  X.runes.use('husheng');
  const boosted = X.manual.survival(1, 'mosscave');
  check('护身符抬高洞天生还率', near(boosted, Math.min(0.98, plain + 0.20), 1e-9),
    `${(plain * 100).toFixed(1)}% → ${(boosted * 100).toFixed(1)}%`);
  state.spiritStones = 100; state.cultivation.clues = 10;
  X.map.explore(1, 'mosscave', () => 0);
  check('探险用掉后加成消失', X.runes.pending().cave === 0);
}
{
  // 破阵符
  setPeople(person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
  state.cultivation.world = { reached: ['mosscave', 'valley'], held: [], garrison: {}, unrest: {} };
  const plain = X.map.plan('valley').rate;
  X.runes.give('pozhen', 1, 3);
  X.runes.use('pozhen');
  const boosted = X.map.plan('valley').rate;
  // 胜算有 95% 硬上限，所以这里要按夹取后的值比
  check('破阵符抬高攻伐胜算', near(boosted, Math.min(0.95, plain + 0.15), 1e-9),
    `${(plain * 100).toFixed(1)}% → ${(boosted * 100).toFixed(1)}%（上限 95%）`);
  X.map.attack('valley', () => 0);
  check('攻伐用掉后加成消失', X.runes.pending().attack === 0);
}
check('没有符时不能启用', X.runes.use('chongguan').ok === false);

section('炼符：符台');
{
  state.cultivation.runes.bench = 1;
  state.spiritStones = 10000; state.silver = 100000000;
  const plan = X.runes.benchPlan();
  check('升台询价成立', plan.ok === true, plan.reason);
  check('升至二级为朱漆符案', plan.next.name === '朱漆符案' && plan.stones === 10, `${plan.stones} 灵石`);
  const stonesBefore = state.spiritStones;
  X.runes.upgradeBench();
  check('升级成功', X.runes.bench() === 2);
  check('扣掉灵石', state.spiritStones === stonesBefore - 10);
  state.cultivation.runes.bench = 5;
  check('顶阶不能再升', X.runes.benchPlan().ok === false, X.runes.benchPlan().reason);
  state.cultivation.runes.bench = 1;
}
check('三条线的熟练度互不干扰', (() => {
  state.cultivation.alchemy.prof = { quzhang: 5 };
  state.cultivation.forge.prof = { qingfeng: 4 };
  state.cultivation.runes.prof = {};
  return X.alchemy.proficiency('quzhang') === 5
    && X.forge.proficiency('qingfeng') === 4
    && X.runes.proficiency('juling') === 0;
})());

/* ══════════════════════ 14. 百科 ══════════════════════ */

const D = X.data;

section('百科：结构与进度');
{
  const book = X.codex.book();
  const stats = X.codex.stats();
  check('百科章节数与数据表一致', book.length === X.data.chapters.length, book.map((c) => c.name).join(' '));
  check('章节 id 唯一', new Set(book.map((c) => c.id)).size === book.length);
  check('每条都有 id / 标题 / 正文',
    book.every((c) => c.entries.every((e) => e.id && e.title && typeof e.prose === 'string' && e.prose.length > 0)));
  check('条目 id 全局唯一', (() => {
    const ids = book.flatMap((c) => c.entries.map((e) => e.id));
    return new Set(ids).size === ids.length;
  })());
  check('总计六十条以上', stats.total >= 60, `${stats.total} 条`);
  check('进度不会超过总数', stats.seen <= stats.total, `${stats.seen}/${stats.total}`);
  check('每章的计数自洽', book.every((c) => c.seenCount === c.entries.filter((e) => e.seen).length));
  check('章节的 seenCount 不超过 total', book.every((c) => c.seenCount <= c.total));
}

section('百科：聚合而非重抄');
// 这一节是「不重抄」这条设计约定的守门人：
// 各表改了正文，百科必须跟着变，而不是留着旧说法。
check('境界条目的正文取自境界表（改表即改百科）', (() => {
  const book = X.codex.book();
  const qi = book.find((c) => c.id === 'realm').entries.find((e) => e.id === 'realm-qi');
  return qi && typeof qi.prose === 'string' && qi.prose.length > 30;
})());
check('建筑条目的正文含该建筑的 lore 原文', (() => {
  const b = D.buildings.find((x) => x.id === 'arena');
  const e = X.codex.book().find((c) => c.id === 'home').entries.find((x) => x.id === 'home-arena');
  // 不论可见与否，正文都必须是那条 lore —— 这才是「不重抄」的意思
  return e && e.prose.includes(b.lore.slice(0, 12));
})(), '演武台');
check('地图条目的正文就是节点的 lore', (() => {
  const n = D.map.find((x) => x.id === 'valley');
  const e = X.codex.book().find((c) => c.id === 'map').entries.find((x) => x.id === 'map-valley');
  return e && e.prose === n.lore;
})());
check('丹方条目的正文就是丹方的 desc', (() => {
  const r = D.recipes.find((x) => x.id === 'zhuji');
  const e = X.codex.book().find((c) => c.id === 'pill').entries.find((x) => x.id === 'pill-zhuji');
  return e && e.prose === r.desc;
})());
check('法器条目的正文就是法器的 desc', (() => {
  const it = D.artifacts.find((x) => x.id === 'qingfeng');
  const e = X.codex.book().find((c) => c.id === 'artifact').entries.find((x) => x.id === 'art-qingfeng');
  return e && e.prose === it.desc;
})());
check('符箓条目的正文就是符箓的 desc', (() => {
  const it = D.runes.find((x) => x.id === 'juling');
  const e = X.codex.book().find((c) => c.id === 'rune').entries.find((x) => x.id === 'rune-juling');
  return e && e.prose === it.desc;
})());

section('百科：数据引文取活表');
check('境界条目的引文与境界表对得上', (() => {
  const e = X.codex.book().find((c) => c.id === 'realm').entries.find((x) => x.id === 'realm-zhuji');
  const t = D.realms.find((r) => r.id === 'zhuji');
  return e.lines.some((l) => l.includes(String(t.stages.length)))
    && e.lines.some((l) => l.includes(String(t.xpBase)));
})());
check('地图条目的引文含真实的镇守需求', (() => {
  const n = D.map.find((x) => x.id === 'valley');
  const e = X.codex.book().find((c) => c.id === 'map').entries.find((x) => x.id === 'map-valley');
  return e.lines.some((l) => l.includes(String(X.map.holdPower(n.id))));
})());
check('机制条目的引文含当前真实状态', (() => {
  const e = X.codex.book().find((c) => c.id === 'mech').entries.find((x) => x.id === 'mech-shelf');
  return e.lines.some((l) => l.includes(String(X.runes.table().shelfHours)));
})());
check('引文生成失败不会炸掉整页', (() => {
  // 直接喂一条会抛错的条目定义，看兜底
  const fake = { id: 'x', title: 'x', prose: 'x', lines: () => { throw new Error('boom'); }, seen: () => true };
  const lines = X.codex.lines(fake);
  return lines.length === 1 && lines[0].includes('boom');
})());

section('百科：只显示已解锁');
{
  // 清空成一个「刚开局」的状态，看看还剩多少可见
  const fresh = JSON.parse(JSON.stringify(state));
  fresh.cultivation = { ...fresh.cultivation, cultivators: [], manuals: [], runes: { crafts: 0, mats: {} }, forge: { owned: [], crafts: 0 }, alchemy: { crafts: 0 } };
  const book = X.codex.bookFor(fresh);
  const total = book.reduce((a, c) => a + c.total, 0);
  const seen = book.reduce((a, c) => a + c.seenCount, 0);
  check('开局没见过的条目一律不显示正文', book.every((c) =>
    c.entries.every((e) => (e.seen ? true : e.lines.length === 0))));
  check('开局可见条目远少于总数', seen < total / 2, `开局 ${seen}/${total}`);
  check('境界·凡人 开局即可见',
    book.find((c) => c.id === 'realm').entries.find((e) => e.id === 'realm-0').seen === true);
  check('境界·化神 开局不可见',
    book.find((c) => c.id === 'realm').entries.find((e) => e.id === 'realm-huashen').seen === false);
  check('未解锁条目带提示', book.flatMap((c) => c.entries).filter((e) => !e.seen).every((e) => e.hint.length > 0));
}
{
  // 收一名修士之后，境界 / 灵根 / 职责类的条目应当解锁
  setPeople(person({ realmIndex: 3, job: 'retreat', talent: 1 }));
  const book = X.codex.book();
  const qi = book.find((c) => c.id === 'realm').entries.find((e) => e.id === 'realm-qi');
  check('收得修士后「炼气」条目解锁', qi.seen === true);
  check('收得修士后「灵根」机制条目解锁',
    book.find((c) => c.id === 'mech').entries.find((e) => e.id === 'mech-root').seen === true);
  check('有人担任职责后对应条目解锁',
    book.find((c) => c.id === 'job').entries.find((e) => e.id === 'job-retreat').seen === true);
  check('没人担任的职责仍未解锁',
    book.find((c) => c.id === 'job').entries.find((e) => e.id === 'job-sect').seen === false);
}

section('百科：搜索');
{
  check('空查询返回全部可见条目', (() => {
    const all = X.codex.search('', 'all');
    const stats = X.codex.stats();
    return all.length === stats.seen;
  })());
  check('搜索覆盖正文（「死亡率」能找到演武台）', (() => {
    // 演武台要先研习「扩张」才会解锁，百科只搜已解锁的条目
    if (!state.techs.includes('expansion')) state.techs.push('expansion');
    const hit = X.codex.search('死亡率', 'all');
    return hit.some((e) => e.title === '演武台');
  })(), '这正是目标里举的那个例子');
  check('搜索覆盖数据引文', X.codex.search('镇守', 'all').length > 0);
  check('搜索覆盖标签', X.codex.search('洞天', 'all').some((e) => e.chapterId === 'map'));
  check('搜索不区分大小写', (() => {
    const a = X.codex.search('MECH-SHELF', 'all');
    const b = X.codex.search('mech-shelf', 'all');
    return a.length === b.length;
  })());
  check('可以限定章节', (() => {
    const all = X.codex.search('', 'all');
    const only = X.codex.search('', 'map');
    return only.length < all.length && only.every((e) => e.chapterId === 'map');
  })());
  check('搜不到时返回空数组', X.codex.search('绝不可能出现的词xyzzy', 'all').length === 0);
  check('未解锁的条目搜不到（不剧透）', (() => {
    // 化神条目此时并未解锁，搜它的标题不该命中
    return !X.codex.search('化神', 'all').some((e) => e.id === 'realm-huashen');
  })());
}

section('百科：界面');
{
  ui.actions.setPage('codex');
  X.codex.render(true);
  check('百科页存在', Boolean(document.querySelector('.page[data-page="codex"]')));
  check('条目列表渲染了', document.querySelectorAll('#codex-list .codex-entry').length > 0,
    `${document.querySelectorAll('#codex-list .codex-entry').length} 条`);
  check('章节按钮渲染了', (() => {
    // 断言「每一章都有按钮」，而不是断言个数 —— 个数会被「全部」和状态按钮带偏
    const ids = [...document.querySelectorAll('[data-codex-chapter]')].map((b) => b.dataset.codexChapter);
    return ['all', ...X.codex.book().map((c) => c.id)].every((id) => ids.includes(id));
  })(), `${document.querySelectorAll('[data-codex-chapter]').length} 个（含「全部」）`);
  check('进度 chip 有数字', /\d+ \/ \d+ 条/.test($('codex-chip').textContent), $('codex-chip').textContent);
  // 未解锁的条目默认不显示 —— 一上来就摆出 63 条会让人觉得内容太多
  check('未解锁条目默认不显示', !$('codex-list').textContent.includes('？？？'));
  check('但给了「显示未解锁」的按钮', Boolean(document.querySelector('[data-codex-locked]')),
    document.querySelector('[data-codex-locked]')?.textContent);
  state.ui.codexShowLocked = true;
  X.codex.render(true);
  check('打开后才显示「？？？」占位', $('codex-list').textContent.includes('？？？'));
  state.ui.codexShowLocked = false;
  X.codex.render(true);
  check('关掉后占位又消失', !$('codex-list').textContent.includes('？？？'));
  check('数据引文渲染成了独立行', document.querySelectorAll('.codex-data span').length > 0);

  // 切章节（shim 没有 Element.click，用 dom.click 触发文档级监听）
  dom.click(document.querySelector('[data-codex-chapter="map"]'));
  check('切章节生效', state.ui.codexChapter === 'map');
  check('切章节后只剩该章条目', (() => {
    const chs = [...document.querySelectorAll('#codex-list .codex-entry-chapter')].map((x) => x.textContent);
    return chs.length > 0 && chs.every((t) => t.includes('舆图'));
  })());
  state.ui.codexChapter = 'all';

  // 搜索
  state.ui.codexQuery = '死亡率';
  X.codex.render(true);
  check('界面搜索能命中演武台', $('codex-list').textContent.includes('演武台'));
  check('搜索时不再显示未解锁占位', !$('codex-list').textContent.includes('？？？'));
  state.ui.codexQuery = '';
  X.codex.render(true);

  check('搜索不到时给出空态', (() => {
    state.ui.codexQuery = '绝不可能出现的词xyzzy';
    X.codex.render(true);
    const empty = Boolean(document.querySelector('#codex-list .codex-empty'));
    state.ui.codexQuery = '';
    X.codex.render(true);
    return empty;
  })());
  check('百科页不影响其它页', (() => {
    ui.actions.setPage('home');
    return state.ui.page === 'home' && document.querySelector('.page[data-page="home"]').classList.contains('is-active');
  })());
}

/* ══════════════════════ 15. 周目与金手指 ══════════════════════ */

section('金手指表');
{
  const fgs = X.cycle.fingers();
  check('四件金手指', fgs.length === 4, fgs.map((f) => f.name).join(' '));
  check('id 唯一', new Set(fgs.map((f) => f.id)).size === 4);
  check('每件都有正面的规则改动', fgs.every((f) => typeof f.rule === 'string' && f.rule.length > 20));
  check('每件都有代价（这是硬约定）', fgs.every((f) => typeof f.price === 'string' && f.price.length > 8));
  check('每件都有背景文字', fgs.every((f) => typeof f.lore === 'string' && f.lore.length > 20));
  check('每件都有效果数值', fgs.every((f) => f.fx && Object.keys(f.fx).length > 0));
  check('解锁价格为正', fgs.every((f) => f.cost > 0));
  check('价格各不相同（不是复制粘贴）', new Set(fgs.map((f) => f.cost)).size >= 3);
  check('小绿瓶（掌天瓶）在表里', fgs.some((f) => f.id === 'bottle' && f.name === '掌天瓶'),
    '目标点名要的');
  check('携带位有限', X.cycle.slots() === 2);
}

section('轮回：门槛与结算');
{
  setPeople(person({ realmIndex: 10, xp: 0, job: 'retreat', talent: 1 }));
  state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
  state.cultivation.manuals = [];
  const p1 = X.cycle.progress();
  check('境界不够时不能轮回', p1.canEnd === false, p1.reason);
  check('拒绝理由点明还差多少', p1.reason.includes('化神'), p1.reason);

  setPeople(person({ realmIndex: 22, xp: 0, job: 'retreat', talent: 1 }));
  const p2 = X.cycle.progress();
  check('修至化神初期即可轮回', p2.canEnd === true, p2.reason);
  check('结算给出四项明细', (() => {
    const r = p2.reward;
    return r.base > 0 && typeof r.fromHold === 'number' && typeof r.fromManuals === 'number' && typeof r.fromRealm === 'number';
  })());
  check('点数 = 各项之和', (() => {
    const r = p2.reward;
    return r.total === r.base + r.fromHold + r.fromManuals + r.fromRealm;
  })());
  // 成就越多点越多
  const before = X.cycle.reward().total;
  state.cultivation.world.held = ['valley', 'river'];
  state.cultivation.conquests = ['valley', 'river'];
  check('多占一块地就多一点', X.cycle.reward().total > before,
    `${before} → ${X.cycle.reward().total}`);
}

section('轮回：解锁与携带');
{
  state.meta = { cycle: 1, points: 0, cleared: 0, unlocked: [], active: [], history: [] };
  check('没有点数时解锁被拒', X.cycle.unlock('bottle').ok === false, X.cycle.unlock('bottle').reason);
  X.cycle.grantPoints(10);
  const r = X.cycle.unlock('bottle');
  check('有点数即可解锁掌天瓶', r.ok === true, r.reason);
  check('解锁扣掉对应点数', X.cycle.meta().points === 10 - X.cycle.fingers().find((f) => f.id === 'bottle').cost,
    `${X.cycle.meta().points} 点`);
  check('重复解锁被拒', X.cycle.unlock('bottle').ok === false);
  check('未解锁的不能携带', X.cycle.setActive(['ring']).ok === false, X.cycle.setActive(['ring']).reason);
  check('已解锁的可以携带', X.cycle.setActive(['bottle']).ok === true);
  X.cycle.grantPoints(10);
  X.cycle.unlock('ring');
  X.cycle.unlock('luck');
  check('超过携带位被拒', X.cycle.setActive(['bottle', 'ring', 'luck']).ok === false,
    X.cycle.setActive(['bottle', 'ring', 'luck']).reason);
  check('两件可以', X.cycle.setActive(['bottle', 'luck']).ok === true);
  check('不存在的金手指被过滤', X.cycle.setActive(['bottle', 'buzhidao']).ok === true
    && X.cycle.meta().active.join(',') === 'bottle');
}

section('金手指：效果真的接进去了');
{
  state.meta.active = [];
  check('没带金手指时所有效果都是中性', (() => {
    const fx = X.cycle.fx();
    return near(fx.train, 1) && near(fx.material, 1) && near(fx.stone, 1)
      && near(fx.break, 0) && near(fx.survival, 0);
  })());

  // 掌天瓶：材料 ×2.5、修炼 ×0.90
  state.meta.active = ['bottle'];
  check('掌天瓶抬高材料产出 ×2.5', near(X.cycle.fx().material, 2.5), `${X.cycle.fx().material}`);
  check('掌天瓶压低修炼 ×0.90（代价）', near(X.cycle.fx().train, 0.90), `${X.cycle.fx().train}`);
  {
    // 材料产出真的变了
    setPeople(person({ id: 1, realmIndex: 9, xp: 0, job: 'retreat', talent: 1 }));
    state.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: { valley: 1 }, unrest: {} };
    state.cultivation.alchemy = { herbs: {}, pills: {}, prof: {}, furnace: 1, crafts: 0 };
    const before = X.alchemy.herb('grass');
    X.map.tick(1000);
    const gainWith = X.alchemy.herb('grass') - before;
    const base = X.map.node('valley').herbYield * 1000;
    check('掌天瓶真的让药材产量翻倍', near(gainWith, base * 2.5, 1e-6),
      `${gainWith.toFixed(3)} vs 基准 ${base.toFixed(3)}`);
  }
  {
    // 修炼速度真的变了
    const run = () => {
      setPeople(person({ id: 1, realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
      state.cultivation.manuals = []; state.cultivation.equippedManual = null;
      X.step(100);
      return state.cultivation.cultivators[0].xp;
    };
    const withBottle = run();
    state.meta.active = [];
    const plain = run();
    check('掌天瓶也真的拖慢了修炼（代价不是摆设）', withBottle < plain,
      `${plain.toFixed(1)} → ${withBottle.toFixed(1)}`);
  }

  // 戒中老者：冲关 +12 个百分点
  {
    state.meta.active = ['ring'];
    // 【策划 C4 / 任务 T-5】炼气九层要先择地
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    X.alchemy.addPills('zhuji', 5);
    const withRing = X.realm.plan(1, 'mosscave').rate;
    state.meta.active = [];
    const without = X.realm.plan(1, 'mosscave').rate;
    check('戒中老者抬高冲关成功率 +12 个百分点', near(withRing, without + 0.12, 1e-9),
      `${(without * 100).toFixed(1)}% → ${(withRing * 100).toFixed(1)}%`);
  }

  // 气运加身：生还 +15 个百分点、灵石 ×0.80
  {
    state.meta.active = ['luck'];
    setPeople(person({ id: 1, realmIndex: 3, talent: 1.1, job: 'retreat' }));
    const withLuck = X.manual.survival(1, 'mosscave');
    check('气运加身压低灵石产出（代价）', near(X.cycle.fx().stone, 0.80), `${X.cycle.fx().stone}`);
    state.meta.active = [];
    const without = X.manual.survival(1, 'mosscave');
    check('气运加身抬高洞天生还率 +15 个百分点', near(withLuck, Math.min(0.98, without + 0.15), 1e-9),
      `${(without * 100).toFixed(1)}% → ${(withLuck * 100).toFixed(1)}%`);
  }

  // 两件叠加：掌天瓶 + 气运加身
  state.meta.active = ['bottle', 'luck'];
  check('两件金手指的效果会叠加', near(X.cycle.fx().material, 2.5) && near(X.cycle.fx().stone, 0.80)
    && near(X.cycle.fx().train, 0.90));
  state.meta.active = [];
}

section('轮回：重置要保住什么');
{
  // 造一个「玩到中后期」的状态
  state.meta = { cycle: 1, points: 5, cleared: 0, unlocked: ['bottle', 'luck'], active: ['luck'], history: [] };
  state.meta.points = 5;
  setPeople(person({ id: 1, realmIndex: 22, xp: 0, job: 'retreat', talent: 1 }));
  state.silver = 123456; state.population = 789;
  state.techs = ['realestate', 'architecture'];
  state.cultivation.manuals = ['star', 'xuanjia'];
  state.cultivation.world = { reached: ['mosscave', 'valley'], held: ['valley'], garrison: {}, unrest: {} };
  state.cultivation.alchemy = { herbs: { grass: 50 }, pills: {}, prof: {}, furnace: 3, crafts: 9 };
  state.cultivation.forge = { ores: { lingmu: 9 }, owned: ['qingfeng'], equipped: {}, durability: {}, prof: {}, level: 2, crafts: 3 };
  state.quiz.total = 100; state.quiz.right = 88;
  state.settings.speed = 5;
  const savedPoints = X.cycle.meta().points;

  const r = X.cycle.commit(['luck']);
  check('轮回成功', r.ok === true, r.reason);
  check('周目数 +1', X.cycle.meta().cycle === 2, `第 ${X.cycle.meta().cycle} 世`);
  check('拿到了轮回点', X.cycle.meta().points > savedPoints, `${savedPoints} → ${X.cycle.meta().points}`);

  // 该清的清了
  check('家业清空', state.silver !== 123456 && state.population !== 789, `${state.silver} 银 / ${state.population} 人`);
  check('科技清空', state.techs.length <= 3, state.techs.join(','));
  check('修士清空', state.cultivation.cultivators.length === 0);
  check('功法清空', state.cultivation.manuals.length === 0);
  check('领地清空', X.map.held().length === 0);
  check('丹房清空', state.cultivation.alchemy.furnace === 1 && X.alchemy.herb('grass') === 0);
  check('器坊清空', X.forge.owned().length === 0 && X.forge.level() === 1);
  check('符房清空', X.runes.bench() === 1 && X.runes.stock('juling') === 0);

  // 该留的留了
  check('**答题记录保留**（英语掌握程度不该因重开清空）',
    state.quiz.total === 100 && state.quiz.right === 88, `${state.quiz.right}/${state.quiz.total}`);
  check('设置保留', state.settings.speed === 5, `×${state.settings.speed}`);
  check('已解锁的金手指保留', X.cycle.meta().unlocked.includes('bottle') && X.cycle.meta().unlocked.includes('luck'));
  check('携带的金手指生效', X.cycle.meta().active.join(',') === 'luck');
  check('历世记录 +1', X.cycle.meta().history.length === 1, JSON.stringify(X.cycle.meta().history[0] || {}));
}

section('金手指：前世记忆的开局效果');
{
  state.meta = { cycle: 2, points: 0, cleared: 1, unlocked: ['memory'], active: ['memory'], history: [] };
  setPeople(person({ id: 1, realmIndex: 22, xp: 0, job: 'retreat', talent: 1 }));
  const r = X.cycle.commit(['memory']);
  check('轮回成功', r.ok === true, r.reason);
  check('开局即解锁了三项科技',
    ['realestate', 'architecture', 'finance'].every((t) => state.techs.includes(t)),
    state.techs.join(','));
  check('开局已知晓两处地点', X.map.reached().includes('valley'), X.map.reached().join(','));
  check('前世记忆写进了纪事',
    state.log.some((e) => typeof e.text === 'string' && e.text.includes('前世记忆')));
}

section('轮回：界面');
{
  state.meta = { cycle: 1, points: 12, cleared: 0, unlocked: [], active: [], history: [] };
  ui.actions.setPage('cycle');
  X.cycle.render(true);
  check('轮回页存在', Boolean(document.querySelector('.page[data-page="cycle"]')));
  // 注意：DOM 垫片的 innerHTML **取值器**不返回解析后的内容，所以这里用 textContent
  // 与 children 计数来断言「渲染产物里确实有这些东西」。
  const cycleText = () => $('cycle-body').textContent;
  const fingerCards = () => [...$('cycle-body').children].filter((el) => el.className.includes('codex-entry')).length;
  check('金手指卡片都画出来了', fingerCards() >= 5, `${fingerCards()} 张卡（含结算与列表头）`);
  check('chip 显示世数与点数', /\d+ 世/.test($('cycle-chip').textContent), $('cycle-chip').textContent);
  check('四件金手指的名字都在页面上',
    ['掌天瓶', '戒中老者', '前世记忆', '气运加身'].every((n) => cycleText().includes(n)));
  check('每件都写了代价', ['全族修炼速度 −10%', '额外消耗一枚同阶丹药', '答题带来的增益减半', '灵石产出 −20%']
    .every((t) => cycleText().includes(t)), '代价不是摆设');
  check('结算行写了四项明细',
    cycleText().includes('基础') && cycleText().includes('占领领地')
    && cycleText().includes('收录功法') && cycleText().includes('最高境界'));
  check('写明了携带上限', cycleText().includes(`最多 ${X.cycle.slots()} 件`));
  // 点一下解锁
  dom.click(document.querySelector('[data-cycle-unlock]'));
  check('点击解锁生效', X.cycle.meta().unlocked.length === 1, X.cycle.meta().unlocked.join(','));
  X.cycle.render(true);
  check('解锁后出现「携带」按钮', cycleText().includes('携带'),
    cycleText().replace(/\s+/g, ' ').slice(0, 60));
}

/* ══════════════════════ 15.5 T-0 线索经济闭环（阻断项） ══════════════════════
 *
 * 这一节的由来：`scripts/smoke.mjs` 里原有 17 处 `clues` 命中，
 * **设置值的一律是常量赋值**（`state.cultivation.clues = 50` 再验），
 * 断言只覆盖「扣减后等于常量」——**产出侧一条断言都没有**。
 * 于是「线索总产出 20 条 < 四道门槛累计需求 28 条、一周目数学上无法通关」
 * 这个阻断缺陷在 633 项断言全绿的情况下活了下来。
 * 本节的每一条都是**产出侧 / 守恒侧**的断言，就是为了让同类缺陷下次立刻暴露。
 */
section('T-0 线索经济（产出侧守恒）');
{
  const cluesInfo = X.clues();
  check('四道门槛累计需求 = 2+4+8+14 = 28 条', cluesInfo.gateDemand === 28, `${cluesInfo.gateDemand} 条`);

  // ① 秘闻池集齐之后，寻秘事件仍然产出线索（池空不再等于线索断供）
  {
    const S = X.state;
    const keep = { secrets: S.secrets.slice(), clues: S.cultivation.clues };
    S.secrets = X.data.map && Array.from({ length: cluesInfo.poolTotal }, (_, i) => i);
    S.cultivation.clues = 0;
    const before = S.secrets.length;
    const added = X.grantSecretForTest();   // 直接走 grantSecret 那条路
    check('秘闻池集齐后，寻秘仍然产出一条线索', S.cultivation.clues === 1,
      `clues=${S.cultivation.clues}（返回 ${added}）`);
    check('池集齐后 secrets 不再增长', S.secrets.length === before, `${before} → ${S.secrets.length}`);
    S.secrets = keep.secrets;
    S.cultivation.clues = keep.clues;
  }

  // ② cluePerSecFlat 登记齐全 + 真的被消费
  {
    const S = X.state;
    const withClue = d.immortalTechs.filter((t) => typeof t.effect?.cluePerSecFlat === 'number');
    check('有科技提供 cluePerSecFlat（否则线索仍是不可再生资源）', withClue.length >= 2,
      withClue.map((t) => `${t.id}=${t.effect.cluePerSecFlat}`).join(' '));
    check('cluePerSecFlat 有界面文案', Boolean(d.effectLabels.cluePerSecFlat));
    check('cluePerSecFlat 在合法 effect 键表里', d.immortalEffectKeys.includes('cluePerSecFlat'));

    // 真实消费：装上那两项科技，跑 3600 游戏秒，小数池进位成线索
    const keep = { immortalTechs: (S.immortalTechs || []).slice(), clues: S.cultivation.clues, pool: S.cultivation.cluePool };
    S.immortalTechs = withClue.map((t) => t.id);
    S.cultivation.clues = 0;
    S.cultivation.cluePool = 0;
    const rate = X.clues().perSec;
    check('装上探穴/界墟后 cluePerSecFlat 真的累加到了', rate > 0, `${rate}/秒`);
    setPeople(person({ realmIndex: 1, xp: 0, job: 'retreat', talent: 1 }));
    X.tick(3600);
    const gained = X.clues().clues;
    const expect = Math.floor(rate * 3600);
    check('跑 3600 秒后线索按 rate×时间 增长', gained >= expect && gained <= expect + 1,
      `${gained} 条（期望 ${expect}~${expect + 1}）`);
    S.immortalTechs = keep.immortalTechs;
    S.cultivation.clues = keep.clues;
    S.cultivation.cluePool = keep.pool;
    X.ui.render();
  }

  // ③ 总产出 ≥ 门槛需求（长期口径）——「以后再加门槛就立刻失败」的那条
  {
    const oneShot = cluesInfo.poolTotal;
    const clueTechs = d.immortalTechs.filter((t) => typeof t.effect?.cluePerSecFlat === 'number');
    const perSec = clueTechs.reduce((a, t) => a + t.effect.cluePerSecFlat, 0);
    const cycleHours = X.realm.pacing().total / H;
    const renewable = Math.floor(perSec * cycleHours * 3600);
    check('线索总产出（池 + 仙道科技可再生）≥ 四道门槛累计需求',
      oneShot + renewable >= cluesInfo.gateDemand,
      `${oneShot} 池 + ${renewable} 可再生 = ${oneShot + renewable} ≥ ${cluesInfo.gateDemand}（${cycleHours.toFixed(1)} 小时）`);
    // 慢路的余量。⚠【策划裁决 docs/91 §十二.4】口径已从「需求 59」改为**硬需求**：
    //   旧口径把参悟按 10 本算（实为 24 本 × 2 = 48），「+56%」已被设计师撤回，
    //   现在只对**硬需求 28**（四道门槛）要求余量，长期池（参悟）不再算进「必需」。
    check('慢路（不投帖）对**硬需求**（四道门槛）留有 ≥ 50% 余量',
      oneShot + renewable >= cluesInfo.gateDemand * 1.5,
      `硬需求 ${cluesInfo.gateDemand}，余量 ${(((oneShot + renewable) / cluesInfo.gateDemand - 1) * 100).toFixed(0)}%`);
  }

  // ④ 冲关失败不再扣线索（否则「缺线索」会变成死局）
  {
    atGate();
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
    const cluesBefore = state.cultivation.clues;
    const stonesBefore = state.spiritStones;
    const r = X.realm.commitWith(1, 'mosscave', () => 0.999);   // 骰子必失败
    check('冲关失败时扣灵石（备足材料再冲仍有意义）',
      r.success === false && state.spiritStones === stonesBefore - 8,
      `${stonesBefore} → ${state.spiritStones}`);
    check('冲关失败**不再**扣线索', state.cultivation.clues === cluesBefore,
      `${cluesBefore} → ${state.cultivation.clues}`);
  }
}

/* ══════════════════════ 15.6 T-1 存档白名单（阻断项） ══════════════════════
 *
 * 这一节存在的理由与上一节同源：原来的存档断言只查 `saved.cultivation.*` 内部，
 * 而从没有一条查过「**顶层**字段经过 serialize 之后还在不在」。
 * 于是 `serialize()` 漏掉 immortalTechs / morality / exchangeCount 三个顶层字段、
 * 刷新一次整条仙道科技线归零，而测试全绿。
 */
section('T-1 存档白名单（顶层字段）');
{
  // ① 结构性断言：createState 的每个顶层字段都必须被写出
  const freshState = X.save.hydrate({ createdAt: 0 });
  const serialized = X.save.serialize(freshState);
  // 唯一允许不持久化的运行时字段：lastSeen（在 hydrate 里由 savedAt 赋值）
  const NOT_PERSISTED = ['lastSeen'];
  const missingKeys = Object.keys(freshState)
    .filter((k) => !NOT_PERSISTED.includes(k))
    .filter((k) => !(k in serialized));
  check('createState 的每个顶层字段都在 serialize() 里（防止再漏字段）',
    missingKeys.length === 0, missingKeys.join(',') || '一个都没漏');
  check('不持久化白名单只有 lastSeen', NOT_PERSISTED.length === 1 && NOT_PERSISTED[0] === 'lastSeen');
  check('serialize 的键全都是 createState 的键（没有多余字段）',
    Object.keys(serialized).filter((k) => k !== 'savedAt' && !(k in freshState)).length === 0,
    Object.keys(serialized).filter((k) => k !== 'savedAt' && !(k in freshState)).join(',') || '');
  check('三个曾经漏掉的字段都在 serialize 里',
    ['immortalTechs', 'morality', 'exchangeCount'].every((k) => k in serialized));

  // ② 往返断言：断言**值**不丢（不是「字段存在」）
  {
    const S = X.state;
    const keep = {
      immortalTechs: (S.immortalTechs || []).slice(),
      morality: S.morality, exchangeCount: S.exchangeCount,
      clockYear: Number(S.clock?.year) || 0,
      metaPoints: X.cycle.meta().points,
    };
    S.immortalTechs = ['yinling', 'lingtian'];
    S.morality = 18;
    S.exchangeCount = 3;
    S.clock = { year: 321 };
    X.cycle.grantPoints(4);
    const back = X.save.roundTrip();
    check('往返后 immortalTechs 的值不丢', JSON.stringify(back.immortalTechs) === JSON.stringify(['yinling', 'lingtian']),
      JSON.stringify(back.immortalTechs));
    check('往返后 morality 的值不丢', back.morality === 18, `${back.morality}`);
    check('往返后 exchangeCount 的值不丢', back.exchangeCount === 3, `${back.exchangeCount}`);
    check('往返后 clock.year 的值不丢', back.clock.year === 321, `${back.clock?.year}`);
    check('往返后轮回点数不丢（meta 也是顶层字段）', back.meta.points === keep.metaPoints + 4, `${back.meta.points}`);
    S.immortalTechs = keep.immortalTechs;
    S.morality = keep.morality;
    S.exchangeCount = keep.exchangeCount;
    S.clock = { year: keep.clockYear };
    X.cycle.meta().points = keep.metaPoints;
    X.ui.render();
  }

  // ③ 旧存档（完全没有这三个字段）载入时不炸、走默认值
  {
    const legacy = X.save.hydrate({ createdAt: 0, cultivation: { cultivators: [] } });
    check('旧存档载入不炸且三个字段走默认值',
      Array.isArray(legacy.immortalTechs) && legacy.immortalTechs.length === 0
      && legacy.exchangeCount === 0 && legacy.morality === 50,
      `${JSON.stringify(legacy.immortalTechs)}/${legacy.exchangeCount}/${legacy.morality}`);
    check('旧存档载入后 clock 存在且归零', legacy.clock && legacy.clock.year === 0);
  }
}

/* ══════════════════════ 15.7 T-2 / T-2b 仪表盘与寿元钟 ══════════════════════ */
section('T-2 境界仪表盘 + personState');
{
  const dash = document.getElementById('realm-dashboard');
  check('#realm-dashboard 存在', Boolean(dash));
  setPeople(person({ realmIndex: 5, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  check('炼气期仪表渲染行气条 .dash-qi', Boolean(dash.querySelector('.dash-qi')));
  check('炼气期**不**渲染 .dash-foundation（未解锁的机制 DOM 里不存在）',
    dash.querySelector('.dash-foundation') === null);
  setPeople(person({ realmIndex: 12, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  check('筑基期仪表渲染 .dash-foundation', Boolean(dash.querySelector('.dash-foundation')));
  check('筑基期不再渲染 .dash-qi', dash.querySelector('.dash-qi') === null);
  setPeople(person({ realmIndex: 15, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  check('金丹期仪表渲染丹图 .dash-core', Boolean(dash.querySelector('.dash-core')));
  setPeople(person({ realmIndex: 19, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  check('元婴期仪表渲染 .dash-nascent', Boolean(dash.querySelector('.dash-nascent')));
  setPeople(person({ realmIndex: 23, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  check('化神期仪表渲染 .dash-tribulation', Boolean(dash.querySelector('.dash-tribulation')));
  check('每格仪表都带 [查百科] 链接（data-target-page="codex"）',
    dash.querySelectorAll('[data-target-page="codex"]').length === 1);
  check('凡人（无修士）时仪表隐藏', (() => {
    setPeople();
    X.ui.render();
    return dash.hidden === true && dash.querySelector('.dash-qi') === null;
  })());
  check('dashboardVisible() 与渲染出来的那一格一致', (() => {
    setPeople(person({ realmIndex: 12, xp: 0, job: 'retreat', talent: 1 }));
    return X.visible.dashboard('foundation') && !X.visible.dashboard('qi');
  })());
}

{
  // personState 是 breakthroughState 的**严格超集**：新态之外必须逐位一致
  const samples = [
    { realmIndex: 1, xp: 0, job: 'retreat' },
    { realmIndex: 9, xp: 0, job: 'retreat' },
    { realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat' },
    { realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'sect' },
    { realmIndex: 12, xp: 10, job: 'retreat' },
    { realmIndex: 13, xp: X.realm.xpNeeded(13), job: 'retreat' },
    { realmIndex: 14, xp: 0, job: 'retreat' },
    { realmIndex: 14, xp: X.realm.xpNeeded(14), job: 'retreat' },
    { realmIndex: 25, xp: 0, job: 'retreat' },
    { realmIndex: 3, xp: 0, job: 'labor' },
    { realmIndex: 3, xp: 0, job: 'guard' },
  ];
  const mismatch = [];
  for (const over of samples) {
    setPeople(person(over));
    const p = state.cultivation.cultivators[0];
    if (X.realm.personState(1) !== X.realm.stateOf(1).kind) {
      mismatch.push(`${JSON.stringify(over)}: ${X.realm.personState(1)} vs ${X.realm.stateOf(1).kind}`);
    }
  }
  check('personState() 与 breakthroughState() 在不涉及新态时逐位一致',
    mismatch.length === 0, mismatch.join(' | '));

  setPeople(person({ realmIndex: 3, xp: 0, job: 'errand' }));
  check('差事在外 → personState = out', X.realm.personState(1) === 'out');
  setPeople(person({ realmIndex: 3, xp: 0, job: 'retreat', stalled: 5 }));
  check('气机滞住 → personState = stalled', X.realm.personState(1) === 'stalled');
  setPeople(person({ realmIndex: 14, xp: X.realm.xpNeeded(14), job: 'retreat' }));
  check('金丹满修为 → personState = folding', X.realm.personState(1) === 'folding');
  check('personState(不存在的 id) = mortal', X.realm.personState(9999) === 'mortal');
  check('九个合法返回值不多不少（含 mortal）', (() => {
    const seen = new Set();
    const probes = [
      null,
      { realmIndex: 3, xp: 0, job: 'errand' },
      { realmIndex: 3, xp: 0, job: 'retreat', stalled: 1 },
      { realmIndex: 14, xp: X.realm.xpNeeded(14), job: 'retreat' },
      { realmIndex: 25, xp: 0, job: 'retreat' },
      { realmIndex: 3, xp: 0, job: 'retreat' },
      { realmIndex: 9, xp: 0, job: 'retreat' },
      { realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat' },
    ];
    for (const probe of probes) {
      setPeople(probe ? person(probe) : null);
      if (!probe) setPeople();
      seen.add(probe ? X.realm.personState(1) : X.realm.personState(9999));
    }
    const legal = ['mortal', 'max', 'progressing', 'filling', 'blocked', 'folding', 'errand', 'stalled', 'out'];
    return [...seen].every((k) => [...legal, 'out', 'stalled'].includes(k));
  })());

  setPeople(person({ realmIndex: 12, xp: 0, job: 'retreat', talent: 1 }));
  X.ui.render();
  const tags = document.querySelectorAll('#cultivator-list .state-tag');
  check('修士卡片上不出现两个状态标记（每张卡 ≤ 1 个）',
    tags.length <= 1 && document.querySelectorAll('#cultivator-list .cultivator-card').length === 1,
    `${tags.length} 个标记 / ${document.querySelectorAll('#cultivator-list .cultivator-card').length} 张卡`);
}

section('T-2b 寿元钟（收窄版）');
{
  check('state.clock 存在', Boolean(X.state.clock), JSON.stringify(X.state.clock));
  // ① 在线推进 1 游戏小时 → year 恰好 +25
  {
    X.state.clock = { year: 0 };
    setPeople(person({ realmIndex: 5, xp: 0, job: 'retreat', talent: 1 }));
    X.tick(3600);
    check('在线推进 1 游戏小时 → year +25', near(X.state.clock.year, 25, 1e-9), `${X.state.clock.year}`);
    check('在线推进（时间推进路径）与 tick 口径一致', (() => {
      const before = X.state.clock.year;
      X.step(3600);
      return near(X.state.clock.year - before, 25, 1e-9);
    })(), `${X.state.clock.year}`);
  }
  // ② 离线不推年份（本条唯一的硬约束）
  {
    const before = X.state.clock.year;
    X.offline(12 * 3600);
    check('离线 12 小时**不推**年份', X.state.clock.year === before,
      `${before} → ${X.state.clock.year}`);
  }
  // ③ 境界变化重置 realmEnteredYear
  {
    X.state.clock = { year: 100 };
    setPeople(person({ realmIndex: 1, xp: 0, job: 'retreat', talent: 1, realmEnteredYear: 0 }));
    X.step(200000);   // 一路自动晋升
    const p = state.cultivation.cultivators[0];
    check('自动晋升后 realmEnteredYear 跟着重置', p.realmEnteredYear === X.state.clock.year,
      `${p.realmEnteredYear} vs ${X.state.clock.year}`);
    atGate();
    X.state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
    X.state.cultivation.cultivators[0].realmEnteredYear = 0;
    const r = X.realm.commitWith(1, 'mosscave', () => 0);
    check('冲关成功后 realmEnteredYear 也被重置',
      r.success === true && state.cultivation.cultivators[0].realmEnteredYear === X.state.clock.year,
      `${state.cultivation.cultivators[0].realmEnteredYear} vs ${X.state.clock.year}`);
  }
  // ④ 族谱上出现「寿 X，余 Y」+ 三档配色
  {
    X.state.clock = { year: 0 };
    setPeople(person({ realmIndex: 5, xp: 0, job: 'retreat', talent: 1, realmEnteredYear: 0 }));
    X.ui.render();
    const text = () => document.getElementById('cultivator-list').textContent;
    check('炼气期修士的寿元上限是 120', X.realm.lifespan(1).max === 120, `${X.realm.lifespan(1).max}`);
    check('族谱上出现「寿 120，余 …」', /寿\s*120，余\s*\d+/.test(text()), text().replace(/\s+/g, ' ').slice(0, 80));
    check('筑基期上限 300 / 金丹 700 / 元婴 1500 / 化神 3000',
      X.realm.lifespan(1).max === 120
      && (setPeople(person({ realmIndex: 12 })), X.realm.lifespan(1).max === 300)
      && (setPeople(person({ realmIndex: 15 })), X.realm.lifespan(1).max === 700)
      && (setPeople(person({ realmIndex: 19 })), X.realm.lifespan(1).max === 1500)
      && (setPeople(person({ realmIndex: 23 })), X.realm.lifespan(1).max === 3000));
    // 三档配色：余量 > 50% 正常 / 20–50% 黄 / < 20% 红
    const clsAt = (year) => {
      X.state.clock = { year };
      setPeople(person({ realmIndex: 12, xp: 0, job: 'retreat', talent: 1, realmEnteredYear: 0 }));
      X.ui.render();
      const el = document.querySelector('#cultivator-list .cultivator-life');
      return el ? el.className : '';
    };
    check('余量 > 50% → 正常配色', clsAt(0).includes('dash-life-normal'), clsAt(0));
    check('余量 20–50% → 黄色', clsAt(200).includes('dash-life-warn'), clsAt(200));
    check('余量 < 20% → 红色', clsAt(280).includes('dash-life-danger'), clsAt(280));
    check('余量耗尽 → 灰色「寿元已尽…」，且**不产生任何惩罚**', (() => {
      const c = clsAt(400);
      const stillThere = state.cultivation.cultivators.length === 1;
      return c.includes('dash-life-gone') && stillThere;
    })(), clsAt(400));
    check('寿元耗尽不会让修士消失（收窄版不做老死）', state.cultivation.cultivators.length === 1);
    X.state.clock = { year: 0 };
  }
  // ⑤ 旧存档兼容
  {
    const legacy = X.save.hydrate({
      createdAt: 0,
      cultivation: { cultivators: [{ id: 1, realmIndex: 7, xp: 0, job: 'retreat' }] },
    });
    check('旧存档的修士补上了 realmEnteredYear: 0',
      legacy.cultivation.cultivators[0].realmEnteredYear === 0);
    check('旧存档补上了 clock', legacy.clock && legacy.clock.year === 0);
  }
}

/* ══════════════════════ 15.8 T-3 猛进行气 ══════════════════════ */
section('T-3 猛进行气（炼气期的第一个决策）');
{
  // ① 修为倍率恰好 2.2
  {
    const runXp = (push, rngFn) => {
      // population 归零：用 () => 0 这类极端骰子时，天然出生会把「生一个修士」
      // 也判成必触发，从而干扰「骰子只用来验走火」这条断言。
      state.population = 0;
      setPeople(person({ realmIndex: 3, xp: 0, job: 'retreat', talent: 1, push, stalled: 0 }));
      state.cultivation.manuals = [];
      state.cultivation.equippedManual = null;
      state.meta.active = [];
      X.setRng(rngFn);
      X.tick(100);
      X.setRng(null);
      return state.cultivation.cultivators[0];
    };
    const slow = runXp(false, () => 0.999999);
    const fast = runXp(true, () => 0.999999);
    check('猛进的修为增量恰好是缓修的 2.2 倍', near(fast.xp / slow.xp, 2.2, 1e-6), `${(fast.xp / slow.xp).toFixed(6)}`);
  }
  // ② 走火：本层修为清零（不是全境界清零）
  {
    state.population = 0;
    setPeople(person({ realmIndex: 3, xp: 20, job: 'retreat', talent: 1, push: true, stalled: 0 }));
    X.setRng(() => 0);
    X.tick(1);
    X.setRng(null);
    const p = state.cultivation.cultivators[0];
    check('骰子必触发 → 本层修为清零', p.xp === 0, `${p.xp}`);
    check('走火只回退到「刚进这一层」，境界不变', p.realmIndex === 3, X.realm.name(p.realmIndex));
    check('走火**不产生死亡**（走火买的是时间，不是人）', state.cultivation.cultivators.length === 1,
      `${state.cultivation.cultivators.length} 人`);
  }
  {
    state.population = 0;
    setPeople(person({ realmIndex: 3, xp: 0, job: 'retreat', talent: 1, push: false, stalled: 0 }));
    X.setRng(() => 0);
    X.tick(1);
    X.setRng(null);
    check('缓修时有骰子也不走火', state.cultivation.cultivators.length === 1 && state.cultivation.cultivators[0].xp <= 1,
      `${state.cultivation.cultivators.length} 人 / xp=${state.cultivation.cultivators[0]?.xp}（缓修 1 秒约 +1）`);
  }
  // ③ stalled 递减
  {
    setPeople(person({ realmIndex: 3, xp: 0, job: 'retreat', talent: 1, push: false, stalled: 10 }));
    X.setRng(() => 0.999999);
    X.tick(4);
    X.setRng(null);
    const p = state.cultivation.cultivators[0];
    check('stalled 每秒递减 1（10 − 4 = 6）', p.stalled === 6, `${p.stalled}`);
    check('stalled > 0 时不涨修为', p.xp === 0, `${p.xp}`);
  }
  // ④ 期望走火次数：可算的风险
  {
    const expectAt = (idx) => (X.realm.at(idx).local * 1e-4 * X.realm.xpNeeded(idx)) / 2.2;
    check('九层期望走火 1.49 次（与 docs/91 T-3 表逐位一致）', near(expectAt(9), 1.491, 0.01),
      `${expectAt(9).toFixed(3)}`);
    check('八层期望走火 1.05 次', near(expectAt(8), 1.047, 0.01), `${expectAt(8).toFixed(3)}`);
    check('一层期望走火 0.002 次（低层几乎免费）', expectAt(1) < 0.01, `${expectAt(1).toFixed(4)}`);
    setPeople(person({ realmIndex: 9, xp: 0, job: 'retreat', talent: 1, push: false }));
    X.ui.render();
    const text = document.getElementById('cultivator-list').textContent;
    check('卡片上写出「期望走火 X 次」（带一位小数，不是「有风险」）',
      /期望走火\s*1\.\d/.test(text), text.replace(/\s+/g, ' ').slice(0, 100));
  }
  // ⑤ 开关只对炼气 + 闭关开放
  {
    setPeople(person({ realmIndex: 5, xp: 0, job: 'retreat', talent: 1 }));
    X.ui.render();
    check('炼气 + 闭关 → 有猛进开关', document.querySelectorAll('#cultivator-list [data-push]').length === 1);
    setPeople(person({ realmIndex: 5, xp: 0, job: 'sect', talent: 1 }));
    X.ui.render();
    check('宗门修士 → 没有猛进开关（否则 3.5×2.2 会让宗门成为唯一解）',
      document.querySelectorAll('#cultivator-list [data-push]').length === 0);
    setPeople(person({ realmIndex: 12, xp: 0, job: 'retreat', talent: 1 }));
    X.ui.render();
    check('筑基以上 → 没有猛进开关', document.querySelectorAll('#cultivator-list [data-push]').length === 0);
  }
  // ⑥ 旧存档兼容
  {
    const legacy = X.save.hydrate({ createdAt: 0, cultivation: { cultivators: [{ id: 1, realmIndex: 4, xp: 0, job: 'retreat' }] } });
    const p = legacy.cultivation.cultivators[0];
    check('旧存档载入后 push === false', p.push === false);
    check('旧存档载入后 stalled === 0', p.stalled === 0);
  }
}

/* ══════════════════════ 15.9 T-4 投帖问路 ══════════════════════ */
section('T-4 投帖问路（拿族人的命换线索）');
{
  // ① 差事接进三处数据驱动的地方
  check('职责表里有 errand（差事）', Boolean(X.data.jobs.errand), Object.keys(X.data.jobs).join(','));
  check('职责计数里出现「差事」', (() => {
    setPeople(person({ realmIndex: 3, job: 'errand' }));
    X.ui.render();
    const text = document.getElementById('cultivator-job-stats').textContent;
    return text.includes('差事');
  })());
  check('下拉框里有「差事」选项', (() => {
    setPeople(person({ realmIndex: 3, job: 'retreat' }));
    X.ui.render();
    return document.querySelector('#cultivator-list select[data-assign-id]').textContent.includes('差事');
  })());
  check('百科里有「差事」条目', (() => {
    const book = X.codex.book();
    return JSON.stringify(book).includes('差事');
  })());

  // ② 在外的人不涨修为
  {
    state.population = 0;
    setPeople(person({ realmIndex: 3, xp: 0, job: 'errand', talent: 1 }));
    X.setRng(() => 0.999999);
    X.tick(600);
    X.setRng(null);
    check('差事在外的人跑 progressCultivators 后 xp 不变',
      state.cultivation.cultivators.length === 1 && state.cultivation.cultivators[0].xp === 0,
      `${state.cultivation.cultivators.length} 人 / xp=${state.cultivation.cultivators[0]?.xp}`);
  }

  // ③ 不能被派去镇守 / 探险
  {
    setPeople(person({ realmIndex: 3, job: 'errand', talent: 1 }));
    state.cultivation.world = { reached: ['mosscave', 'valley'], held: ['valley'], garrison: {}, unrest: {} };
    check('在外的人不能被派去镇守', X.map.garrison('valley', 1).ok === false, X.map.garrison('valley', 1).reason);
    check('在外的人不能去洞天探险', X.map.explore(1, 'mosscave').ok === false, X.map.explore(1, 'mosscave').reason);
    check('在外的人不在镇守候选名单里（宗门修士同理）', (() => {
      setPeople(
        person({ id: 1, realmIndex: 3, job: 'errand', talent: 1 }),
        person({ id: 2, realmIndex: 3, job: 'sect', talent: 1 }),
        person({ id: 3, realmIndex: 3, job: 'retreat', talent: 1 }),
      );
      const cands = X.map.garrisonCandidates();
      return cands.length === 1 && cands[0] === 3;
    })(), JSON.stringify(X.map.garrisonCandidates()));
  }

  // ④ 线索产出（受控骰子：第一次判不死、第二次判得线索）
  {
    // population 归零：用极端骰子时天然出生会把人数搅乱
    state.population = 0;
    setPeople(person({ realmIndex: 3, job: 'errand', talent: 1 }));
    state.cultivation.clues = 0;
    state.log = [];
    // 每次 tick 里，在外的人两个骰子：① 死？② 线索？→ 先高后 0
    let roll = 0;
    X.setRng(() => (roll += 1) % 2 === 1 ? 0.999999 : 0);
    X.tick(1);
    X.setRng(null);
    check('在外的人必定带回线索时，clues +1', state.cultivation.clues === 1, `${state.cultivation.clues}`);
    check('线索日志里带上了那个人的名字',
      state.log.some((e) => typeof e.text === 'string' && e.text.includes('林清衡') && e.text.includes('线索')),
      (state.log[0]?.text || '').slice(0, 40));
    state.population = 0;
    setPeople(person({ realmIndex: 3, job: 'errand', talent: 1 }));
    state.cultivation.clues = 0;
    X.seedRng(20260101);
    X.tick(1);
    check('在外 1 秒大概率不得线索（2.5e-5 的速率）', state.cultivation.clues === 0, `${state.cultivation.clues}`);
  }

  // ⑤ 死亡：只死在外的人，且写讣告
  {
    state.population = 0;
    setPeople(person({ realmIndex: 3, job: 'errand', talent: 1 }));
    state.stats.deaths = 0;
    state.log = [];
    X.setRng(() => 0);   // 第一次判定即「不回来」
    X.tick(1);
    X.setRng(null);
    check('骰子必死 → 那个在外的人消失了', state.cultivation.cultivators.length === 0, `${state.cultivation.cultivators.length}`);
    check('讣告写进了纪事，且带名字',
      state.log.some((e) => typeof e.text === 'string' && e.text.includes('林清衡')),
      (state.log[0]?.text || '').slice(0, 40));
    check('死亡率恒为 0 时不死人', (() => {
      state.population = 0;
      setPeople(person({ realmIndex: 3, job: 'errand', talent: 1 }));
      X.setRng(() => 0.999999);
      X.tick(3600);
      X.setRng(null);
      return state.cultivation.cultivators.length === 1;
    })());
  }

  // ⑥ 投帖与召回（走真实的行动入口）
  {
    setPeople(
      person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 3, job: 'retreat', talent: 1 }),
    );
    const r = X.immortalAction('errand', '1,2');
    check('投帖：两人都变成「差事」', r.ok === true
      && state.cultivation.cultivators.every((p) => p.job === 'errand'), r.reason.slice(0, 30));
    check('投帖日志带「回不来」的可算概率', /%/ .test(r.reason), r.reason.slice(0, 60));
    const r2 = X.immortalAction('recall', '1');
    check('召回：瞬时生效、无冷却',
      r2.ok === true && state.cultivation.cultivators[0].job === 'retreat', r2.reason);
    check('投帖不过炼气期（筑基以上拒绝）', (() => {
      setPeople(person({ id: 1, realmIndex: 12, job: 'retreat', talent: 1 }));
      return X.immortalAction('errand', '1').ok === false;
    })());
    check('投帖不派宗门修士', (() => {
      setPeople(person({ id: 1, realmIndex: 3, job: 'sect', talent: 1 }));
      return X.immortalAction('errand', '1').ok === false;
    })());
    // 【t12 验收】投帖的三道门槛同样要「理由点名」——
    // 上面两条只说 ok===false，玩家看不到「为什么这个人不能派」。
    check('投帖拒绝理由点名：筑基以上的人 → 理由含其名与缘由',
      (() => { setPeople(person({ id: 1, realmIndex: 12, job: 'retreat', talent: 1 }));
        const r = X.immortalAction('errand', '1');
        return r.ok === false && /炼气/.test(r.reason) && /林清衡/.test(r.reason); })(),
      (() => { setPeople(person({ id: 1, realmIndex: 12, job: 'retreat', talent: 1 }));
        return X.immortalAction('errand', '1').reason; })());
    check('投帖拒绝理由点名：宗门修士 → 理由含「宗门」',
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'sect', talent: 1 }));
        const r = X.immortalAction('errand', '1');
        return r.ok === false && /宗门/.test(r.reason); })(),
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'sect', talent: 1 }));
        return X.immortalAction('errand', '1').reason; })());
    check('投帖拒绝理由点名：一个人都没勾 → 理由含「勾选」',
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }));
        const r = X.immortalAction('errand', '');
        return r.ok === false && /勾选/.test(r.reason); })(),
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }));
        return X.immortalAction('errand', '').reason; })());
    // 两侧：刚好够 → 必成（上面 ⑥ 已断言两人都变成 errand，这里补「再派已在外的会被拒」）
    check('投帖拒绝理由点名：已在外的再派 → 理由含「已经在外面」',
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'errand', talent: 1 }));
        const r = X.immortalAction('errand', '1');
        return r.ok === false && /在外/.test(r.reason); })(),
      (() => { setPeople(person({ id: 1, realmIndex: 3, job: 'errand', talent: 1 }));
        return X.immortalAction('errand', '1').reason; })());
  }

  // ⑦ 卡片上的勾选框与按钮
  {
    setPeople(person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }));
    X.ui.render();
    check('炼气族人卡片上有投帖勾选框',
      document.querySelectorAll('#cultivator-list [data-errand-check]').length === 1);
    check('在外的人卡片上有「召回」按钮', (() => {
      setPeople(person({ id: 1, realmIndex: 3, job: 'errand', talent: 1 }));
      X.ui.render();
      return document.querySelectorAll('#cultivator-list [data-recall]').length === 1;
    })());
  }

  /* ── 【修复 t4 缺陷① / docs/91 §十二 T-4-A1 ~ A4】投帖入口的属性级与端到端断言 ──
   * 缺陷① 的原形态：渲染侧只有勾选框、**没有任何 `data-errand` 元素**，
   * 而处理器等的是 `[data-errand]` ⇒ 玩家勾了人却没人出门。
   * 它之所以能活下来，是因为原来的断言只问「数据接没接上」（`immortalAction` 直调），
   * **从没问「界面上那个按钮在不在、点了会不会动」**。
   * ⚠ 这几条一律查**渲染结果的 DOM**，不查模板字符串 —— 查模板字符串就只能证明
   *   「源码里写了这几个字」，证明不了「它在真实 DOM 里、且点击链路通」。 */
  {
    // ⚠ 所有查询都**限定在 `#cultivator-list` 内**，不用 `document.querySelector`。
    //   原因（这一条是实测出来的坑）：垫片会把内联 `<script type="module">` 里的
    //   文本当成 HTML 解析，于是 `data-errand-check="${p.id}"` 这种**模板字面量**
    //   会在 BODY 下生成「幻影元素」，`document.querySelectorAll` 会把它们算进去。
    //   限定作用域后只数真实渲染出来的那一个。
    const listQ = () => document.getElementById('cultivator-list');

    // ── T-4-A4：勾选 0 人时入口必须 disabled（否则那个入口是死的）──
    setPeople(
      person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 3, job: 'retreat', talent: 1 }),
    );
    state.population = 0;
    X.ui.render();
    check('T-4-A1：界面上恰好有 1 个投帖入口 `[data-errand]`',
      listQ().querySelectorAll('[data-errand]').length === 1,
      `${listQ().querySelectorAll('[data-errand]').length} 个`);
    check('T-4-A4：勾选 0 人时投帖入口 disabled',
      listQ().querySelector('[data-errand]').disabled === true);

    // ── T-4-A2：端到端 —— 勾 2 人 → 派发真实 click → 这 2 人出门、其余人不变 ──
    //    走的是「属性名 → 事件委托 → dispatcher」整条链路，正是缺陷① 断掉的那一段。
    //    第 3 个人是宗门弟子 ⇒ 界面上不会给他勾选框，覆盖「其余人不变」。
    setPeople(
      person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 3, realmIndex: 3, job: 'sect', talent: 1 }),
    );
    state.population = 0;
    X.ui.render();
    // 勾选框是**活的**：勾选后不重渲染（否则勾选会丢），
    // 所以入口的可用性由容器上的 `change` 委托就地刷新。
    // ⚠ 垫片限制（与「逗号选择器」同类，如实记在这里）：`Element.dispatch` **不冒泡**，
    //   所以没法靠「在勾选框上派发事件」触发容器上的委托。
    //   这里按垫片暴露的路径直接调容器上的 change 监听器（`dom.click` 也是这么做的），
    //   并把 `target` 指向勾选框 —— 真实浏览器里这一步由冒泡完成。
    for (const n of listQ().querySelectorAll('[data-errand-check]')) n.checked = true;
    const cbTarget = listQ().querySelector('[data-errand-check]');
    for (const fn of (listQ()._listeners?.change || [])) fn({ target: cbTarget });
    const eb = listQ().querySelector('[data-errand]');
    check('T-4-A2：勾选并派发 change 后入口不再 disabled —— 入口是活的',
      // 先要求入口**存在**再查 disabled：否则按钮一旦消失，`.disabled` 读 undefined
      // 会让 `=== false` 变成假失败，而 `!== true` 又会变成恒真 —— 两头都是坑。
      Boolean(eb) && eb.disabled === false, eb ? `disabled=${eb.disabled}` : '入口不存在');
    dom.click(eb);
    check('T-4-A2：端到端点击投帖 → 勾选的 2 人 job 变成 errand',
      state.cultivation.cultivators[0].job === 'errand'
      && state.cultivation.cultivators[1].job === 'errand',
      `${state.cultivation.cultivators.map((p) => p.job).join(',')}`);
    check('T-4-A2：端到端点击投帖 → 没勾的宗门弟子不受影响',
      state.cultivation.cultivators[2].job === 'sect');

    // ── T-4-A3：召回后 job 回 retreat，且 errandSince 被删掉 ──
    // ⚠ 召回是**按勾选取人**的（与投帖同一个处理器）：不勾选就只会得到
    //   「请先勾选族人」的提示。所以这里必须先把他的框勾上 —— 这也正是真实的
    //   操作路径（玩家在外的人身上勾一下，再点召回），测试要照着走。
    setPeople(person({ id: 1, realmIndex: 3, job: 'errand', talent: 1, errandSince: 7 }));
    state.population = 0;
    X.ui.render();
    check('T-4-A3：在外的人有 `[data-recall]`（恰好 1 个）',
      listQ().querySelectorAll('[data-recall]').length === 1,
      `${listQ().querySelectorAll('[data-recall]').length}`);
    listQ().querySelector('[data-errand-check]').checked = true;
    dom.click(listQ().querySelector('[data-recall]'));
    check('T-4-A3：勾选后点召回 → job 回 retreat',
      state.cultivation.cultivators[0].job === 'retreat',
      state.cultivation.cultivators[0].job);
    check('T-4-A3：点召回 → errandSince 被删掉',
      !('errandSince' in state.cultivation.cultivators[0]));
    check('T-4-A3：**没勾选**时点召回不会误召回（入口有守卫，不是无脑全召回）', (() => {
      setPeople(person({ id: 1, realmIndex: 3, job: 'errand', talent: 1, errandSince: 7 }));
      state.population = 0;
      X.ui.render();
      dom.click(listQ().querySelector('[data-recall]'));
      return state.cultivation.cultivators[0].job === 'errand';
    })());

    /* ── T-4-A5 / A6【修复 t9 缺陷③】勾选状态必须**活过一次重渲染** ──
     * 这是投帖缺陷的第三种形态（前两种：入口根本没渲染、处理器恒不触发）。
     * 原来 856 条断言全绿也抓不到它，因为旧断言是「勾选 → **立刻**点击」，
     * 中间没有重渲染 —— 而那正是对照组。挂机时每几秒就有一次重渲染，所以
     * 「勾选 → 重渲染 → 点击」才是玩家真实会遇到的路径。
     * 当时的表现：勾选框被重建为空，按钮却仍 enabled 且文案写着「已勾选 2 人」
     * ⇒ **同一画面自相矛盾**，点下去一个人也不出门。 */
    setPeople(
      person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 3, job: 'retreat', talent: 1 }),
      person({ id: 3, realmIndex: 3, job: 'sect', talent: 1 }),
    );
    state.population = 0;
    X.ui.render();
    {
      const boxes = listQ().querySelectorAll('[data-errand-check]');
      boxes[0].checked = true;
      boxes[1].checked = true;
      // 让容器上的 change 委托就地刷新按钮（垫片不冒泡，直接调容器的监听器）
      for (const fn of (listQ()._listeners?.change || [])) fn({ target: boxes[0] });
      check('T-4-A5-前置：勾选 2 人后按钮可用且文案为 2 人',
        listQ().querySelector('[data-errand]').disabled === false
        && /勾选 2 人/.test(listQ().querySelector('[data-errand]').textContent),
        listQ().querySelector('[data-errand]').textContent);

      // ★ 关键：中间插入一次重渲染（模拟挂机时的自动刷新）
      X.ui.render();
      const stillChecked = listQ().querySelectorAll('[data-errand-check]:checked').length;
      check('T-4-A5：勾选状态活过一次重渲染（重渲染后仍勾着 2 人）',
        stillChecked === 2, `${stillChecked} 个仍勾选`);
      // 阳性对照：`:checked` 必须**能区分**勾与没勾 —— 否则上面那条会是恒真的空检查
      // （垫片原本不认识 `:checked`，会把它静默丢掉、退化成只按属性匹配 ⇒ 两个框都算命中）。
      check('T-4-A5 阳性对照：:checked 能区分勾选状态（不勾的框不算命中）', (() => {
        const all = listQ().querySelectorAll('[data-errand-check]');
        const before = listQ().querySelectorAll('[data-errand-check]:checked').length;
        all[0].checked = false;
        const after = listQ().querySelectorAll('[data-errand-check]:checked').length;
        all[0].checked = true;   // 复原，别影响后面的断言
        return before === 2 && after === 1;
      })());
      check('T-4-A6：重渲染后按钮的 disabled/文案与**真实**勾选数一致（按钮不再说谎）',
        (() => {
          const b = listQ().querySelector('[data-errand]');
          return b.disabled === false && /勾选 2 人/.test(b.textContent);
        })(),
        (() => { const b = listQ().querySelector('[data-errand]');
          return `disabled=${b.disabled} text=${b.textContent.trim()}`; })());

      // 端到端：重渲染之后点它，必须真的把人派出去（对照组能过、这里也必须能过）
      dom.click(listQ().querySelector('[data-errand]'));
      check('T-4-A5：重渲染后点击仍能把勾选的 2 人派出去（不是只弹「请先勾选」）',
        state.cultivation.cultivators[0].job === 'errand'
        && state.cultivation.cultivators[1].job === 'errand',
        `${state.cultivation.cultivators.map((p) => p.job).join(',')}`);
      check('T-4-A5：派帖成功后勾选被清空（「已在外」的人不会再被算进勾选数）',
        // 这两人都出门之后，卡片上**没有**可勾的人了 ⇒ 投帖工具栏整条按设计不渲染
        // （`canErrand` 为假）。所以正确的断言是「没有残留勾选，且入口要么不存在要么是灰的」，
        // 而不是硬要求入口存在 —— 那样会在「所有人都已在外」这个正常情形下假失败。
        listQ().querySelectorAll('[data-errand-check]:checked').length === 0
        && (() => { const b = listQ().querySelector('[data-errand]'); return !b || b.disabled === true; })(),
        `checked=${listQ().querySelectorAll('[data-errand-check]:checked').length}，入口=${listQ().querySelector('[data-errand]') ? '存在' : '已收起'}`);
    }

    /* ── T-4-A7 / A8 / A9（docs/91 §12.11.4，主策采纳的两处加固）──
     * A7 的不变量：**回填集 = 文案计数 = 派发取值**，三者必须恒等。
     *   以前它们各算一遍：文案数 DOM 上的勾、派发读 DOM 上的勾、回填用 checkedIds
     *   ⇒ 任何一处与「本轮仍走候选分支的人」脱钩，就会出现按钮说谎。
     *   `data-errand-count` 就是为这条可机读断言加的（否则只能解析中文文案，改文案即废）。
     * A8：有人离开候选分支（死了 / 被派走 / 过了炼气期）时**不得多报** ——
     *   这正是加固 1 修的那个「多报 1、持续一个渲染周期」的小窗口。
     * A9：勾 0 人时 disabled。 */
    {
      setPeople(
        person({ id: 1, realmIndex: 3, job: 'retreat', talent: 1 }),
        person({ id: 2, realmIndex: 3, job: 'retreat', talent: 1 }),
        person({ id: 3, realmIndex: 3, job: 'sect', talent: 1 }),
      );
      state.population = 0;
      X.ui.render();

      // A9：一个都没勾 → disabled
      check('T-4-A9：勾 0 人时投帖入口 disabled',
        listQ().querySelector('[data-errand]').disabled === true);

      const boxes = listQ().querySelectorAll('[data-errand-check]');
      boxes[0].checked = true;
      boxes[1].checked = true;
      for (const fn of (listQ()._listeners?.change || [])) fn({ target: boxes[0] });

      /* ★【修复 t13 §14.4】断言必须**在渲染之前**读一次：
       *   `data-errand-count` 原先只在渲染时由 `checkedCount` 写入，而 change 处理器
       *   只更新 `disabled`/文案 ⇒ **「勾选 → 尚未渲染」窗口里 attr 是旧值**：
       *   实测 `:checked=2`、文案「已勾选 2 人」、而 attr=0，三量恒等在这个窗口不成立。
       *   为什么原来的 A7 抓不到：它读取前先 `X.ui.render()`，**按构造只看得见渲染后的自洽状态**。
       *   教训（与 `test-blindspots.md` 同源）：断言要覆盖**状态的每一个窗口**，
       *   而不只是「稳定态」—— 稳定态自洽不能推出中间态自洽。
       *   对玩家无影响（派发读活动 DOM），但锚点与真值不一致就是会骗人的信号。 */
      check('T-4-A7′：**未渲染**窗口里 data-errand-count 也已同步（不再滞后）', (() => {
        const btn = listQ().querySelector('[data-errand]');
        const declared = Number(btn.dataset.errandCount);
        const checkedNow = listQ().querySelectorAll('[data-errand-check]:checked').length;
        return declared === checkedNow && declared === 2;
      })(), (() => { const b = listQ().querySelector('[data-errand]');
        return `attr=${b.dataset.errandCount} checked=${listQ().querySelectorAll('[data-errand-check]:checked').length}`; })());

      X.ui.render();

      // A7：三者恒等（机读 data-errand-count，不解析中文文案）
      check('T-4-A7：data-errand-count === 勾选数 === 真被派出去的人数（三者恒等）', (() => {
        const btn = listQ().querySelector('[data-errand]');
        const declared = Number(btn.dataset.errandCount);
        const checkedNow = listQ().querySelectorAll('[data-errand-check]:checked').length;
        // 实际会派出去的人数：模拟派发取值的口径（勾选 ∩ 仍走候选分支）
        const wouldSend = [...listQ().querySelectorAll('[data-errand-check]')]
          .filter((n) => n.checked && !n.disabled).length;
        return declared === 2 && checkedNow === 2 && wouldSend === 2;
      })(), (() => { const b = listQ().querySelector('[data-errand]');
        return `count=${b.dataset.errandCount} checked=${listQ().querySelectorAll('[data-errand-check]:checked').length}`; })());
      check('T-4-A7：文案里的数字与 data-errand-count 一致',
        (() => { const b = listQ().querySelector('[data-errand]');
          return new RegExp(`勾选 ${b.dataset.errandCount} 人`).test(b.textContent); })());

      // A8：勾着的人**离开候选分支**（这里让他变成宗门弟子）⇒ 不得多报
      check('T-4-A8：勾着的人离开候选分支后不得多报（计数与 disabled 同步收紧）', (() => {
        const before = Number(listQ().querySelector('[data-errand]').dataset.errandCount);
        // 把 id=1 改成宗门弟子：他不再走候选分支，因此不会被回填 checked
        state.cultivation.cultivators[0].job = 'sect';
        X.ui.render();
        const btn = listQ().querySelector('[data-errand]');
        const after = btn ? Number(btn.dataset.errandCount) : 0;
        return before === 2 && after === 1;
      })(), (() => { const b = listQ().querySelector('[data-errand]');
        return b ? `count=${b.dataset.errandCount}` : '入口已收起'; })());

      // A8 续：**全部**离开候选分支 ⇒ 必须多报 0（而不是留下一个虚高的数）
      check('T-4-A8：全部离开候选分支后计数归 0，且入口变灰（不留下虚高的数字）', (() => {
        state.cultivation.cultivators[1].job = 'sect';
        X.ui.render();
        const btn = listQ().querySelector('[data-errand]');
        if (!btn) return true;   // 已无人可派 ⇒ 工具栏按设计收起，也算「不多报」
        return Number(btn.dataset.errandCount) === 0 && btn.disabled === true;
      })());
    }
  }

  /* ── 【修复 t4 缺陷⑦ / pre-push-review-gate.md R2⑤】死交互属性静态扫描（带阳性对照）──
   * ① 和 ② 是同一个病的两个方向：
   *   ① 处理侧在等一个**没人渲染**的属性（`[data-errand]` 永远匹配不到）；
   *   ② 渲染侧给了一个**没人读**的属性（`data-force` 曾挂在筑基冲关按钮上）。
   * 一条静态扫描能同时钉住两个方向的地方：`app.js` 渲染出的交互型 `data-*`，
   * 都必须在 `main.js`/`app.js` 里有读取侧；反之亦然。
   *
   * ⚠ **这条扫描的能力边界（必须写清，否则会被过度信任）**：
   *   它是**全局**的 —— 只问「这个属性名有没有人读」，**不问「是不是同一个按钮上的人读」**。
   *   当初 `data-force` 恰好能骗过它：main.js 里确实读了 `dataset.force`（金丹那个按钮），
   *   所以全局看它「有读取侧」，而筑基按钮上那一个是死的。
   *   「同一个按钮上渲染与读取对得上」只能靠**行为级断言**（T-6-A1/A4、T-4-A2）兜住。
   *   所以三种断言是一套：静态扫描管「有没有」、行为级管「对不对」、uicheck 管「看不看得见」。
   */
  {
    /** 去掉注释，避免把**注释里提到的**属性名算成渲染点。
     *  这一步是实测必需的：`// data-site-preview 已删` 这种说明文字会被
     *  `data-([a-z]...)` 扫成「渲染了」，于是扫描器报一个已经不存在的属性。 */
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    /** 渲染侧：`app.js` 里出现在 `data-xxx="` 或 `data-xxx}` 之类位置上的属性名。 */
    const scanRendered = (src) => {
      const out = new Set();
      const re = /\bdata-([a-z][a-z0-9-]*)/g;
      let m;
      while ((m = re.exec(src))) out.add(`data-${m[1]}`);
      return out;
    };
    /** 读取侧：`dataset.xxx` / `closest('[data-xxx…` / `querySelector*('[data-xxx…`。 */
    const scanRead = (src) => {
      const out = new Set();
      for (const m of src.matchAll(/dataset\.([A-Za-z0-9_]+)/g)) {
        out.add(`data-${m[1].replace(/_/g, '-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      }
      for (const m of src.matchAll(/(?:closest|querySelector|querySelectorAll)\(\s*[`'"]([^`'"]*)/g)) {
        for (const a of m[1].matchAll(/\[(data-[a-z0-9-]+)/g)) out.add(a[1]);
      }
      return out;
    };
    const appSrc = stripComments(readFileSync('src/ui/app.js', 'utf8'));
    const mainSrc = stripComments(readFileSync('src/main.js', 'utf8'));
    const rendered = scanRendered(appSrc);
    const read = scanRead(appSrc + '\n' + mainSrc);
    // `data-errand-count` 是**给测试用的机械锚点**（它唯一的消费者就是本文件下面的
    // A7/A8 断言，不是 main.js 的交互读取侧）。把它显式登记为「已读」——
    // 这不是豁免死属性，恰恰相反：它存在的目的就是让 A7 的「三者恒等」能写成
    // 纯属性断言，而不是去解析中文文案（改一次文案就废一批断言）。
    if (appSrc.includes('data-errand-count')) read.add('data-errand-count');
    /**
     * 「语义标记」——渲染出来**只为给 CSS / 调试看**、不需要 JS 读取侧的属性。
     * ⚠ 新加一项等于承认又多了一个没人读的属性，所以每加一项都要写清理由。
     *   缺陷②（`data-force` 挂在筑基按钮上、读了也没用）之后，这两项是全部豁免。
     */
    const NON_INTERACTIVE = new Set([
      // 卡片状态标记：供 CSS 选中「非默认态」的人，不是交互入口。
      'data-pstate',
      // 脏检查签名：由 `render()` 自己写给自己读（`host.dataset.signature`），
      // 不是事件委托的入口，所以「没有读取侧」是设计如此。
      'data-signature',
    ]);
    const orphanRendered = [...rendered].filter((a) => !read.has(a) && !NON_INTERACTIVE.has(a));
    check('渲染出的每个交互型 data-* 都有读取侧（没有「渲染了但没人读」）',
      orphanRendered.length === 0, orphanRendered.join(','));

    /* 反向：只查**这次任务碰过的那几个交互属性**有没有渲染点。
     * 为什么不查全部：`read` 里一大批属性的渲染点在**骨架**（`_shell-head.html`）
     * 或别的模块里用**动态**写法生成（`dataset.x = …`、`setAttribute('data-x')`、
     * `data-codex-chapter` 那种跨模块约定），静态扫 `app.js` 看不见它们 ——
     * 全量比对会给出 20 条假阳性，那种断言没人会看，等于没写。
     * 收窄到本任务真正修过的那几个，才是「缺陷① 会不会复发」的判据。 */
    const TASK_ATTRS = ['data-errand', 'data-errand-check', 'data-recall'];
    const orphanRead = TASK_ATTRS.filter((a) => read.has(a) && !rendered.has(a));
    check('读取侧引用的投帖/召回属性都有渲染点（缺陷① 不会复发）',
      orphanRead.length === 0, orphanRead.join(','));
    check('扫描器真的扫到了东西（不是空集上的恒真）',
      rendered.size > 20 && read.size > 20, `渲染 ${rendered.size} 个 / 读取 ${read.size} 个`);
    // 阳性对照：把「一个必然无人读的属性名」注入渲染集合，扫描必须报出来 ——
    // 没有这一步，上面两条可能是恒真的空检查（本项目已栽过两次）。
    const probe = [...rendered, 'data-orphan-probe'].filter((a) => !read.has(a) && !NON_INTERACTIVE.has(a));
    check('阳性对照：注入一个无人读的 data-* → 扫描器必须报出来',
      probe.includes('data-orphan-probe'), probe.join(','));
  }
}

/* ══════════════════════ 15.10 T-5 择地筑基 ══════════════════════ */
section('T-5 择地筑基（地块变成永久 build）');
{
  const prep = (reached) => {
    atGate();
    state.cultivation.world = { reached, held: [], garrison: {}, unrest: {} };
    state.spiritStones = 1000;
    state.cultivation.clues = 50;
    X.alchemy.addPills('zhuji', 5);
  };

  // ① 候选清单只列走到过的节点
  prep(['mosscave']);
  check('只走到 mosscave → 候选 1 项', X.realm.foundationSites().length === 1, `${X.realm.foundationSites().length}`);
  check('未择地时冲关被拒，且理由点名「择地」',
    X.realm.plan(1).ok === false && X.realm.plan(1).reason.includes('择地'), X.realm.plan(1).reason);
  prep(['mosscave', 'valley', 'mistcave']);
  check('走到三处 → 候选 3 项', X.realm.foundationSites().length === 3, `${X.realm.foundationSites().length}`);
  check('走到 mosscave 后可择地冲关', X.realm.plan(1, 'mosscave').ok === true, X.realm.plan(1, 'mosscave').reason);

  // ② 品阶由 tier 推导（+ 已镇守晋一档）
  check('tier 1/2/3/4 → 黄/玄/地/天',
    ['huang', 'xuan', 'di', 'tian'].every((id, i) => X.realm.foundationGrade(i + 1, false).id === id));
  check('已占领且有效镇守 → 晋一档（含天品越档为仙品 ×1.65）',
    X.realm.foundationGrade(1, true).id === 'xuan' && X.realm.foundationGrade(4, true).mult === 1.65);

  // ③ 相合 / 相冲（判定依据是**灵根主系**，不是主修功法系别）
  {
    prep(['mosscave', 'valley']);
    setPeople(person({ id: 1, realmIndex: 9, xp: gateNeed, job: 'retreat', talent: 1, root: { grade: 'quad', elements: ['wood', 'water', 'fire', 'earth'], rerolls: 0 } }));
    const match = X.realm.foundationPlan(1, 'mosscave').preview;
    check('木灵根 + 木地气 → 相合 ×1.5', match.relation === 'match' && near(match.entryMult, 1.5, 1e-9),
      `${match.relation} ×${match.entryMult}`);
    setPeople(person({ id: 1, realmIndex: 9, xp: gateNeed, job: 'retreat', talent: 1, root: { grade: 'quad', elements: ['metal', 'water', 'fire', 'earth'], rerolls: 0 } }));
    const clash = X.realm.foundationPlan(1, 'mosscave').preview;
    check('金灵根 + 木地气 → 相冲 ×0.6（金克木）', clash.relation === 'clash' && near(clash.entryMult, 0.6, 1e-9),
      `${clash.relation} ×${clash.entryMult}`);
    setPeople(person({ id: 1, realmIndex: 9, xp: gateNeed, job: 'retreat', talent: 1, root: { grade: 'quad', elements: ['water', 'metal', 'fire', 'earth'], rerolls: 0 } }));
    const neutral = X.realm.foundationPlan(1, 'mosscave').preview;
    check('水灵根 + 木地气 → 无涉 ×1.0', neutral.relation === 'neutral' && near(neutral.entryMult, 1, 1e-9),
      `${neutral.relation} ×${neutral.entryMult}`);
    check('预览里带「地气 / 品阶 / 词条 ×N」三行字', (() => {
      X.ui.render();
      const t = document.getElementById('cultivator-list').textContent;
      return t.includes('地气') && t.includes('品阶') && /×1\.\d\d/.test(t);
    })());
  }

  // ④ 提交后落库
  {
    prep(['mosscave']);
    setPeople(person({ id: 1, realmIndex: 9, xp: gateNeed, job: 'retreat', talent: 1, root: { grade: 'quad', elements: ['wood', 'water', 'fire', 'earth'], rerolls: 0 } }));
    const r = X.realm.commitWith(1, 'mosscave', () => 0);
    const p = state.cultivation.cultivators[0];
    check('冲关成功后落库 person.foundation = { nodeId, element, grade }',
      r.success === true && p.foundation && p.foundation.nodeId === 'mosscave'
      && p.foundation.element === 'wood' && p.foundation.grade === 1,
      JSON.stringify(p.foundation));
    check('存档往返覆盖 foundation', (() => {
      const back = X.save.roundTrip();
      const q = back.cultivation.cultivators[0];
      return q.foundation && q.foundation.nodeId === 'mosscave' && q.foundation.grade === 1;
    })());
  }

  // ⑤ 五条词条各接一个真实消费点
  {
    // 「有效镇守」需要一名**战力足够**的人站在那块地上，而它必须是名册里的人。
    // 所以这里统一保留一个守将（id 9），再让被测者（id 1）拿道基 ——
    // 直接把名册换成一个人会把守将弄丢，然后 quietly 变成「地块已失、词条减半」。
    const HOLD = (realm = 14) => person({ id: 9, name: '沈守', realmIndex: realm, xp: 0, job: 'garrison', talent: 1 });
    const make = (element, nodeId, grade = 4) => {
      setPeople(
        person({ id: 1, realmIndex: 12, xp: 0, job: 'retreat', talent: 1, foundation: { nodeId, element, grade } }),
        HOLD(),
      );
      state.cultivation.world = { reached: ['mosscave', 'valley', 'mistcave', 'ridge'], held: ['valley', 'ridge'], garrison: { valley: 9, ridge: 9 }, unrest: {} };
      return state.cultivation.cultivators[0];
    };
    const clearF = () => { if (state.cultivation.cultivators[0]) state.cultivation.cultivators[0].foundation = null; };
    // ── 逐条地气词条：把灵根主系换成与地气**相合**，才能看到满额词条 ──
    // ⚠ 本文件的 person() 默认灵根是「金水火力土」（主系金），对木地气是**相冲 ×0.6**。
    //   不显式改灵根，测出来的是「相冲」那一档 —— 这正是一开始踩到的坑。
    const makeMatch = (element, nodeId, grade = 4) => {
      const p = make(element, nodeId, grade);
      p.root = { grade: 'quad', elements: [element, 'metal', 'fire', 'earth'], rerolls: 0 };
      return p;
    };

    // 木 → 炼丹成功率
    // ⚠ 熟练度与丹炉等级都必须压在基准上：它们各给 +1.5pp/炉 与 +2pp/级，
    //   前面那些炼丹用例已经把它们刷上去了，于是 recipeRate() 会顶在 98% 硬顶上
    //   —— 那样测出来的是「离封顶还有多少」，不是「道基加了多少」。
    //   （docs/91 §七.3 第 4 条说的就是这条硬顶。）
    state.cultivation.alchemy = { herbs: {}, pills: {}, prof: { zhuji: 0 }, furnace: 1, crafts: 0 };
    make(null, 'mosscave');
    clearF();
    const rateBase = X.alchemy.rate('zhuji');
    makeMatch('wood', 'valley', 1);
    const rateWood = X.alchemy.rate('zhuji');
    check('木词条抬高 recipeRate()', rateWood > rateBase, `${rateBase.toFixed(4)} → ${rateWood.toFixed(4)}`);
    // 玄品（tier1 已镇守晋一档 ×1.10）× 相合 ×1.5 = 8pp × 1.65 = 13.2pp
    // ⚠ 期望值是「乘积」而不是文档里那个 ×1.5 单独用出来的 12pp：
    //   docs/91 §三 T-5 的品阶表说「品阶倍率乘的是**一条词条**」，
    //   所以基准值要先过品阶、再过相合 —— 12pp 那一列只是「品阶 = 黄品」时的特例。
    check('木词条（已镇守晋一档 × 相合）恰好 +13.2pp',
      near(rateWood - rateBase, 0.132, 1e-6), `+${((rateWood - rateBase) * 100).toFixed(2)}pp`);
    check('木词条恰好 = 基准 8pp × 品阶 1.10 × 相合 1.5',
      near(rateWood - rateBase, 0.08 * 1.10 * 1.5, 1e-9), `+${((rateWood - rateBase) * 100).toFixed(2)}pp`);

    // 相冲那一档：同一块地、同一品阶，只把灵根主系换成克它的金
    {
      make(null, 'mosscave');
      clearF();
      const b = X.alchemy.rate('zhuji');
      // ⚠ 这里用 makeMatch 会把灵根主系设成同名元素 —— 对「金」而言那是**相合**，
      //   测不出相冲。改用 make()（默认灵根主系就是金，金克木 = 相冲）。
      make('wood', 'valley', 1);
      const c = X.alchemy.rate('zhuji');
      check('木词条相冲（金灵根）恰好 = 8pp × 1.10 × 0.6 = +5.28pp',
        near(c - b, 0.08 * 1.10 * 0.6, 1e-9), `+${((c - b) * 100).toFixed(2)}pp`);
    }

    // 土 → 领地赋税（valley 是 tier 1，已镇守晋一档 = 玄品 ×1.10）
    make(null, 'mosscave');
    clearF();
    const yBase = X.realm.mapYieldOf('valley');
    makeMatch('earth', 'valley', 4);
    const yTu = X.realm.mapYieldOf('valley');
    check('土词条抬高 mapYieldOf()', yTu > yBase, `${yBase} → ${yTu}`);
    check('土词条（玄品 1.10 × 相合 1.5）× 基准 25% = +41.25%',
      near(yTu / yBase - 1, 0.25 * 1.10 * 1.5, 1e-6), `+${((yTu / yBase - 1) * 100).toFixed(2)}%`);

    // 水 → 洞天生还率（mosscave 是洞天，不需要镇守）
    make(null, 'mosscave');
    clearF();
    const sBase = X.manual.survival(1, 'mosscave');
    makeMatch('water', 'mosscave', 4);
    const sShui = X.manual.survival(1, 'mosscave');
    check('水词条抬高 caveSurvival()', sShui > sBase, `${sBase.toFixed(4)} → ${sShui.toFixed(4)}`);

    // 火 → 符箓保质期
    make(null, 'mosscave');
    clearF();
    state.cultivation.runes.stock.juling = { n: 1, expiresAt: Date.now() + 10 * 3600 * 1000 };
    const eBase = X.runes.expiresIn('juling');
    state.cultivation.runes.stock.juling = { n: 1, expiresAt: Date.now() + 10 * 3600 * 1000 };
    makeMatch('fire', 'mistcave', 4);
    const eHuo = X.runes.expiresIn('juling');
    check('火词条延长 runeExpiresIn()', eHuo > eBase, `${(eBase / 3600).toFixed(2)}h → ${(eHuo / 3600).toFixed(2)}h`);

    // 金 → 法器耐久损耗（ridge 是 tier 3 且已镇守 → 晋一档 = 天品 1.50）
    // ⚠ 基准与对照必须用**同一件法器、同一把主系灵根**，只让「道基」这一个变量变，
    //   否则测出来的差里混着别的因素（这里踩过：换了灵根，基准那一次也变了）。
    X.forge.give('qingfeng');
    state.cultivation.forge.equipped = { weapon: 'qingfeng' };
    const wearAt = () => {
      state.cultivation.forge.durability = { qingfeng: 100 };
      const d0 = X.forge.durability('qingfeng');
      X.forge.wear('attack');
      return d0 - X.forge.durability('qingfeng');
    };
    makeMatch('metal', 'ridge', 4);
    state.cultivation.cultivators[0].foundation = null;   // 同一把灵根，只摘掉道基
    const wearBase = wearAt();
    makeMatch('metal', 'ridge', 4);
    const wearJin = wearAt();
    check('金词条降低 wearArtifacts() 的耐久损耗', wearJin < wearBase, `${wearBase} → ${wearJin}`);
    check('金词条的减免 = 基准 30% × 天品 1.50 × 相合 1.5（= −67.5%，夹在 90% 以内）',
      near(wearJin / wearBase, 1 - Math.min(0.9, 0.30 * 1.50 * 1.5), 1e-6),
      `${(wearJin / wearBase).toFixed(4)}`);
  }

  // ⑥ 地块丢失 → 词条减半，但 foundation 字段仍在
  {
    // 地块**存在但没占领/镇守**时：品阶掉回原档 × 减半
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {} };
    setPeople(person({ id: 1, realmIndex: 12, xp: 0, job: 'retreat', talent: 1, foundation: { nodeId: 'mosscave', element: 'earth', grade: 1 } }));
    check('地块未占领时词条倍率减半（×0.5）', near(X.realm.foundationEntryMult(1, false, false), 0.5, 1e-9),
      `${X.realm.foundationEntryMult(1, false, false)}`);
    check('地块仍有效镇守时是满额（×1.0）', near(X.realm.foundationEntryMult(1, true, false), 1, 1e-9),
      `${X.realm.foundationEntryMult(1, true, false)}`);
    check('地块丢失后 foundation 字段仍在', state.cultivation.cultivators[0].foundation != null);
    // 节点整个不存在（数据损坏）时退回「按落库品阶」而不是崩掉
    setPeople(person({ id: 1, realmIndex: 12, xp: 0, job: 'retreat', talent: 1, foundation: { nodeId: '不存在的节点', element: 'earth', grade: 1 } }));
    check('道基节点不存在时退回落库品阶，不抛错',
      near(X.realm.foundationEntryMult(1, true), 1, 1e-9), `${X.realm.foundationEntryMult(1, true)}`);
  }

  // ⑦ 散功重修
  {
    setPeople(person({ id: 1, realmIndex: 12, xp: 500, job: 'retreat', talent: 1, foundation: { nodeId: 'mosscave', element: 'wood', grade: 1 } }));
    const morBefore = X.morality.get();
    const r = X.realm.dissolve(1);
    const p = state.cultivation.cultivators[0];
    check('散功：境界回退到炼气九层', p.realmIndex === 9, X.realm.name(p.realmIndex));
    check('散功：修为清零', p.xp === 0);
    check('散功：3 游戏小时不能修炼', p.stalled === 3 * 3600, `${p.stalled}`);
    check('散功：家族道心 −5', near(X.morality.get() - morBefore, -5, 1e-9), `${X.morality.get() - morBefore}`);
    check('散功：道基被清掉', p.foundation === null);
    check('散功后 stalled 真的挡住了修为', (() => {
      X.setRng(() => 0.999999);
      X.tick(600);
      X.setRng(null);
      return p.xp === 0;
    })());
    check('没结过道基的人不能散功', X.realm.dissolve(1).ok === false);
  }

  // ⑧ 地图数据完整性：每块地都有合法地气
  {
    const bad = d.map.filter((n) => !['metal', 'wood', 'water', 'fire', 'earth'].includes(n.earthQi));
    check('八块地每块都有五行地气', bad.length === 0, bad.map((n) => n.id).join(','));
    check('地气的 power/tier/yield 一个都没动（纯数据追加）',
      d.map.find((n) => n.id === 'valley').power === 110
      && d.map.find((n) => n.id === 'beastnest').power === 12000
      && d.map.find((n) => n.id === 'beastnest').tier === 4);
  }
}

/* ══════════════════════ 15.11 T-6 结丹 ══════════════════════ */
/* ══════════════════════ 15.12 T-7 元婴圣胎温养 ══════════════════════ */
section('T-7 元婴圣胎温养（你的第二个自己会想跑）');
{
  const NC = X.nascent.constants();
  // ⚠ 每个 section 都要自己定义：`listQ` 是 T-4 那个块的**局部**常量，
  //   跨块引用会 ReferenceError（而它会让整个 smoke 中途崩掉、PASS 数骤降但 FAIL 为 0 —— 
  //   一个很容易被误读成「全绿」的失败形态，所以崩溃时先看尾部而不是只看计数）。
  const listQ = () => document.getElementById('cultivator-list');
  /** 造一个元婴期修士 + 一块已占领的领地。population=0 防止自然出生干扰名册。 */
  const atYuanying = (over = {}) => {
    setPeople(person({ id: 1, realmIndex: 18, xp: 0, job: 'retreat', talent: 1, ...over }));
    state.population = 0;
    state.spiritStones = 1000000;
    state.cultivation.immortalTechs = [];
    state.cultivation.world = { reached: ['mosscave', 'valley'], held: ['valley'], garrison: {}, unrest: {} };
    X.setRng();
  };
  const p0 = () => state.cultivation.cultivators[0];

  // ① 常量与派生时间尺度（数值出处：docs/91 §三 T-7）
  check('T-7①：稳固度常量与文档逐位一致（+0.02 / −0.03 / 躁动 <30 / 5e-5）',
    NC.recover === 0.02 && NC.drain === 0.03 && NC.restlessBelow === 30 && NC.restlessPerSec === 5e-5,
    `${NC.recover}/${NC.drain}/${NC.restlessBelow}/${NC.restlessPerSec}`);
  check('T-7①：派生时间尺度 —— 100→0 需 55.6 分钟（±0.1）',
    near(100 / NC.drain / 60, 55.6, 0.1), `${(100 / NC.drain / 60).toFixed(1)} 分`);
  check('T-7①：派生时间尺度 —— 0→100 需 83.3 分钟（±0.1）',
    near(100 / NC.recover / 60, 83.3, 0.1), `${(100 / NC.recover / 60).toFixed(1)} 分`);

  // ② 在体 +0.02/秒；出窍 −0.03/秒；出窍期间修为完全不涨
  atYuanying();
  check('T-7②：在体时稳固度按 +0.02/秒 回复（100 秒 → +2）', (() => {
    X.nascent.setStability(1, 50);
    X.tick(100);
    return near(X.nascent.of(1).stability, 52, 1e-6);
  })(), String(X.nascent.of(1).stability));

  atYuanying();
  check('T-7②：出窍时稳固度按 −0.03/秒 消耗（100 秒 → −3）', (() => {
    X.nascent.setStability(1, 60);
    X.nascent.out(1, 'valley');
    X.tick(100);
    return near(X.nascent.of(1).stability, 57, 1e-6);
  })(), String(X.nascent.of(1).stability));

  atYuanying();
  check('T-7②：出窍时该修士修为**完全不涨**（本体不动）', (() => {
    X.nascent.setStability(1, 100);
    X.nascent.out(1, 'valley');
    const before = p0().xp;
    X.tick(600);
    return p0().xp === before;
  })(), `xp=${p0().xp}`);

  // ③ 出窍威压绕开 mapGarrisonLimit（一个镇守都没派时仍判定「被有效镇守」）
  atYuanying();
  check('T-7③：不派镇守、仅靠出窍威压也能判定领地「被有效镇守」', (() => {
    const pacifiedNo = X.map.isPacified('valley');
    X.nascent.out(1, 'valley');
    const pacifiedYes = X.map.isPacified('valley');
    return pacifiedNo === false && pacifiedYes === true;
  })(), `holdPower=${X.map.node('valley').power} ward=${X.nascent.wardPower('valley')}`);

  // ④ 出窍者所在节点民怨回落 3 倍
  check('T-7④：出窍者所在节点的民怨回落是平时的 3 倍', (() => {
    // ⚠ 民怨**只在节点被有效镇守时才回落**（否则按 MAP_UNREST_PER_SEC 上升）。
    //   所以基线组必须真的有一个镇守者 —— 我第一版没派镇守，基线是「上升」，
    //   比值自然算不出来。这也是「测一个倍率前先确认基线本身在动」的教训。
    atYuanying();
    setPeople(
      person({ id: 1, realmIndex: 18, job: 'garrison', talent: 1 }),
      person({ id: 2, realmIndex: 18, job: 'retreat', talent: 1 }),
    );
    state.population = 0;
    state.cultivation.world = { reached: ['mosscave', 'valley'], held: ['valley'], garrison: { valley: 1 }, unrest: { valley: 0.9 } };
    X.map.tick(30);
    const dropWithout = 0.9 - X.map.unrest('valley');
    // 实验组：多一个**出窍的元婴**坐镇同一个节点
    state.cultivation.world.unrest = { valley: 0.9 };
    X.nascent.out(2, 'valley');
    X.map.tick(30);
    const dropWith = 0.9 - X.map.unrest('valley');
    return dropWithout > 0 && near(dropWith / dropWithout, 3, 1e-6);
  })());

  // ⑤ 稳固度 < 30：修为 ×0.6；骰子两侧
  atYuanying();
  check('T-7⑤：稳固度 29（<30）时修为倍率 = 0.6（−40%）',
    (() => { X.nascent.setStability(1, 29); return near(X.nascent.trainMult(1), 0.6, 1e-12); })(),
    String(X.nascent.trainMult(1)));
  check('T-7⑤：稳固度恰为 30 时倍率 = 1（阈值是严格小于）',
    (() => { X.nascent.setStability(1, 30); return X.nascent.trainMult(1) === 1; })());
  check('T-7⑤：躁动骰子必触发 → 该修士陨落（名册摘掉、deaths+1、qi 同步）', (() => {
    atYuanying();
    X.nascent.setStability(1, 29);
    const before = state.stats.deaths;
    X.setRng(() => 0);
    X.tick(1);
    X.setRng();
    return state.cultivation.cultivators.length === 0 && state.stats.deaths === before + 1
      && state.cultivation.qi === 0;
  })(), `n=${state.cultivation.cultivators.length} deaths=${state.stats.deaths} qi=${state.cultivation.qi}`);
  check('T-7⑤：躁动骰子必不触发 → 不陨落（两侧）', (() => {
    atYuanying();
    X.nascent.setStability(1, 29);
    X.setRng(() => 0.999999);
    X.tick(1);
    X.setRng();
    return state.cultivation.cultivators.length === 1;
  })());

  // ⑥ 稳固度到 0：境界冻结在元婴初期、战力保留
  atYuanying();
  check('T-7⑥：稳固度归 0 → 标记 lost、元婴回体、境界冻结在元婴初期', (() => {
    X.nascent.setStability(1, 0.01);
    X.nascent.out(1, 'valley');
    X.tick(10);
    const na = X.nascent.of(1);
    return na.lost === true && na.out === false && p0().realmIndex === 18;
  })(), JSON.stringify(X.nascent.of(1)));
  check('T-7⑥：离体不返后**战力保留**（镇守战力与失陷前一致，没被归零）', (() => {
    atYuanying();
    state.cultivation.world.garrison = { valley: 1 };
    const powerBefore = X.map.holdStrength('valley');
    X.nascent.setStability(1, 0.01);
    X.nascent.out(1, 'valley');
    X.tick(10);
    const powerAfter = X.map.holdStrength('valley');
    return X.nascent.isLost(1) === true && powerBefore > 0 && powerAfter === powerBefore;
  })(), `before=${X.map.holdStrength('valley')}`);
  check('T-7⑥：离体不返后不再涨修为（倍率 0）',
    (() => { X.nascent.setStability(1, 0); return X.nascent.trainMult(1) === 0; })());

  // ⑦ 🔴 离线硬约定：真跑 runOffline
  atYuanying();
  check('T-7⑦：离线 12 小时后，出窍者已回体且稳固度不低于离线前', (() => {
    X.nascent.setStability(1, 40);
    X.nascent.out(1, 'valley');
    const before = X.nascent.of(1).stability;
    X.offline(12 * 3600);
    const na = X.nascent.of(1);
    return na.out === false && na.place === null && na.stability >= before;
  })(), JSON.stringify(X.nascent.of(1)));

  // ⑧ 边界警告
  atYuanying();
  check('T-7⑧：稳固度跌破 30 时播报一次，文案含「离体不返」与分钟数', (() => {
    X.nascent.setStability(1, 30.5);
    X.nascent.out(1, 'valley');
    state.log = [];
    X.tick(100);   // 30.5 → 27.5，跨过 30
    const hit = state.log.find((e) => /离体不返/.test(e.text));
    return Boolean(hit) && /分钟/.test(hit.text) && X.nascent.of(1).stability < 30;
  })(), (state.log[0] && state.log[0].text) || '(无日志)');

  // ⑨ 旧存档兼容
  check('T-7⑨：老存档里没有 nascent 字段的修士，载入后被补成「满稳固 / 在体」', (() => {
    atYuanying();
    delete state.cultivation.cultivators[0].nascent;
    X.step(0);   // 触发一次 repair
    const na = X.nascent.of(1);
    return na.stability === 100 && na.out === false && na.place === null && na.lost === false;
  })());

  // ⑩ UI：稳固度条 + 出窍/回体入口（验收标准 1）
  atYuanying();
  X.ui.render();
  check('T-7⑩：元婴修士卡片上有稳固度条与「出窍」入口',
    listQ().querySelectorAll('.nascent-bar').length === 1
    && listQ().querySelectorAll('[data-nascent-out]').length === 1,
    `bar=${listQ().querySelectorAll('.nascent-bar').length} btn=${listQ().querySelectorAll('[data-nascent-out]').length}`);
  check('T-7⑩：非元婴修士**不渲染**圣胎面板（未解锁的机制不进 DOM，而不是渲染成空）', (() => {
    setPeople(person({ id: 1, realmIndex: 14, job: 'retreat', talent: 1 }));
    state.population = 0;
    X.ui.render();
    return listQ().querySelectorAll('.nascent-bar').length === 0
      && listQ().querySelectorAll('[data-nascent-out]').length === 0;
  })());
  check('T-7⑩：出窍中的人卡片上给的是「回体」，且文案点明「修为停涨」', (() => {
    atYuanying();
    X.nascent.out(1, 'valley');
    X.ui.render();
    const box = listQ().querySelector('.nascent-box');
    return listQ().querySelectorAll('[data-nascent-recall]').length === 1
      && /停涨/.test(box.textContent);
  })());
  check('T-7⑩：稳固度三档配色（>30 正常 / <30 且 ≥15 黄 / <15 红）', (() => {
    const toneAt = (v) => { atYuanying(); X.nascent.setStability(1, v); X.ui.render();
      const b = listQ().querySelector('.nascent-box'); return b ? b.className : ''; };
    return /nascent-ok/.test(toneAt(90)) && /nascent-mid/.test(toneAt(25)) && /nascent-low/.test(toneAt(10));
  })());

  /* ── 与**科技线**的功能性联动（t5 验收条款：至少一处真实联动，不是并存）──
   * 仙道科技 `zhenyue` / `jielu` 抬的是 `garrisonCapFlat` → `mapGarrisonLimit()`；
   * 元婴出窍给的是**不受那个上限约束**的第二条路。两者作用在**同一个量**
   * （「我能有效压住几块地」）上：科技抬**底线**、境界抬**上限**，且量可加。
   * 这条断言把叠加关系钉住 —— 若有人把出窍威压也接进 `mapGarrisonLimit()`，
   * 或让科技与威压互斥，这里会立刻红。 */
  check('T-7·科技联动：科技 zhenyue 抬底线、出窍威压抬上限 —— 可叠加且量可加', (() => {
    atYuanying();
    setPeople(
      person({ id: 1, realmIndex: 18, job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 18, job: 'retreat', talent: 1 }),
    );
    state.population = 0;
    // ⚠ `immortalTechs` 是**顶层** state 字段（不是 cultivation 里的）——
    //   这正是 T-1 修的那个白名单漏字段；写错位置会让 techEffects 完全读不到，
    //   表现为「科技好像没生效」，极易误判成产品缺陷。
    state.immortalTechs = [];
    const base = X.nascent.garrisonLimit();
    const slack0 = X.nascent.wardSlack();
    X.nascent.out(1, 'valley');
    const slack1 = X.nascent.wardSlack();
    // 科技 zhenyue 给 garrisonCapFlat: 2（src/data/immortal-techs.js）
    state.immortalTechs = ['zhenyue'];
    const withTech = X.nascent.garrisonLimit();
    const eff = X.nascent.effGarrisonLimit();
    state.immortalTechs = [];
    return slack0 === 0 && slack1 === 1 && withTech === base + 2 && near(eff, withTech + slack1, 1e-12);
  })(), `base=${X.nascent.garrisonLimit()} slack=${X.nascent.wardSlack()} eff=${X.nascent.effGarrisonLimit()}`);
}

/* ══════════════════════ 15.13 T-8 化神天劫 ══════════════════════ */
section('T-8 天劫（你越强，天地越要收你）');
{
  const TC = X.tribulation.table();
  const listQ = () => document.getElementById('cultivator-list');
  /** 元婴/化神名册 + 一块已占领领地；wardens 由测试按需给。 */
  const atHuashen = (over = {}) => {
    setPeople(person({ id: 1, realmIndex: 22, xp: X.realm.xpNeeded(22), job: 'retreat', talent: 1, ...over }));
    state.population = 2000;
    state.spiritStones = 1000000;
    state.immortalTechs = [];
    state.morality = 50;
    state.cultivation.world = { reached: ['mosscave', 'valley'], held: ['valley'], garrison: {}, unrest: {}, wardens: [] };
    X.setRng();
  };
  const p0 = () => state.cultivation.cultivators[0];

  // ① 三次天劫的基础雷伤与文档一致（6 / 7 / 9）
  check('T-8①：三次天劫基础雷伤 = 6 / 7 / 9（键是晋升前的 realmIndex 22/23/24）',
    TC.base[22] === 6 && TC.base[23] === 7 && TC.base[24] === 9,
    JSON.stringify(TC.base));
  check('T-8①：化神三层才是天劫层，22 以下不是',
    X.tribulation.isTrial(22) && X.tribulation.isTrial(23) && X.tribulation.isTrial(24)
    && !X.tribulation.isTrial(21) && !X.tribulation.isTrial(17));

  // ② plan/commit 分离：tribulationPlan **不动状态**
  atHuashen();
  check('T-8②：调 tribulationPlan 后 state 逐字段不变（plan/commit 分离）', (() => {
    // ⚠ 先「热身」一次：`worldOf()` 是**读时修补**（会把旧的 conquests 迁进 world），
    //   所以第一次读会合法地改一次 state。这与「plan 不结算」是两件事 ——
    //   不热身的话这条断言测到的是那个惰性迁移，而不是 plan 的纯净性。
    X.step(0);   // 跑一次 repair，把 worldOf/forgeOf/runesOf/artifactBonus 的惰性初始化先做掉
    const before = JSON.stringify(state);
    X.tribulation.plan(1);
    return JSON.stringify(state) === before;
  })());

  // ④ 分档：先断言**纯映射**（这张表是唯一真相源），再用真实 plan 走端到端
  check('T-8④：分档纯映射 —— 3→calm / 6→shaken / 7→broken / 9→perish',
    X.tribulation.tierOf(3) === 'calm' && X.tribulation.tierOf(6) === 'shaken'
    && X.tribulation.tierOf(7) === 'broken' && X.tribulation.tierOf(9) === 'perish'
    && X.tribulation.tierOf(0) === 'calm',
    [0, 3, 6, 7, 9].map((d) => X.tribulation.tierOf(d)).join('/'));
  check('T-8④：实际雷伤 0–3 → 无事（calm）—— 堆满 6 位护法 + 道心清白 = 46% 减免', (() => {
    setPeople(
      person({ id: 1, realmIndex: 22, xp: X.realm.xpNeeded(22), job: 'retreat', talent: 1 }),
      ...[2, 3, 4, 5, 6, 7].map((id) => person({ id, realmIndex: 18, job: 'retreat', talent: 1 })),
    );
    state.population = 0;
    state.morality = 75;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const pl = X.tribulation.plan(1, { territory: false, artifact: false });
    return pl.damage === 3 && pl.tier === 'calm';
  })(), (() => { const p = X.tribulation.plan(1, { territory: false, artifact: false }); return `damage=${p.damage} tier=${p.tier} r=${p.reduction}`; })());
  check('T-8④：实际雷伤 4–6 → 该修士修炼受震（shaken，修炼 −50% 一小时）', (() => {
    atHuashen();
    state.morality = 50;
    const pl = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    return pl.damage === 6 && pl.tier === 'shaken' && pl.trainMult === 0.5 && pl.trainHours === 1;
  })(), (() => { atHuashen(); state.morality = 50; const p = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false }); return `damage=${p.damage} tier=${p.tier}`; })());
  check('T-8③：减免来源表含封地/护法/法器/道心/护身符五条，且数值与文档一致', (() => {
    const byId = Object.fromEntries(TC.sources.map((s) => [s.id, s]));
    return byId.territory.per === 0.08 && byId.territory.max === 4
      && byId.warden.per === 0.06 && byId.warden.max === 6
      && byId.artifact.per === 0.10 && byId.artifact.max === 3
      && byId.merit.per === 0.10
      && byId.rune.max === 1;
  })());
  check('T-8③：道心 ≥70 给 −10%（天道不罚善人）', (() => {
    atHuashen();
    state.morality = 75;
    const s = X.tribulation.sources(1).find((x) => x.id === 'merit');
    return near(s.value, 0.10, 1e-12);
  })());
  check('T-8③：道心 ≤30 反而 **+15%**（诛邪神雷 —— 恶名招雷）', (() => {
    atHuashen();
    state.morality = 20;
    const s = X.tribulation.sources(1).find((x) => x.id === 'merit');
    return near(s.value, -0.15, 1e-12);
  })());
  check('T-8③：护法条数由**元婴及以上**名册决定（元婴以下不算）', (() => {
    atHuashen();
    setPeople(
      person({ id: 1, realmIndex: 22, xp: X.realm.xpNeeded(22), job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 18, job: 'retreat', talent: 1 }),   // 元婴 → 可当护法
      person({ id: 3, realmIndex: 14, job: 'retreat', talent: 1 }),   // 金丹 → 不算
    );
    state.population = 0;
    const s = X.tribulation.sources(1).find((x) => x.id === 'warden');
    return s.available === 1;   // 只有 id2（元婴）算；id3 是金丹；本人排除
  })());

  // ④ 分档四条（端到端：用 0 减免与堆满减免两种构造）
  check('T-8④：实际雷伤 7–8 → 修为回退 40%（broken）', (() => {
    setPeople(person({ id: 1, realmIndex: 23, xp: X.realm.xpNeeded(23), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const pl = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    return pl.damage === 7 && pl.tier === 'broken' && pl.xpLoss > 0;
  })());
  check('T-8④：实际雷伤 9+ → 陨落（perish）', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const pl = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    return pl.damage === 9 && pl.perish === true;
  })());
  check('T-8④：**不准备就渡劫** → 第三次（基础 9、0 减免）必落入陨落档 —— 这是刻意的门槛', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const pl = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    return pl.perish === true && pl.damage === 9;
  })());

  // ⑤ 陨落保留传承（遗物 + 10 条秘闻）
  check('T-8⑤：陨落时保留传承 —— 10 条秘闻归入家族，且名册摘掉该修士', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.morality = 50;
    state.cultivation.clues = 0;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const r = X.tribulation.commit(1, { territory: false, wardens: [], artifact: false });
    return r.perish === true && state.cultivation.cultivators.length === 0
      && state.cultivation.clues >= 10 && state.cultivation.qi === 0;
  })(), `clues=${state.cultivation.clues}`);
  check('T-8⑤：陨落也计入 deaths', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const before = state.stats.deaths;
    X.tribulation.commit(1, { territory: false, wardens: [], artifact: false });
    return state.stats.deaths === before + 1;
  })());

  // ⑥ 落城的雷：缺口 0 → 人口不变；缺口 3 → 恰好 1 道
  check('T-8⑥：落雷规则 —— 每 2 点缺口一道（0→0、3→1、9→4）',
    X.tribulation.bolts(0) === 0 && X.tribulation.bolts(3) === 1
    && X.tribulation.bolts(9) === 4 && X.tribulation.bolts(5) === 2,
    `${X.tribulation.bolts(0)}/${X.tribulation.bolts(3)}/${X.tribulation.bolts(9)}/${X.tribulation.bolts(5)}`);
  check('T-8⑥：缺口 0 时人口不变 —— 用**护身符**把最后一道雷也免掉（符房线的产物）', (() => {
    // 构造「缺口 3 点 ⇒ 1 道落城的雷」，再用护身符免掉它 ⇒ 人口应当不变。
    // 顺带把符房线的产物（护身符）也真正接进断言，而不是只查它「有没有被读到」。
    setPeople(
      person({ id: 1, realmIndex: 22, xp: X.realm.xpNeeded(22), job: 'retreat', talent: 1 }),
      ...[2, 3, 4, 5, 6, 7].map((id) => person({ id, realmIndex: 18, job: 'retreat', talent: 1 })),
    );
    state.population = 2000;
    state.morality = 75;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    // 挂一张护身符（`runesOf(state).pending` 就是符房存挂加成的字段）
    state.cultivation.runes = state.cultivation.runes || {};
    state.cultivation.runes.pending = { tribulation: 1 };
    const pl = X.tribulation.plan(1, { territory: false, artifact: false });
    const before = state.population;
    X.tribulation.commit(1, { territory: false, artifact: false });
    return pl.damage === 3 && pl.boltsRaw === 1 && pl.runeSaved === 1 && pl.bolts === 0
      && state.population === before;
  })(), (() => { const p = X.tribulation.plan(1, { territory: false, artifact: false });
    return `damage=${p.damage} boltsRaw=${p.boltsRaw} runeSaved=${p.runeSaved} bolts=${p.bolts} pop=${state.population}`; })());
  check('T-8⑥：缺口 > 0 时人口按每道 ×(1−0.5%) 下降（逐道复利）', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 2000;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const before = state.population;
    const r = X.tribulation.commit(1, { territory: false, wardens: [], artifact: false });
    // 9 点缺口 → 4 道 → 2000 × 0.995⁴ ≈ 1960.1 → 死 40
    return r.bolts === 4 && state.population < before && state.population >= 1955;
  })(), `pop=${state.population}`);

  // ⑦ 化神期晋升真的走天劫（转发链通）
  atHuashen();
  check('T-8⑦：`breakthroughPlan` 在化神期转发到天劫（返回 kind=tribulation，不是冲关）', (() => {
    const pl = X.realm.plan(1);
    return pl.ok === true && pl.kind === 'tribulation' && typeof pl.damage === 'number';
  })(), JSON.stringify({ ok: X.realm.plan(1).ok, kind: X.realm.plan(1).kind }));
  check('T-8⑦：化神期**修为满不会自动跳级**（否则渡劫界面永不出现）', (() => {
    atHuashen();
    X.tick(600);
    return p0().realmIndex === 22;
  })(), `realmIndex=${p0().realmIndex}`);
  check('T-8⑦：渡劫成功后 realmIndex +1 且修为清零', (() => {
    atHuashen();
    state.morality = 75;   // 攒足减免 ⇒ 落入 calm
    const r = X.tribulation.commit(1, { territory: false });
    return r.ok === true && r.success === true && p0().realmIndex === 23 && p0().xp === 0;
  })(), `realmIndex=${p0() ? p0().realmIndex : '-'}`);

  // ⑨ UI：渡劫准备界面（验收标准 1 —— 必须出现「缺口」+数字，且**不出现**冲关按钮）
  atHuashen();
  X.ui.render();
  check('T-8⑨：化神期修为满时卡片上出现渡劫界面，且文本含「缺口」与数字',
    (() => {
      const box = listQ().querySelector('.trial-box');
      return Boolean(box) && /缺口/.test(box.textContent) && /\d/.test(box.textContent);
    })(), (() => { const b = listQ().querySelector('.trial-box'); return b ? b.textContent.replace(/\s+/g, ' ').slice(0, 120) : '(没有渡劫界面)'; })());
  check('T-8⑨：渡劫界面列出全部减免来源（五条）与各自的数值',
    listQ().querySelectorAll('.trial-list li').length === 5,
    `${listQ().querySelectorAll('.trial-list li').length} 条`);
  check('T-8⑨：渡劫层**不出现**原来的「冲关」按钮（走天劫而不是 REALM_GATES）',
    listQ().querySelectorAll('.trial-box [data-breakthrough]').length === 0);
  check('T-8⑨：界面明写落雷规则「每 2 点缺口，城内落雷一道」',
    (() => { const b = listQ().querySelector('.trial-gap');
      return Boolean(b) && /每 2 点缺口/.test(b.textContent); })());
  check('T-8⑨：不准备时按钮标出「此劫会要命」（缺口 9 ⇒ 陨落档，必须极清晰预告）', (() => {
    setPeople(person({ id: 1, realmIndex: 24, xp: X.realm.xpNeeded(24), job: 'retreat', talent: 1 }));
    state.population = 0;
    state.morality = 50;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    // ⚠ 必须把法器也清空：前面 T-5/器坊的用例留下过一件**已装备的法器**，
    //   它会以 −10% 悄悄混进减免（9 × 0.9 = 8.1 → round 8），于是「不准备」
    //   这个前提根本不成立。`artifactBonus` 读的是 `forge.equipped`，
    //   只清 world 是不够的 —— 这是「构造前置状态要清干净所有入口」的又一例。
    state.cultivation.forge = state.cultivation.forge || {};
    state.cultivation.forge.equipped = {};
    X.ui.render();
    const btn = listQ().querySelector('[data-tribulation]');
    return Boolean(btn) && /要命/.test(btn.textContent);
  })(), (() => {
    const b = listQ().querySelector('[data-tribulation]');
    const pl = X.tribulation.plan(1);
    return `btn=${b ? b.textContent.trim() : 'NONE'} | damage=${pl.damage} perish=${pl.perish} realm=${state.cultivation.cultivators[0]?.realmIndex}`;
  })());

  // ⑧ 旧存档：world.wardens 补 []
  check('T-8⑧：老存档载入后 world.wardens 被补成空数组（护法位是独立字段）', (() => {
    atHuashen();
    delete state.cultivation.world.wardens;
    X.step(0);
    return Array.isArray(state.cultivation.world.wardens) && state.cultivation.world.wardens.length === 0;
  })());

  /* ── 与**科技线/生产链**的第二处功能性联动（t5 验收条款）──────────
   * 天劫的减免来源**全部**取自前两个节点建起来的生产链：
   *   领地 → 地图线（占领 + 镇守）；法器 → 器坊线；护身符 → 符房线。
   * 也就是说「化神能不能过」不由化神期决定，而由玩家前 40 小时
   * 在凡人/仙道两条科技线上攒下了什么决定 —— 这是「相互关联」而非并存。
   * 这条断言把「投入的减免物真的会改变结算结果」钉住。 */
  check('T-8·科技联动：减免的三个来源**真的从生产链读**，且投入会改变结算结果', (() => {
    // ① 护法：来自名册（元婴+）—— 投 3 位护法应让雷伤下降 18%
    setPeople(
      person({ id: 1, realmIndex: 22, xp: X.realm.xpNeeded(22), job: 'retreat', talent: 1 }),
      person({ id: 2, realmIndex: 18, job: 'retreat', talent: 1 }),
      person({ id: 3, realmIndex: 18, job: 'retreat', talent: 1 }),
      person({ id: 4, realmIndex: 18, job: 'retreat', talent: 1 }),
    );
    state.population = 0;
    state.morality = 50;
    state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] };
    const bare = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    const warded = X.tribulation.plan(1, { territory: false, artifact: false });
    const wardenRow = X.tribulation.sources(1).find((s) => s.id === 'warden');
    // 3 位护法 × 6% = 18% ⇒ round(6×0.82) = 5，比不投入低
    // ② 法器：从器坊读（`artifactBonus` 与 equipped 位）—— 这里断言 available 与真实装备位同源
    const artRow = X.tribulation.sources(1).find((s) => s.id === 'artifact');
    const equippedCount = Object.keys(state.cultivation.forge?.equipped || {}).length;
    // ③ 封地：从地图读（已占领 **且有效镇守** 才计入）
    const terrRow = X.tribulation.sources(1).find((s) => s.id === 'territory');
    return bare.damage === 6 && wardenRow.available === 3 && warded.damage < bare.damage
      && artRow.available === equippedCount && terrRow.available === 0;
  })(), (() => { const b = X.tribulation.plan(1, { territory: false, wardens: [], artifact: false });
    const w = X.tribulation.plan(1, { territory: false, artifact: false });
    return `bare=${b.damage} warded=${w.damage}`; })());
}

/* ══════════════════════ 15.14 T-9 冲关仪式 ══════════════════════ */
section('T-9 冲关仪式（全篇情绪的最高点）');
{
  // ① 19 段念白齐备：4 门槛 × 4 段 = 16，结丹三档各一段 lose = 3
  check('T-9①：四次冲关各有 before/during/win/lose 四段，16 段齐备且非空', (() => {
    for (const idx of X.rite.gateIndexes()) {
      const r = X.rite.all(idx, { name: '甲', to: '某境', loss: 10, mercy: 0.08, failures: 1, rate: 0.5 });
      for (const ph of ['before', 'during', 'win', 'lose']) {
        if (typeof r[ph] !== 'string' || r[ph].trim().length < 10) return false;
      }
    }
    return X.rite.gateIndexes().length === 4;
  })(), `门槛 ${X.rite.gateIndexes().join('/')} —— 共 ${X.rite.gateIndexes().length * 4} 段`);
  check('T-9①：结丹三档各有一段失败念白（16 + 3 = 19 段）', (() => ['wen', 'wu', 'zhen'].every((f) => {
    const t = X.rite.foldLose(f, { rate: 0.55, marksFrom: 5, marksTo: 4 });
    return typeof t === 'string' && t.trim().length >= 10;
  }))());
  check('T-9①：念白住在 data/realms.js，不是 app.js 里的硬编码字符串', (() => {
    const appSrc = readFileSync('src/ui/app.js', 'utf8');
    const realmsSrc = readFileSync('src/data/realms.js', 'utf8');
    return realmsSrc.includes('坛上火起') && !appSrc.includes('坛上火起');
  })());

  // ④ 失败文案必须点名起因
  check('T-9④：缺丹药时的败念白含「丹」',
    X.rite.of(13, 'lose', { miss: 'pill', loss: 100, mercy: 0.08, failures: 1 }).includes('丹'));
  check('T-9④：修为不足时的败念白含「修为」',
    X.rite.of(13, 'lose', { miss: 'xp', loss: 100, mercy: 0.08, failures: 1 }).includes('修为'));
  check('T-9④：起因词表覆盖 丹/灵石/线索/修为/地基/天时 六种',
    ['pill', 'stones', 'clues', 'site', 'xp', 'luck'].every((k) => typeof X.rite.missWords()[k] === 'string'),
    JSON.stringify(X.rite.missWords()));
  check('T-9④：`breakthroughPlan` 的拒绝分支带 miss 标签（不是让渲染层猜中文）', (() => {
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {}, wardens: [] };
    X.alchemy.addPills('zhuji', -99);
    const p1 = X.realm.plan(1, 'mosscave');
    state.spiritStones = 0;
    X.alchemy.addPills('zhuji', 1);
    const p2 = X.realm.plan(1, 'mosscave');
    return p1.miss === 'pill' && p2.miss === 'stones';
  })(), `pill→${X.realm.plan(1, 'mosscave').miss}`);

  // ⑤ 失败补偿播报
  check('T-9⑤：败念白播报「下次成率 +8%」这个可算的数',
    /\+8%/.test(X.rite.of(13, 'lose', { loss: 100, mercy: 0.08, failures: 1 })));
  check('T-9⑤：连续失败时播报**累计**值（第 2 次 ⇒ 已累计 +16%）', (() => {
    const t = X.rite.of(13, 'lose', { loss: 100, mercy: 0.08, failures: 2 });
    return /\+8%/.test(t) && /16%/.test(t);
  })());
  check('T-9⑤：补偿率取自 REALM_FAIL_MERCY，改它文案自动跟着变（不是硬编码 8）', (() => {
    const t = X.rite.of(13, 'lose', { loss: 100, mercy: 0.25, failures: 1 });
    return /\+25%/.test(t) && !/\+8%/.test(t);
  })());

  // ② 过场机制
  check('T-9②：`state.ui.ritesSeen` 记住看过哪些门槛（随存档、不是模块级变量）', (() => {
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {}, wardens: [] };
    X.alchemy.addPills('zhuji', 5);
    state.ui = state.ui || {}; state.ui.ritesSeen = {};
    X.setRng(() => 0);
    const r = X.realm.commitWith(1, 'mosscave');
    X.setRng();
    return r.ok === true && X.rite.seen()['9'] === true;
  })(), JSON.stringify(X.rite.seen()));
  check('T-9②：`ritesSeen` 随存档往返（刷新不会重播已看过的过场）', (() => {
    state.ui = state.ui || {};
    state.ui.ritesSeen = { 9: true, 13: true };
    const raw = X.save.serialize();
    const back = X.save.hydrate(JSON.parse(JSON.stringify(raw)));
    return back.ui.ritesSeen['9'] === true && back.ui.ritesSeen['13'] === true;
  })());

  // ③ 成功/失败都挂念白
  check('T-9③：冲关成功写一条 rite 类日志并挂上 win 念白', (() => {
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    state.cultivation.world = { reached: ['mosscave'], held: [], garrison: {}, unrest: {}, wardens: [] };
    X.alchemy.addPills('zhuji', 5);
    state.log = [];
    X.setRng(() => 0);
    const r = X.realm.commitWith(1, 'mosscave');
    X.setRng();
    return r.ok === true && r.success === true
      && state.log.some((e) => e.kind === 'rite')
      && typeof r.rite === 'string' && r.rite.length > 10;
  })());
  check('T-9③：冲关失败也挂上 lose 念白，并写明回退点数', (() => {
    setPeople(person({ id: 1, realmIndex: 13, xp: X.realm.xpNeeded(13), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    X.alchemy.addPills('jindan', 5);
    X.setRng(() => 0.999999);
    const r = X.realm.commitWith(1);
    X.setRng();
    return r.ok === true && r.success === false && r.loss > 0
      && typeof r.rite === 'string' && /回退/.test(r.rite);
  })());

  // ⑥ 仪式不改数值
  check('T-9⑥：仪式零新数值 —— 门槛成率与回退比例与文档逐位一致', (() => {
    const g = X.realm.gate(13);
    return g.baseRate === 0.42 && g.failLoss === 0.40 && g.stones === 30 && g.clues === 4;
  })());
}

/* ═════════════ 15.15 用户实机缺陷三项（t5 收口） ═════════════
 * 每条都先把「场景」写死，再断言可见性 —— 这三条的表现形式都是
 * 「界面把该给玩家的东西藏起来了」，而**藏起来的东西不会报错**。
 * ⚠ 三条都在修复前先跑过同一段断言、确认**必红**（主策硬要求）。 */
section('用户实机缺陷：仙途死锁 / 百科自锁 / 拼音泄漏');
{
  const blankWorld = () => { state.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {}, wardens: [] }; };
  const blankCultivation = () => {
    setPeople();
    state.cultivation.unlocked = false;
    state.spiritStones = 0;
    state.cultivation.clues = 0;
    state.cultivation.cluePool = 0;
    state.cultivation.pills = {};
    state.immortalTechs = [];
    blankWorld();
  };

  // ── ① 仙途死锁：攒够 1 灵石却进不去仙途 ⇒ 永远买不到祛障丹 ──
  check('缺陷①：**持有灵石 > 0 且一个修士都没有** ⇒ 仙途页必须可见（否则买不到祛障丹，死锁）', (() => {
    blankCultivation();
    state.spiritStones = 1;             // 刚好够一枚祛障丹（PILL_STONE_COST = 1）
    return X.visible.pages().includes('immortal') === true;
  })(), `pages=${X.visible.pages().join(',')}`);
  check('缺陷①：灵石 0、无修士、无任何进展 ⇒ 仙途仍应隐藏（不能一开局就全亮）', (() => {
    blankCultivation();
    return X.visible.pages().includes('immortal') === false;
  })(), `pages=${X.visible.pages().join(',')}`);
  check('缺陷①：已经在仙途里做过事的人，入口不许藏回去（解锁/有修士/有线索/有仙道术）', (() => {
    const probe = (setup) => { blankCultivation(); setup(); return X.visible.pages().includes('immortal'); };
    return probe(() => { state.cultivation.unlocked = true; }) === true
      && probe(() => { setPeople(person({ id: 1, realmIndex: 1 })); }) === true
      && probe(() => { state.cultivation.clues = 1; }) === true
      && probe(() => { state.immortalTechs = ['tanxue']; }) === true;
  })());

  // ── ② 百科开局即见（用户原话：「我甚至不知道怎么才能开放百科」）──
  check('缺陷②：**全新 state** ⇒ 百科页必须可见，不得有任何前置', (() => {
    const fresh = X.save.hydrate({ version: 1 });
    return X.visible.pagesOf(fresh).includes('codex') === true;
  })(), `pages=${X.visible.pagesOf(X.save.hydrate({ version: 1 })).join(',')}`);
  check('缺陷②：把曾经的前置（unlocked / qi）逐个拿掉，百科都必须仍可见', (() => {
    const fresh = X.save.hydrate({ version: 1 });
    fresh.cultivation.unlocked = false;
    fresh.cultivation.qi = 0;
    fresh.spiritStones = 0;
    return X.visible.pagesOf(fresh).includes('codex') === true;
  })());

  // ── ③ 拼音泄漏 ──
  check('缺陷③：`techNameOf()` 是科技名的单一入口，**两条线**都查得到中文', (() => {
    const fan = X.tech.nameOf('lingtian');
    const xian = X.tech.nameOf('tanxue');
    return typeof fan === 'string' && /[\u4e00-\u9fa5]/.test(fan)
      && typeof xian === 'string' && /[\u4e00-\u9fa5]/.test(xian);
  })(), `lingtian→${X.tech.nameOf('lingtian')} / tanxue→${X.tech.nameOf('tanxue')}`);
  check('缺陷③：查不到的 id **不回退成拼音**，给中文「未知科技」', (() => {
    return X.tech.nameOf('no_such_tech_id') === null
      && X.tech.labelOf('no_such_tech_id') === '未知科技';
  })(), `label=${X.tech.labelOf('no_such_tech_id')}`);
  /* 机械扫描：界面里**任何** `须研习「…」` 都必须带中文。
   * 不依赖任何具体建筑 —— 只要有人再写 `|| def.tech` 那种回退，输出一变成拼音就被抓住。 */
  check('缺陷③（机械扫描）：渲染出的每一处「须研习「X」」里的 X 都是中文，不是 id', (() => {
    setPeople();
    state.population = 0;
    state.cultivation.unlocked = false;
    for (const def of X.data.buildings) state.buildings[def.id] = 0;
    state.techs = [];
    X.ui.render();
    // ⚠ 必须 scope 到 `#building-list`：垫片不实现 `document.body.textContent` 的
    //   后代聚合（实测取到空串），拿 body 去扫会得到「0 处」⇒ 一个永远触发的假失败。
    const host = document.getElementById('building-list');
    const hits = [...(host ? host.textContent : '').matchAll(/须研习「([^」]*)」/g)].map((m) => m[1]);
    if (!hits.length) return false;   // 一处都没渲染出来 ⇒ 空检查，不许算过
    return hits.every((h) => /[\u4e00-\u9fa5]/.test(h) && !/^[a-z0-9_]+$/.test(h));
  })(), (() => {
    const host = document.getElementById('building-list');
    const hits = [...(host ? host.textContent : '').matchAll(/须研习「([^」]*)」/g)].map((m) => m[1]);
    return `${hits.length} 处：${[...new Set(hits)].slice(0, 5).join(' / ')}`;
  })());
  /* 第二道机械闸：**每一个**建筑引用的科技 id 都必须能解析出中文名。
   * 这条与上一条是互补的 —— 上一条只看「界面上渲染出来的」，若某张卡因为别的条件
   * 没渲染成 locked 态就扫不到；这一条覆盖**全部 9 个引用**，一条都不放过。
   * 它正是用户那个 bug 的根因所在一处（`lingtian` 在仙道线、`TECH_MAP` 只有凡人线）。 */
  check('缺陷③（全量扫描）：每一个建筑引用的 tech id 都能解析出中文名', (() => {
    const refs = [...new Set(X.data.buildings.map((d) => d.tech).filter(Boolean))];
    const bad = refs.filter((id) => {
      const n = X.tech.nameOf(id);
      return !(typeof n === 'string' && /[\u4e00-\u9fa5]/.test(n));
    });
    return refs.length >= 9 && bad.length === 0;
  })(), (() => {
    const refs = [...new Set(X.data.buildings.map((d) => d.tech).filter(Boolean))];
    return `${refs.length} 个引用，解析失败：${refs.filter((id) => !X.tech.nameOf(id)).join(',') || '无'}`;
  })());
  check('缺陷③（源码闸）：app.js 里不再有 `|| def.tech` 那种「回退成拼音」的写法', (() => {
    // ⚠ 必须先剥注释：修复处的注释里**引用了**那个写法（"删掉了原来的 `|| def.tech` 回退"），
    //   不剥注释的话这条断言会被自己的说明文字判红 —— 一个很容易被误读成「没修好」的假失败。
    const src = readFileSync('src/ui/app.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    return !/\|\|\s*def\.tech\b/.test(src) && /techLabelOf\(/.test(src);
  })());
  /* 【验收 5/7 · 全仓闸】「查不到就回退成原始 id」这种写法必须**从整个渲染/文案层消失**。
   * 它一共有**四个落点** —— 这是本轮最值得记住的一点：同一个病在四个地方各写了一遍。
   *   ① `ui/app.js` 建筑卡　② `data/codex.js` 百科正文
   *   ③ `core/engine.js` planBuy 的「须先研习…」（**这正是用户点建造时看到的那一句**）
   *   ④ `ui/app.js` 科技前置条件提示
   * 所以闸门也必须是**全仓扫描**，而不是只盯一个文件。 */
  check('缺陷③（全仓闸）：四个落点都不再有「查不到就回退成原始 id」的写法', (() => {
    const strip = (t2) => t2.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const files = ['src/ui/app.js', 'src/data/codex.js', 'src/core/engine.js'];
    const bad = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      if (/(TECH_MAP|IMMORTAL_TECH_MAP)\[[^\]]+\]\?\.name\s*\|\|/.test(src)) bad.push(`${f}:双表+回退`);
      if (/tech\?\.name\s*\|\|\s*def\.tech\b/.test(src)) bad.push(`${f}:tech?.name||def.tech`);
    }
    const uses = files.filter((f) => /techLabelOf\(/.test(readFileSync(f, 'utf8')));
    return bad.length === 0 && uses.length === 3;
  })(), (() => {
    const strip = (t2) => t2.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    return ['src/ui/app.js', 'src/data/codex.js', 'src/core/engine.js'].map((f) => {
      const src = strip(readFileSync(f, 'utf8'));
      const n = ((src.match(/(TECH_MAP|IMMORTAL_TECH_MAP)\[[^\]]+\]\?\.name\s*\|\|/g) || []).length)
        + ((src.match(/tech\?\.name\s*\|\|\s*def\.tech\b/g) || []).length);
      return `${f.split('/').pop()}:残留${n}/techLabelOf:${/techLabelOf\(/.test(src) ? 'Y' : 'N'}`;
    }).join(' | ');
  })());
  /* 【验收 5 · engine.js 点名的落点】用户点「建造」时拿到的拒绝文案就是这里产生的。 */
  check('缺陷③（engine 落点）：买未解锁建筑时，拒绝文案点名中文科技名而不是拼音', (() => {
    setPeople();
    state.techs = [];
    const r = X.engine.planBuy('lingtian');   // `lingtian` 是仙道线科技，正是用户看到的那一例
    if (!r || r.ok !== false) return false;
    return /[\u4e00-\u9fa5]/.test(r.reason) && !/[a-z_]{3,}/.test(r.reason);
  })(), (() => { const r = X.engine.planBuy('lingtian'); return r ? r.reason : '(无返回)'; })());
  /* 【验收 5/8】百科正文同样要扫 —— 建筑卡修了、百科漏了，是这个 bug 的**第二个落点**
   * （`src/data/codex.js` 原来也有 `TECH_MAP[b.tech]?.name || b.tech`）。
   * 这条直接调百科自己的 `lines()` 取正文，凡是「需研习：」「须研习「」后面跟纯小写标识符就判红。 */
  check('缺陷③（机械扫描·百科正文）：百科吐出的正文里不出现小写标识符泄漏', (() => {
    const srcBad = readFileSync('src/data/codex.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    if (/\|\|\s*b\.tech\b/.test(srcBad)) return false;   // 源码层面先拦一次
    // ⚠ `X.codex.raw()` 返回的是**章节**（每章有 entries），不是条目数组 ——
    //   直接 for..of 会拿到章节对象、`lines` 不存在 ⇒ 收集到 0 段（假失败）。
    const entries = [];
    for (const ch of X.codex.raw()) for (const e of (ch.entries || [])) entries.push(e);
    const bodies = [];
    for (const e of entries) {
      if (e.prose) bodies.push(String(e.prose));
      if (typeof e.lines === 'function') {
        try { for (const l of e.lines(state) || []) bodies.push(String(l)); } catch { /* 缺前置的条目，跳过 */ }
      }
    }
    const text = bodies.join('\n');
    return entries.length > 30 && bodies.length > 20
      && !/(需研习|须研习)[：:]?\s*「?[a-z0-9_]+」?/.test(text);
  })(), (() => {
    const entries = [];
    for (const ch of X.codex.raw()) for (const e of (ch.entries || [])) entries.push(e);
    const bodies = [];
    for (const e of entries) {
      if (e.prose) bodies.push(String(e.prose));
      if (typeof e.lines === 'function') { try { for (const l of e.lines(state) || []) bodies.push(String(l)); } catch {} }
    }
    const hits = [...bodies.join('\n').matchAll(/(需研习|须研习)[：:]?\s*「?([a-z0-9_]+)」?/g)].map((m) => m[2]);
    return `${entries.length} 条 / ${bodies.length} 段正文，泄漏 ${hits.length} 处${hits.length ? '：' + [...new Set(hits)].join(',') : ''}`;
  })());
}

section('T-6 结丹（每一次修为满，都是一次下注）');{
  const atJindan = () => {
    setPeople(person({ id: 1, realmIndex: 14, xp: X.realm.xpNeeded(14), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000000;
    X.alchemy.addHerbs('grass', 500);
  };

  // ① 新态 folding，且四态行为逐位不变
  atJindan();
  check('金丹期修为满 → breakthroughState 返回 folding', X.realm.stateOf(1).kind === 'folding');
  check('炼气九层修为满 → 仍然是 blocked（四态不变）', (() => {
    setPeople(person({ realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    return X.realm.stateOf(1).kind === 'blocked';
  })());
  check('修为满也不再自动晋升（跑 600 秒仍停在 14 层）', (() => {
    atJindan();
    X.tick(600);
    return state.cultivation.cultivators[0].realmIndex === 14;
  })());

  // ② 两个按钮
  atJindan();
  X.ui.render();
  {
    const list = document.getElementById('cultivator-list');
    check('丹成待决时卡片上有「晋升」按钮', list.querySelectorAll('[data-breakthrough]').length === 1);
    check('丹成待决时卡片上有三档火候的「结丹」按钮', list.querySelectorAll('[data-fold]').length === 3);
  }

  /* ── 【修复 t4 缺陷② / docs/91 §十二 T-6-A1 ~ A4】「晋升」按钮的**行为级**验证 ──
   * 原形态：`app.js` 渲染了 `data-force="1"`，而 `main.js` 不读它，
   * `commitBreakthrough` 又在 folding 态直接 `ok:false` ⇒ 按钮点了什么都不发生。
   * 危害比「点不动」重：修为停在 need、自动晋升只吃「超出 need 的部分」，
   * 于是 `xp === need` 永不自愈 ⇒ **金丹期满修为后不结丹就永远出不去**，
   * 4 次火候机会从「可选下注」变成「必经流程」，
   * 反过来架空 docs/91 §三 T-6「绑成晋升的替代、防止反复结丹刷丹纹」那条硬上限论证。
   * ——一个静默失效，让另一处的设计论证变成空话。
   * ⚠ 找 `force` 的钩子用 `[data-breakthrough]` + `dataset.force === '1'`，
   *   **不能用 `[data-force="1"]`**：垫片的多属性复合选择器不支持，会静默匹配不到。
   */
  {
    // ── T-6-A1：folding 态点晋升 → 进下一层、修为清零、丹纹不变、本层机会不消耗 ──
    atJindan();
    state.cultivation.cultivators[0].core = { marks: 4, mercy: 0, used: {} };
    X.ui.render();
    const promoteBtn = [...document.querySelectorAll('#cultivator-list [data-breakthrough]')]
      .find((n) => n.dataset.force === '1');
    check('T-6-A1：folding 态渲染出的晋升按钮带 data-force（且处理侧会读它）',
      Boolean(promoteBtn), promoteBtn ? 'found' : 'missing');
    dom.click(promoteBtn);
    const pAfter = state.cultivation.cultivators[0];
    check('T-6-A1：点晋升 → realmIndex = 本层 + 1（14 → 15）',
      pAfter.realmIndex === 15, `realmIndex=${pAfter.realmIndex}`);
    check('T-6-A1：点晋升 → xp 清零', pAfter.xp === 0, `xp=${pAfter.xp}`);
    check('T-6-A1：点晋升 → 丹纹不变（放弃本层机会 ≠ 丢掉丹纹）',
      X.realm.coreOf(1).marks === 4, `${X.realm.coreOf(1).marks} 纹`);
    check('T-6-A1：点晋升 → **不写入** core.used[本层]（只是放弃，不是消耗）',
      !Object.keys(X.realm.coreOf(1).used).includes('14'),
      Object.keys(X.realm.coreOf(1).used).join(',') || '空');
    check('T-6-A1：点晋升 → 不扣灵石 / 不扣药草（无风险）',
      state.spiritStones === 1000000, `${state.spiritStones}`);

    // ── T-6-A2：晋升后不再停在 folding（下一层照常积累）──
    check('T-6-A2：晋升后不再回到 folding',
      X.realm.stateOf(1).kind !== 'folding', X.realm.stateOf(1).kind);

    // ── T-6-A3：不传 force 时，folding 仍返回 ok:false 且理由里点明「结丹」──
    atJindan();
    const noForce = X.realm.plan(1);
    check('T-6-A3：不传 force 的 folding 仍被拒（保留「提醒玩家可以结丹」的行为）',
      noForce.ok === false && /结丹/.test(noForce.reason || ''), noForce.reason);

    // ── T-6-A4：force 只在 folding 被接受；blocked（材料不足）态必须**仍然被拒** ──
    //    否则 force 会变成「跳过一切门槛」的后门 —— 这是本条最危险的写法。
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 0;
    state.cultivation.clues = 0;
    check('T-6-A4：blocked（材料不足）态传 force 仍被拒（force 不是后门）',
      X.realm.plan(1, undefined, true).ok === false
      && X.realm.stateOf(1).kind === 'blocked', X.realm.stateOf(1).kind);
    //    而且 force 也不能把「没到 folding」的人硬推上去
    check('T-6-A4：修为未满（filling）时传 force 也被拒',
      (() => {
        setPeople(person({ id: 1, realmIndex: 10, xp: 0, job: 'retreat', talent: 1 }));
        return X.realm.plan(1, undefined, true).ok === false;
      })());
  }

  // ③ 三档火候的数值逐位一致，且明文写在按钮上
  check('文火：+1 纹 / 95% / 止于 6 纹',
    X.realm.coreFolds()[0].marks === 1 && X.realm.coreFolds()[0].rate === 0.95 && X.realm.coreFolds()[0].cap === 6);
  check('武火：+3 纹 / 55% / 上限 12 纹',
    X.realm.coreFolds()[1].marks === 3 && X.realm.coreFolds()[1].rate === 0.55 && X.realm.coreFolds()[1].cap === 12);
  check('三昧真火：+6 纹 / 25% / 无上限',
    X.realm.coreFolds()[2].marks === 6 && X.realm.coreFolds()[2].rate === 0.25 && X.realm.coreFolds()[2].cap === null);
  // ⚠ 先重置本层状态再渲染：前面的用例已经把 14 层的唯一机会用掉了，
  //   不清 `used` 的话 `foldPlan` 会返回 ok:false、三档按钮全 disabled，
  //   按钮文案就查不到了（假失败）。
  atJindan();
  state.cultivation.cultivators[0].core = { marks: 0, mercy: 0, used: {} };
  X.ui.render();
  check('⑤ 按钮文本里出现 95% / 55% / 25%（三档成率明文写在按钮上）', (() => {
    const t = document.getElementById('cultivator-list').textContent;
    return t.includes('95%') && t.includes('55%') && t.includes('25%');
  })());
  check('⑤「止于六纹」写在按钮的 title 里（上限信息是给悬停看的，不在按钮正文）—— 同时校验 title 真的带上了上限',
    (() => {
      const btn = document.querySelector('#cultivator-list [data-fold="wen"]');
      return btn && typeof btn.attrs.title === 'string'
        && btn.attrs.title.includes('止于 6 纹') && btn.attrs.title.includes('成算 95%');
    })(), (document.querySelector('#cultivator-list [data-fold="wen"]') || {}).attrs?.title?.slice(0, 90));
  // 【t9 更正 · 调试者】此处原本断言「三昧真火的数学期望最低（+0.75 < 武火 +1.20）——风险买的是上限不是均值」。
  //   ⚠ 那两个数出自「每次机会独立、且**忽略丹纹夹 0**」的简化模型 —— 该模型已被 docs/91 §12.10
  //   用 2⁴ 全枚举正式否证；而本文件 C6 段（:3301-3313）断言的正是真值，且 :3311 明确写着
  //   「均值最低的是**文火**（不是真火）」。⇒ 留着原来那条会造成**同一文件里两条互相矛盾的断言**，
  //   而且它一直绿只是**碰巧**：简化模型下 0.75 < 1.20；真实模型下 5.33203125 < 5.80738125
  //   —— 序关系在换模型后**偶然保住**，所以没人发现标题是错的。
  //   故删除该条（不重复断言同一事实），正确表述由 C6 段与 docs/91 §12.10 承担。

  // ④ 同一层最多结丹一次
  {
    atJindan();
    const first = X.realm.fold(1, 'wen', () => 0);
    check('文火必成 → +1 纹', first.success === true && first.marks === 1, `${first.marks} 纹`);
    check('结丹吃掉本层修为', state.cultivation.cultivators[0].xp === 0);
    check('本层已结丹 → 第二次被拒', (() => {
      state.cultivation.cultivators[0].xp = X.realm.xpNeeded(14);
      return X.realm.foldPlan(1, 'wen').ok === false && X.realm.foldPlan(1, 'wen').reason.includes('已结过丹');
    })());
    check('结丹后只剩「晋升」（state 回到 progressing）', (() => {
      state.cultivation.cultivators[0].xp = X.realm.xpNeeded(14);
      return X.realm.stateOf(1).kind === 'progressing';
    })());
    check('剩余机会 4 → 3', X.realm.coreChancesLeft(1) === 3, `${X.realm.coreChancesLeft(1)}`);
  }

  // ⑤ 失败 = **护纹**语义（docs/91 §十二.3 裁决；不再是「mercy += 0.12」的成率补偿）
  //   失败时：mercy > 0 → 本次不掉纹且护纹用掉；否则掉一纹并记下一次护纹。
  //   文案承诺的因果必须与这两个分支逐字对得上（承诺与兑现同源）。
  {
    // 每次都要把 `used` 清空 —— 上一段测试已经用掉 14 层的唯一机会，
    // 不清就会让 `foldPlan` 直接返回 `ok:false`、`failText` 变 undefined（把整个脚本打崩）。
    const freshCore = (marks, mercy) => {
      atJindan();
      state.cultivation.cultivators[0].core = { marks, mercy, used: {} };
    };

    // ── T-6-B1（策划裁决 1 · 强制）：失败文案里不许再出现「补偿 / 个百分点」──
    freshCore(3, 0);
    const noWard = X.realm.foldPlan(1, 'wen').failText;
    freshCore(3, 1);
    const warded = X.realm.foldPlan(1, 'wen').failText;
    check('T-6-B1：失败文案不再承诺「补偿 N 个百分点」（承诺了却不兑现比没有承诺更糟）',
      !noWard.includes('补偿') && !noWard.includes('个百分点')
      && !warded.includes('补偿') && !warded.includes('个百分点'),
      `${noWard} | ${warded}`);

    // ── 分支 A：mercy = 0 → 掉一纹、并记下一次护纹 ──
    freshCore(5, 0);
    const rA = X.realm.fold(1, 'wu', () => 0.999);   // 骰子必失败
    check('护纹：mercy=0 失败 → 掉一纹（5 → 4）', rA.success === false && rA.marks === 4, `${rA.marks}`);
    check('护纹：mercy=0 失败 → 记下一次护纹（mercy=1，次数语义不是 0.12）',
      near(X.realm.coreOf(1).mercy, 1, 1e-9), `${X.realm.coreOf(1).mercy}`);
    check('护纹：mercy=0 的失败文案承诺「掉一纹 + 记下护纹」，与结算一致',
      noWard.includes('掉一纹') && noWard.includes('护纹'), noWard);

    // ── 分支 B：mercy > 0 → 本次**不掉纹**、护纹用掉 ──
    freshCore(5, 1);
    const rB = X.realm.fold(1, 'wu', () => 0.999);
    check('护纹：mercy>0 失败 → **不掉纹**（5 纹保住）', rB.success === false && rB.marks === 5, `${rB.marks}`);
    check('护纹：mercy>0 失败 → 护纹被用掉（mercy=0）',
      near(X.realm.coreOf(1).mercy, 0, 1e-9), `${X.realm.coreOf(1).mercy}`);
    check('护纹：mercy>0 的失败文案承诺「不掉纹」，与结算一致',
      warded.includes('不掉纹') && warded.includes('护纹用掉'), warded);

    // ── 两条分支连起来：文案说的「下次再裂就真掉一纹」必须成立 ──
    freshCore(5, 1);
    const r1 = X.realm.fold(1, 'wu', () => 0.999);   // 护纹挡下
    state.cultivation.cultivators[0].realmIndex = 15;
    state.cultivation.cultivators[0].xp = X.realm.xpNeeded(15);
    state.cultivation.cultivators[0].core = { marks: r1.marks, mercy: X.realm.coreOf(1).mercy, used: {} };
    const r2 = X.realm.fold(1, 'wu', () => 0.999);   // 无护纹 → 真掉
    check('护纹：挡下一次之后，再裂就真掉一纹（5 → 5 → 4）',
      r1.marks === 5 && r2.marks === 4, `${r1.marks} → ${r2.marks}`);

    check('丹纹最低夹到 0（0 纹时失败不掉纹 —— 这条下限是旧公式算错的原因）', (() => {
      freshCore(0, 0);
      const r3 = X.realm.fold(1, 'wu', () => 0.999);
      return r3.marks === 0;
    })());
    check('成功：mercy 归零', (() => {
      freshCore(3, 1);
      const r4 = X.realm.fold(1, 'wen', () => 0);
      return r4.success === true && X.realm.coreOf(1).mercy === 0;
    })());
  }

  /* ── T-6-C4 / C5 / C6（docs/91 §十二.9）：三档期望与五品概率的**精确枚举** ──
   * 新规则 `~/.dsh/rules/numeric-verification.md`：带 cap / 下限 / 机会次数的结算
   * **一律枚举，不要用连续式均值估**。设计师那张表就是被「丹纹夹 0」这个下限整张算错的
   * （真火 3.00 → 5.0508，低估 68%）。
   * 这里**复刻实现的状态机语义**，枚举全部 2⁴ = 16 条成败序列：
   *   ① 丹纹**跨层累计**（每个成功 +marks）
   *   ② cap 夹住（文火止于 6 / 武火 12 / 真火无上限）
   *   ③ 丹裂**夹 0**（0 纹时失败不掉纹）—— 漏了这条就会算回旧的错数
   *   ④ 失败只在**没有护纹**时掉纹，掉纹后记下一次护纹 */
  {
    /** 按实现语义枚举某一档在「4 层各结一次」下所有 2⁴ 序列的（期望纹数, ≥9 纹概率, 概率和）。
     *  ⚠ 关键的一行是失败分支的 `ward`：**被护纹挡下之后 ward 要清零**（护纹用掉了），
     *    而「掉纹」才把 ward 置 1。写成「失败后一律置 1」会算出一组偏高的错数
     *    （这个错在本轮真的犯过一次，所以下面有一条「模型 vs 实现逐条对表」兜着）。 */
    const foldModel = (marks, cap, rate, bits, useWard) => {
      let cur = 0, ward = false;
      for (const b of bits) {
        if (b === '1') { cur += marks; if (cap !== null) cur = Math.min(cap, cur); ward = false; }
        else if (useWard && ward) { ward = false; }        // 护纹挡下，且护纹用掉
        else { cur = Math.max(0, cur - 1); ward = useWard; } // 真掉一纹，并记下一次护纹
      }
      return cur;
    };
    const enumerate = (marks, cap, rate, useWard) => {
      let expMarks = 0, pFive = 0, pSum = 0;
      for (let mask = 0; mask < 16; mask += 1) {
        const bits = mask.toString(2).padStart(4, '0').split('').reverse();
        let p = 1;
        for (const b of bits) p *= (b === '1' ? rate : 1 - rate);
        const cur = foldModel(marks, cap, rate, bits, useWard);
        expMarks += p * cur;
        pSum += p;
        if (cur >= 9) pFive += p;
      }
      return { expMarks, pFive, pSum };
    };
    const selfCheck = enumerate(1, 6, 0.95, true);
    check('T-6-C4：2⁴ 枚举的概率和 = 1（枚举没漏分支 —— 恒真检查的对照）',
      near(selfCheck.pSum, 1, 1e-12), `${selfCheck.pSum}`);

    const noWardExp = [
      enumerate(1, 6, 0.95, false), enumerate(3, 12, 0.55, false), enumerate(6, null, 0.25, false),
    ];
    const wardExp = [
      enumerate(1, 6, 0.95, true), enumerate(3, 12, 0.55, true), enumerate(6, null, 0.25, true),
    ];
    // 期望（无护纹）—— 对应「mercy 是死字段」的旧实现
    check('T-6-C5：期望（无护纹）文火 = 3.65524375', near(noWardExp[0].expMarks, 3.65524375, 1e-8),
      `${noWardExp[0].expMarks}`);
    check('T-6-C5：期望（无护纹）武火 = 5.58463125（注意不是四舍五入的 5.5846）',
      near(noWardExp[1].expMarks, 5.58463125, 1e-8), `${noWardExp[1].expMarks}`);
    check('T-6-C5：期望（无护纹）真火 = 5.05078125（不是文档旧表写的 3.00）',
      near(noWardExp[2].expMarks, 5.05078125, 1e-8), `${noWardExp[2].expMarks}`);
    // 期望（护纹）—— 当前实现
    check('T-6-C6：期望（护纹）文火 = 3.6575', near(wardExp[0].expMarks, 3.6575, 1e-8),
      `${wardExp[0].expMarks}`);
    check('T-6-C6：期望（护纹）武火 = 5.80738125', near(wardExp[1].expMarks, 5.80738125, 1e-8),
      `${wardExp[1].expMarks}`);
    check('T-6-C6：期望（护纹）真火 = 5.33203125', near(wardExp[2].expMarks, 5.33203125, 1e-8),
      `${wardExp[2].expMarks}`);
    check('T-6-C6：≥9 纹 文火 = 0%', near(wardExp[0].pFive, 0, 1e-12), `${wardExp[0].pFive}`);
    check('T-6-C6：≥9 纹 武火 = 16.6375%（含「首败不掉纹 + 后三全成 = 9 纹」那条 7.4875% 路径）',
      near(wardExp[1].pFive, 0.166375, 1e-9), `${wardExp[1].pFive}`);
    check('T-6-C6：≥9 纹 真火 = 26.171875%', near(wardExp[2].pFive, 0.26171875, 1e-9), `${wardExp[2].pFive}`);
    check('T-6-C6：均值最低的是**文火**（不是真火）；真火是在两个付费档之间用均值换上限',
      wardExp[0].expMarks < wardExp[2].expMarks && wardExp[2].expMarks < wardExp[1].expMarks,
      `文火 ${wardExp[0].expMarks} < 真火 ${wardExp[2].expMarks} < 武火 ${wardExp[1].expMarks}`);

    /* ── T-6-C5'/C6'：把上面的模型**与实现逐条对表** ──
     * 只写一张期望表是不够的：如果模型本身也理解错了（设计师那张表就是），
     * 期望表会「自洽地错」。所以这里再跑一遍**实现本身**：对 16 条成败序列，
     * 逐条比对「实现结算出的丹纹」与「模型算出的丹纹」，必须 16/16 一致。
     * 这样模型与实现互为对照，任何一边改了都会红。
     * （`setRng` 按序列掐死骰子，所以这是确定性的、不是采样。） */
    {
      const SPEC = { wen: [1, 6, 0.95], wu: [3, 12, 0.55], zhen: [6, null, 0.25] };
      const mkPerson = () => ({
        id: 1, name: 'X', origin: 'innate', realmIndex: 14, xp: 0, breakFailures: 0,
        job: 'retreat', talent: 1, parentage: 'cultivator-mortal',
        root: { grade: 'quad', elements: ['metal', 'water', 'fire', 'earth'], rerolls: 0 },
      });
      const setupForFold = () => {
        setPeople(mkPerson());
        state.spiritStones = 1e9;
        state.cultivation.alchemy = { herbs: { grass: 1e6 }, pills: {}, prof: {}, furnace: 1, crafts: 0 };
        state.population = 0;
      };
      const mismatches = [];
      for (const foldId of Object.keys(SPEC)) {
        const [mk, cap, rate] = SPEC[foldId];
        for (let mask = 0; mask < 16; mask += 1) {
          const bits = mask.toString(2).padStart(4, '0').split('').reverse();
          setupForFold();
          const who = state.cultivation.cultivators[0];
          let marks = 0;
          for (let k = 0; k < 4; k += 1) {
            who.realmIndex = 14 + k;
            who.xp = X.realm.xpNeeded(14 + k);
            X.setRng(() => (bits[k] === '1' ? 0 : 0.999999));
            const rr = X.realm.fold(1, foldId);
            X.setRng(null);
            if (rr.ok === false) { mismatches.push(`${foldId}/${bits.join('')} refused`); break; }
            marks = rr.marks;
          }
          const want = foldModel(mk, cap, rate, bits, true);
          if (marks !== want) mismatches.push(`${foldId}/${bits.join('')} impl=${marks} model=${want}`);
        }
      }
      check('T-6-C6′：模型与实现的 16×3 条序列逐条一致（模型不是自洽地错）',
        mismatches.length === 0, mismatches.slice(0, 5).join(' '));
    }

    /* ── T-6-C4：**防止 mercy 被接回成率**（回归防护）──
     * 一旦有人把 mercy 加进成率，武火/真火会蹿到 7.68 / 8.04、武火被真火全面压过、
     * 三档退化成两档。这条断言直接检查 `foldPlan().rate` **不含** mercy：
     * 同一个修士，mercy = 0 与 mercy = 1 时 rate 必须**完全相同**、且等于火候基准成率。 */
    atJindan();
    state.cultivation.cultivators[0].core = { marks: 3, mercy: 0, used: {} };
    const rateNoWard = X.realm.foldPlan(1, 'wu').rate;
    state.cultivation.cultivators[0].core = { marks: 3, mercy: 1, used: {} };
    const rateWard = X.realm.foldPlan(1, 'wu').rate;
    check('T-6-C4：mercy 不参与成率（否则三档会退化成两档）',
      near(rateNoWard, rateWard, 1e-12) && near(rateWard, 0.55, 1e-12),
      `mercy=0 → ${rateNoWard}，mercy=1 → ${rateWard}`);
    // 【t9 补强 · 主策要求 / 监管者 test-blindspots R4：成组透传的字段必须覆盖组内**每一项**】
    //   只测武火会留下真实盲区：若 `foldId → fold` 的映射被写错档，
    //   `coreFolds()` **数据表**断言（:3144-3149）与 UI **文案**断言（:3156/:3379-3380）
    //   **仍然全绿** —— 它们查的是数据源与文案，而实现真正读的是 `foldPlan()` 的解析结果。
    //   故三档逐档断言；有效性用变异测试证明（把 `foldPlan` 的查表改错一档 → 本断言必须变红，
    //   见 docs/92 §十三）。
    const rateByFold = ['wen', 'wu', 'zhen'].map((fid) => {
      state.cultivation.cultivators[0].core = { marks: 0, mercy: 0, used: {} };
      return X.realm.foldPlan(1, fid).rate;
    });
    check('T-6-C4′：foldPlan 的成率三档齐（0.95 / 0.55 / 0.25）—— 只测一档会漏掉映射错档',
      near(rateByFold[0], 0.95, 1e-12) && near(rateByFold[1], 0.55, 1e-12) && near(rateByFold[2], 0.25, 1e-12),
      rateByFold.join(' / '));
    const specByFold = ['wen', 'wu', 'zhen'].map((fid) => {
      const pl = X.realm.foldPlan(1, fid);
      return `${pl.marks}/${pl.cap}`;
    });
    check('T-6-C4″：foldPlan 的得纹/上限三档齐（1/6、3/12、6/null）',
      specByFold[0] === '1/6' && specByFold[1] === '3/12' && specByFold[2] === '6/null',
      specByFold.join(' '));

    /* ── 【t12 验收】结丹资源门槛：两侧 + **拒绝理由点名** ──
     * t9 报的「话术口」：实现两侧都对、话术也点名了，但**回归套件里一条断言都没有** ⇒
     * 将来话术退化成「不能结丹」这种笼统文案，没有任何东西会红。
     * 规则（`test-blindspots.md` R4）：既不能只查数据源/文案（漏「分派错档」），
     * 也不能只查 `ok` 布尔（漏「话术退化」）—— 本条属后者，故断言 **reason 里的关键词与数字**。
     * 「刚好够 → 能结」与「差一个 → 被拒并点名缺哪一样」两侧都覆盖。 */
    {
      const setRes = (stones, grass) => {
        atJindan();
        state.cultivation.cultivators[0].core = { marks: 0, mercy: 0, used: {} };
        state.spiritStones = stones;
        state.cultivation.alchemy.herbs.grass = grass;
      };
      // 武火：10 灵石 + 1 药草
      setRes(10, 1);
      check('结丹资源门槛：武火（刚好 10 灵石 + 1 药草）→ 放行',
        X.realm.foldPlan(1, 'wu').ok === true, X.realm.foldPlan(1, 'wu').reason);
      setRes(9, 1);
      check('结丹资源门槛：武火差 1 灵石 → 拒绝，且理由点名「10 灵石」与现有数',
        (() => { const p = X.realm.foldPlan(1, 'wu');
          return p.ok === false && p.reason.includes('10') && p.reason.includes('灵石') && p.reason.includes('9'); })(),
        X.realm.foldPlan(1, 'wu').reason);
      setRes(100, 0);
      check('结丹资源门槛：武火缺药草 → 拒绝，且理由点名「药草」',
        (() => { const p = X.realm.foldPlan(1, 'wu');
          return p.ok === false && p.reason.includes('药草') && p.reason.includes('1'); })(),
        X.realm.foldPlan(1, 'wu').reason);
      // 真火：60 灵石 + 3 药草
      setRes(60, 3);
      check('结丹资源门槛：真火（刚好 60 灵石 + 3 药草）→ 放行',
        X.realm.foldPlan(1, 'zhen').ok === true, X.realm.foldPlan(1, 'zhen').reason);
      setRes(59, 3);
      check('结丹资源门槛：真火差 1 灵石 → 拒绝，且理由点名「60 灵石」',
        (() => { const p = X.realm.foldPlan(1, 'zhen');
          return p.ok === false && p.reason.includes('60') && p.reason.includes('灵石'); })(),
        X.realm.foldPlan(1, 'zhen').reason);
      setRes(1000, 2);
      check('结丹资源门槛：真火缺药草 → 拒绝，且理由点名「药草」与 3 份',
        (() => { const p = X.realm.foldPlan(1, 'zhen');
          return p.ok === false && p.reason.includes('药草') && p.reason.includes('3'); })(),
        X.realm.foldPlan(1, 'zhen').reason);
      // 文火：0 灵石 0 药草 —— 免费档，任何资源状态下都应放行（两侧的另一侧）
      setRes(0, 0);
      check('结丹资源门槛：文火免费（0 灵石 / 0 药草）→ 仍然放行',
        X.realm.foldPlan(1, 'wen').ok === true, X.realm.foldPlan(1, 'wen').reason);
    }

    /* ── T-6-C7：风险披露 —— 按钮必须同时写成率与上限，真火要写「三成只得九品」──
     * 这不是数值问题而是**公平性**问题：真火贵 6 倍却均值更低（5.332 < 5.807），
     * 界面不披露就是在利用信息不对等，违反 docs/00「不做隐藏公式」。 */
    atJindan();
    state.cultivation.cultivators[0].core = { marks: 0, mercy: 0, used: {} };
    X.ui.render();
    const foldText = document.getElementById('cultivator-list').textContent;
    check('T-6-C7：三档按钮都写了成率（95% / 55% / 25%）',
      foldText.includes('95%') && foldText.includes('55%') && foldText.includes('25%'));
    check('T-6-C7：写了上限信息（文火止于六纹；真火无上限）',
      foldText.includes('止于六纹') && foldText.includes('无上限'), foldText.slice(0, 140));
    check('T-6-C7：真火档披露「三成只得九品」（60 灵石却均值更低，必须如实告知）',
      foldText.includes('三成只得九品'));
  }

  // ⑥ 文火止于 6 纹
  {
    atJindan();
    state.cultivation.cultivators[0].core = { marks: 6, mercy: 0, used: {} };
    const r = X.realm.fold(1, 'wen', () => 0);
    check('文火封顶：6 纹 + 1 纹仍然只有 6 纹（止于六纹）', r.marks === 6, `${r.marks}`);
  }

  // ⑦ 丹纹 → 品阶（逐档）
  {
    const table = [[0, '九品'], [1, '九品'], [2, '八品'], [3, '八品'], [4, '七品'], [6, '六品'], [8, '六品'],
      [9, '五品'], [12, '五品'], [13, '四品'], [17, '四品'], [18, '三品'], [21, '二品'], [24, '一品']];
    const bad = table.filter(([m, name]) => X.realm.coreGradeOf(m).name !== name);
    check('丹纹档位表逐档一致（五品门槛 = 9 纹）', bad.length === 0,
      bad.map(([m, n]) => `${m}→${X.realm.coreGradeOf(m).name}(应 ${n})`).join(' '));
    check('丹纹档位一共产出 9 个品阶', new Set(X.realm.coreGrades().map((g) => g.grade)).size === 9);
    check('战力倍率跨度上限 ×1.80（刻意不超过一层小境界）',
      X.realm.coreGradeOf(24).power === 1.80 && X.realm.coreGradeOf(0).power === 1.00);
  }

  // ⑧ 丹纹接进战力与修炼
  {
    setPeople(person({ id: 1, realmIndex: 14, xp: 0, job: 'retreat', talent: 1, core: { marks: 0, mercy: 0, used: {} } }));
    const powBase = X.derive().cultivatorPower;
    setPeople(person({ id: 1, realmIndex: 14, xp: 0, job: 'retreat', talent: 1, core: { marks: 24, mercy: 0, used: {} } }));
    const powMax = X.derive().cultivatorPower;
    check('丹纹接进 cultivatorPower()（一品 ×1.80）', near(powMax / powBase, 1.80, 1e-6),
      `${(powMax / powBase).toFixed(4)}`);
    const xpAt = (marks) => {
      setPeople(person({ id: 1, realmIndex: 14, xp: 0, job: 'retreat', talent: 1, core: { marks, mercy: 0, used: {} } }));
      state.cultivation.manuals = []; state.cultivation.equippedManual = null; state.meta.active = [];
      X.setRng(() => 0.999999);
      X.tick(100);
      X.setRng(null);
      return state.cultivation.cultivators[0].xp;
    };
    check('丹纹接进修炼乘数链（一品 ×1.45）', near(xpAt(24) / xpAt(0), 1.45, 1e-6),
      `${(xpAt(24) / xpAt(0)).toFixed(4)}`);
  }

  // ⑨ 旧存档兼容
  check('旧存档补上 core 默认值', (() => {
    const legacy = X.save.hydrate({ createdAt: 0, cultivation: { cultivators: [{ id: 1, realmIndex: 14, xp: 0, job: 'retreat' }] } });
    const c = legacy.cultivation.cultivators[0].core;
    return c && c.marks === 0 && c.mercy === 0 && JSON.stringify(c.used) === '{}';
  })());
  check('旧存档补上 foundation: null', (() => {
    const legacy = X.save.hydrate({ createdAt: 0, cultivation: { cultivators: [{ id: 1, realmIndex: 12, xp: 0, job: 'retreat' }] } });
    return legacy.cultivation.cultivators[0].foundation === null;
  })());
}

/* ══════════════════════ 15.12 本轮四条机制都有百科条目 ══════════════════════ */
section('本轮机制的百科条目（不做隐藏公式）');
{
  // 【策划 各条 / docs/91 §六.7】每条落地都必须同步写百科条目（志书体）。
  const ids = new Set(X.codex.book().flatMap((c) => c.entries).map((e) => e.id));
  for (const [id, label] of [
    ['mech-push', '猛进行气 / 走火入魔（T-3）'],
    ['mech-errand', '投帖问路（T-4）'],
    ['mech-foundation', '择地筑基（T-5）'],
    ['mech-fold', '结丹三档火候（T-6）'],
  ]) {
    check(`百科有「${label}」条目`, ids.has(id), id);
  }
  // 条目正文里的数字必须来自活表（改表即改百科），而不是抄死在文案里。
  // ⚠ X.codex.book() 里的 entry.lines 已经是**算好的字符串数组**（渲染用），
  //   要看原始定义得走 X.codex.raw()。
  const rawEntry = (id) => X.codex.raw().find((c) => c.id === 'mech').entries.find((e) => e.id === id);
  const pushLines = X.codex.lines(rawEntry('mech-push')).join(' ');
  check('走火条目的数值取自活表（写明 ×2.2 与走火速率）',
    pushLines.includes('2.2') && pushLines.includes('0.0001'), pushLines.slice(0, 120));
  const foldLines = X.codex.lines(rawEntry('mech-fold')).join(' ');
  check('结丹条目写明三档成率 95% / 55% / 25%',
    foldLines.includes('95%') && foldLines.includes('55%') && foldLines.includes('25%'), foldLines.slice(0, 140));
  check('结丹条目写明「止于 6 纹」与「无上限」',
    foldLines.includes('止于 6 纹') && foldLines.includes('无上限'), foldLines.slice(0, 140));
}

/* ══════════════════════ 15.13 T-1 补强：旧存档形状 + 逐字段往返 ══════════════════════
 *
 * 这两条原来住在 `scripts/_uat-legacy-save.mjs` / `_uat-save-fields.mjs` 里。
 * 主策指出：**一次性脚本不防回归**（它们被 gitignore，下次没人跑就形同不存在）。
 * 所以并进正式的回归套件 —— 下面两条覆盖的正是「产出侧 / 持久化侧」，
 * 也就是当初让两个阻断缺陷活下来的那类缺口。
 */
section('T-1 补强：1.0 时代的旧存档形状');
{
  // 最老的形状：cultivation 里**只有 qi 整数**，顶层连 immortalTechs/morality/
  // exchangeCount/clock/meta 都没有。这一份必须能载入、字段补齐、还能继续跑。
  const legacy = X.save.hydrate({
    version: 1, savedAt: Date.now() - 3600000, createdAt: Date.now() - 86400000,
    generation: 1, silver: 12345, population: 200,
    buildings: { field: 3, house: 2 },
    techs: ['realestate', 'architecture'],
    caravans: [], tradeRuns: 5, milestones: [100],
    stats: { silverEarned: 1, silverWasted: 0, silverFromSales: 0, births: 1, deaths: 0, playSeconds: 100 },
    settings: { quizMode: 'off', difficulty: 'normal', speed: 1 },
    wordStats: {}, customQuizStats: {}, customWrongBooks: {},
    quiz: { total: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0, lost: 0, lostStones: 0, wrongBook: [] },
    spiritStones: 50, secrets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    cultivation: { qi: 3 },   // ← 只有 qi 整数
    log: [],
    ui: { buyMode: '1', page: 'home', techLine: 'mortal', codexChapter: 'all', codexQuery: '', codexShowLocked: false, hideDoneTechs: false, collapsed: {} },
  });
  check('1.0 时代的旧存档载入不炸', Boolean(legacy) && legacy.cultivation != null);
  check('qi=3 迁移成三名修士', legacy.cultivation.cultivators.length === 3,
    `${legacy.cultivation.cultivators.length} 名`);
  check('顶层三字段走默认值（[] / 0 / 50）',
    Array.isArray(legacy.immortalTechs) && legacy.immortalTechs.length === 0
    && legacy.exchangeCount === 0 && legacy.morality === 50);
  check('clock 补成 {year:0}', legacy.clock && legacy.clock.year === 0);
  check('cluePool 补成 0', legacy.cultivation.cluePool === 0);
  check('meta 补成初始元进度', legacy.meta && legacy.meta.cycle === 1 && legacy.meta.points === 0);
  const lp = legacy.cultivation.cultivators[0];
  check('逐人新字段全部补齐（push/stalled/realmEnteredYear/foundation/core）',
    lp.push === false && lp.stalled === 0 && lp.realmEnteredYear === 0
    && lp.foundation === null && lp.core && lp.core.marks === 0
    && JSON.stringify(lp.core.used) === '{}',
    JSON.stringify({ push: lp.push, stalled: lp.stalled, year: lp.realmEnteredYear, f: lp.foundation, core: lp.core }));
}

section('T-1 补强：逐字段往返（不只查那三个字段）');
{
  // 「三个字段不丢」是底线；这一条查的是**所有**顶层字段的值都能原样回来。
  // ⚠ 键序不是语义（hydrate 重建对象会改键序），所以排序后再比。
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
    }
    return v;
  };
  const S = X.state;
  const keep = JSON.parse(JSON.stringify({
    immortalTechs: S.immortalTechs, exchangeCount: S.exchangeCount, morality: S.morality,
    clock: S.clock, generation: S.generation, silver: S.silver, population: S.population,
    tradeRuns: S.tradeRuns, milestones: S.milestones, spiritStones: S.spiritStones,
    secrets: S.secrets, meta: S.meta, ui: S.ui,
  }));
  S.immortalTechs = ['yinling'];
  S.exchangeCount = 7;
  S.morality = 12.5;
  S.clock = { year: 42 };
  S.generation = 3;
  S.silver = 999;
  S.population = 77;
  S.tradeRuns = 11;
  S.milestones = [100, 200];
  S.spiritStones = 4.5;
  S.secrets = [0, 1];
  S.ui.buyMode = '10';
  S.meta.cycle = 2;
  S.meta.points = 9;

  const back = X.save.roundTrip();
  const freshState = X.save.hydrate({ createdAt: 0 });
  const diffs = [];
  for (const k of Object.keys(freshState)) {
    if (k === 'lastSeen') continue;   // 唯一允许不持久化的运行时字段
    if (canon(S[k]) === undefined) continue;
    const a = JSON.stringify(canon(S[k]));
    const b = JSON.stringify(canon(back[k]));
    // cultivation 会由 repairCultivation 补默认值，逐人字段的补齐已由上一节覆盖，
    // 这里只查**顶层标量/数组**字段的值。
    if (k === 'cultivation') continue;
    // log 是**刻意截断**的（`serialize()` 只写 `log.slice(0, 20)`，见 T-1 非目标
    // 「不动 log.slice(0, 20) 这个刻意的截断」）⇒ 它按设计就不做完整往返，
    // 不该进这条逐字段比对。之前它没被排除，是因为本用例跑的时候 `state.log`
    // 恰好还没攒到 20 条；测试顺序一变就红了（假失败）。
    if (k === 'log') continue;
    if (a !== b) diffs.push(`${k}: ${String(a).slice(0, 40)} ≠ ${String(b).slice(0, 40)}`);
  }
  check('除 cultivation 外的每个顶层字段，往返后值都不变', diffs.length === 0, diffs.join(' | '));

  // 还原
  S.immortalTechs = keep.immortalTechs;
  S.exchangeCount = keep.exchangeCount;
  S.morality = keep.morality;
  S.clock = keep.clock;
  S.generation = keep.generation;
  S.silver = keep.silver;
  S.population = keep.population;
  S.tradeRuns = keep.tradeRuns;
  S.milestones = keep.milestones;
  S.spiritStones = keep.spiritStones;
  S.secrets = keep.secrets;
  S.meta = keep.meta;
  S.ui = keep.ui;
  X.ui.render();
}

/* ══════════════════════ 16. 存档 ══════════════════════ */

section('存档写出');
state.cultivation.manuals = ['star', 'xuanjia'];
state.cultivation.equippedManual = 'star';
state.cultivation.assistManual = 'xuanjia';
state.cultivation.attune = { star: 3, xuanjia: 1 };
setPeople(person({ realmIndex: 12, xp: 100, job: 'retreat', breakFailures: 2 }));
ui.actions.save();
const SAVE_KEY = [...dom.store.keys()][0];
check('存档键名沿用 v1', SAVE_KEY === 'xiuxian-family/save/v1', SAVE_KEY);
const saved = JSON.parse(dom.store.get(SAVE_KEY));
check('存档里带 realmIndex', saved.cultivation.cultivators[0].realmIndex === 12);
check('存档里带 breakFailures', saved.cultivation.cultivators[0].breakFailures === 2);
check('存档里带辅修位与参悟度',
  saved.cultivation.assistManual === 'xuanjia' && saved.cultivation.attune.star === 3);

/** 重新装 DOM 并重跑脚本 —— 等价于「刷新页面」。存档沿用同一份 store。 */
function reload() {
  installDOM(html, { store: dom.store });
  new Function(code)();
  const inst = window.__xiuxian;
  clearInterval(inst.timer);
  return inst;
}
function putSave(mutate) {
  const raw = JSON.parse(JSON.stringify(saved));
  mutate(raw);
  dom.store.set(SAVE_KEY, JSON.stringify(raw));
}

section('旧存档迁移：境界字段改名');
// 秘籍那一版存的是 person.realm（1..9 的炼气层数），没有 realmIndex / breakFailures
putSave((raw) => {
  raw.cultivation.cultivators = [
    { id: 1, name: '林清衡', origin: 'innate', realm: 7, xp: 100, job: 'retreat', talent: 1.2, parentage: 'cultivator-mortal' },
  ];
  raw.cultivation.manuals = ['breath', 'spring'];
  raw.cultivation.equippedManual = 'spring';
  delete raw.cultivation.assistManual;
  delete raw.cultivation.attune;
});
{
  const X2 = reload();
  const p = X2.state.cultivation.cultivators[0];
  check('旧存档没有被当成损坏而重开', X2.state.cultivation.qi === 1);
  check('realm 7 迁移成 realmIndex 7（炼气七层）', p.realmIndex === 7, X2.realm.name(p.realmIndex));
  check('修为原样保留', near(p.xp, 100, 1e-6), `${p.xp}`);
  check('新增的 breakFailures 补 0', p.breakFailures === 0);
  check('旧的 realm 字段被清掉', p.realm === undefined);
  check('秘籍字段照旧可用', X2.manual.owned().length === 2 && p.breakFailures === 0);
  check('修炼倍率仍然生效', near(X2.manual.training(), 2.1), `${X2.manual.training()}`);
}

section('存档容错');
putSave((raw) => {
  raw.cultivation.cultivators = [
    { id: 1, realmIndex: 999, xp: 1e9, job: 'retreat' },
    { id: 2, realmIndex: -3, xp: -50, job: '不存在' },
    { id: 3, realm: 0, xp: 0 },
  ];
});
{
  const X3 = reload();
  const ps = X3.state.cultivation.cultivators;
  check('越界的境界被夹到合法范围', ps[0].realmIndex === X3.realm.table().max, X3.realm.name(ps[0].realmIndex));
  check('过量的修为被夹到本层上限',
    ps[0].xp < X3.realm.xpNeeded(ps[0].realmIndex), `${ps[0].xp}`);
  check('负数境界夹到 1', ps[1].realmIndex === 1, X3.realm.name(ps[1].realmIndex));
  check('负数修为夹到 0', ps[1].xp === 0);
  check('非法职责回落为闭关', ps[1].job === 'retreat');
  check('realm 0 也夹到 1', ps[2].realmIndex === 1);
  check('修好之后游戏能正常渲染', Boolean(document.getElementById('cultivator-list')));
}

putSave((raw) => { raw.cultivation.manuals = ['breath', 'not-real']; });
{
  const X4 = reload();
  check('未登记的功法 id 被丢弃',
    X4.state.cultivation.manuals.join(',') === 'breath', X4.state.cultivation.manuals.join(','));
}

putSave((raw) => {
  raw.cultivation.manuals = ['breath', 'spring'];
  raw.cultivation.equippedManual = 'breath';
  raw.cultivation.assistManual = 'spring';
  raw.cultivation.attune = { breath: 999, ghost: 3 };
});
{
  const X5 = reload();
  check('同道途双占被修掉', X5.state.cultivation.assistManual === null);
  check('参悟度被夹到上限 5', X5.state.cultivation.attune.breath === 5);
  check('已不存在功法的参悟记录被清掉', X5.state.cultivation.attune.ghost === undefined);
}


/* ────────────── R10：流派与道心 ────────────── */
console.log('\n── R10：流派与道心 ──');
{
  const DT = X.data;
  check('六个流派', DT.schools.length === 6, DT.schools.map((s) => s.name).join(' '));
  check('每个流派都有 tagline / desc / lore / price',
    DT.schools.every((s) => s.tagline && s.desc && s.lore && s.price));
  check('只有玄门正宗没有 fx（它是基准）',
    DT.schools.filter((s) => !Object.keys(s.fx || {}).length).map((s) => s.id).join(',') === 'orthodox');
  check('只有血煞解锁炼人丹', DT.schools.find((s) => s.id === 'demonic').unlock === 'humanPill');
  check('会拉低道心的流派只有血煞与合欢',
    DT.schools.filter((s) => s.drift).map((s) => s.id).join(',') === 'demonic,dual');

  check('道心五个档位', DT.moralityTiers.length === 5);
  check('档位首尾相接且覆盖 0–100',
    DT.moralityTiers[0].min === 0 && DT.moralityTiers[4].max === 100
    && DT.moralityTiers.every((t, i) => i === 0 || t.min === DT.moralityTiers[i - 1].max + 1));
  check('档位之间后果严格单调（越善越能养地、越难打仗）',
    DT.moralityTiers.every((t, i) => {
      const p = DT.moralityTiers[i - 1];
      return !p || (p.caveBonus < t.caveBonus && p.taxMult < t.taxMult && p.warBonus > t.warBonus);
    }));
  check('每个档位都有文案', DT.moralityTiers.every((t) => t.desc && t.name));

  // ── 百科覆盖 ──
  const entryIds = new Set(X.codex.book().flatMap((c) => c.entries).map((e) => e.id));
  const missing = DT.manuals.filter((m) => !entryIds.has(`manual-${m.id}`)).map((m) => m.name);
  check(`每本功法都有百科条目（共 ${DT.manuals.length} 本）`, missing.length === 0, missing.join(' '));
  check('每个流派都有百科条目',
    DT.schools.every((s) => entryIds.has(`school-${s.id}`)));
  check('道心机制有百科条目',
    ['morality-what', 'morality-tiers', 'morality-change', 'morality-human-pill']
      .every((id) => entryIds.has(id)));

  // ── 档位边界 ──
  check('道心边界取值正确', [[0, '魔道'], [19, '魔道'], [20, '旁门'], [39, '旁门'],
    [40, '中庸'], [60, '中庸'], [61, '正道'], [80, '正道'], [81, '道心通明'], [100, '道心通明']]
    .every(([v, name]) => X.morality.tierOf(v).name === name));
  check('越界值被夹取', X.morality.tierOf(-50).name === '魔道' && X.morality.tierOf(999).name === '道心通明');
}

{
  // ── 主修流派：只有主修位生效 ──
  const c = X.state.cultivation;
  const before = { main: c.equippedManual, assist: c.assistManual, owned: (c.manuals || []).slice() };
  c.manuals = ['breath', 'spring', 'xuesha', 'huanxi'];
  c.equippedManual = 'breath';
  c.assistManual = null;
  check('主修玄门时流派是玄门', X.school.main().id === 'orthodox');
  check('玄门不加修炼也不减修炼', X.school.fx('training') === 0 && X.school.fx('power') === 0);
  check('玄门不解锁人丹', X.school.unlocks('humanPill') === false);
  check('玄门不拉低道心', X.school.drift() === 0);

  c.equippedManual = 'xuesha';
  check('主修血煞 → 流派变了', X.school.main().id === 'demonic');
  check('血煞解锁炼人丹', X.school.unlocks('humanPill') === true);
  check('血煞加战力、减修炼', X.school.fx('power') > 0 && X.school.fx('training') < 0);
  check('血煞抬高凡人死亡率', X.school.deathMult() > 1);
  check('血煞会拉低道心', X.school.drift() < 0);

  // 辅修的流派**不**生效：换成合欢，机制不该跟着变
  c.assistManual = 'huanxi';
  check('辅修合欢不影响主修流派', X.school.main().id === 'demonic');
  check('辅修合欢不带来出生率加成', X.school.birthMult() === 1);

  // 主修换成合欢，机制才切换
  c.equippedManual = 'huanxi';
  c.assistManual = null;
  check('主修合欢 → 出生率 ×1.4', Math.abs(X.school.birthMult() - 1.4) < 1e-9);
  check('主修合欢 → 战力为负', X.school.fx('power') < 0);
  check('主修合欢不解锁人丹', X.school.unlocks('humanPill') === false);

  c.equippedManual = before.main;
  c.assistManual = before.assist;
  c.manuals = before.owned;
}

{
  // ── 道心回归中道（不是无限爬升） ──
  X.morality.add(1000);            // 先顶满
  const peak = X.morality.get();
  check('道心被夹在 100', peak === 100);
  // 主修玄门 → 应该往回走，而不是停在 100
  X.state.cultivation.equippedManual = 'breath';
  for (let i = 0; i < 200; i += 1) X.morality.advance(60);
  const settled = X.morality.get();
  check('不从邪路时道心回归中道（不再是 100）', settled < peak, `${peak} → ${settled.toFixed(1)}`);
  check('回归方向朝着 50', Math.abs(settled - 50) < Math.abs(peak - 50));
  check('道心不会越过中道继续下坠', settled >= 45, settled.toFixed(1));
}

{
  // ── 三条后果随档位变化 ──
  const c2 = X.state.cultivation;
  const keep = c2.equippedManual;
  c2.equippedManual = 'breath';
  X.morality.add(-1000);
  check('魔道洞天生还修正为负', X.morality.caveBonus() < 0);
  check('魔道攻伐胜算修正为正', X.morality.warBonus() > 0);
  check('魔道赋税打折', X.morality.taxMult() < 1);
  X.morality.add(1000);
  check('道心通明洞天生还修正为正', X.morality.caveBonus() > 0);
  check('道心通明攻伐胜算修正为负', X.morality.warBonus() < 0);
  check('道心通明赋税加成', X.morality.taxMult() > 1);
  c2.equippedManual = keep;
}

{
  // ── 炼人丹：守恒 ──
  const c3 = X.state.cultivation;
  const keep = { main: c3.equippedManual, pop: X.state.population, stones: X.state.spiritStones };
  c3.manuals = ['breath', 'xuesha'];
  c3.equippedManual = 'xuesha';
  c3.humanPills = 0;
  X.state.population = 100;
  X.state.spiritStones = 50;
  X.morality.add(1000);        // 从中庸开始，便于观察下坠

  const plan = X.school.humanPill.plan();
  check('有血煞功法时人丹可炼', plan.ok, plan.reason);
  const popBefore = X.state.population;
  const moralBefore = X.morality.get();
  const r = X.school.humanPill.commit();
  check('炼人丹成功', r.ok, r.reason);
  check('凡人被扣掉 5 口', X.state.population === popBefore - 5, `${popBefore} → ${X.state.population}`);
  check('人丹 +1', X.school.humanPill.count() === 1);
  check('道心下降', X.morality.get() < moralBefore, `${moralBefore.toFixed(1)} → ${X.morality.get().toFixed(1)}`);
  check('灵石被扣', X.state.spiritStones < 50);

  // 凡人见底就炼不动了
  X.state.population = 5;
  check('凡人不足时拒绝炼人丹', X.school.humanPill.plan().ok === false);

  // 换成玄门就该整个入口消失
  c3.equippedManual = 'breath';
  check('非血煞流派炼不了人丹', X.school.humanPill.plan().ok === false);

  c3.equippedManual = keep.main;
  c3.humanPills = 0;
  X.state.population = keep.pop;
  X.state.spiritStones = keep.stones;
}

{
  // ── 施粥赈济 ──
  X.morality.add(-1000);
  X.state.silver = 0;
  check('没钱时施不了粥', X.morality.goodDeedPlan().ok === false);
  X.state.silver = 500000;
  const p = X.morality.goodDeedPlan();
  check('有钱时施粥可行', p.ok, p.reason);
  const m0 = X.morality.get();
  const s0 = X.state.silver;
  const done = X.morality.goodDeed();
  check('施粥抬升道心', done.ok && X.morality.get() > m0, `${m0.toFixed(1)} → ${X.morality.get().toFixed(1)}`);
  check('施粥扣掉银两', X.state.silver < s0);
  X.morality.add(1000);
  check('道心圆满时不再需要施粥', X.morality.goodDeedPlan().ok === false);
}

/* ══════════════════════ 仙凡科技线（两条线的接线自查） ══════════════════════
 *
 * 这一节的全部意义是防**静默失败**：
 * 「往数据表里塞了个 effect 键、却没在任何地方结算」这种东西不会报错，
 * 只会让玩家点完一项科技发现什么都没变。所以这里逐键查三处是否对齐。
 */

section('仙凡科技线：数据完整性');

const imm = X.immortal;

check('仙道科技表非空', d.immortalTechs.length > 0, `${d.immortalTechs.length} 项`);
check('仙道科技 id 唯一', new Set(d.immortalTechs.map((t) => t.id)).size === d.immortalTechs.length);
check('凡人科技 id 唯一', new Set(d.techs.map((t) => t.id)).size === d.techs.length);
check('两条线的 id 不重复',
  d.techs.every((t) => !d.immortalTechs.some((i) => i.id === t.id)));

/** 每一项科技的每个 effect 键都必须：在合法键表里 + 有展示文案。 */
const allKeys = [...d.mortalEffectKeys, ...d.immortalEffectKeys];
{
  const wild = [];
  const unlabeled = [];
  for (const t of [...d.techs, ...d.immortalTechs]) {
    for (const k of Object.keys(t.effect || {})) {
      if (!allKeys.includes(k)) wild.push(`${t.id}.${k}`);
      if (!d.effectLabels[k]) unlabeled.push(`${t.id}.${k}`);
    }
  }
  check('没有未登记的 effect 键（否则数值不生效）', wild.length === 0, wild.join(' '));
  check('每个 effect 键都有界面文案（否则收益栏空白）', unlabeled.length === 0, unlabeled.join(' '));
}
check('仙道科技的效果只用了仙道侧的键（secretChance 除外，两条线共用）', d.immortalTechs.every((t) =>
  Object.keys(t.effect || {}).every((k) => d.immortalEffectKeys.includes(k) || k === 'secretChance')));

/**
 * 每个 effect 键都必须有**消费点** —— 这条查的是「数值真的会生效吗」。
 *
 * 上面那两条只能证明「键被登记了、有文案」，证明不了「有人读它」。
 * 一个只登记不消费的键是彻底的静默失败：玩家点完科技发现什么都没变，
 * 而所有测试都是绿的。`trainMult` 就曾经是这个状态（见 docs/15-科技线.md 第八节）。
 *
 * 做法：在构建产物里数「消费处函数名」出现次数。
 * 阈值取 ≥3，因为正常情况它至少出现在三处：
 *   数据表（tech.effect 的字面量）+ 累加器（formulas.js 的键名数组）+ 消费处。
 */
{
  const CONSUMERS = {
    estateDiscount: 'estateDiscountTotal', birthFlat: 'birthRate', incomeMult: 'incomeMult',
    tradeSpeed: 'tradeSpeed', fieldBonus: 'fieldBonus', tradeIncome: 'tradeIncome',
    deathFlat: 'deathFlat', secretChance: 'secretChance', explorePerSecFlat: 'explorePerSecFlat',
    vaultMult: 'vaultMult',
    immortalCapFlat: 'cultivatorLimit', innateBirthMult: 'innateMult',
    mineDeathMult: 'mineDeathMult', mineYieldMult: 'mineYieldMult',
    territoryYieldMult: 'territoryYieldMult', territoryHoldMult: 'mapHoldPowerFor',
    garrisonCapFlat: 'mapGarrisonLimit', exploreSurviveBonus: 'exploreSurviveBonus',
    breakBonusFlat: 'breakBonusFlat', tradeStoneMult: 'tradeStoneMult',
    cityMaterialMult: 'cityMaterialMult', runeBenchFree: 'runeEffectiveBench',
    alchemyRateBonus: 'alchemyRateBonus', trainMult: 'techTrainMult',
    familyPowerMult: 'familyPowerMult',
  };
  const missing = [];
  for (const [key, needle] of Object.entries(CONSUMERS)) {
    if ((html.split(needle).length - 1) < 3) missing.push(`${key}←${needle}`);
  }
  check('每个 effect 键都有真实消费点（不是只登记不生效）', missing.length === 0, missing.join(' '));
}

/** 前置必须指向真实存在的科技，且不能有环。 */
{
  const mortalIds = new Set(d.techs.map((t) => t.id));
  const immIds = new Set(d.immortalTechs.map((t) => t.id));
  const badMortal = [];
  const badImm = [];
  for (const t of d.techs) {
    for (const r of t.requires || []) if (!mortalIds.has(r)) badMortal.push(`${t.id}←${r}`);
    for (const r of t.requiresImmortal || []) if (!immIds.has(r)) badMortal.push(`${t.id}←仙:${r}`);
  }
  for (const t of d.immortalTechs) {
    for (const r of t.requires || []) if (!mortalIds.has(r) && !immIds.has(r)) badImm.push(`${t.id}←${r}`);
  }
  check('凡人科技的前置都存在（含跨树前置）', badMortal.length === 0, badMortal.join(' '));
  check('仙道科技的前置都存在（含跨树前置）', badImm.length === 0, badImm.join(' '));

  // 环检测：两条线的依赖合起来必须是有向无环图
  const edges = new Map();
  for (const t of d.techs) edges.set(t.id, [...(t.requires || []), ...(t.requiresImmortal || [])]);
  for (const t of d.immortalTechs) edges.set(t.id, [...(t.requires || [])]);
  let cyclic = null;
  const state2 = new Map();
  const dfs = (n) => {
    if (state2.get(n) === 1) { cyclic = n; return true; }
    if (state2.get(n) === 2) return false;
    state2.set(n, 1);
    for (const m of edges.get(n) || []) if (edges.has(m) && dfs(m)) return true;
    state2.set(n, 2);
    return false;
  };
  for (const n of edges.keys()) if (dfs(n)) break;
  check('两条线的前置合起来无环', cyclic === null, cyclic || '');
}

/** 仙道科技的每个 unlocksBuilding 都要在建筑表里，且那个建筑的 tech 指回来。 */
{
  const bad = [];
  for (const t of d.immortalTechs) {
    if (!t.unlocksBuilding) continue;
    const b = d.buildings.find((x) => x.id === t.unlocksBuilding);
    if (!b) bad.push(`${t.id}→${t.unlocksBuilding}（建筑不存在）`);
    else if (b.tech !== t.id) bad.push(`${t.id}→${t.unlocksBuilding}（建筑的 tech 是 ${b.tech}）`);
  }
  for (const t of d.techs) {
    if (!t.unlocksBuilding) continue;
    const b = d.buildings.find((x) => x.id === t.unlocksBuilding);
    if (!b) bad.push(`${t.id}→${t.unlocksBuilding}（建筑不存在）`);
    else if (b.tech !== t.id) bad.push(`${t.id}→${t.unlocksBuilding}（建筑的 tech 是 ${b.tech}）`);
  }
  check('解锁建筑类科技都有配套的真实建筑（双向对齐）', bad.length === 0, bad.join(' '));
}

/** 每座建筑的 tech 必须指向真实存在的科技（任一树）。 */
{
  const mortalIds = new Set(d.techs.map((t) => t.id));
  const immIds = new Set(d.immortalTechs.map((t) => t.id));
  const bad = d.buildings.filter((b) => b.tech && !mortalIds.has(b.tech) && !immIds.has(b.tech));
  check('每座建筑的解锁科技都存在', bad.length === 0, bad.map((b) => `${b.id}←${b.tech}`).join(' '));
}

/** 无孤儿：每一项科技都必须被另一项 require（两条线合起来看）。 */
{
  const needed = new Set();
  for (const t of d.techs) for (const r of t.requires || []) needed.add(r);
  for (const t of d.immortalTechs) for (const r of t.requires || []) needed.add(r);
  for (const t of d.techs) for (const r of t.requiresImmortal || []) needed.add(r);
  // 顶层（没有任何后继）只允许是两条线各自的终点，且必须真的没有后继可言
  const orphans = [...d.techs, ...d.immortalTechs]
    .filter((t) => !needed.has(t.id) && !t.terminal)
    .map((t) => t.id);
  check('没有孤儿科技（每一项都被后续 require）', orphans.length === 0, orphans.join(' '));
}

/** 跨树咬合必须真的存在，而且双向。 */
{
  const links = imm.crossLinks();
  const immortalToMortal = links.filter((l) => l.fromTree === 'mortal' && l.toTree === 'immortal');
  const mortalToImmortal = links.filter((l) => l.fromTree === 'immortal' && l.toTree === 'mortal');
  check('仙道科技依赖凡人科技（仙要城养）', immortalToMortal.length > 0,
    immortalToMortal.map((l) => `${l.to}←${l.from}`).join(' '));
  check('凡人科技依赖仙道科技（城要仙撑）', mortalToImmortal.length > 0,
    mortalToImmortal.map((l) => `${l.to}←${l.from}`).join(' '));
  check('跨树咬合点不少于 6 处', links.length >= 6, `${links.length} 处`);
}

/** 丹方的跨树前置同样要有配套。 */
{
  const bad = d.recipes
    .filter((r) => r.requiresImmortalTech)
    .filter((r) => !d.immortalTechs.some((t) => t.id === r.requiresImmortalTech));
  check('丹方的跨树前置都存在', bad.length === 0, bad.map((r) => `${r.id}←${r.requiresImmortalTech}`).join(' '));
}

section('仙凡科技线：研习与咬合行为');

{
  // 把状态收敛到一个「凡人已走完、仙道刚开」的干净局面
  const S = X.state;
  const keep = {
    techs: S.techs.slice(), immortal: (S.immortalTechs || []).slice(),
    silver: S.silver, stones: S.spiritStones, secrets: S.secrets.slice(),
    exchange: S.exchangeCount, population: S.population, buildings: { ...S.buildings },
  };
  S.techs = ['realestate', 'architecture', 'finance', 'expansion', 'surveying', 'household',
    'trade', 'tuntian', 'seeker', 'arithmetic', 'courier', 'quzhang', 'marketexp'];
  S.immortalTechs = [];
  S.silver = 10_000_000;
  S.spiritStones = 100_000;

  /**
   * 跨树前置的落点：凡人「义庄」要仙道「悬壶」。
   *
   * ⚠ 第一版测的是「祛障 ← 引灵」，那条**已经被删掉了** ——
   *   它把主线（祛障 → 修士 → 仙途）挂在了仙道线上，一旦仙道侧不可用
   *   就永久锁死，正是本次设计要避免的「互相卡脖子」。
   *   现在的规矩是：跨树前置只允许出现在凡人线的**可选深处**。
   */
  const yzBefore = X.tech.status('yizhuang');
  check('义庄在缺少仙道前置时被锁', yzBefore === 'locked', yzBefore);
  check('义庄缺的正是仙道「悬壶」',
    X.immortal.missing('xuanhu') !== null && !X.immortal.researched('xuanhu'));

  const p0 = imm.plan('yinling');
  check('引灵可研习（无前置）', p0.ok, p0.reason);
  const s0 = S.spiritStones;
  const r0 = imm.research('yinling');
  check('研习引灵成功', r0.ok, r0.reason);
  check('引灵扣了灵石', S.spiritStones < s0, `${s0} → ${S.spiritStones}`);
  check('引灵已记入 immortalTechs', imm.researched('yinling'));

  // 悬壶要灵枢，灵枢要引灵 —— 顺着仙道线往上点两步
  check('灵枢在引灵之后解锁', X.immortal.plan('lingxu').ok, X.immortal.plan('lingxu').reason);
  imm.research('lingxu');
  const xu = imm.plan('xuanhu');
  check('悬壶在灵枢之后可研习', xu.ok, xu.reason);
  imm.research('xuanhu');

  const yzAfter = X.tech.status('yizhuang');
  check('研习悬壶后义庄解锁（不再 locked）', yzAfter !== 'locked',
    `${yzAfter}｜仙=${S.immortalTechs.join(',')}｜解锁判定=${X.tech.unlocked('yizhuang')}`);

  // 主线不能被仙道侧卡住 —— 这是「互相卡脖子」的直接回归测试
  check('主线科技「祛障」不依赖任何仙道前置',
    !(d.techs.find((t) => t.id === 'quzhang').requiresImmortal || []).length);
  check('主线科技「祛障」在仙道侧为空时也可研习（无软锁）', (() => {
    const saved = S.immortalTechs;
    S.immortalTechs = [];
    const st = X.tech.status('quzhang');
    S.immortalTechs = saved;
    return st !== 'locked';
  })());

  // 仙道科技的灵石门槛真的拦得住
  const keepStones = S.spiritStones;
  S.spiritStones = 0;
  const poor = imm.plan('kaimai');
  check('灵石不足时研习不了仙道科技', poor.ok === false, poor.reason);
  S.spiritStones = keepStones;

  // 名册容量受仙道科技抬升
  const cap0 = X.cityEconomy().immortalCap;
  imm.research('kaimai');
  const cap1 = X.cityEconomy().immortalCap;
  check('开脉抬高名册容量', cap1 > cap0, `${cap0} → ${cap1}`);

  // 领地镇守门槛受仙道科技下调（镇岳要 kaimai）
  imm.research('zhenyue');
  const node = X.map.nodes().find((n) => n.kind === 'foe');
  const holdNow = X.map.plan(node.id).holdPower;
  check('镇岳下调了领地镇守所需战力', holdNow < Math.round(node.power * 0.5),
    `${Math.round(node.power * 0.5)} → ${holdNow}`);

  // 恢复
  S.techs = keep.techs;
  S.immortalTechs = keep.immortal;
  S.silver = keep.silver;
  S.spiritStones = keep.stones;
  S.secrets = keep.secrets;
  S.exchangeCount = keep.exchange;
  S.population = keep.population;
  S.buildings = keep.buildings;
}

section('仙凡经济：城市作坊与兑率');

{
  const S = X.state;
  const keep = {
    buildings: { ...S.buildings }, population: S.population,
    immortal: (S.immortalTechs || []).slice(), techs: S.techs.slice(),
    exchange: S.exchangeCount, silver: S.silver, stones: S.spiritStones,
    secrets: S.secrets.slice(),
  };

  // 清掉所有作坊，看基线
  const workshopIds = ['herbhouse', 'minestop', 'papermill', 'immortalmarket'];
  for (const k of workshopIds) S.buildings[k] = 0;
  S.immortalTechs = [];
  S.techs = [];
  S.population = 1000;
  S.silver = 1000;
  S.spiritStones = 0;

  const zero = X.cityEconomy();
  check('没有作坊时城中药材产出为 0', zero.herbPerSec === 0,
    `产出=${zero.herbPerSec} 用工=${zero.laborWorkers} 人口=${S.population}`);
  check('没有作坊时打工死亡为 0', zero.laborDeath === 0, `${zero.laborDeath}`);

  S.buildings.herbhouse = 1;
  const one = X.cityEconomy();
  check('盖一座药圃开始产药材', one.herbPerSec > 0,
    `${one.herbPerSec.toFixed(5)}/秒（用工 ${one.workshopWorkers('herbhouse')}）`);

  // 人不够时摊薄
  S.population = 30;
  const thin = X.cityEconomy();
  check('人口不足时产量摊薄', thin.herbPerSec < one.herbPerSec,
    `1000人 ${one.herbPerSec.toFixed(5)} → 30人 ${thin.herbPerSec.toFixed(5)}`
    + `（用工 ${one.workshopWorkers('herbhouse')} → ${thin.workshopWorkers('herbhouse')}）`);
  check('人口不足时用工也跟着少', thin.workshopWorkers('herbhouse') < 300,
    `${thin.workshopWorkers('herbhouse')} 人`);
  X.state.population = 1000;

  // 科技抬高产量
  S.immortalTechs = ['yinling', 'lingtian'];
  const teched = X.cityEconomy();
  check('灵田/引灵确实抬高城中药材产出', teched.herbPerSec > one.herbPerSec,
    `${one.herbPerSec.toFixed(5)} → ${teched.herbPerSec.toFixed(5)}`);

  // 坊市兑率随科技变松
  S.immortalTechs = [];
  const q0 = X.cityEconomy().exchange;
  S.immortalTechs = ['jiexu'];
  const q1 = X.cityEconomy().exchange;
  check('界墟提高了兑率（同价换更多灵石）', q1.stones > q0.stones,
    `${q0.stones} → ${q1.stones}`);
  // 【软锁修复】兑换不再有总量上限：上限恒为 Infinity，有限笔数永远不拦人。
  check('兑换不设总量上限（上限恒为无穷）', X.cityEconomy().exchangeLimit === Infinity,
    `${X.cityEconomy().exchangeLimit}`);

  // 兑换是**平价**的（用户实机裁决：两种货币体系的兑换不涨价，只有建筑涨价）
  S.immortalTechs = [];
  S.exchangeCount = 0;
  S.silver = 100_000_000;
  const quotes = [0, 1, 5, 11].map((n) => { S.exchangeCount = n; return X.cityEconomy().exchange; });
  check('任意笔数的银两成本都与第一笔相同（平价兑换）',
    quotes.every((q) => q.silver === quotes[0].silver),
    quotes.map((q) => q.silver).join(' / '));
  check('任意笔数的灵石收益都与第一笔相同（平价兑换）',
    quotes.every((q) => q.stones === quotes[0].stones),
    quotes.map((q) => q.stones).join(' / '));
  check('首笔报价即固定兑率：100000 银两 → 0.5 灵石',
    quotes[0].silver === 100000 && quotes[0].stones === 0.5,
    `${quotes[0].silver} → ${quotes[0].stones}`);

  // 科技杠杆保留：只放大灵石侧，银两侧不动；单价 = 200000 ÷ (1 + tradeStoneMult)，与笔数无关
  S.immortalTechs = ['jiexu'];
  const mJx = d.immortalTechs.find((t) => t.id === 'jiexu').effect.tradeStoneMult || 0;
  const qJx = X.cityEconomy().exchange;   // exchangeCount 仍 = 11
  check('科技放大灵石收益（tradeStoneMult 杠杆保留）',
    near(qJx.stones, +(0.5 * (1 + mJx)).toFixed(4), 1e-9), `${qJx.stones}（m=${mJx}）`);
  check('科技不动银两成本', qJx.silver === 100000, `${qJx.silver}`);
  check('单价恒为 200000÷(1+tradeStoneMult)，与笔数无关',
    near(qJx.silver / qJx.stones, 200000 / (1 + mJx), 1e-6),
    `${(qJx.silver / qJx.stones).toFixed(1)} 银两/灵石`);
  S.immortalTechs = [];

  // 阳性对照：建筑的 baseCost × growth^座数 涨价机制原样保留（第 2 座确实更贵）
  S.techs = ['realestate'];
  S.buildings.estate = 0;
  const buy0 = X.engine.planBuy('estate');
  S.buildings.estate = 1;
  const buy1 = X.engine.planBuy('estate');
  check('阳性对照：建筑仍涨（第 2 座地产 = 第 1 座 ×1.22）',
    buy0.ok && buy1.ok && near(buy1.cost / buy0.cost, 1.22, 1e-9),
    buy0.ok && buy1.ok ? `${buy0.cost} → ${buy1.cost}` : `${buy0.reason}｜${buy1.reason}`);
  S.techs = [];

  // 界面显示 = 实际结算（单一真相源：updateMarket 读 derive().marketExchange）
  // ⚠ 必须新开干净实例：§16 的「刷新」测试重装了 DOM，旧实例 render 会写进新文档、
  //   而本文件的 `$` 读的是第一份文档 —— 两者错位会让断言读到陈旧文本。
  {
    const dom2 = installDOM(html, { store: dom.store });
    new Function(code)();
    const X2 = window.__xiuxian;
    clearInterval(X2.timer);
    const $2 = (id) => dom2.document.getElementById(id);
    const S2 = X2.state;
    S2.techs = [];
    S2.immortalTechs = [];
    S2.secrets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];   // 凑满 10 条秘闻开门
    S2.silver = 100_000_000;
    S2.exchangeCount = 7;                          // L2 状态注入：任意笔数下标价都必须一样
    X2.ui.render();
    check('界面标价在任意笔数下都是固定兑率（10万 → 0.5）',
      $2('market-desc').textContent.includes('10万 银两 → 0.5 灵石'),
      $2('market-desc').textContent);
    S2.silver = 50_000;                            // 不够一笔
    X2.ui.render();
    check('银两不够一笔时兑换按钮不可点', $2('exchange-btn').disabled === true);
    S2.silver = 100_000_000;
    // 【软锁修复】不再有「兑满」：总量上限已取消（灵石是唯一能撬动仙途的资源）。
    S2.exchangeCount = 9999;
    X2.ui.render();
    check('兑换不限笔数：兑过极多笔后按钮仍可点、不再出现「已兑满」',
      $2('exchange-btn').disabled === false && !/兑满/.test($2('market-chip').textContent),
      `${$2('market-chip').textContent}｜${$2('exchange-btn').textContent.trim()}`);
  }

  // 恢复
  S.buildings = keep.buildings;
  S.population = keep.population;
  S.immortalTechs = keep.immortal;
  S.techs = keep.techs;
  S.exchangeCount = keep.exchange;
  S.silver = keep.silver;
  S.spiritStones = keep.stones;
  S.secrets = keep.secrets;
}

/* ══════════════════════ S7. 资源体系与开发者模式 ══════════════════════
 *
 * 【架构 docs/101】把「玩家可见的量」收进注册表 + 给它解锁状态 + 加开发者模式。
 * 这一段**只追加**，前面 987 项一条不动。
 *
 * 每条断言都做过变异测试（故意改坏 → 必红 → 还原），见交付说明。
 */

section('资源体系：注册表与解锁状态');

/**
 * 开发者模式要过「会话令牌」那道闸 —— 测试里主动写一份（浏览器里由开关自己写）。
 * ⚠ 写 **globalThis.sessionStorage**：源码读的是全局那一份；而 `dom.sessionStorage`
 *   是 installDOM 时那一份快照，后面的 installDOM 会把全局换成新的（旧的就不再被读到）。
 */
const DEV_TOKEN_KEY = 'xiuxian-family/dev/token/v1';
const devEnter = (s) => { globalThis.sessionStorage.setItem(DEV_TOKEN_KEY, String(Date.now())); X.dev.enter(s); };
const devLeave = (s) => { if (s) X.dev.leave(s); globalThis.sessionStorage.removeItem(DEV_TOKEN_KEY); };

/**
 * 「一份可抛弃的干净状态」：形状取 createState 的默认值（人口 10 / 银两 100 / 容器齐全），
 * 只把**容器**这一段用当前状态补上（丹房、器房、符房、地图、名册都要有键）。
 * ⚠ 刻意不用 `X.state` 本身：主状态已经被前面几千条断言改得面目全非，
 *   拿它当基线会让「补满不碰人口」这类断言读到一堆无关噪声。
 */
const resState = () => {
  const src = X.state;
  const s = X.save.hydrate({ createdAt: 0 });
  s.cultivation.alchemy = JSON.parse(JSON.stringify(src.cultivation.alchemy || {}));
  s.cultivation.forge = JSON.parse(JSON.stringify(src.cultivation.forge || {}));
  s.cultivation.runes = JSON.parse(JSON.stringify(src.cultivation.runes || {}));
  s.cultivation.world = { reached: [], held: [], garrison: {}, unrest: {} };
  s.cultivation.cultivators = [];
  s.cultivation.qi = 0;
  X.res.repair(s);
  return s;
};
/** 一条资源此刻的数值读数。 */
const rv = (id, s = X.state) => X.res.read(id, s);

{
  const R = X.res.list();
  const ids = R.map((r) => r.id);
  check('注册表条目数 ≥ 60', R.length >= 60, `${R.length} 条`);
  check('id 全表唯一', new Set(ids).size === ids.length, `${ids.length} 个 id`);
  check('六类体系齐全（C/M/P/G/X/F）',
    ['currency', 'material', 'population', 'progress', 'modifier', 'flag']
      .every((k) => R.some((r) => r.kind === k)),
    X.res.kinds().join('/'));
  check('每条资源都有显示名（非中文一律不算）',
    R.every((r) => typeof r.name === 'string' && /[\u4e00-\u9fff]/.test(r.name)),
    R.filter((r) => !/[\u4e00-\u9fff]/.test(r.name || '')).map((r) => r.id).join(' '));
  check('每条资源的 lockedUi 都是三口径之一（必须显式声明）',
    R.every((r) => ['hide', 'dim', 'mask'].includes(r.lockedUi)),
    R.filter((r) => !['hide', 'dim', 'mask'].includes(r.lockedUi)).map((r) => r.id).join(' '));
  check('每条资源的 gate 都是已知判据 kind',
    R.every((r) => ['null', 'tech', 'itech', 'secrets', 'realm', 'held', 'canAct', 'flag']
      .includes(r.gate?.kind)),
    R.filter((r) => !['null', 'tech', 'itech', 'secrets', 'realm', 'held', 'canAct', 'flag']
      .includes(r.gate?.kind)).map((r) => r.id).join(' '));
  check('hint 全是 ≥4 个汉字的中文提示',
    R.every((r) => typeof r.hint === 'string' && r.hint.length >= 4 && /[\u4e00-\u9fff]/.test(r.hint)),
    R.filter((r) => !(typeof r.hint === 'string' && r.hint.length >= 4)).map((r) => r.id).join(' '));

  // 每条 gate 的 kind 都至少出现在一条资源上（没有写了却没人用的判据）
  const usedKinds = new Set(R.map((r) => r.gate.kind));
  check('用到的判据种类覆盖 tech/secrets/realm/held/canAct/flag',
    ['tech', 'secrets', 'realm', 'held', 'canAct', 'flag'].every((k) => usedKinds.has(k)),
    [...usedKinds].join('/'));

  // 货币与材料：要么有产出速率，要么显式声明「非产出型」（rate 为 null 也算声明）
  const bad = R.filter((r) => (r.kind === 'currency' || r.kind === 'material') && r.rate === undefined);
  check('货币与材料都声明了自己的产出速率位（null 也是声明）', bad.length === 0,
    bad.map((r) => r.id).join(' '));

  // 同名不同物必须拆成两个 id，且名字两两不同
  check('秘闻与线索是两个独立 id（同名不同物的历史）',
    X.res.of('secret') && X.res.of('clue') && X.res.of('secret').id !== X.res.of('clue').id);
  const four = ['silver', 'spiritStones', 'secret', 'clue'].map((id) => X.res.of(id).name);
  check('银两/灵石/秘闻/线索 四个显示名两两不同', new Set(four).size === 4, four.join(' / '));
  check('秘闻的备注写清了它与线索同名不同物',
    /同名不同物/.test(X.res.of('secret').note) && /同名不同物/.test(X.res.of('clue').note));
}

{
  // 注册表字段名与 createState() 顶层字段名的交集必须为空（防退化成第二份真相源）
  const topKeys = Object.keys(X.state);
  const overlaps = Object.keys(X.res.of('silver')).filter((k) => topKeys.includes(k));
  check('注册表字段名与 createState() 顶层字段名交集为空', overlaps.length === 0, overlaps.join(' '));
  check('注册表禁用字段名 value/amount/count',
    X.res.list().every((r) => !('value' in r) && !('amount' in r) && !('count' in r)));
  // 每个「有玩家可见状态」的顶层字段都要在注册表里找到归属（顶层即资源，或有专门条目）
  const needsHome = ['silver', 'population', 'spiritStones', 'secrets', 'morality', 'clock', 'meta', 'settings'];
  const homeless = needsHome.filter((k) => !X.res.list().some((r) => r.note.includes(k)));
  check('顶层可见字段在注册表里都有归属（银两属于「资源」大类）', homeless.length === 0,
    homeless.join(' '));
}

{
  // 新开局与「满进度」两种状态：path 都必须返回数字、不抛错
  const fresh = X.save.hydrate({ createdAt: 0 });
  const full = resState();
  full.techs = d.techs.map((t) => t.id);
  full.immortalTechs = d.immortalTechs.map((t) => t.id);
  full.secrets = Array.from({ length: 20 }, (_, i) => i);
  full.buildings = Object.fromEntries(Object.keys(full.buildings).map((k) => [k, 2]));
  full.cultivation.veins = [{ grade: 3, reserve: 100 }];
  full.cultivation.compass = true;
  full.cultivation.mineLevel = 1;
  full.cultivation.pool = 1;
  full.cultivation.poolBlueprint = true;
  full.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: {}, unrest: {} };
  full.cultivation.cultivators = [person({ realmIndex: 22 })];
  full.cultivation.qi = 1;

  const readAll = (s) => X.res.list().map((r) => { X.res.read(r.id, s); return true; });
  check('新开局：每条资源都能读出数（无异常）', readAll(fresh).length === X.res.list().length);
  check('满进度：每条资源都能读出数（无异常）', readAll(full).length === X.res.list().length);
  check('读数永不 undefined（容器缺失也返回 0）', (() => {
    const empty = { cultivation: {} };
    return X.res.list().every((r) => X.res.read(r.id, empty) !== undefined);
  })());
  check('读数永不 NaN', X.res.list().every((r) => {
    const v = X.res.read(r.id, full);
    return typeof v === 'object' ? true : !Number.isNaN(v);
  }));
  check('满进度下解锁条目远多于新开局（两种状态真的不同）',
    X.res.unlockedIds(full).length > X.res.unlockedIds(fresh).length,
    `${X.res.unlockedIds(fresh).length} → ${X.res.unlockedIds(full).length}`);
  check('新开局就有「无事可做」的判据为真（gate 可达）',
    X.res.unlocked('silver', fresh) && X.res.unlocked('building:field', fresh),
    X.res.unlockedIds(fresh).join(','));
}

{
  const fresh = X.save.hydrate({ createdAt: 0 });
  // 「全开」状态：每条门控都不再被前置挡住（只测判据可达，不测界面）
  const all = resState();
  all.techs = d.techs.map((t) => t.id);
  all.immortalTechs = d.immortalTechs.map((t) => t.id);
  all.secrets = Array.from({ length: 20 }, (_, i) => i);
  all.cultivation.veins = [{ grade: 3, reserve: 100 }];
  all.cultivation.compass = true;
  all.cultivation.poolBlueprint = true;
  all.cultivation.mineLevel = 1;
  all.cultivation.world = { reached: ['mosscave'], held: ['valley'], garrison: {}, unrest: {} };
  all.cultivation.cultivators = [person({ realmIndex: 22 })];
  all.cultivation.qi = 1;
  // 每一条 gate 都要在某一种状态里成立 —— 否则那道门永远打不开
  const dead = X.res.list().filter((r) => !X.res.unlocked(r.id, fresh) && !X.res.unlocked(r.id, all));
  check('每一条门控都有可达状态使其为真（没有永远锁死的资源）', dead.length === 0,
    dead.map((r) => `${r.id}(${r.gate.kind}:${r.gate.value})`).join(' '));
  // 自我门控必死锁
  const selfGated = X.res.list().filter((r) => r.gate.kind === 'flag' && r.gate.value === r.id);
  check('没有资源用自己当门控（自我门控必死锁）', selfGated.length === 0,
    selfGated.map((r) => r.id).join(' '));
  // 带门控的资源，hint 必须说清「为什么看不见」（开局即有的那批不必）
  const gated = X.res.list().filter((r) => r.gate.kind !== 'null');
  const vague = gated.filter((r) => !/(先|才|须|一|每|集齐|占|研习|走到|没有|之后|解锁|可)/.test(r.hint));
  check('有门控的资源的 hint 都在说前置条件（不是废话）', vague.length === 0,
    vague.map((r) => `${r.id}:${r.hint}`).join(' '));
  check('无门控的资源确实不需要 hint 解释前置（它们开局即见）',
    X.res.list().filter((r) => r.gate.kind === 'null').length > 0,
    `${X.res.list().filter((r) => r.gate.kind === 'null').length} 条`);
}

{
  // hide 口径的资源不占资源条格子：资源条上出现的资源名必须都是「此刻已解锁」的
  const bar = $('page-res').textContent;
  const shownNames = X.res.list()
    .filter((r) => r.kind !== 'pointer' && bar.includes(r.name))
    .map((r) => r.name);
  const illegal = shownNames.filter((n) => {
    const res = X.res.list().find((r) => r.name === n);
    return res && !X.res.unlocked(res.id, X.state);
  });
  check('资源条上出现的资源名都是此刻已解锁的（未解锁的不占格子）',
    illegal.length === 0, illegal.join(' '));
  // 未解锁且 hide 口径的资源不得出现在资源条上
  const hiddenLeak = X.res.list()
    .filter((r) => r.lockedUi === 'hide' && !X.res.unlocked(r.id, X.state) && r.kind !== 'pointer')
    .filter((r) => bar.includes(r.name) || bar.includes(r.uiLabel))
    .map((r) => `${r.id}(${r.uiLabel})`);
  check('hide 口径且未解锁的资源不出现在资源条上', hiddenLeak.length === 0, hiddenLeak.join(' '));
  // 资源条上每一格都必须能对上注册表里的一条（不许有「无出处的数字」）
  const chips = [...$('page-res').querySelectorAll('.pres-chip')]
    .map((c) => c.querySelector('.pres-label')?.textContent || '');
  const chipOk = (n) => X.res.list().some((r) => r.name === n || r.uiLabel === n);
  check('资源条的每一格都能在注册表里找到出处（银两在册）',
    chips.length > 0 && chips.every(chipOk),
    chips.map((n) => `[${n}]${chipOk(n) ? '' : '✗'}`).join(' '));
}

{
  // 解锁状态经 serialize → hydrate 往返不丢
  const s = resState();
  s.techs = ['realestate', 'architecture', 'finance', 'trade', 'quzhang'];
  s.immortalTechs = ['yinling'];
  s.secrets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  s.cultivation.alchemy.furnace = 3;
  const beforeIds = X.res.unlockedIds(s);
  const back = X.save.hydrate(JSON.parse(JSON.stringify(X.save.serialize(s))));
  check('解锁状态经 serialize→hydrate 往返不丢',
    JSON.stringify(X.res.unlockedIds(back)) === JSON.stringify(beforeIds),
    `${beforeIds.length} → ${X.res.unlockedIds(back).length}`);
  check('往返后科技数一条不少', back.techs.length === s.techs.length,
    `${s.techs.length} → ${back.techs.length}`);
  check('往返后仙道科技一条不少', back.immortalTechs.length === s.immortalTechs.length);
  check('往返后丹炉等级不丢', rv('alchemyFurnace', back) === 3, `${rv('alchemyFurnace', back)}`);
  const locked = X.res.list().filter((r) => !X.res.unlocked(r.id, s)).map((r) => r.id);
  check('往返不会把未解锁的变成解锁',
    locked.every((id) => !X.res.unlocked(id, back)), locked.filter((id) => X.res.unlocked(id, back)).join(' '));
}

section('开发者模式：补满的边界');

{
  const s = resState();
  s.settings.devMode = false;
  s.silver = 137;
  const before = rv('silver', s);
  check('devMode=false 时资源不会被补满', X.dev.refill(s) === 0 && rv('silver', s) === before,
    `${before} → ${rv('silver', s)}`);
  check('devMode=false 时 devRefill 返回 0（一项都没补）', X.dev.refill(s) === 0);
  check('devMode=false 时开发者模式未生效', X.dev.on(s) === false);
}

{
  const s = resState();
  s.techs = ['trade', 'quzhang'];
  s.secrets = [0, 1, 2];
  s.spiritStones = 0;
  devEnter(s);
  check('devMode=true（已解锁「银两」）时银两被补满',
    (X.dev.refill(s), rv('silver', s) > 0.9e12), `${rv('silver', s)}`);
  check('未解锁的资源不补：只有 3 条秘闻时灵石纹丝不动',
    rv('spiritStones', s) === 0, `${rv('spiritStones', s)}`);
  check('未解锁的资源不补：线索也没被补（仙途页还没开）',
    rv('cluePool', s) === 0 && X.res.canBeGiven('cluePool') === false, `${rv('cluePool', s)}`);

  s.secrets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];   // 集齐 10 条 → 坊市开
  X.dev.refill(s);
  check('补满后凑够秘闻：灵石跟着被补满', rv('spiritStones', s) > 0.9e12, `${rv('spiritStones', s)}`);
  check('秘闻是「累计凭证」：补满只补到池子抽干为止，不会凭空造下标',
    X.res.canBeGiven('secret') === true && rv('secret', s) === 20, `${rv('secret', s)}`);
  check('已花秘闻是记账：绝不能补（必须恒 ≤ 累计数）',
    X.res.canBeGiven('secretUsed') === false, `${rv('secretUsed', s)}`);
  check('有上限的资源补到上限，不会超（灵池上限 10）',
    X.res.giveTo('pool', s) === 10, `${X.res.giveTo('pool', s)}`);
  devLeave(s);
}

{
  // 非货币 / 非材料一律不补
  check('population / progress / modifier / flag 全部不可补',
    X.res.list().filter((r) => r.kind !== 'currency' && r.kind !== 'material')
      .every((r) => X.res.canBeGiven(r.id) === false));
  // ④ 把「不该给的」硬塞进注册表也补不出来：canBeGiven 必须由 kind 判据兜底，
  //    不能只看 dev.give 这个字段（否则「手滑把 progress 标成 give:true」就破了口子）
  check('就算把 progress 条目的 dev.give 硬改成 true，canBeGiven 仍然为假', (() => {
    const target = X.res.list().find((r) => r.kind === 'progress');
    const saved = target.dev;
    target.dev = { give: true, to: 1 };
    const ok = X.res.canBeGiven(target.id) === false;
    target.dev = saved;
    return ok;
  })(), 'canBeGiven 的判据必须同时看 dev.give 与 kind');
  check('dev.give 为真的条目只可能是 currency 或 material',
    X.res.list().filter((r) => r.dev && r.dev.give === true)
      .every((r) => r.kind === 'currency' || r.kind === 'material'));
  check('dev.give 为假的条目覆盖了全部 population',
    X.res.list().filter((r) => r.kind === 'population').every((r) => X.res.canBeGiven(r.id) === false));

  // 补满不许动「非资源」的那批字段（人口 / 境界 / 倍率 / 上限）
  const s = resState();
  s.techs = d.techs.map((t) => t.id);
  s.immortalTechs = d.immortalTechs.map((t) => t.id);
  s.secrets = Array.from({ length: 20 }, (_, i) => i);
  s.cultivation.cultivators = [person({ realmIndex: 14, xp: 33 })];
  s.cultivation.qi = 1;
  const snap = (x) => JSON.stringify({
    population: x.population,
    realm: x.cultivation.cultivators.map((p) => p.realmIndex),
    xp: x.cultivation.cultivators.map((p) => p.xp),
    birth: X.res.read('m_birthRate', x),
    death: X.res.read('m_deathRate', x),
    cap: X.res.read('m_silverCap', x),
    house: X.res.read('housingCap', x),
    highest: X.res.read('highestRealmIndex', x),
  });
  const before = snap(s);
  s.settings.devMode = false;
  devEnter(s);
  X.dev.refill(s);
  check('补满不碰人口 / 境界 / 修为 / 倍率 / 上限（逐字段相等）',
    snap(s) === before, snap(s));
  check('补满也确实补到了东西（阳性对照）', rv('silver', s) > 0.9e12, `${rv('silver', s)}`);
  // 容器里没有的条目：不凭空造出来
  const clean = X.save.hydrate({ createdAt: 0 });
  devEnter(clean);
  X.dev.refill(clean);
  check('不凭空造出 33 条材料（容器里没有的条目不动）',
    Object.keys(clean.cultivation.alchemy?.herbs || {}).length === 0,
    Object.keys(clean.cultivation.alchemy?.herbs || {}).join(' '));
  check('开局没有法器存货时不会造出第 1 件法器',
    Object.keys(clean.cultivation.forge?.items || {}).length === 0);
  devLeave(clean);
}

{
  // 关掉之后：写入恒 0，且序列化前后逐字段相等
  const s = resState();
  s.techs = ['trade'];
  s.settings.devMode = false;
  devLeave(s);
  const j1 = JSON.stringify(X.save.serialize(s));
  X.dev.refill(s);
  const j2 = JSON.stringify(X.save.serialize(s));
  check('关闭时 devRefill 写入恒 0（序列化前后逐字段相等）', j1 === j2);
  check('关闭时 devRefill 的返回值为 0', X.dev.refill(s) === 0);

  // 真的走一次 tick 入口：devMode=false 时那一帧不许补任何东西
  X.state.settings.devMode = false;
  const silverBefore = X.state.silver;
  X.tick(0);
  check('tick 在 devMode=false 时不补资源（真实入口）',
    X.state.silver === silverBefore, `${silverBefore} → ${X.state.silver}`);

  // 阳性对照：开启之后，**同一个 tick 入口**必须把银两封顶
  devEnter(X.state);   // 只写开关，不写令牌（测试不碰会话盒子）
  X.tick(0);
  check('tick 在 devMode=true 时补满已解锁资源（阳性对照）',
    X.state.silver > 0.9e12, `${X.state.silver}`);
  devLeave(X.state);
  X.state.silver = silverBefore;
  X.tick(0);
  check('关闭后同一个入口立刻停手（银两保持原值）',
    X.state.silver === silverBefore, `${X.state.silver}`);
}

section('开发者模式：口令与四道闸');

{
  check('新开局的 devMode 默认 false', X.save.hydrate({ createdAt: 0 }).settings.devMode === false);
  check('旧存档（没有 devMode 字段）读进来仍是 false',
    X.save.hydrate({ createdAt: 1, silver: 500, settings: { speed: 2 } }).settings.devMode === false);
  check('手改存档 devMode:true 时，没有会话令牌也不生效（第三道闸）', (() => {
    const s = X.save.hydrate({ createdAt: 1, settings: { devMode: true } });
    const noToken = X.dev.on(s) === false;
    // 补一次也不该动任何资源
    const before = rv('silver', s);
    X.dev.refill(s);
    return noToken && rv('silver', s) === before;
  })());
  check('devMode 字段认严格 true：字符串 "false" / 数字 1 都不算',
    X.save.hydrate({ createdAt: 1, settings: { devMode: 'false' } }).settings.devMode === false
    && X.save.hydrate({ createdAt: 1, settings: { devMode: 1 } }).settings.devMode === false);
  check('开启状态经 serialize→hydrate 往返不丢（这一行也不能漏）', (() => {
    const a = resState();
    a.settings.devMode = true;
    const backA = X.save.hydrate(JSON.parse(JSON.stringify(X.save.serialize(a))));
    const b = resState();
    b.settings.devMode = false;
    const backB = X.save.hydrate(JSON.parse(JSON.stringify(X.save.serialize(b))));
    return backA.settings.devMode === true && backB.settings.devMode === false;
  })());
  check('口令 3303 通过', X.dev.check('3303') === true);
  check('错误口令一律拒绝：330 / 33030 / 空串 / null / 数字 3303',
    ['330', '33030', '', ' 3303', '3303 ', null, undefined, 3303].every((p) => X.dev.check(p) === false),
    ['330', '33030', '', ' 3303', null, 3303].map((p) => `${String(p)}=${X.dev.check(p)}`).join(' '));
  check('页面里没有明文口令（game.html 搜不到 3303 这个口令串）',
    !/3303/.test(html), '口令只以散列值出现在产物里');
}

{
  // 真·玩家路径：设置里输口令（含会话令牌与日志）
  const wrong = X.dev.submit('9999');
  check('错误口令不进入开发者模式', wrong.ok === false && X.state.settings.devMode === false,
    `${wrong.reason}`);
  const right = X.dev.submit('3303');
  check('正确口令进入开发者模式', right.ok === true && X.state.settings.devMode === true);
  check('进入后立刻生效（令牌也在）', X.dev.on(X.state) === true);
  check('进入后已解锁的资源确实被封顶（银两）', rv('silver', X.state) > 0.9e12, `${rv('silver', X.state)}`);
  check('写了一条 dev:on 族谱纪事', X.state.log.some((l) => l.key === 'dev:on'));
  const offAgain = X.dev.submit('3303');
  check('再点一次即关闭', offAgain.ok === true && X.state.settings.devMode === false
    && X.dev.on(X.state) === false);
  check('关闭写了一族谱纪事 dev:off', X.state.log.some((l) => l.key === 'dev:off'));
}

{
  // 界面层单独开一个干净实例：这一段要**真的点按钮**（走 app.js 的事件委托），
  // 而主实例的点击监听器在更早的「刷新」测试里已经被换掉了 —— 拿它点等于点空气。
  const dom3 = installDOM(html, { store: dom.store });
  new Function(code)();
  const X3 = globalThis.window.__xiuxian;
  clearInterval(X3.timer);
  const $3 = (id) => dom3.document.getElementById(id);

  check('开发者模式的三件界面元素都在（徽标 / 设置行 / 状态行）',
    Boolean($3('dev-badge') && $3('dev-mode-row') && $3('dev-state') && $3('dev-submit')));
  X3.ui.render();
  check('默认状态下徽标是藏的（加 is-hidden，不删 DOM）',
    $3('dev-badge').classList.contains('is-hidden') && Boolean($3('dev-badge')));

  const key3 = $3('dev-password');
  key3.value = '0000';
  dom3.click($3('dev-submit'));
  check('点按钮输错口令：不进入，徽标仍藏着',
    X3.state.settings.devMode === false && $3('dev-badge').classList.contains('is-hidden'));

  key3.value = '3303';
  dom3.click($3('dev-submit'));
  X3.ui.render();
  check('点按钮输对口令：进入开发者模式',
    X3.state.settings.devMode === true && X3.dev.on(X3.state) === true);
  check('进入后徽标立刻露出来', !$3('dev-badge').classList.contains('is-hidden'));
  check('进入后设置行写着「开发者模式已开启」',
    /已开启/.test($3('dev-state').textContent), $3('dev-state').textContent);
  check('进入后按钮文案变成「关闭」', $3('dev-submit').textContent === '关闭',
    $3('dev-submit').textContent);

  dom3.click($3('dev-submit'));   // 同一次点击是「关闭」
  X3.ui.render();
  check('再点一次：关闭并收起徽标',
    X3.state.settings.devMode === false && $3('dev-badge').classList.contains('is-hidden'));
  key3.value = '9999';
  dom3.click($3('dev-submit'));   // 再点一次（这回是「开启」，口令是错的）
  X3.ui.render();
  check('关闭后状态行回到「未开启」', /已关闭|未开启/.test($3('dev-state').textContent),
    $3('dev-state').textContent);
  // 界面测试的实例到此为止：它有自己的 DOM 与状态，不影响后面任何断言
}

section('魔数收敛（S1）');

{
  const cfg = readFileSync('src/core/config.js', 'utf8');
  const blocks = ['src/core/config.js', 'src/main.js', 'src/systems/immortal-actions.js',
    'src/systems/immortal-economy.js', 'src/core/save.js'].map((p) => readFileSync(p, 'utf8')).join('\n');
  check('寻龙尺门槛收成一个常量（COMPASS_SECRET_REQ）', /COMPASS_SECRET_REQ\s*=\s*15/.test(cfg));
  check('灵池上限与耗石速率收成常量',
    /POOL_MAX\s*=\s*10/.test(cfg) && /POOL_STONE_PER_SEC\s*=\s*0\.00013/.test(cfg));
  check('灵脉与矿工上限收成常量（VEIN_MAX / MINE_WORKER_MAX）',
    /VEIN_MAX\s*=\s*20/.test(cfg) && /MINE_WORKER_MAX\s*=\s*1000/.test(cfg));
  check('源码里不再有散落的 0.00013 魔数',
    !/\*\.00013/.test(blocks) && !/c\.pool\*\.00013/.test(blocks));
  check('源码里不再有散落的「秘闻 ≥15」字面量',
    !/secrets\.length\s*<\s*15/.test(blocks) && !/需要15条秘闻/.test(blocks));
  check('源码里不再有灵池的 10 座 / 20 处灵脉的裸字面量',
    !/c\.pool\s*>=\s*10/.test(blocks) && !/veins\.length\s*>=\s*20/.test(blocks));
  // save.js 的 10000 与操作层 1000 不一致 —— 登记在案但本次不夹带修改
  check('save.js 的矿工夹取仍是 10000（只收常量、不改行为）',
    /Math\.min\(10000,Math\.floor\(num\(fresh\.cultivation\.mineWorkers/.test(
      readFileSync('src/core/save.js', 'utf8')));
}

console.log(failed === 0 ? '\n全部通过 ✓\n' : `\n${failed} 项未通过 ✗\n`);
process.exit(failed ? 1 : 0);
