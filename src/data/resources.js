
/* ────────────────────────────────────────────────────────────────
 * 区块：资源注册表（玩家可见世界的唯一索引）
 * 职责：把散落在 state / derive() / 各数据表里的**一切玩家可见的量**
 *       收进一张表，每项都带：显示名、读法 path、产出速率 rate、
 *       上限 cap、解锁判据 gate、未解锁口径 lockedUi、提示 hint、
 *       开发者模式的补满规则 dev。
 *
 * ⚠ 这是**索引，不是第二份真相源**。
 *   注册表**绝不持有任何数值**：银两就是 `s.silver`、上限就是 `silverCap()`
 *   那个函数算出来的。想改数值请回到 core/config.js 与核心公式，
 *   这里只允许「指过去」。绝不允许写成 `{ id:'silver', value: 100 }` 再同步 ——
 *   那是本项目已经踩过的坑（meta / immortalTechs 的「刷新即静默丢失」）。
 *
 * ⚠ 本表**不进存档**：不新增任何顶层字段，解锁状态一律派生（docs/101 §2）。
 *
 * 出处：docs/101-内部架构与资源体系.md（架构 t2 的裁决）
 *   ① 六类体系 C/M/P/G/X/F（见 §1）；
 *   ② 解锁状态**派生**，不新增 state.unlocks（见 §2）；
 *   ③ 开发者模式（见 §3）；
 *   ④ 魔数收敛到 core/config.js 的具名常量（见 §4 S1）。
 * 配套：src/systems/resources.js（读/写/解锁/devRefill）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 六类体系。
 *   C currency  —— 货币（可花、可能吃上限）
 *   M material  —— 材料（原料 + 成品存货，后者带耐久 / 保质期）
 *   P population—— 人口
 *   G progress  —— 进度与等级（含容量类上限）
 *   X modifier  —— 属性与倍率（只读派生值，**不可补满**）
 *   F flag      —— 解锁标记（布尔事实，**不可补满**）
 *
 * ⚠ `modifier` 与 `flag` 一律 `dev.give=false`：
 *   realmIndex = ∞ 会越出 realms 的 26 档表；population = ∞ 会让死亡率里的
 *   拥挤项变 ∞² → NaN（见 docs/101 §3.3 的两条硬理由）。
 * ⚠ 注册表字段名与 createState() 的顶层字段名**交集必须为空**（docs/101 §2.4）：
 *   这里没有 silver/population/secrets/morality/settings/... 任何一个是顶层名，
 *   并且禁用 `value` / `amount` / `count` 三个字段名。
 */
const RESOURCE_KINDS = ['currency', 'material', 'population', 'progress', 'modifier', 'flag', 'pointer'];
const RESOURCE_GROUPS = ['currency', 'herb', 'pill', 'ore', 'forge', 'runematerial',
  'rune', 'population', 'progress', 'modifier', 'flag', 'index'];

/**
 * 【架构 docs/101 §3.3 裁决 e + 附录 C 断言 A13】开发者模式的**唯一构造入口**。
 *
 * 硬约束（A13 会机械检出）：
 *   `dev.give === true` 的条目**只允许**是 `currency` 或 `material` 两类；
 *   `population` / `progress` / `modifier` / `flag` 四类**一律**不给。
 *
 * 为什么这条必须写成函数而不能靠人记：
 *   · `population = ∞` ⇒ 死亡率里的拥挤项变成 ∞² = NaN，整局数值当场烂掉；
 *   · `realmIndex = ∞` ⇒ 越出 realms 的 26 档表；
 *   · 容量 / 倍率是**规则**不是家产，补它等于关掉游戏；
 *   · 标记的意义就是「获取过程」，补它等于跳过整条链子。
 * 这个函数把「哪一类能补」压成一处判断，注册表里每一条只需声明
 * 「这一项升上去算不算量」。
 */
function devSpec(kind, to = null, id = '') {
  // 已花掉的秘闻是**记账**，绝不能补：它必须恒 ≤ 累计数（core/save.js 有归一化）。
  if (id === 'secretUsed') return { give: false };
  // 线索小数池是内部进位池：补满它等于凭空多一条线索（而不是「资源无限」）。
  if (id === 'cluePool') return { give: false };
  const giveable = kind === 'currency' || kind === 'material';
  if (!giveable) return { give: false };
  return to === null ? { give: true, to: null } : { give: true, to };
}

/**
 * 登记一条资源。
 *
 * @param {string} id      唯一 id（也是 devGiveTo / 测试的索引键）
 * @param {string} name    显示名（中文）
 * @param {string} kind    RESOURCE_KINDS 之一
 * @param {string} group   资源条分组
 * @param {Function} path  (state) → 读数。数值型返回 number，堆叠型返回对象
 *                         （符箓是 { n, expiresAt }，法器是 { durability, ... }）。
 *                         容器缺失一律返回 0（**永不 undefined**，docs/101 §C 断言 1）。
 * @param {object} [o]     rate / cap / gate / lockedUi / hint / dev / note
 */
function makeResource(id, name, kind, group, path, o = {}) {
  return {
    id,
    name,
    kind,
    group,
    path,
    /** 每秒产出（无产出型为 null）。只作说明与测试核对，不参与结算。 */
    rate: o.rate === undefined ? null : o.rate,
    /**
     * 【架构 docs/101 §5.1.1】上限（无限为 null）。三种形态：
     *   数字 / `(s) => number` / **derive() 的键名字符串**（如 `silverCap`）。
     * 第三种是**已接受的扩展**，理由见 resCapOf 的注释（不在注册表里抄公式）。
     */
    cap: o.cap === undefined ? null : o.cap,
    /** 解锁判据（派生，见 systems/resources.js 的 unlockOf）。 */
    gate: o.gate || { kind: 'null' },
    /** 未解锁时的表现：'hide' | 'dim' | 'mask'（必须显式声明，没有默认值）。 */
    lockedUi: o.lockedUi || 'hide',
    /** 未解锁时给玩家的一句中文提示（≥4 个汉字）。 */
    hint: o.hint || '尚未到用得上的时候',
    /**
     * 界面上的**短标签**（资源条那一格写的那几个字）。
     * 与显示名可以不同：资源条上写「人口」，注册表里叫「凡人人口」——
     * 两个名字都留着，是为了让「注册表 = 台账」与「资源条 = 短标签」各自说人话，
     * 而不是为了对齐字符串把台账名字改成两个字的缩写。
     * 不填时等于显示名。
     */
    uiLabel: o.uiLabel || name,
    /**
     * 开发者模式。**只走 devSpec()**，绝不手写 `{ give: true }` ——
     * 手写就是在给「progress 也能补满」留后门（A13 会红）。
     * 补满目标：`to` 为 null 时补到 DEV_ABUNDANCE，是数字时补到那个数字。
     */
    dev: devSpec(kind, o.to === undefined ? null : o.to, id),
    /** 备注：同名不同物的历史、魔数的出处等。 */
    note: o.note || '',
  };
}

/* ═══════════════ 读法小工具（永不 undefined） ═══════════════ */

/** 任意叶子 → number（缺失 / 非数值 → 0，布尔 → 1/0，数组 → 长度）。 */
function resNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === true) return 1;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** state.a.b 的安全读法（任一层缺失 → undefined）。 */
function resAt(state, ...keys) {
  let cur = state;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 数组 / 容器的条目数（缺失 → 0）。 */
function resCount(state, ...keys) {
  const v = resAt(state, ...keys);
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return resNum(v);
}

/** 丹房 / 器房 / 符房的容器（旧存档缺这一段时返回空对象，不抛错）。 */
function resAlchemy(s) { return resAt(s, 'cultivation', 'alchemy') || {}; }
function resForge(s) { return resAt(s, 'cultivation', 'forge') || {}; }
function resRunes(s) { return resAt(s, 'cultivation', 'runes') || {}; }

/**
 * 取上限的数值。
 *
 * 【架构 docs/101 §5.1.1】cap 允许**三种形态**（t4 的 D4 落点）：
 *   ① `null`                 —— 没有上限（补满目标 = DEV_ABUNDANCE）
 *   ② 数字 / `(s) => number` —— 直接就是上限
 *   ③ **字符串**              —— `derive(state)` 的**键名**（如 `silverCap`）
 *
 * ⚠ 第 ③ 种是为了不在注册表里再抄一遍公式（银两上限由 derive().silverCap 算出）。
 *   **漏掉这一种就是 D4**：Number.isFinite(silverCap 那个字符串) 为假 → 当成无上限
 *   → 银两被补到 1e12，越过了自己 3000 的上限（资源条上直接露馅）。
 * ⚠ 字符串键名在 derive() 里不是数字时抛错，而不是静默返回 null：
 *   静默 = 又补出一个越界的非法值，宁可当场红。
 */
function resCapOf(res, state) {
  const cap = res ? res.cap : null;
  if (cap === null || cap === undefined) return null;
  if (typeof cap === 'number') return Number.isFinite(cap) ? cap : null;
  if (typeof cap === 'string') {
    const d = derive(state || {});
    const v = d ? d[cap] : undefined;
    if (!Number.isFinite(v)) {
      throw new Error('资源「' + res.id + '」的 cap 指向 derive().' + cap + '，但那不是数字（' + v + '）');
    }
    return v;
  }
  if (typeof cap === 'function') {
    const v = cap(state);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/* ═══════════════ 门控判据的构造器 ═══════════════ */

/**
 * 门控判据 kind 一览（全部**派生**，不新增任何顶层字段）：
 *   null    开局即在
 *   tech    已研习某凡人科技（s.techs 含 id）
 *   itech   已研习某仙道科技（s.immortalTechs 含 id）
 *   secrets 累计秘闻 ≥ value
 *          ⚠ 一律读**累计** s.secrets.length，不是 secretsUsed
 *            （历史规则：花钱不关已经打开的门，见 data/markets.js 头注）
 *   realm   最高境界下标 ≥ value（没有修士时按 0 = 凡人算）
 *   held    已占领领地数 ≥ value
 *   canAct  直接复用既有判据函数（唯一允许「代码而非数据」的判据，
 *           用于 immortalBlockVisible 那种「有事可做」的复合条件）
 *   flag    读注册表里另一个 flag 资源（**禁止自我门控**：会死锁）
 */
const gateNull    = () => ({ kind: 'null' });
const gateTech    = (id) => ({ kind: 'tech', value: id });
const gateITech   = (id) => ({ kind: 'itech', value: id });
const gateSecrets = (n) => ({ kind: 'secrets', value: n });
const gateRealm   = (n) => ({ kind: 'realm', value: n });
const gateHeld    = (n) => ({ kind: 'held', value: n });
const gateFlag    = (id) => ({ kind: 'flag', value: id });
/** 【架构 docs/101 §6.2】复用界面那一份「有事可做」判据（immortalBlockVisible）。 */
const gateCanAct  = (key) => ({ kind: 'canAct', value: key });

/* ═══════════════ 一、货币（C） ═══════════════ */

/**
 * 【架构 docs/101 §6.5】首页顶部那五格境界仪表的**顺序**（与
 * `systems/progression.js` 的 `realmDashboardKey()` 返回值一一对应）。
 * 注册表只用它把「现在该露哪一格」归一成 1..5 的数字，
 * **不复制**那份 switch —— 名单仍只有 realmDashboardKey() 一份真相源。
 */
const DASHBOARD_CELL_ORDER = ['qi', 'foundation', 'core', 'nascent', 'tribulation'];

/**
 * 银两：**属于「资源」大类**，不是孤立字段（用户原话：银两属于资源大类）。
 * 它是开局唯一能花的货币，上限 = (基础 + 钱庄×容量) × (1 + 库房倍率)。
 */
const RES_CURRENCY = [
  makeResource('silver', '银两', 'currency', 'currency', (s) => resNum(resAt(s, 'silver')), {
    rate: 'silverPerSec', cap: 'silverCap', gate: gateNull(),
    lockedUi: 'dim', hint: '开局即有：族人每秒产银，钱庄与库房抬高上限',
    note: '上限见 core/formulas.js derive()：BASE.silverCap + 钱庄×BANK_CAPACITY，再乘库房倍率。',
  }),
  makeResource('spiritStones', '灵石', 'currency', 'currency', (s) => resNum(resAt(s, 'spiritStones')), {
    rate: 'stonesPerSec', cap: null, gate: gateSecrets(SECRET_UNLOCK),
    lockedUi: 'hide', hint: `集齐 ${SECRET_UNLOCK} 条秘闻，云深谷坊市才会开，银钱才换得动灵石`,
    note: '平价兑率：MARKET_EXCHANGE_BASE_SILVER → BASE_STONES×(1+tradeStoneMult)。',
  }),
  makeResource('secret', '秘闻', 'currency', 'currency', (s) => resCount(s, 'secrets'), {
    // 【架构 docs/101 §6.1 + t4 的 D2】秘闻是「累计凭证」：门控写 null、口径 dim。
    //   通商页资源条自带这一格（secretGoal 就是坊市门槛），给它是本地信息，
    //   不需要前置条件 —— 写 gateTech(trade) 会让「已攒下秘闻但科技被轮回重置」
    //   的存档里这一格凭空消失。
    rate: 'secretPerSec', cap: null, gate: gateNull(),
    lockedUi: 'dim', hint: '遣族人出门探访，才有秘闻带回家族',
    note: '⚠ **同名不同物**：本项是「累计发现的秘闻」（凭证，只增不减，'
      + 's.secrets 存的是 SECRETS 下标数组），**不是** cultivation.clues。'
      + '历史上两者被混过一次，所以改为独立 id：secret（秘闻凭证）/ clue（线索）。'
      + '一切门控读累计：花钱解商品只动 secretsUsed，不动这里。',
  }),
  makeResource('secretUsed', '已费秘闻', 'currency', 'currency', (s) => resNum(resAt(s, 'secretsUsed')), {
    cap: null, gate: gateSecrets(SECRET_UNLOCK),
    lockedUi: 'dim', hint: '坊市里每解锁一件商品，要花 1 条秘闻',
    note: '只记账用，不参与任何门控（门控读累计 secret）。**绝不能补**：它必须恒 ≤ 累计数。',
  }),
  makeResource('clue', '线索', 'currency', 'currency', (s) => resNum(resAt(s, 'cultivation', 'clues')), {
    rate: 'cluePerSec', cap: null, gate: gateFlag('immortalPage'),
    lockedUi: 'hide', hint: '投帖问路与探秘都会带回线索 —— 洞天与大境界突破都要用它，但须先开仙途',
    note: '⚠ **同名不同物**：这是**可消耗**的线索（cultivation.clues），'
      + '与累计凭证 secret（秘闻）不是一回事，故注册为独立 id `clue`。',
  }),
  makeResource('cluePool', '线索池', 'currency', 'currency', (s) => resNum(resAt(s, 'cultivation', 'cluePool')), {
    rate: 'cluePerSecFlat', cap: 1, gate: gateFlag('immortalPage'),
    lockedUi: 'hide', hint: '线索按秒累加，攒满一条才算一条（取整会把它吃成 0）',
    dev: { give: false },
    note: '小数池 [0,1)：每满 1 才扣 1 加到 clue。补满它等于凭空多一条线索，故不补；'
      + 'devSpec() 里另有一道同名豁免，两处一致。',
  }),
];

/* ═══════════════ 二、材料（M） ═══════════════ */

/**
 * 33 条材料**由数据表工厂展开**，绝不手抄 —— 手抄等于复制一份真相源。
 *   药材    ALCHEMY_HERBS      → cultivation.alchemy.herbs[id]
 *   丹药    ALCHEMY_RECIPES    → cultivation.alchemy.pills[id]（剔除祛障丹，它走旧字段）
 *   矿料    FORGE_ORES         → cultivation.forge.ores[id]
 *   法器    FORGE_ITEMS        → cultivation.forge.items[id]（存货，带耐久）
 *   符文    RUNE_MATERIALS     → cultivation.runes.materials[id]
 *   符箓    RUNE_ITEMS         → cultivation.runes.items[id]（{n,expiresAt}，有保质期）
 */
/**
 * 三条生产线的门控 —— 与界面**逐个对齐**（docs/101 §6.2 / t4 的 D7）：
 *   药材 / 丹药 → `canAct:alchemy`，矿料 → `canAct:forge`，符文材料 → `canAct:runes`。
 *
 * ⚠ 为什么不能用 held(1)：界面露不露丹房走的是 immortalBlockVisible()
 *   （held>0 || crafts>0），而「有开炉记录但一块领地都没占」是真会出现的状态。
 *   那时界面把丹房摆出来了，注册表却判这些原料「未解锁」—— 两条判据分叉
 *   （§2.3 明确要求「不可能分叉」）。canAct 就是复用界面那一份判据。
 */
const RES_MAT_HINT_ALCHEMY = '先占下一块领地，或先开炉炼过一炉：丹房是药材与丹药的家';
const RES_MAT_HINT_FORGE = '先占下一块领地，或先铸过一件器：器房是矿料与法器的家';
const RES_MAT_HINT_RUNES = '先占下一块领地，或先画过一张符：符房是符文材料的家';

/** 药材（4）。 */
const RES_HERBS = ALCHEMY_HERBS.map((h) => makeResource(
  `herb:${h.id}`, h.name, 'material', 'herb',
  (s) => resNum(resAt(resAlchemy(s), 'herbs', h.id)),
  {
    rate: 'herbPerSec', cap: null, gate: gateCanAct('alchemy'), lockedUi: 'dim',
    hint: RES_MAT_HINT_ALCHEMY,
    note: `产地：地图节点「${h.node}」，需已占领且镇守足够。`,
  },
));

/** 丹药成品（7，祛障丹除外：它走 cultivation.pills 旧字段）。 */
const RES_PILLS = ALCHEMY_RECIPES.filter((r) => r.id !== 'quzhang').map((r) => makeResource(
  `pill:${r.id}`, r.name, 'material', 'pill',
  (s) => resNum(resAt(resAlchemy(s), 'pills', r.id)),
  {
    // 【架构 docs/101 §九 A3 / t4 的 D9】rate 只有两种写法：
    //   要么是 derive() 里某个每秒速率，要么是 null —— 而 null 必须在 note 里
    //   说清**为什么没有产率**，否则读者分不清「漏填」和「本来就没有」。
    rate: null, cap: null, gate: gateCanAct('alchemy'), lockedUi: 'dim',
    hint: RES_MAT_HINT_ALCHEMY,
    note: '一次性产出（无持续产率）：一炉一炉炼出来，不是每秒产出的东西。'
      + (r.requiresImmortalTech ? `另需仙道科技「${r.requiresImmortalTech}」。` : ''),
  },
));

/** 矿料（4）。 */
const RES_ORES = FORGE_ORES.map((o) => makeResource(
  `ore:${o.id}`, o.name, 'material', 'ore',
  (s) => resNum(resAt(resForge(s), 'ores', o.id)),
  {
    rate: 'orePerSec', cap: null, gate: gateCanAct('forge'), lockedUi: 'dim',
    hint: RES_MAT_HINT_FORGE,
    note: `产地：地图节点「${o.node}」。与药材同源不同料（刻意不互抢）。`,
  },
));

/** 法器成品（9，逐件存货，带耐久）。 */
const RES_FORGE_ITEMS = FORGE_ITEMS.map((it) => makeResource(
  `item:${it.id}`, it.name, 'material', 'forge',
  (s) => resAt(resForge(s), 'items', it.id) || 0,
  {
    cap: null, gate: gateFlag('forgeBlock'), lockedUi: 'hide',
    hint: '先占下一块领地（或有铸器记录），器房才会露出来',
    note: '一次性产出（无持续产率）：铸一件算一件，不是每秒产出的东西。'
      + `部位「${it.slot}」· 耐久上限 FORGE_DURABILITY_MAX。`
      + '存货是对象而非纯数字，注册表只读、不碰 durability 以外的语义。',
  },
));

/** 符文（4）。 */
const RES_RUNE_MATERIALS = RUNE_MATERIALS.map((m) => makeResource(
  `runematerial:${m.id}`, m.name, 'material', 'runematerial',
  (s) => resNum(resAt(resRunes(s), 'materials', m.id)),
  {
    rate: 'runeMaterialPerSec', cap: null, gate: gateCanAct('runes'), lockedUi: 'dim',
    hint: RES_MAT_HINT_RUNES,
    note: `产地：地图节点「${m.node}」。`,
  },
));

/** 符箓成品（4，堆叠存货 {n, expiresAt}，有保质期）。 */
const RES_RUNES = RUNE_ITEMS.map((r) => makeResource(
  `talisman:${r.id}`, r.name, 'material', 'rune',
  (s) => resAt(resRunes(s), 'items', r.id) || 0,
  {
    cap: null, gate: gateFlag('runesBlock'), lockedUi: 'hide',
    hint: '先占下一块领地（或有画符记录），符房才会露出来',
    note: '一次性产出（无持续产率）：画一张算一张，不是每秒产出的东西。'
      + `保质期 RUNE_SHELF_HOURS=${RUNE_SHELF_HOURS} 游戏小时`
      + '（dev 补满只加数量，不刷新已存那一张的 expiresAt）。',
  },
));

/** 其余材料：祛障丹存量与人丹。 */
const RES_MISC_MATERIALS = [
  makeResource('pillStore:quzhang', '祛障丹存量', 'material', 'pill',
    (s) => resNum(resAt(s, 'cultivation', 'pills')),
    {
      cap: null, gate: gateTech('quzhang'), lockedUi: 'hide',
      hint: '研习「祛障」之后，才谈得上服丹破障',
      note: 'cultivation.pills 数的是**已服下**的枚数（历史命名），'
        + '不是库房存量；注册表沿用同一字段，不改写语义。',
    }),
  makeResource('humanPill', '人丹', 'material', 'pill',
    (s) => resNum(resAt(s, 'cultivation', 'humanPills')),
    {
      cap: null, gate: gateFlag('humanPillBlock'), lockedUi: 'hide',
      hint: '主修血煞一脉才有「献祭凡人」这条路，别的人看不见',
      note: '一次性产出（无持续产率）：献祭一次得一枚，不是每秒产出的东西。'
        + '门控复用 systems/progression.js 的 immortalBlockVisible(state,"humanPill")。',
    }),
];

/* ═══════════════ 三、人口（P） ═══════════════ */

/**
 * ⚠ 人口一律 `dev.give=false`：
 *   population = 1e12 会让死亡率里的拥挤项 (pop/housing)² 变成 ∞² → NaN，
 *   整局数值会当场烂掉（docs/101 §3.3）。
 */
const RES_POPULATION = [
  makeResource('population', '凡人人口', 'population', 'population', (s) => resNum(resAt(s, 'population')), {
    rate: 'netPerSec', cap: 'housingCap', gate: gateNull(), lockedUi: 'dim',
    hint: '开局即有：田地抬出生率，房产抬容纳量', uiLabel: '人口',
    dev: { give: false },
  }),
  makeResource('housingCap', '家族容纳量', 'population', 'population',
    (s) => derive(s).housingCap, {
      cap: null, gate: gateNull(), lockedUi: 'dim', hint: '每栋房产都让家族多养人',
      dev: { give: false },
      note: '派生值（derive().housingCap），不是 state 字段。',
    }),
  makeResource('cultivatorCount', '炼气人口', 'population', 'population',
    (s) => resCount(s, 'cultivation', 'cultivators'), {
      cap: 'cultivatorCap', gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '一名族人服下祛障丹破障，家族才有第一位修士',
      dev: { give: false },
      note: '等价于 cultivation.cultivators.length（与 c.qi 保持同步）。',
    }),
  makeResource('cultivatorCap', '名册容量', 'population', 'population',
    (s) => cultivatorLimit(s), {
      cap: null, gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '5 + 凡人人口/1000（科技按比例放大）：想多养修士，先添丁',
      dev: { give: false },
    }),
  makeResource('innateCount', '天生修士', 'population', 'population',
    (s) => resCountOf(s, 'origin', 'innate'), {
      cap: null, gate: gateSecrets(SECRET_UNLOCK), lockedUi: 'hide',
      hint: '新生儿自带灵根者，天生可修；灵气池越深越容易出',
      dev: { give: false },
    }),
  makeResource('laborWorkers', '作坊用工', 'population', 'population',
    (s) => derive(s).laborWorkers, {
      cap: null, gate: gateFlag('cityBlock'), lockedUi: 'hide',
      hint: '须先盖起药圃矿寮纸坊：它们都要人，做工要死人',
      dev: { give: false },
    }),
  makeResource('mineWorkers', '矿工', 'population', 'population',
    (s) => resNum(resAt(s, 'cultivation', 'mineWorkers')), {
      cap: MINE_WORKER_MAX, gate: gateFlag('mineBuilt'), lockedUi: 'hide',
      hint: '矿场开起来之后，才谈得上派多少凡人去挖石头',
      dev: { give: false },
      note: `上限 MINE_WORKER_MAX=${MINE_WORKER_MAX}（core/config.js 具名常量）。`,
    }),
  makeResource('garrisonCount', '镇守人数', 'population', 'population',
    (s) => resCount(s, 'cultivation', 'world', 'garrison'), {
      cap: null, gate: gateHeld(1), lockedUi: 'hide',
      hint: '占下领地之后要派人镇守，不然赋税上不来还会叛离',
      dev: { give: false },
    }),
];

/** 数一遍「cultivators 里满足某字段条件的」（origin/addCultivator 的用法）。 */
function resCountOf(state, field, want) {
  const list = resAt(state, 'cultivation', 'cultivators');
  if (!Array.isArray(list)) return 0;
  return list.filter((p) => p && p[field] === want).length;
}

/* ═══════════════ 四、进度与等级（G） ═══════════════ */

/**
 * 建筑计数（8）：从 BUILDINGS 表展开，id 一律 `building:<id>`。
 * 未解锁的建筑**不必藏** —— 格物页的建筑卡本来就是「灰 + 须研习「X」」口径，
 * 藏起来反而让人不知道有这条路（docs/100 §4 的「生产面板走灰」）。
 */
const RES_BUILDINGS = BUILDINGS.map((b) => makeResource(
  `building:${b.id}`, b.name, 'progress', 'progress',
  (s) => resNum(resAt(s, 'buildings', b.id)),
  {
    cap: null,
    gate: b.tech ? gateTech(b.tech) : gateNull(),
    lockedUi: 'dim',
    hint: b.tech ? `须先研习「${b.tech}」才能营造` : '开局即可营造',
    note: `每座：${b.perText || ''}。建筑是**进度**不是量：`
      + '开发者模式不给（补满它等于跳过整条营造链，见 docs/101 §3.3 裁决 e）。',
  },
));

const RES_PROGRESS = [
  makeResource('buildingCap', '建筑容量', 'progress', 'progress', (s) => derive(s).buildingCap, {
    cap: null, gate: gateNull(), lockedUi: 'dim', hint: '地基与地产决定能盖几座',
    dev: { give: false },
  }),
  makeResource('techCount', '已研习科技', 'progress', 'progress', (s) => resCount(s, 'techs'), {
    cap: () => Object.keys(TECH_MAP).length, gate: gateNull(), lockedUi: 'dim',
    hint: '格物页每研习一项，后一项才会露出来',
    dev: { give: false },
    note: '刻意**不显示总数**（看到总数就是剧透，见 ui/app.js 的 PAGE_RES 注释）。',
  }),
  makeResource('immortalTechCount', '已参悟仙道术', 'progress', 'progress',
    (s) => resCount(s, 'immortalTechs'), {
      cap: () => Object.keys(IMMORTAL_TECH_MAP).length, gate: gateFlag('immortalPage'),
      lockedUi: 'hide', hint: '仙道那一列科技，要等仙途页开了才看得见',
      dev: { give: false },
    }),
  makeResource('highestRealmIndex', '最高境界', 'progress', 'progress',
    (s) => highestRealmIndex(s), {
      // 【架构 docs/101 §2.3 / t4 的 D5】境界档位的真名是 REALM_MAX_INDEX
      //   （data/realms.js:500 = realmCursorEnd），**没有** REALMS 这个符号。
      //   原来写 REALMS.length 会 ReferenceError —— 今天不炸只因本项 dev.give=false，
      //   一旦 §2.3 第二步（可见性函数读注册表）落地就是开机崩。
      cap: REALM_MAX_INDEX, gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '族中修为最高的那一位，决定了首页顶部那一格仪表',
      dev: { give: false },
      note: '⚠ 绝不补满：realmIndex=∞ 会越出 realms 的 26 档表（docs/101 §3.3）。',
    }),
  // 【架构 docs/101 §九 A1 / t4 的 D6】原来 path 返回字符串（''/'qi'/'foundation'…）
  //   ⇒ `X.res.read` 兜成 0，这一行永远是 0（注册表里的**死行**）。
  //   改成**数字**：当前该露的是第几格仪表（0 = 凡人期没有仪表）。
  //   字符串键仍留在 systems/progression.js 的 realmDashboardKey()（界面在用），
  //   这里不复制它的名单，只把它归一成序号 —— 少一处「同一规则写两遍」。
  makeResource('realmDashboard', '境界仪表格', 'progress', 'progress',
    (s) => DASHBOARD_CELL_ORDER.indexOf(realmDashboardKey(s)) + 1, {
      cap: DASHBOARD_CELL_ORDER.length, gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '凡人时期没有仪表；有了修士，首页顶部才随境界换表',
      dev: { give: false },
      note: `1..${DASHBOARD_CELL_ORDER.length} 依次对应 ${DASHBOARD_CELL_ORDER.join(' / ')}；`
        + '0 = 凡人期，没有仪表。仪表该不该出现仍由 dashboardVisible() 判。',
    }),
  makeResource('alchemyFurnace', '丹炉等级', 'progress', 'progress',
    (s) => resNum(resAt(resAlchemy(s), 'furnace')) || 1, {
      cap: ALCHEMY_FURNACE_MAX, gate: gateFlag('alchemyBlock'), lockedUi: 'hide',
      hint: '须先开丹房：丹炉越高，成功率越高、能炼的丹方越高级',
      note: '丹炉等级是**进度**不是量：开发者模式不给（docs/101 §3.3 裁决 e）。',
    }),
  makeResource('forgeLevel', '锻造台等级', 'progress', 'progress',
    (s) => resNum(resAt(resForge(s), 'level')) || 1, {
      cap: FORGE_LEVEL_MAX, gate: gateFlag('forgeBlock'), lockedUi: 'hide',
      hint: '须先开器房：锻造台越高，成功率越高、能铸的法器越高级',
      note: '锻造台等级是**进度**不是量：开发者模式不给（docs/101 §3.3 裁决 e）。',
    }),
  makeResource('runeBench', '符台等级', 'progress', 'progress',
    (s) => resNum(resAt(resRunes(s), 'bench')) || 1, {
      cap: RUNE_BENCH_MAX, gate: gateFlag('runesBlock'), lockedUi: 'hide',
      hint: '须先开符房：符台越高，成功率越高、能画的符箓越高级',
      note: '符台等级是**进度**不是量：开发者模式不给（docs/101 §3.3 裁决 e）。',
    }),
  makeResource('craftsAlchemy', '累计开炉', 'progress', 'progress',
    (s) => resNum(resAt(resAlchemy(s), 'crafts')), {
      cap: null, gate: gateFlag('alchemyBlock'), lockedUi: 'hide',
      hint: '开炉次数就是丹房这一条线的进度',
      dev: { give: false },
    }),
  makeResource('craftsForge', '累计铸器', 'progress', 'progress',
    (s) => resNum(resAt(resForge(s), 'crafts')), {
      cap: null, gate: gateFlag('forgeBlock'), lockedUi: 'hide',
      hint: '铸器次数就是器房这一条线的进度',
      dev: { give: false },
    }),
  makeResource('craftsRunes', '累计画符', 'progress', 'progress',
    (s) => resNum(resAt(resRunes(s), 'crafts')), {
      cap: null, gate: gateFlag('runesBlock'), lockedUi: 'hide',
      hint: '画符次数就是符房这一条线的进度',
      dev: { give: false },
    }),
  makeResource('exchangeCount', '兑灵石笔数', 'progress', 'progress',
    (s) => resNum(resAt(s, 'exchangeCount')), {
      cap: null, gate: gateSecrets(SECRET_UNLOCK), lockedUi: 'hide',
      hint: '坊市一共能吃几笔银钱，看这条涨到哪一格',
      dev: { give: false },
    }),
  makeResource('expeditionRuns', '探索归来次数', 'progress', 'progress',
    (s) => resNum(resAt(s, 'expeditionRuns')), {
      cap: null, gate: gateTech('trade'), lockedUi: 'hide',
      hint: '每回来一支探索队，就多一条秘闻的指望',
      dev: { give: false },
      note: '【凡人篇 I1】原 `tradeRuns`。旧档的取值由 core/save.js 的 migrateV1toV2 / migrateV2toV3 搬过来。',
    }),
  makeResource('expeditionSlots', '驿馆名额', 'progress', 'progress',
    (s) => derive(s).expeditionSlots, {
      cap: null, gate: gateTech('trade'), lockedUi: 'hide', hint: '每座驿馆多一支在途探索队',
      dev: { give: false },
      note: '【凡人篇 I1】原 `caravanSlots`。建筑 id 仍是 `caravan`（不许改），显示名已改「驿馆」。',
    }),
  makeResource('usedExpeditions', '在途探索队', 'progress', 'progress',
    (s) => resCount(s, 'expeditions'), {
      cap: 'expeditionSlots', gate: gateTech('trade'), lockedUi: 'hide',
      hint: '先有驿馆名额才谈得上在途：在途的探索队不算位子空着',
      dev: { give: false },
      note: '【凡人篇 I1】原 `usedCaravans`，读的字段由 `caravans` 改成 `expeditions`。',
    }),
  makeResource('milestoneCount', '人口里程碑', 'progress', 'progress',
    (s) => resCount(s, 'milestones'), {
      cap: () => POP_MILESTONES.length, gate: gateNull(), lockedUi: 'dim',
      hint: '每突破一档人口，族谱上会记一笔',
      dev: { give: false },
    }),
  makeResource('marketUnlockCount', '坊市已解锁商品', 'progress', 'progress',
    (s) => resCount(s, 'marketUnlocks'), {
      cap: null, gate: gateSecrets(SECRET_UNLOCK), lockedUi: 'hide',
      hint: '一件商品花 1 条秘闻解锁，解锁永久有效',
      dev: { give: false },
    }),
  makeResource('cycleCount', '轮回世数', 'progress', 'progress',
    (s) => resNum(resAt(s, 'meta', 'cycle')) || 1, {
      cap: null, gate: gateFlag('cyclePage'), lockedUi: 'hide',
      hint: '走到能收束一世的时候，轮回页才会出现',
      dev: { give: false },
    }),
  makeResource('reincarnationPoints', '轮回点', 'progress', 'progress',
    (s) => resNum(resAt(s, 'meta', 'points')), {
      cap: null, gate: gateFlag('cyclePage'), lockedUi: 'hide',
      hint: '一轮走完结算得来的点数，用来换金手指',
      dev: { give: false },
    }),
  makeResource('poolBlueprint', '灵池蓝图', 'progress', 'progress',
    (s) => (resAt(s, 'cultivation', 'poolBlueprint') === true ? 1 : 0), {
      cap: 1, gate: gateSecrets(SECRET_UNLOCK), lockedUi: 'hide',
      hint: '坊市里花 2 灵石买下蓝图，才谈得上营造灵池',
      dev: { give: false },
      note: '布尔事实（一件商品），不补。',
    }),
  makeResource('pool', '灵池', 'progress', 'progress',
    (s) => resNum(resAt(s, 'cultivation', 'pool')), {
      cap: POOL_MAX, rate: 'POOL_STONE_PER_SEC', gate: gateFlag('poolBlueprint'),
      lockedUi: 'hide', hint: '灵池每秒烧灵石，换来凡人后天破障的机会',
      note: `上限 POOL_MAX=${POOL_MAX}、耗石 POOL_STONE_PER_SEC=${POOL_STONE_PER_SEC}`
        + '/座/秒（core/config.js 具名常量）。',
    }),
  makeResource('veinCount', '灵脉记录', 'progress', 'progress',
    (s) => resCount(s, 'cultivation', 'veins'), {
      cap: VEIN_MAX, gate: gateFlag('compass'), lockedUi: 'hide',
      hint: '研习寻龙尺之后，才能勘得灵脉并留档',
      dev: { give: false },
      note: `上限 VEIN_MAX=${VEIN_MAX}（core/config.js）。`,
    }),
  makeResource('mineLevel', '矿场等级', 'progress', 'progress',
    (s) => resNum(resAt(s, 'cultivation', 'mineLevel')), {
      cap: 1, gate: gateFlag('veinReady'), lockedUi: 'hide',
      hint: '先有一条还有储量的灵脉，才谈得上开矿场',
      dev: { give: false },
    }),
  makeResource('caveRuns', '洞天历练次数', 'progress', 'progress',
    (s) => resNum(resAt(s, 'cultivation', 'caveRuns')), {
      cap: null, gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '洞天赌的是命与机缘，每进去一次都记一笔',
      dev: { give: false },
    }),
  makeResource('conquestCount', '已占城池', 'progress', 'progress',
    (s) => resCount(s, 'cultivation', 'conquests'), {
      cap: 3, gate: gateRealm(1), lockedUi: 'hide',
      hint: '攻下一座势力城，就多开一座坊市、多一份赋税',
      dev: { give: false },
      note: '占城 1/2/3 座分别开青木/黑石/万象三座坊市。',
    }),
  makeResource('heldCount', '已占领地', 'progress', 'progress',
    (s) => resCount(s, 'cultivation', 'world', 'held'), {
      cap: null, gate: gateRealm(1), lockedUi: 'hide',
      hint: '先占下一块领地：药材、矿料、符料全从地里来，这是三条仙道线的原料源头',
      dev: { give: false },
    }),
  makeResource('reachedCount', '已探明地点', 'progress', 'progress',
    (s) => resCount(s, 'cultivation', 'world', 'reached'), {
      cap: null, gate: gateFlag('immortalPage'), lockedUi: 'hide',
      hint: '相邻才能去：探明哪里，决定了能打谁、能采什么',
      dev: { give: false },
    }),
];

/* ═══════════════ 五、属性与倍率（X，只读派生） ═══════════════ */

/**
 * ⚠ 这一组**没有一项可补满**（dev.give 全 false）。
 *   它们是「规则」而不是「家产」：把死亡率补成 0、把倍率补成 ∞，
 *   等于把游戏里所有代价都抹掉，开发者模式会变成「关掉游戏」。
 *   它们的用途是**读**：界面显示，以及测试核对「补资源没顺手改坏别的量」。
 */
function resModifier(id, name, path, hint, o = {}) {
  return makeResource(id, name, 'modifier', 'modifier', path, {
    cap: null, gate: gateNull(), lockedUi: 'dim', hint,
    uiLabel: o.uiLabel, note: o.note || '',
    dev: { give: false },
  });
}

const RES_MODIFIERS = [
  resModifier('m_birthRate', '出生率', (s) => derive(s).birthRate, '田地越多，族人添得越快',
    '规则型（不是家产）：它由 `population` 与田地推导，必须有出口但不该被补满。'),
  resModifier('m_deathRate', '死亡率', (s) => derive(s).deathRate,
    '拥挤、做工、扩张都在这里加码 —— 惩罚必须透明',
    '⚠ 不许有解锁状态：藏起来 = 隐藏公式或隐藏代价（docs/100 §5）。'),
  resModifier('m_netPerSec', '净增长', (s) => derive(s).netPerSec, '出生减死亡，正数是添丁、负数是凋零'),
  resModifier('m_crowdRatio', '拥挤度', (s) => derive(s).crowdRatio, '人口顶到容纳量的几成，过了阈值死亡率开始爬'),
  resModifier('m_silverPerSec', '岁入', (s) => derive(s).silverPerSec, '人口越多、科技越高，每秒进账越多',
    { note: '资源条上那一格「岁入」就是这一条。' }),
  resModifier('m_silverCap', '银两上限', (s) => derive(s).silverCap, '钱庄与库房决定库房能堆多满'),
  resModifier('m_totalPower', '家族战力', (s) => derive(s).totalPower, '凡人、修士、镇守合起来的一条线，攻伐全看它',
    { uiLabel: '战力', note: '资源条上写作「战力」。' }),
  resModifier('m_tradeStoneMult', '兑率杠杆', (s) => derive(s).fx.tradeStoneMult, '城里的科技越像样，银钱越值灵石'),
  resModifier('m_incomeMult', '岁入倍率', (s) => derive(s).fx.incomeMult, '科技与法宝带来的产出加成'),
  resModifier('m_cityMaterialMult', '作坊倍率', (s) => derive(s).cityMaterialMult, '灵田、悬壶、灵脉感应抬起来的产出加成'),
  resModifier('m_immortalCapMult', '名册加成', (s) => derive(s).fx.immortalCapMult, '仙道科技给名册容量的**乘数**加成（人口是底，科技只能放大）'),
  resModifier('m_secretChance', '秘闻概率', (s) => derive(s).fx.secretChance, '出门探访带随机缘，这一项把它抬起来'),
];

/* ═══════════════ 六、解锁标记（F） ═══════════════ */

/**
 * 这一组是**所有可解锁内容的门控真相源**（从 state 直接读，不复制）。
 *   · 它们自己**一律不带解锁状态**（gate: null）—— 自我门控必死锁，
 *     仙途页当初的自锁就是这么来的（docs/100 §5 最后一条）。
 *   · 它们也**不带开发者模式**（dev.give=false）：把 compass 补成 true
 *     等于跳过整条「秘闻→寻龙尺→灵脉→矿场」的链子，那是按一键通关，
 *     不是「已解锁资源无限」这个需求。
 */
function resFlag(id, name, path, hint, gate = gateNull(), note = '') {
  // 【架构 docs/101 §3.2】口径按门控定：无门控的（gateNull）一律 dim（总是显示），
  // 有门控的才 hide（藏）。写死 'hide' 会让「gate:null 却不显示」这种自相矛盾
  // 的条目混进注册表 —— 那正是 t4 的 D2/D7 的形状。
  const g = gate || gateNull();
  return makeResource(id, name, 'flag', 'flag', path, {
    cap: 1, gate: g, lockedUi: g.kind === 'null' ? 'dim' : 'hide', hint, dev: { give: false }, note,
  });
}

const RES_FLAGS = [
  resFlag('immortalPage', '仙途已开', (s) => (resAt(s, 'cultivation', 'unlocked') === true ? 1 : 0),
    '只要有第一件事可做（买得起祛障丹 / 有线索 / 有仙道术），仙途页就该出现',
    gateNull(),
    '判据函数 immortalAccessible()：问「有没有事可做」，不问「有没有修士」。'),
  resFlag('cityBlock', '城中作坊', (s) => (derive(s).cityMaterialMult > 1 ? 1 : 0),
    '药圃、矿寮、纸坊要把人口换成原料，城里先得有这样的地方',
    gateNull(),
    '门控写 null（不再挂 herbhouse）：这条 flag 只是「城里有没有作坊」的读数。'),
  resFlag('alchemyBlock', '丹房', (s) => (immortalBlockVisible(s, 'alchemy') ? 1 : 0),
    '占下一块领地（或有炼丹记录）之后，丹房才会露出来',
    { kind: 'canAct', value: 'alchemy' }),
  resFlag('forgeBlock', '器房', (s) => (immortalBlockVisible(s, 'forge') ? 1 : 0),
    '占下一块领地（或有铸器记录）之后，器房才会露出来',
    { kind: 'canAct', value: 'forge' }),
  resFlag('runesBlock', '符房', (s) => (immortalBlockVisible(s, 'runes') ? 1 : 0),
    '占下一块领地（或有画符记录）之后，符房才会露出来',
    { kind: 'canAct', value: 'runes' }),
  resFlag('humanPillBlock', '人丹一脉', (s) => (immortalBlockVisible(s, 'humanPill') ? 1 : 0),
    '主修血煞一脉，才谈得上炼人丹',
    gateNull(),
    '门控写 null：人丹这一脉的可见性本身是复合判据（schoolUnlocks || 已有存量），'
      + '拿它当别人的门控只会把两条链子缠在一起。'),
  resFlag('compass', '寻龙尺', (s) => (resAt(s, 'cultivation', 'compass') === true ? 1 : 0),
    `集齐 ${COMPASS_SECRET_REQ} 条秘闻，才够得着寻龙探脉这条路`,
    gateSecrets(COMPASS_SECRET_REQ)),
  resFlag('veinReady', '有储量的灵脉', (s) => ((resAt(s, 'cultivation', 'veins') || []).some((v) => (v && v.reserve > 0)) ? 1 : 0),
    '先勘出一条还有储量的灵脉，矿场才有地方开',
    gateFlag('compass')),
  resFlag('mineBuilt', '矿场已建', (s) => (resNum(resAt(s, 'cultivation', 'mineLevel')) > 0 ? 1 : 0),
    '矿场开起来之后，才谈得上派工',
    gateFlag('veinReady')),
  resFlag('cyclePage', '轮回已开', (s) => (resCyclePageOpen(s) ? 1 : 0),
    '走到能收束一世（或已经轮回过），轮回页才会出现',
    { kind: 'canAct', value: 'cyclePage' }),
];

/**
 * 轮回页此刻该不该出现 —— 与 ui/app.js 的 pageVisible(state,'cycle') 同一口径。
 * 抽成一个小函数是为了让上面那条注册项的写法短到不会数错括号。
 */
function resCyclePageOpen(s) {
  const m = metaOf(s);
  return reincarnationProgress(s).canEnd
    || resNum(resAt(s, 'meta', 'cleared')) > 0
    || resCount(s, 'meta', 'unlocked') > 0
    || (resNum(resAt(s, 'meta', 'cycle')) || 1) > 1;
}

/* ═══════════════ 注册表本体 ═══════════════ */

/**
 * 索引条目：**没有数值、不作为资源条格子出现**，只把「玩家可见状态的顶层归属」
 * 写在一处（用户需求 ①：给所有玩家可见变量归类 —— 银两属于「资源」大类，
 * 不是孤立字段）。改 createState() 的顶层结构时，这里也要一起看一眼。
 */
const RES_INDEX = [
  makeResource('stateIndex', '状态索引', 'pointer', 'index', (s) => (s ? 1 : 0), {
    cap: 1, gate: gateNull(), lockedUi: 'dim',
    hint: '这不是一条资源，是给注册表与测试看的总目录',
    note: '顶层可见量清单：`silver` 与 `spiritStones` 是货币大类；'
      + '`population` 是人口大类；`secrets`（累计秘闻）与 `cultivation.clues`（可消耗线索）'
      + '分属货币大类但**同名不同物**；`morality` 是道心（规则型，必须有解锁状态之外的出口）；'
      + '`clock.year` 是世界钟（只折算成「寿 X 余 Y」，不单独占格子）；'
      + '`meta` 是跨周目的元进度；`settings` 是玩家偏好（含 devMode 开关）；'
      + '`buildings` / `techs` / `immortalTechs` 归进度大类；`expeditions` / `expeditionRuns` 归进度；'
      + '`log` / `stats` / `quiz` / `wordStats` 是内部记账，不属于资源。',
  }),
];

/** 全部资源条目（顺序即注册表顺序）。 */
const RESOURCES = [
  ...RES_CURRENCY,
  ...RES_HERBS,
  ...RES_PILLS,
  ...RES_ORES,
  ...RES_FORGE_ITEMS,
  ...RES_RUNE_MATERIALS,
  ...RES_RUNES,
  ...RES_MISC_MATERIALS,
  ...RES_POPULATION,
  ...RES_BUILDINGS,
  ...RES_PROGRESS,
  ...RES_MODIFIERS,
  ...RES_FLAGS,
  ...RES_INDEX,
];

/** id → 条目。 */
const RESOURCE_MAP = Object.fromEntries(RESOURCES.map((r) => [r.id, r]));

/** 按 kind 取条目。 */
function resourcesOfKind(kind) { return RESOURCES.filter((r) => r.kind === kind); }

/**
 * 注册表里是否**具备补满资格**：只有货币与材料。
 * 注册表与 devRefill 共用这一个出口，避免「两处各判一次」而走偏。
 */
function resourceCanBeGiven(res) {
  return Boolean(res && res.dev && res.dev.give === true
    && (res.kind === 'currency' || res.kind === 'material'));
}
