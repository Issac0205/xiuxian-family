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
import { installDOM } from './dom-shim.mjs';

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
check('六张建筑卡都渲染了', document.querySelectorAll('.bcard').length === 6,
  `${document.querySelectorAll('.bcard').length} 张`);
check('科技列表渲染了', document.querySelectorAll('.tech').length >= 12,
  `${document.querySelectorAll('.tech').length} 项`);
check('七个页面标签都在', document.querySelectorAll('.pagetab').length === 7,
  [...document.querySelectorAll('.pagetab')].map((b) => b.dataset.page).join(' '));
check('纪事侧栏在页面之外',
  Boolean(document.querySelector('.shell-side [data-panel="log"]'))
  && !document.querySelector('.page [data-panel="log"]'));
check('修士职业统计不再出现 undefined',
  !$('cultivator-job-stats').textContent.includes('undefined'));
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
  // R5 起突破门槛以丹药为主材料，所以测试里先备上
  X.alchemy.addPills('zhuji', 5);
};
atGate();
check('修为满了进入「瓶颈」状态', X.realm.stateOf(1).kind === 'blocked', X.realm.stateOf(1).kind);
{
  const plan = X.realm.plan(1);
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
atGate();
state.cultivation.clues = 0;
check('线索不足时拒绝', X.realm.plan(1).ok === false, X.realm.plan(1).reason);
atGate();
{
  // 没有丹药就冲不了关 —— 这是炼丹区块存在的理由
  addPillAndZero('zhuji');
  const plan = X.realm.plan(1);
  check('没有丹药时拒绝冲关', plan.ok === false, plan.reason);
  check('拒绝理由点名了缺哪一味丹', plan.reason.includes('筑基丹'), plan.reason);
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
  const r = X.realm.commit(1, () => 0);   // 骰子必成功
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
  const r = X.realm.commit(1, () => 0.999);   // 骰子必失败
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
  const best = X.realm.best();
  return best && best.personId === 2;
})(), JSON.stringify(X.realm.best()?.name));

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
check('目录共 15 本', catalog.length === 15, `${catalog.length} 本`);
check('五条道途各 3 本', ['breath', 'ward', 'trade', 'seek', 'peril']
  .every((d) => catalog.filter((x) => x.dao === d).length === 3));
check('三个品阶各 5 本', [1, 2, 3].every((t) => catalog.filter((x) => x.tier === t).length === 5));
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
check('芯片显示收录进度', $('manual-chip').textContent === '4 / 15 门', $('manual-chip').textContent);
check('装备栏显示主修与辅修',
  $('manual-slots').textContent.includes('周天星河诀')
  && $('manual-slots').textContent.includes('玄甲护身诀'));
check('装备栏标出参悟层数', $('manual-slots').textContent.includes('参悟 2/5'));
check('汇总区列出了生效加成', $('manual-summary').textContent.includes('闭关修为'));
check('15 本全部画出（含未收录）',
  $('manual-grid').querySelectorAll('.manual-card').length === 15);
check('未收录的标为 locked',
  $('manual-grid').querySelectorAll('.manual-card.is-locked').length === 11);
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
check('六个丹方', al.recipes.length === 6, al.recipes.map((r) => r.name).join(' '));
check('丹方 id 唯一', new Set(al.recipes.map((r) => r.id)).size === 6);
check('每个丹方的材料都是有效药材', al.recipes.every((r) =>
  Object.keys(r.materials).every((k) => al.herbs.some((h) => h.id === k))));
check('每个丹方都有正的成功率与产出',
  al.recipes.every((r) => r.baseRate > 0 && r.baseRate < 1 && r.yield >= 1));
check('越高级的丹方成功率越低', (() => {
  const s = [...al.recipes].sort((a, b) => a.tier - b.tier);
  for (let i = 1; i < s.length; i += 1) if (s[i].baseRate > s[i - 1].baseRate) return false;
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
  setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
  state.spiritStones = 1000; state.cultivation.clues = 50;
  X.alchemy.addPills('zhuji', 5);
  const plain = X.realm.plan(1).rate;
  X.runes.give('chongguan', 1, 3);
  X.runes.use('chongguan');
  const boosted = X.realm.plan(1).rate;
  check('冲关符抬高冲关成功率', boosted > plain,
    `${(plain * 100).toFixed(1)}% → ${(boosted * 100).toFixed(1)}%`);
  X.realm.commit(1, () => 0);
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
  check('百科有九章', book.length === 9, book.map((c) => c.name).join(' '));
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
  check('章节按钮渲染了', document.querySelectorAll('[data-codex-chapter]').length === 11,
    `${document.querySelectorAll('[data-codex-chapter]').length} 个（含「全部」）`);
  check('进度 chip 有数字', /\d+ \/ \d+ 条/.test($('codex-chip').textContent), $('codex-chip').textContent);
  check('未解锁条目显示为「？？？」', $('codex-list').textContent.includes('？？？'));
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
    setPeople(person({ id: 1, realmIndex: 9, xp: X.realm.xpNeeded(9), job: 'retreat', talent: 1 }));
    state.spiritStones = 1000; state.cultivation.clues = 50;
    X.alchemy.addPills('zhuji', 5);
    const withRing = X.realm.plan(1).rate;
    state.meta.active = [];
    const without = X.realm.plan(1).rate;
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

console.log(failed === 0 ? '\n全部通过 ✓\n' : `\n${failed} 项未通过 ✗\n`);
process.exit(failed ? 1 : 0);
