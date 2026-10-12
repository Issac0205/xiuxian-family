
/* ────────────────────────────────────────────────────────────────
 * 区块：资源系统（读 / 写 / 解锁判据 / 开发者模式）
 * 职责：把 data/resources.js 那张注册表接上真实状态。
 *   1) 读数与写数：readResource / writeResource —— **永不 undefined**；
 *   2) 解锁判据：unlockOf（纯函数，派生）与 visibleOf（界面用的粘性口径）；
 *   3) 开发者模式：口令校验、开关、会话令牌、devRefill（补满已解锁资源）。
 *
 * 出处：docs/101-内部架构与资源体系.md §2（解锁派生）§3（开发者模式）
 *
 * ⚠ 三条硬约束（挡住这个功能最可能造成的三种事故）：
 *   ① **不新增任何顶层 state 字段**：解锁状态全派生，开关落在
 *      settings.devMode（settings 本就在 serialize 白名单里）；
 *   ② **一处扣减点都不改**：补满走 tick()/runOffline() 末尾的 devRefill，
 *      绝不去 engine/alchemy/forge/runes/immortal-actions/markets/breakthrough
 *      逐个找扣减点 —— 那样必漏，漏掉的那个资源就会「用一点少一点」；
 *   ③ **writeResource 只在容器项已存在时写**：不凭空造出 33 条材料
 *      （否则存档里会多出一堆 0 值项，既污染存档也污染界面）。
 * ──────────────────────────────────────────────────────────────── */

/** 开发者模式的会话令牌键。**不进存档**：关掉标签页即失效。 */
const DEV_TOKEN_KEY = 'xiuxian-family/dev/token/v1';

/* ══════════════════ 一、读数与写数 ══════════════════ */

/** 取一条资源（id 或条目对象都接受）。 */
function resourceOf(idOrRes) {
  if (!idOrRes) return null;
  if (typeof idOrRes === 'object') return idOrRes;
  return RESOURCE_MAP[idOrRes] || null;
}

/**
 * 读一条资源。
 *
 * 数值型 → number；堆叠型（符箓）→ 它的存货对象；容器缺失 → 0。
 * ⚠ **永不返回 undefined**，这是注册表能被机械断言的前提（docs/101 §C 断言 1）。
 */
function readResource(state, idOrRes) {
  const res = resourceOf(idOrRes);
  if (!res || !state) return 0;
  let v;
  try {
    v = res.path(state);
  } catch (e) {
    return 0;
  }
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  return v;
}

/** 一条资源的数值读数（堆叠型取 .n，其余取 resNum）。 */
function readResourceNumber(state, idOrRes) {
  const v = readResource(state, idOrRes);
  if (v && typeof v === 'object' && !Array.isArray(v)) return resNum(v.n);
  return resNum(v);
}

/** 有没有这条资源。 */
function hasResource(state, idOrRes) { return Boolean(resourceOf(idOrRes) && state); }

/**
 * 把一条资源写到指定数值。**只用于开发者模式**（正常玩法一律走各自的
 * plan/commit，此处不参与任何扣减）。
 *
 * 三种形态：
 *   · 纯数字 → 直接写；
 *   · 存货对象（法器 { durability } / 符箓 { n, expiresAt }）→ 只动数量字段，
 *     保留耐久与保质期（`n` 是数量，其余字段是它的属性）；
 *   · Map 型容器（药材/矿料/丹药…）→ **只在对应键已经存在时**才写，
 *     不凭空造出 33 条材料。
 *
 * @returns {boolean} 是否真的写进去了（容器里没有这一项时返回 false）
 */
function writeResource(state, idOrRes, n, opts = {}) {
  const res = resourceOf(idOrRes);
  if (!res || !state) return false;
  const target = Number.isFinite(n) ? n : 0;

  switch (res.id) {
    case 'silver': state.silver = target; return true;
    case 'spiritStones': state.spiritStones = target; return true;
    case 'secret': return resWriteSecret(state, target, opts);
    case 'clue': {
      if (!state.cultivation) return false;
      state.cultivation.clues = target;
      return true;
    }
    case 'pillStore:quzhang': {
      if (!state.cultivation) return false;
      state.cultivation.pills = target;
      return true;
    }
    case 'humanPill': {
      if (!state.cultivation) return false;
      state.cultivation.humanPills = target;
      return true;
    }
    case 'pool': {
      if (!state.cultivation) return false;
      state.cultivation.pool = target;
      return true;
    }
    case 'alchemyFurnace': {
      const box = resAlchemy(state);
      if (box.furnace === undefined) return false;
      box.furnace = target;
      return true;
    }
    case 'forgeLevel': {
      const box = resForge(state);
      if (box.level === undefined) return false;
      box.level = target;
      return true;
    }
    case 'runeBench': {
      const box = resRunes(state);
      if (box.bench === undefined) return false;
      box.bench = target;
      return true;
    }
    default: break;
  }

  // 逐项落点表：容器 + 键
  const slot = RES_WRITE_SLOTS[res.id];
  if (slot) {
    const box = slot.box(state);
    if (!box || typeof box !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(box, slot.key)) return false; // 容器里没有这一项 → 不造
    const cur = box[slot.key];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur.n = target;   // 存货：只改数量
      return true;
    }
    box[slot.key] = target;
    return true;
  }

  // 建筑计数（`building:<id>`）
  if (res.id.startsWith('building:')) {
    const bid = res.id.slice('building:'.length);
    if (!state.buildings || state.buildings[bid] === undefined) return false;
    state.buildings[bid] = target;
    return true;
  }
  return false;
}

/** 存货型资源的落点表（容器 + 键）。 */
const RES_WRITE_SLOTS = {
  'herb:grass': { box: (s) => resAlchemy(s).herbs, key: 'grass' },
  'herb:ling': { box: (s) => resAlchemy(s).herbs, key: 'ling' },
  'herb:iron': { box: (s) => resAlchemy(s).herbs, key: 'iron' },
  'herb:flame': { box: (s) => resAlchemy(s).herbs, key: 'flame' },
  'ore:lingmu': { box: (s) => resForge(s).ores, key: 'lingmu' },
  'ore:hantie': { box: (s) => resForge(s).ores, key: 'hantie' },
  'ore:xuantie': { box: (s) => resForge(s).ores, key: 'xuantie' },
  'ore:yaogu': { box: (s) => resForge(s).ores, key: 'yaogu' },
  'runematerial:paper': { box: (s) => resRunes(s).materials, key: 'paper' },
  'runematerial:cinnabar': { box: (s) => resRunes(s).materials, key: 'cinnabar' },
  'runematerial:ink': { box: (s) => resRunes(s).materials, key: 'ink' },
  'runematerial:blood': { box: (s) => resRunes(s).materials, key: 'blood' },
  'talisman:juling': { box: (s) => resRunes(s).items, key: 'juling' },
  'talisman:husheng': { box: (s) => resRunes(s).items, key: 'husheng' },
  'talisman:pozhen': { box: (s) => resRunes(s).items, key: 'pozhen' },
  'talisman:chongguan': { box: (s) => resRunes(s).items, key: 'chongguan' },
};
/** 丹药成品与法器成品：由数据表展开，避免手抄这两组 id。 */
for (const r of ALCHEMY_RECIPES) {
  if (r.id === 'quzhang') continue;
  RES_WRITE_SLOTS[`pill:${r.id}`] = { box: (s) => resAlchemy(s).pills, key: r.id };
}
for (const it of FORGE_ITEMS) {
  RES_WRITE_SLOTS[`item:${it.id}`] = { box: (s) => resForge(s).items, key: it.id };
}

/**
 * 「秘闻」是唯一需要**扩数组**的补满项（它存的是 SECRETS 下标）。
 * 只补到池子抽干为止（SECRETS.length）：再多的「累计」是假的 ——
 * 池子里本来就没有那条秘闻，凭空塞下标只会让 grantSecret 的判重失效。
 */
function resWriteSecret(state, target, opts = {}) {
  if (!Array.isArray(state.secrets)) return false;
  const cap = Math.min(resNum(target), SECRETS.length);
  if (opts.fillSecrets === false) return false;
  const had = new Set(state.secrets);
  for (let i = 0; i < cap; i += 1) if (!had.has(i)) state.secrets.push(i);
  state.secrets.sort((a, b) => a - b);
  return true;
}

/* ══════════════════ 二、解锁判据（一律派生） ══════════════════ */

/**
 * 一条资源此刻是否已解锁。**纯函数、只看当前状态**，没有记忆：
 *   · 吃「当前刻」的真相源（techs / immortalTechs / held / secrets / realmIndex）；
 *   · 因此不需要新增顶层字段、没有 hydrate 默认值问题，也不会有过期值。
 *
 * 代价是它**会随状态回落**（卖掉最后一块领地 → 重判为未解锁）。
 * 界面因此另走 visibleOf()（可选粘性），见下。
 */
function unlockOf(state, idOrRes) {
  const res = resourceOf(idOrRes);
  if (!res || !state) return false;
  return resGateOk(state, res.gate, 0);
}

/** 判据求值（depth 防「flag 互相指」打转：最多走 4 层）。 */
function resGateOk(state, gate, depth) {
  if (!gate || gate.kind === 'null') return true;
  if (depth > 4) return false;
  switch (gate.kind) {
    case 'tech':
      // 两条线一起查：建筑表里的 tech 有的是凡人线（realestate）、有的是仙道线
      // （药圃→灵田、矿寮/纸坊→悬壶、灵石矿场→灵脉感应，见 data/buildings.js），
      // 只查一条线会让那四座建筑的解锁状态永远为假。
      return resTechResearched(state, gate.value);
    case 'itech':
      return resTechResearched(state, gate.value);
    case 'secrets':
      // ⚠ 一律读**累计**（不是 secretsUsed）：花钱解商品不该关掉已经打开的门
      return resCount(state, 'secrets') >= resNum(gate.value);
    case 'realm':
      return highestRealmIndex(state) >= resNum(gate.value);
    case 'held':
      return resCount(state, 'cultivation', 'world', 'held') >= resNum(gate.value);
    case 'canAct':
      return resCanAct(state, String(gate.value));
    case 'flag': {
      const target = RESOURCE_MAP[gate.value];
      if (!target) return false;
      // 自我门控必死锁（仙途页当初的自锁就是这么来的）：
      // 目标就是自己时按「已解锁」处理 —— 死锁在这里被结构性地挡住，
      // 而 smoke 里另有一条断言把这个写法本身标红。
      if (target.id === gate.value
        && target.gate && target.gate.kind === 'flag' && target.gate.value === gate.value) return true;
      return resGateOk(state, target.gate, depth + 1);
    }
    default:
      return true;
  }
}

/** 两条科技线一起查（建筑表里两种 id 混着用，见 data/buildings.js 的 tech 字段）。 */
function resTechResearched(state, id) {
  return isResearched(state, id) || isImmortalTechResearched(state, id);
}

/** canAct：直接复用既有的可见性判据函数（唯一允许「代码而非数据」的判据）。 */
function resCanAct(state, key) {
  switch (key) {
    case 'alchemy':
    case 'forge':
    case 'runes':
    case 'humanPill':
      return immortalBlockVisible(state, key);
    case 'cyclePage': {
      const m = metaOf(state);
      return reincarnationProgress(state).canEnd
        || resNum(m.cleared) > 0
        || resCount(state, 'meta', 'unlocked') > 0
        || (resNum(m.cycle) || 1) > 1;
    }
    case 'immortalPage':
      return immortalAccessible(state);
    default:
      return true;
  }
}

/* ══════════════════ 三、界面用的「可见」口径（可选粘性） ══════════════════ */

/**
 * 【既有铁律】一旦可见就不要再让它消失（栏目忽隐忽现比一直显示更让人困惑）。
 * 这里为**资源条**保存一份「已露过面」的痕迹。
 *
 * ⚠ **hide 口径的数值格不许做粘性**（docs/101 §2.3）：
 *   否则会出现「量是 0、格子还在」的鬼状态 —— 玩家看到一格空资源条，
 *   却怎么也想不起来它是什么、也不知道它为什么是空的。
 *   粘性只对 `visibleOf(..., {sticky:true})` 的调用方（面板/分块）开放。
 */
let RES_STICKY_SEEN = new Set();

/** 清空粘性痕迹（读档 / 重开时调用）。 */
function resClearSticky() { RES_STICKY_SEEN = new Set(); }

/** 此刻是否应当让玩家看见这条资源（sticky=false 就是纯 unlockOf）。 */
function visibleOf(state, idOrRes, opts = {}) {
  const res = resourceOf(idOrRes);
  if (!res || !state) return false;
  if (opts.sticky === true && RES_STICKY_SEEN.has(res.id)) return true;
  const ok = unlockOf(state, res);
  if (ok && opts.sticky === true) RES_STICKY_SEEN.add(res.id);
  return ok;
}

/** 未解锁时的三种口径（docs/100 §4）：hide 藏 / dim 灰 / mask 图鉴的 ？？？。 */
function lockedUiOf(idOrRes) {
  const res = resourceOf(idOrRes);
  return res ? res.lockedUi : 'hide';
}

/** 未解锁时给玩家的一句提示。 */
function lockedHintOf(idOrRes) {
  const res = resourceOf(idOrRes);
  return res ? res.hint : '';
}

/**
 * 未解锁时**藏**一格：给 DOM 宿主加 `is-hidden`。
 *
 * ⚠ 只加 class，**绝不删元素** —— #tech-list 那次的教训：
 *   删掉的宿主元素不会自己回来，后续渲染找不到挂点，界面就永久缺一块。
 *   hide 口径的格子甚至连「占位」都不该留（未解锁资源不占资源条格子，
 *   见 docs/100 的三条铁律）。
 */
function resHideLocked(state, idOrRes, host) {
  if (!host || !host.classList) return false;
  const hidden = !visibleOf(state, idOrRes);
  host.classList.toggle('is-hidden', hidden);
  return hidden;
}

/* ══════════════════ 四、开发者模式 ══════════════════ */

/**
 * FNV-1a 32 位散列。
 *
 * ⚠ 为什么不直接用 SHA-256：本项目是**单文件、零依赖**的产物
 *   （game.html 里没有 import，也没有 crypto 模块），塞一份 SHA-256 实现
 *   要多 60 行并引入一个顶层函数名。这里要达成的目标只有一个：
 *   **口令不以明文形式出现在 game.html 里**（docs/101 §3.2）。
 *   这道门的目的是防手滑，不是防破解 —— 真正的防线是
 *   「未开启时 devRefill 首行 return」与「会话令牌不入存档」。
 */
function devHash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 口令校验：只认**字符串**且**逐字相等**的那一个。 */
function devCheckPassword(input) {
  if (typeof input !== 'string') return false;
  return devHash(input) === DEV_PASSWORD_HASH;
}

/** 读会话令牌（sessionStorage 不可用时一律当没有 —— 安全侧的默认值）。 */
function devTokenPresent() {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage) return false;
    return sessionStorage.getItem(DEV_TOKEN_KEY) !== null;
  } catch (e) {
    return false;
  }
}

/** 写 / 清会话令牌。 */
function devSetToken(on) {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage) return;
    if (on) sessionStorage.setItem(DEV_TOKEN_KEY, String(Date.now()));
    else sessionStorage.removeItem(DEV_TOKEN_KEY);
  } catch (e) { /* 隐私模式下写不进去：那就退化成「本次会话没有令牌」 */ }
}

/**
 * 开发者模式此刻是否生效。
 *
 * 四道闸（docs/101 §3.4）：
 *   ① createState() 默认 false；
 *   ② 旧存档 hydrate 之后仍是 false（严格 `=== true`）；
 *   ③ 没有会话令牌时，**手改存档也无效**；
 *   ④ 没开启时 devRefill 首行就 return（见下）。
 */
function devModeOn(state) {
  if (!state || !state.settings) return false;
  if (state.settings.devMode !== true) return false;
  return devTokenPresent();
}

/** 进入开发者模式：写 settings + 写会话令牌。口令由调用方先校验。 */
function devEnable(state, opts = {}) {
  if (!state || !state.settings) return false;
  state.settings.devMode = true;
  if (opts.writeToken !== false) devSetToken(true);
  return true;
}

/** 退出开发者模式：清 settings + 清会话令牌。 */
function devDisable(state, opts = {}) {
  if (!state || !state.settings) return false;
  state.settings.devMode = false;
  if (opts.writeToken !== false) devSetToken(false);
  return true;
}

/**
 * 一条资源在开发者模式下的补满目标（有上限补到上限，无上限补到 DEV_ABUNDANCE）。
 *
 * ⚠ 上限一律从注册表的 `cap` 读（数字或 `(s) => number`），**不在 dev 里另写一份**：
 *   另写就是第二份真相源 —— 上限改了而 dev 没跟着改，就是「补出一个非法值」。
 */
function devGiveTo(state, idOrRes) {
  const res = resourceOf(idOrRes);
  if (!res) return 0;
  const cap = resCapOf(res, state);
  if (cap !== null) return Math.min(DEV_ABUNDANCE, cap);
  return DEV_ABUNDANCE;
}

/**
 * 开发者模式的核心：把**已解锁且 devGive 非空**的资源补满。
 *
 * ⚠ 为什么放在 tick()/runOffline() 末尾而不是改扣减点：
 *   扣减点散在 engine / alchemy / forge / runes / immortal-actions /
 *   markets / breakthrough 七处，逐个改必漏；漏掉的那个资源就会
 *   「用一点少一点」，玩家得反复关开开关 —— 那不是「无限」。
 *   每 tick 补一次是全量覆盖，漏不掉。
 *
 * ⚠ 绝不碰的东西（docs/101 §3.3）：人口、境界、所有倍率与上限、
 *   realmIndex / xp 这类进度量。它们 kind 是 population/progress/modifier/flag，
 *   `resourceCanBeGiven()` 直接把它们挡在门外。
 *
 * @returns {number} 本次实际补满了几条
 */
function devRefill(state) {
  if (!devModeOn(state)) return 0;      // ④ 没开启时首行就 return
  let n = 0;
  for (const res of RESOURCES) {
    if (!resourceCanBeGiven(res)) continue;
    if (!unlockOf(state, res)) continue;   // ② 未解锁的**不补**
    if (writeResource(state, res, devGiveTo(state, res), { fillSecrets: true })) n += 1;
  }
  return n;
}

/** 开发者模式：一条资源是不是「已解锁且因此会无限」。 */
function devResourceActive(state, idOrRes) {
  const res = resourceOf(idOrRes);
  if (!res || !devModeOn(state)) return false;
  return resourceCanBeGiven(res) && unlockOf(state, res);
}

/** 给界面/日志用的一行摘要。 */
function devStatusLine(state) {
  const on = devModeOn(state);
  let live = 0;
  let total = 0;
  for (const res of RESOURCES) {
    if (!resourceCanBeGiven(res)) continue;
    total += 1;
    if (on && unlockOf(state, res)) live += 1;
  }
  return on ? `开发者模式已开启 · 已解锁资源 ${live}/${total} 项无限` : '开发者模式已关闭';
}
