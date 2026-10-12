
/* ────────────────────────────────────────────────────────────────
 * 区块：修士规则：修为增长、战力加成、名册修补
 * 原属 src/data/cultivation.js 第 220–326 行
 * ──────────────────────────────────────────────────────────────── */
const CULTIVATOR_LIMIT = 300;            // **硬**上限：防止超大存档和每帧渲染过重
/**
 * 【用户实测 2026-10-11】炼气期的名额基数 —— 开局只带得起五个修士。
 * 用户原话：「我想了想应该限制修士总数，修士的总数上限应该与凡人人口总数相关，
 * 炼气期只能有五个左右修士这样。然后随着后续发展加多。」
 */
const CULTIVATOR_BASE_CAP = 5;
/** 每多少凡人加一个名额。20 = 「五个修士要有一百凡人打底」的反推。 */
const CULTIVATOR_PER_MORTALS = 20;
const CULTIVATOR_SURNAMES = ['林','顾','沈','陆','苏','谢','秦','周','许','叶','唐','白'];
const CULTIVATOR_GIVEN = ['清衡','云岚','知微','怀瑾','望舒','玄澈','清越','景行','思远','若虚','静尘','长风'];

/**
 * 修士能修到的最高境界。
 *
 * R3 起由**灵根**决定（见 systems/roots.js 的 rootLevelCap）：
 * 天灵根可至化神圆满，五灵根只到元婴圆满。
 * 上限是硬的，但可以通过「测灵根」花灵石改善，所以不会卡死。
 */
function cultivateLevelCap(person) { return rootLevelCap(person); }

/**
 * 名册容量。
 *
 * 【用户实测 2026-10-11】名册容量**必须挂在凡人人口上**。
 *
 * 旧口径是「恒定 300 + 仙道科技」—— 与人口无关。后果是**可复现的**：
 * 离线结算在 12 小时上限内要跑两万步（见 engine.js runOffline 的
 * capped / OFFLINE_MAX_STEPS），每一步都可能新增修士，于是玩家下线一趟回来
 * 直接看到「一下子多了两百个修士」。用户报告过两次：第一次当成「离线收益过多」
 * 去修收益，这次才定到根因 —— **上限本身与人口无关**，所以收益怎么削都堵不住。
 *
 * 新口径：**5（炼气期起步）+ 每 20 凡人 +1，再夹到硬上限 300**，科技照旧加名额。
 * 自平衡：addCultivator 每收一人扣 1 凡人（cultivation.js 约 324 行），
 * 所以人口掉下去名额也跟着掉，不会出现「修士越生越多、凡人一个不剩」。
 * 起点人口 10 ⇒ 容量 5，正是用户要的「炼气期只有五个左右」。
 *
 * 科技那一层仍然有意义：名册容量是**玩家唯一能靠科技推高的「人数上限」**，
 * 而修士数又同时决定领地镇守、材料产出与全局战力。
 */
function cultivatorLimit(state) {
  const fx = state && state.immortalTechs ? techEffects(state) : null;
  const pop = Math.max(0, Math.floor(Number(state && state.population) || 0));
  const fromPop = Math.floor(pop / CULTIVATOR_PER_MORTALS);
  const base = CULTIVATOR_BASE_CAP + fromPop;
  // 【用户实测 2026-10-11】科技**只能放大**人口给的名额，不能另开一份。
  //   旧版是 `immortalCapFlat`（开脉直接 +150 人 ⇒ 5 → 155），名册于是与人口脱钩，
  //   离线一趟照样能刷出上百个修士 —— 那正是用户报的问题。
  //   现在：容量 = (5 + 人口/20) × (1 + 科技加成)，**人口永远是那个底**。
  const mult = 1 + Math.max(0, Number(fx && fx.immortalCapMult) || 0);
  return Math.min(CULTIVATOR_LIMIT, Math.floor(base * mult));
}

/** 从 index 升到 index+1 需要多少修为（转发 data/realms.js 的曲线）。 */
function cultivateXpNeeded(realmIndex) { return realmXpNeeded(realmIndex); }

/** 该境界的单人基础战力（转发 data/realms.js 的曲线）。 */
function cultivateBasePower(realmIndex) { return realmPower(realmIndex); }
function averageTalent(state) { const ps=state.cultivation?.cultivators||[]; return ps.length ? ps.reduce((a,p)=>a+Math.max(1,Number(p.talent)||1),0)/ps.length : 1; }

/**
 * 【策划 T-0 / T-2b / T-3 / T-4 / T-5 / T-6】逐人字段的**幂等兜底**。
 *
 * 五轮任务往 person 上加了八个字段（push / stalled / realmEnteredYear /
 * foundation / core / errandSince …），每一个都会让老存档读进来是 undefined。
 * 把它们集中在这一个函数里补默认值，好处是：
 *   ① `hydrate()` 与 `repairCultivation()` 共用同一份口径，不会两处各写一套；
 *   ② 修为 / 突破计数 / 灵根的既有夹取逻辑也一并搬进来，
 *      于是「老存档（只有 qi 整数）→ 逐人字段」那条路自动获得同样的兜底。
 * ⚠ 这个函数会改 p.xp / p.breakFailures / p.realmIndex，调用方按需先做迁移。
 */
function ensurePersonFields(p, state) {
  if (!p || typeof p !== 'object') return p;
  const need = realmXpNeeded(p.realmIndex);
  // 修为最多夹到「本层所需」。注意**不能**夹到 need - ε：
  // 那样修为永远到不了满值，大境界的瓶颈状态（blocked）就永远不成立，
  // 冲关按钮也就永远不出现。
  p.xp = Number.isFinite(need) ? Math.max(0, Math.min(need, Number(p.xp) || 0)) : 0;
  const bf = Number(p.breakFailures);
  p.breakFailures = Number.isFinite(bf) ? Math.max(0, Math.floor(bf)) : 0;
  // 灵根：老存档里的修士没有这个字段，补掷一次
  ensureRoot(p);
  // ── T-3：猛进开关与气机滞住 ──
  if (p.push !== true) p.push = false;
  p.stalled = Math.max(0, Number(p.stalled) || 0);
  // ── T-2b：入此境之年（族谱上「余 Y」的起点）──
  p.realmEnteredYear = Math.max(0, Number(p.realmEnteredYear) || 0);
  // ── T-4：出门在外的起始年（纯展示用；召回时删掉）──
  if (p.job === 'errand') p.errandSince = Math.max(0, Number(p.errandSince) || 0);
  else delete p.errandSince;
  // ── T-5：道基。老存档没有 ⇒ null；数据坏掉也退回 null ──
  if (!(p.foundation && typeof p.foundation === 'object' && p.foundation.nodeId)) p.foundation = null;
  else p.foundation = {
    nodeId: p.foundation.nodeId,
    element: p.foundation.element,
    // 品阶 1..5 —— 5 = 天品地块 + 已镇守越的那一档（见 data/realms.js 的 FOUNDATION_GRADES）
    grade: Math.max(1, Math.min(5, Math.floor(Number(p.foundation.grade) || 1))),
  };
  // ── T-6：丹纹 / 护纹 / 本层是否已结过丹 ──
  // mercy 的语义见 docs/91 §十二.3：护纹（失败不掉纹），不是成率补偿。
  if (!(p.core && typeof p.core === 'object')) p.core = { marks: 0, mercy: 0, used: {} };
  p.core.marks = Math.max(0, Math.floor(Number(p.core.marks) || 0));
  p.core.mercy = Math.max(0, Number(p.core.mercy) || 0);
  if (!(p.core.used && typeof p.core.used === 'object')) p.core.used = {};
  else {
    const used = {};
    for (const [k, v] of Object.entries(p.core.used)) {
      if (v === true && Number.isFinite(Number(k))) used[String(Math.floor(Number(k)))] = true;
    }
    p.core.used = used;
  }
  // ── T-7：圣胎（元婴）。老存档没有 ⇒ 满稳固、在体、无驻地 ──
  //   稳固度是「元婴还能在外待多久」的唯一刻度；低于 30 进躁动区、到 0 离体不返。
  if (!(p.nascent && typeof p.nascent === 'object')) {
    p.nascent = { stability: NASCENT_STABILITY_MAX, out: false, place: null, lost: false };
  } else {
    p.nascent.stability = Math.max(0, Math.min(NASCENT_STABILITY_MAX, Number(p.nascent.stability) || 0));
    p.nascent.out = p.nascent.out === true;
    p.nascent.place = typeof p.nascent.place === 'string' ? p.nascent.place : null;
    p.nascent.lost = p.nascent.lost === true;
    // 数据自洽：不在外就不该有驻地；离体不返者一律视为已回体
    if (!p.nascent.out || p.nascent.lost) p.nascent.place = null;
  }
  return p;
}

/**
 * 【策划 C8 / 任务 T-7】取某人的圣胎状态（幂等，保证字段存在）。
 * 单点入口：所有读写圣胎的地方都走它，避免又出现「两处各写一套」。
 */
function nascentOf(p) {
  if (!(p.nascent && typeof p.nascent === 'object')) {
    p.nascent = { stability: NASCENT_STABILITY_MAX, out: false, place: null, lost: false };
  }
  return p.nascent;
}

/** 该修士是否**有**圣胎可温养（元婴及以上）。 */
function hasNascent(p) {
  return Math.floor(Number(p && p.realmIndex) || 0) >= NASCENT_LOST_REALM;
}

/** 该修士的圣胎是否正在出窍。 */
function nascentIsOut(p) { return hasNascent(p) && nascentOf(p).out === true && nascentOf(p).lost !== true; }

/** 元婴是否已「离体不返」（到 0 的下场：不删数据，只是不再涨修为）。 */
function nascentIsLost(p) { return hasNascent(p) && nascentOf(p).lost === true; }

/** 出窍者在某个节点上的「威压」战力 —— 与镇守同一口径（它就是本体在压着这块地）。 */
function nascentWardPower(state, nodeId) {
  const people = (state.cultivation && state.cultivation.cultivators) || [];
  let power = 0;
  for (const p of people) {
    if (!nascentIsOut(p)) continue;
    if (nascentOf(p).place !== nodeId) continue;
    power += cultivatorPower(state, p);
  }
  return power;
}

/** 某个节点上是否**有**出窍的元婴在镇着（界面与豁免判定都读它）。 */
function nascentWardsAt(state, nodeId) { return nascentWardPower(state, nodeId) > 0; }

/**
 * 【策划 C8 / 任务 T-7 验收标准 7】把所有出窍的元婴叫回来（离线结算前调用）。
 * **不回退稳固度**（离线不惩罚）—— 只把 `out` 置 false、清掉驻地。
 * 返回被召回的人数（`runOffline` 用它决定要不要写一条日志）。
 */
function recallAllNascent(state, now = Date.now()) {
  const people = (state.cultivation && state.cultivation.cultivators) || [];
  let n = 0;
  for (const p of people) {
    if (!hasNascent(p)) continue;
    const na = nascentOf(p);
    if (!na.out) continue;
    na.out = false;
    na.place = null;
    n += 1;
  }
  if (n > 0) pushLog(state, `你不在的这段日子里，${n} 道元婴都回了本体 —— 它们不曾在无人看顾时耗尽。`, 'cultivate', null, now);
  return n;
}

/**
 * 【策划 C8 / 任务 T-7 验收标准 3】出窍威压**绕开** `mapGarrisonLimit()`。
 *
 * 这正是本节点与**仙道科技线**的功能性交叉点：
 *   科技 `zhenyue` / `jielu` 抬的是 `garrisonCapFlat` → `mapGarrisonLimit()`；
 *   而元婴出窍提供的是**不受那个上限约束**的第二条路。
 *   两者作用在**同一个量**（「我能有效压住几块地」）上 ⇒ 不是各自并存的装饰，
 *   而是「科技抬底线、境界抬高线」的叠加关系。
 *   `smoke` 用「同时上科技 + 出窍」的断言把这条关系钉住（见 T-7 的 tech 联动断言）。
 */
function mapEffectiveGarrisonLimit(state) {
  const w = worldOf(state);
  const outCount = Object.keys(w.garrison).length;
  const nascentCount = ((state.cultivation && state.cultivation.cultivators) || [])
    .filter((p) => nascentIsOut(p) && nascentOf(p).place).length;
  return mapGarrisonLimit(state) + nascentCount;
}

/**
 * 【策划 C8 / 任务 T-7 验收标准 5】躁动区的修为倍率。
 * 稳固度 < 30 ⇒ 修为速率 **−40%**（×0.6）；离体不返 ⇒ **0**（不再涨修为）。
 * 出处：docs/91 §三 T-7 数值设计。
 */
function nascentTrainMult(person) {
  if (!hasNascent(person)) return 1;
  const na = nascentOf(person);
  if (na.lost) return 0;
  return na.stability < NASCENT_RESTLESS_BELOW ? NASCENT_RESTLESS_TRAIN_MULT : 1;
}

/** 是否处于「元婴躁动」区（稳固度 < 30 且尚未离体不返）。 */
function nascentIsRestless(person) {
  return hasNascent(person) && !nascentOf(person).lost
    && nascentOf(person).stability < NASCENT_RESTLESS_BELOW;
}

/**
 * 【策划 C8 / 任务 T-7 验收标准 8】边界警告：稳固度降到 30 / 15 / 5 时各播报一次，
 * 文案里明写「再 X 分钟元婴离体不返」——**警告必须可算**，不能只说「有危险」。
 * 用 `nascent.warned` 记账，保证每档只弹一次（否则每秒刷屏）。
 */
function warnNascentThresholds(state, person, now) {
  const na = nascentOf(person);
  if (!na.warned || typeof na.warned !== 'object') na.warned = {};
  // 从高到低扫（30 → 15 → 5）：跌破就播一次并记账，一次 tick 只播一档。
  // 恢复回 30 以上时清账（见下面 else 分支），于是**下一轮出窍会重新警告** ——
  // 否则第二次冒险就变成静默的，而这条机制的全部意义就是「警告必须有效」。
  for (const line of NASCENT_WARN_AT) {
    if (na.stability >= line) continue;
    if (na.warned[String(line)] === true) continue;
    na.warned[String(line)] = true;
    const mins = Math.max(1, Math.ceil(na.stability / NASCENT_DRAIN_PER_SEC / 60));
    pushLog(state, `${person.name}的元婴摇摇欲坠（稳固 ${Math.floor(na.stability)}）—— 再约 ${mins} 分钟便离体不返。`, 'cultivate', null, now);
    break;
  }
}

/**
 * 【策划 C14 / 任务 T-2b】世界钟的幂等兜底。
 * `state.clock` 是顶层新字段；没有它的时候「寿元钟」整条都不成立（会读到 undefined）。
 */
function ensureClock(state) {
  if (!state || typeof state !== 'object') return { year: 0 };
  if (!state.clock || typeof state.clock !== 'object') state.clock = { year: 0 };
  state.clock.year = Math.max(0, Number(state.clock.year) || 0);
  return state.clock;
}

function repairCultivation(state) {
  const c=state.cultivation; if(!c)return;
  // 【策划 C14 / 任务 T-2b】世界钟：老存档没有这个顶层字段
  ensureClock(state);
  // ── 仙道科技与坊市兑换次数：老存档没有这两个字段 ──
  // 1.0 的存档读进来就是「仙道篇未开启」，而不是崩在 undefined.includes 上。
  // 同时把已经不存在于表中的 id 清掉 —— 改了数据表之后旧存档仍然能 load。
  // ⚠ 这两个字段挂在**顶层 state**上，与 techs 并列，不在 cultivation 里：
  //   凡人与仙道是同一层级的「已研习清单」，放一起才好对照着看。
  if(!Array.isArray(state.immortalTechs)) state.immortalTechs=[];
  state.immortalTechs=state.immortalTechs.filter(id=>IMMORTAL_TECH_MAP[id]);
  const ec=Number(state.exchangeCount);
  state.exchangeCount=Number.isFinite(ec)&&ec>0?Math.floor(ec):0;
  // ── 境界：把旧的 person.realm（1..9 的炼气层数）迁移到全局 realmIndex ──
  // 炼气一层~九层在新体系里正好也是 index 1..9，所以旧值可以直接用。
  // 保底：负数、NaN、超界的都夹回合法范围。
  for(const p of c.cultivators||[]){
    const raw = p.realmIndex !== undefined ? p.realmIndex : p.realm;
    p.realmIndex = Math.max(1, Math.min(REALM_MAX_INDEX, Math.floor(Number(raw) || 1)));
    delete p.realm;                       // 旧字段清掉，避免两处真相
    ensurePersonFields(p, state);
  }
  // ── 秘籍：把已收录、参悟、两个装备位都收拾成合法状态 ──
  if(!Array.isArray(c.manuals))c.manuals=[];
  c.manuals=c.manuals.filter(id=>CULTIVATION_MANUAL_MAP[id]);
  if(!c.attune||typeof c.attune!=='object')c.attune={};
  for(const id of Object.keys(c.attune)){
    if(!c.manuals.includes(id)){delete c.attune[id];continue;}
    const v=Number(c.attune[id]);
    c.attune[id]=Number.isFinite(v)?Math.max(0,Math.min(MANUAL_ATTUNE_MAX,Math.floor(v))):0;
  }
  if(!c.manuals.includes(c.equippedManual))c.equippedManual=c.manuals[0]||null;
  if(!c.manuals.includes(c.assistManual)||c.assistManual===c.equippedManual)c.assistManual=null;
  // 同道途不可同时占两位
  if(c.assistManual&&CULTIVATION_MANUAL_MAP[c.assistManual]?.dao===CULTIVATION_MANUAL_MAP[c.equippedManual]?.dao)c.assistManual=null;
  for(const p of c.cultivators||[]){ if(!(p.talent>0)) p.talent=p.origin==='innate'?1.1:1; if(!CULTIVATOR_JOBS[p.job])p.job='retreat'; }
  // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「涉及文件」cultivation.js:82】
  // cluePool 是 cluePerSecFlat 的小数池：老存档没有它，补 0。
  for(const [k,v] of Object.entries({poolBlueprint:false,pool:0,compass:false,veins:[],mineLevel:0,mineWorkers:0,clues:0,cluePool:0,caveRuns:0,conquests:[]})){if(c[k]===undefined)c[k]=v;}
  // 地图世界状态：抵达、占领、镇守、民怨（worldOf 会顺手把旧 conquests 迁进来）
  worldOf(state);
  // 【策划 C11 / 任务 T-8 验收标准 8】护法位：与 world.garrison 同构但**独立字段**
  //   （镇守是「压着一块地」，护法是「为一次天劫结阵」，语义不同，不能共用一个 map）。
  //   老存档没有它 ⇒ 补成空数组。
  {
    const w = worldOf(state);
    if (!Array.isArray(w.wardens)) w.wardens = [];
    w.wardens = w.wardens.map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v) && v > 0);
  }
  // 丹房状态：药材、丹药、丹炉等级、各方熟练度
  alchemyOf(state);
  // 器坊状态：矿料、已铸法器、装备位、耐久、锻造台等级
  forgeOf(state);
  // 符房状态：符文、符箓存货与保质期、挂着的加成、符台等级
  runesOf(state);
}
function cultivateName(id) {
  const i=Math.max(1,Math.floor(id))-1;
  return CULTIVATOR_SURNAMES[i%CULTIVATOR_SURNAMES.length] + CULTIVATOR_GIVEN[Math.floor(i/CULTIVATOR_SURNAMES.length)%CULTIVATOR_GIVEN.length];
}
function addCultivator(state, origin='awakened', now=Date.now(), silent=false, parentage='', rng=Math.random) {
  const c=state.cultivation;
  if (!Array.isArray(c.cultivators)) c.cultivators=[];
  if (c.cultivators.length >= cultivatorLimit(state) || (parentage!=='cultivator-cultivator' && state.population < 1)) return null;
  const id = Math.max(1,Math.floor(c.nextId || 1));
  const innate=origin==='innate';
  const person={
    id,name:cultivateName(id),
    origin:innate?'innate':'awakened',
    // 灵根：天生灵根用更好的权重表，后天祛障只能碰运气。
    // 它决定修炼速度、突破修正，以及**能修到哪一境界**（硬上限）。
    root: rollRoot(rng, innate),
    // 全局境界序号：1 = 炼气一层。往后筑基初期是 10、化神圆满是 25。
    realmIndex:1,
    xp:0,
    // 连续冲关失败次数，用于给成功率补偿；成功即清零。
    breakFailures:0,
    job:'retreat',
    talent:innate?Math.max(1.1,averageTalent(state)*1.1):1,
    parentage:innate?(parentage||'cultivator-mortal'):'awakening',
    // 【策划 C2 / 任务 T-3】猛进行气开关与「气机滞住」剩余秒数
    push:false,
    stalled:0,
    // 【策划 C14 / 任务 T-2b】入此境之年（族谱上「寿 X，余 Y」的 Y 由它算）
    realmEnteredYear:Math.max(0,Number(state.clock?.year)||0),
    // 【策划 C4 / 任务 T-5】道基：择地筑基后才落库，此前为 null
    foundation:null,
    // 【策划 C6 / 任务 T-6】丹纹 / 失败补偿 / 本层是否已结过丹
    core:{ marks:0, mercy:0, used:{} },
  };
  c.nextId=id+1;
  c.cultivators.push(person);
  c.qi=c.cultivators.length;
  c.unlocked=true;
  if(parentage!=='cultivator-cultivator')state.population=Math.max(0,state.population-1); // 修士×凡人：出生的凡人转入修士人口；两修士家庭则直接生下修士
  if (!silent) {
    pushLog(state,person.origin==='innate'?
      `天降灵根！${person.name}生而通灵，成为家族第 ${c.qi} 位炼气修士。`:
      `${person.name}祛障成功，成为家族第 ${c.qi} 位炼气修士。`, 'cultivate',null,now);
  }
  return person;
}
/**
 * 灵气池给**天生灵根诞生率**的加成。
 *
 * 灵池是「以秘闻换来的修行世界入口」：池子越深，灵气越浓，
 * 灵根落在新生儿身上的机会就越大。这是「仙养凡」最直接的一条 ——
 * 玩家在山那边花的灵石，会变成城里婴儿身上的一副好根骨。
 */
function innatePoolBonus(state) {
  const pools = Math.max(0, Number(state.cultivation?.pool) || 0);
  return Math.min(INNATE_POOL_BONUS_MAX, pools * INNATE_POOL_BONUS_PER);
}

function cultivationBonuses(state) {
  const people=state.cultivation?.cultivators || [];
  // 家族层面的加成（不过滤灵根），用于界面上展示「这套功法一共值多少」
  const familyManual=manualBonus(state);
  // 法器加成是全族共享的（装备在家族名下，不是某个人身上）。
  // 耐久为 0 的法器不计入 —— 这是炼器的负面对价。
  const art=artifactBonus(state);
  const fx = techEffects(state);
  let corePower=0, guardBonus=0, workUnits=0, exploreUnits=0, retreat=0, innate=0;
  for(const p of people){
    // 每个人吃自己灵根能修的那一份；天灵根对本系功法还有专精
    const mb=manualBonusFor(state,p);
    // 法器与功法加成相加（都是「百分比加成」，相加比相乘更好解释给玩家）；
    // 主修流派的战力加成也加在这里 —— 剑修就是靠这一项吃饭的。
    // 仙道科技「御剑术」给的是家族层面的 familyPowerMult，直接加在这里。
    // 【策划 C6 / 任务 T-6 验收标准 6 / 涉及文件】丹品带来的家族战力倍率。
    // 逐人乘（有丹纹的人才吃得到），所以它在循环里算；展示用的聚合值随之变化。
    const coreMult=corePowerMult(p);
    const powerMult=(1+mb.power+art.power+schoolFx(state,'power')+fx.familyPowerMult)*coreMult;
    // 劳作与探索按「层数」计，所以这里用大档内的层号而不是全局序号，
    // 否则筑基的 10 层会直接把 laborMult 顶到上限。
    const idx=Math.max(0,Math.min(cultivateLevelCap(p),p.realmIndex||0));
    const local=realmLocalOf(idx)||1;
    const base=cultivateBasePower(idx)*powerMult;
    corePower+=base;
    if(p.job==='guard') guardBonus+=base*.5;
    if(p.job==='labor') workUnits+=local*(1+mb.labor);
    if(p.job==='explore') exploreUnits+=local*(1+mb.explore);
    if(p.job==='retreat') retreat++;
    if(p.origin==='innate') innate++;
  }
  return {corePower,guardBonus,workLevels:workUnits,exploreLevels:exploreUnits,retreat,innate,
    manual:familyManual, artifact:art,
    laborMult:Math.min(2,workUnits*.08),
    exploreTradeBonus:Math.min(.50,exploreUnits*.02),
    // 仙道科技「集贤馆」这类给的是**常驻**的自主寻秘，与修士在岗无关
    explorePerSec:(exploreUnits/9600)+Math.max(0,fx.explorePerSecFlat),
    // 仙道科技给的常驻修炼倍率。界面拿它显示「全族修炼 +N%」，
    // 与 progressCultivators 里真正乘上去的那一项是同一个来源。
    techTrainMult:Math.max(0.1, 1 + (fx.trainMult || 0))};
}
/**
 * 【策划 C2 / 任务 T-3】猛进的修为倍率。
 * 只在闭关且 push === true 时生效 —— 宗门已经有 3.5×，再乘 2.2 就是 7.7 倍，
 * 宗门会立刻成为唯一解（docs/91 §三 T-3「为什么猛进只对 retreat 开放」）。
 */
function pushRateMult(person) {
  return person?.push === true ? PUSH_RATE_MULT : 1;
}

/**
 * 【策划 C2 / 任务 T-3 验收标准 5】界面要写出**可算的风险**：
 * 「本层期望走火 X 次」，X = 走火速率 × 本层所需修为 ÷ 猛进速度。
 * 推导出处：docs/91 §三 T-3 的更新过程模型（m = r·N/v，N = 45·local²）。
 * 正是这个数让玩家自己看出「八层是分界线、九层猛进反而更慢」。
 */
function pushFireExpectation(person) {
  const idx = Math.max(0, Math.floor(Number(person?.realmIndex) || 0));
  const local = Math.max(1, realmLocalOf(idx));
  const need = realmXpNeeded(idx);
  if (!Number.isFinite(need)) return 0;
  const rate = local * PUSH_FIRE_PER_LOCAL;
  return (rate * need) / PUSH_RATE_MULT;
}

/**
 * 【策划 C6 / 任务 T-6 验收标准 6】丹品带来的修炼倍率（部分人来用）。
 * 丹纹档位表在 data/realms.js 的 CORE_GRADES，出处 docs/91 §三 T-6。
 */
function coreTrainMult(person) {
  if (!person?.core) return 1;
  return coreGradeOf(coreOf(person).marks).train;
}

/**
 * 【策划 C6 / 任务 T-6 验收标准 6】丹品带来的战力倍率。
 * 由 systems/exploration.js 的 cultivatorPower() 乘上去。
 */
function corePowerMult(person) {
  if (!person?.core) return 1;
  return coreGradeOf(coreOf(person).marks).power;
}

/**
 * 【策划 C1 / 任务 T-4】一名在外族人的每秒结算：带回线索 / 不回来。
 *
 * 数值出处：docs/91-落地任务清单.md §三 T-4「数值设计」——
 *   线索 `ERRAND_CLUE_PER_SEC = 2.5e-5` /秒/人（10 人 = +0.90 条/时）；
 *   死亡 `ERRAND_DEATH_PER_SEC = 4e-6` /秒/人（10 人 3 小时期望 0.43 人）。
 * 两条都是「小概率事件」，所以按泊松近似把 dt 折算成一次判定
 *   （不这么做的话，dt = 1 秒时 2.5e-5 的逐帧判定会变成每秒一次掷骰，
 *   在倍速与大步长下会失真）。
 * ⚠ 死亡只发生在外的那几个人身上，**不碰凡人死亡率模型**。
 */
/**
 * 【策划 C8 / T-7 · C11 / T-8】把一名修士从名册上摘掉。
 *
 * 抽成单点入口的原因：这条逻辑现在有**三处**调用者（投帖不回、元婴躁动、天劫陨落），
 * 而它必须同时维护三件记账（名册 / `qi` / `stats.deaths`）——
 * 三处各抄一遍，早晚有一处忘了减 `qi`（那个 bug 不会报错，只会让「炼气人口」
 * 永远对不上名册长度，而 `cultivation.qi` 正是解锁仙途的判据）。
 *
 * @param {boolean} inherit 是否留下传承（法器入库 + 秘闻线索）——
 *   只有**天劫陨落**给传承（docs/91 §三 T-8 验收标准 5：「陨落保留传承」）。
 *   投帖不归与元婴躁动不给：前者是凡人级的损耗，后者是玩家自己拖到 0 的后果。
 */
function removeCultivator(state, person, now = Date.now(), inherit = false) {
  const c = state.cultivation;
  if (!c || !person) return false;
  const before = (c.cultivators || []).length;
  c.cultivators = (c.cultivators || []).filter((p) => p !== person);
  if (c.cultivators.length === before) return false;   // 本来就不在册，幂等
  c.qi = c.cultivators.length;
  state.stats.deaths = (Number(state.stats.deaths) || 0) + 1;
  if (inherit) {
    // 传承：一件遗物法器 + 10 条秘闻（数值出处：docs/91 §三 T-8 验收标准 5）
    state.spiritStones = (state.spiritStones || 0) + 30;
    c.clues = (Number(c.clues) || 0) + 10;
    pushLog(state, `${person.name}的道统未绝：遗下一件旧物与十条秘闻，归入家族。`, 'cultivate', null, now);
  }
  return true;
}

function advanceErrand(state, person, dt, now, rng) {
  const step = Math.max(0, Number(dt) || 0);
  if (!(step > 0)) return;

  // 1) 不回来（先判死：死人的线索不该再结算）
  const deathChance = 1 - Math.exp(-ERRAND_DEATH_PER_SEC * step);
  if (rng() < deathChance) {
    removeCultivator(state, person, now);
    pushLog(state, `${person.name}出门投帖，久无音信 —— 怕是回不来了。`, 'cultivate', null, now);
    return;
  }

  // 2) 带回一条秘闻线索
  const clueChance = 1 - Math.exp(-ERRAND_CLUE_PER_SEC * step);
  if (rng() < clueChance) {
    state.cultivation.clues = (state.cultivation.clues || 0) + 1;
    pushLog(
      state,
      `${person.name}在外打听得一条风声，带回秘闻线索（现共 ${state.cultivation.clues} 条）。`,
      'secret', null, now,
    );
  }
}

function progressCultivators(state,dt,now=Date.now(),rng=Math.random,births=0) {
  const c=state.cultivation;
  if(!c || !(dt>0)) return;
  const people=c.cultivators||[];
  const LIMIT = cultivatorLimit(state);
  // 仙道科技的加成在整个循环里取一次即可（不是每人一份）
  const fxTech = techEffects(state);
  // 天生灵根来自本次自然出生的凡人；已有修士不参与凡人死亡率
  if(births>0 && people.length>0 && people.length<LIMIT && state.population>=1) {
    // 泊松事件近似。小步模拟时避免逐一枚举上千名婴儿。
    //
    // innateMult 是**城市能对仙道施加的最强杠杆**：
    //   仙道科技「引灵」「灵枢」提高它，灵气池（灵池）也提高它。
    // 所以「城越大 → 生得越多 → 天生灵根越多」这条正反馈是有实体的，
    // 而不是一句宣传语。见 docs/15-科技线.md 的反馈循环图。
    const innateMult = Math.max(0, 1 + (fxTech.innateBirthMult || 0) + innatePoolBonus(state));
    const perBirth = INNATE_CHANCE_PER_BIRTH * innateMult;
    const eventChance=1-Math.exp(-births*perBirth*Math.min(5,people.length/10));
    if(rng()<eventChance) addCultivator(state,'innate',now,false,'cultivator-mortal',rng);
  }
  if(people.length>=2 && c.cultivators.length<LIMIT){
    const pairChance=1-Math.exp(-Math.floor(people.length/2)*dt/3000000);
    if(rng()<pairChance)addCultivator(state,'innate',now,false,'cultivator-cultivator',rng);
  }
  for(const person of people) {
    // 【策划 C8 / 任务 T-7 验收标准 2】圣胎稳固度的推进（**写在所有 continue 之前**）。
    //   在体：+0.02/秒（回复）；出窍：−0.03/秒（消耗）。
    //   出处：docs/91 §三 T-7 数值设计（100→0 = 55.6 分钟）。
    //   ⚠ 只有元婴及以上才消耗随机数/写字段 —— 对既有存档与既有测试的 rng 序列零影响。
    if (hasNascent(person)) {
      const na = nascentOf(person);
      if (na.lost) {
        // 离体不返：稳固度恒为 0，不再有任何推进（战力保留，见 cultivatorPower）
      } else if (na.out) {
        na.stability = Math.max(0, na.stability - NASCENT_DRAIN_PER_SEC * dt);
        if (na.stability <= 0) {
          // 【验收标准 6】到 0 = 离体不返：境界冻结在元婴初期、不删数据、战力保留
          na.lost = true;
          na.out = false;
          na.place = null;
          person.realmIndex = Math.min(person.realmIndex, NASCENT_LOST_REALM);
          pushLog(state, `${person.name}的元婴在外太久了，终究没能回来 —— 从此不再涨修为，但人还在。`, 'cultivate', null, now);
          continue;
        }
        // 【验收标准 8】边界警告：30 / 15 / 5 各弹一次
        warnNascentThresholds(state, person, now);
        // 【验收标准 2】出窍期间**修为完全不涨** —— 这是「本体不动」的实现
        continue;
      } else {
        na.stability = Math.min(NASCENT_STABILITY_MAX, na.stability + NASCENT_RECOVER_PER_SEC * dt);
        // 回满到最高警告档之上就清账 ⇒ 下一轮出窍会重新警告（警告不能只用一次）
        if (na.stability >= NASCENT_WARN_AT[0]) na.warned = {};
      }
    }
    // 【策划 C1 / 任务 T-4】出门在外的人：先判「不回来」，再过修为那道 continue。
    // 之所以写在最前面，是因为下面 :204 的放行名单只认 retreat/sect ——
    // 差事的人会被它跳过，判定就再也没机会执行了。
    // ⚠ 只有 `job === 'errand'` 的人才会消耗这一次 rng，所以对既有存档/既有测试
    //   的随机数序列零影响（对照实验：balance.mjs 的逐小时数字不变）。
    if (person.job === 'errand') { advanceErrand(state, person, dt, now, rng); continue; }
    // 【策划 C2 / 任务 T-3 验收标准 4】气机滞住期间不涨修为，每秒递减 1。
    // 同样只对 stalled > 0 的人消耗随机数，序列零影响。
    if ((Number(person.stalled) || 0) > 0) {
      person.stalled = Math.max(0, Number(person.stalled) - dt);
      continue;
    }
    if(!['retreat','sect'].includes(person.job)) continue;
    const cap=cultivateLevelCap(person);
    const idx=Math.max(0,Math.floor(person.realmIndex)||0);
    if(idx>=cap) continue;
    // 卡在大境界瓶颈上（本档最后一层 + 修为已满）就停止积累，等玩家去冲关。
    // 这是「主动突破」的全部实现：系统不会替你跨大档。
    if(realmGate(idx) && person.xp>=realmXpNeeded(idx)) continue;
    // 【策划 C6 / 任务 T-6 验收标准 1】金丹期修为满且本层未结丹时，同样停止积累 ——
    // 等玩家在「晋升」与「结丹」之间选。**不再自动晋升**，这是金丹玩法的地基。
    if(!realmGate(idx) && breakthroughState(person).kind==='folding') continue;
    // 【策划 C11 / 任务 T-8 验收标准 1】化神期三层靠**天劫**晋升，同样不许自动跳级。
    // ⚠ 这一条不可省：`REALM_GATES` 里没有 22/23/24 的条目，所以 `realmGate(idx)` 为 null，
    //   而下面的自动晋升 `while` 只认 gate —— 不拦住的话修为一满就自动升级，
    //   「渡劫界面」永远不会出现（静默失败，不报错）。
    if(isTribulationRealm(idx) && person.xp>=realmXpNeeded(idx)) continue;

    // 家族功法只对「闭关」生效——宗门修的是宗门的法，传不进山门。
    // 所以宗门是安全的 3.5× 固定路线，闭关则随功法收藏成长，收藏够了会反超。
    // 功法的倍率要过灵根（manualTrainingMultiplierFor）：灵根不合的人吃不到。
    const manualMult = person.job==='retreat' ? manualTrainingMultiplierFor(state,person) : 1;
    // 聚灵符是全族生效的限时加成（对宗门弟子也算 —— 符贴在静室里，谁回来都能用）
    const runeMult = runeTrainingMult(state, now);
    // 金手指：掌天瓶的代价（分心）与天生道体的增益
    const metaMult = metaTrainMult(state);
    // 主修流派的修炼加成/减益 —— 合欢快、剑修慢
    const schoolMult = 1 + schoolFx(state, 'training');
    // 仙道科技「聚灵阵」「元婴大道」给的全族修炼加成。
    // 它是**全族常驻**的（与聚灵符那种限时符箓不同），所以乘在这里。
    // 下限夹到 0.1，防止以后加「以寿元换修为」那类节点时把速度压成负数。
    const techTrainMult = Math.max(0.1, 1 + (fxTech.trainMult || 0));
    // 灵根是第四个乘数：天灵根 ×2.0，五灵根 ×0.7
    // 【策划 C2 / 任务 T-3 验收标准 2】猛进：闭关修士的修为增量恰好 ×2.2。
    // 【策划 C6 / 任务 T-6 验收标准 6】丹品修炼倍率：丹纹越高，闭关越快。
    // 出处：docs/91-落地任务清单.md §三 T-3（2.2 倍）与 T-6（丹纹 → 品阶 → 修炼倍率）。
    // 【策划 C8 / 任务 T-7 验收标准 5】元婴躁动区的惩罚：
    //   稳固度 < 30 ⇒ 修为速率 **−40%**（×0.6）；离体不返 ⇒ ×0（不再涨修为）。
    //   出处：docs/91 §三 T-7 数值设计。
    const nascentMult = nascentTrainMult(person);
    person.xp += REALM_XP_RATE*dt*manualMult*runeMult*metaMult*schoolMult*techTrainMult*rootSpeedMult(person)*(Number(person.talent)||1)*(person.job==='sect'?3.5:1)*pushRateMult(person)*coreTrainMult(person)*nascentMult;

    // 【策划 C8 / 任务 T-7 验收标准 5】躁动判定：稳固度 < 30 时每秒 5e-5 概率陨落。
    //   只在躁动区才消耗随机数 ⇒ 对既有存档与既有测试的 rng 序列零影响。
    //   概率出处与「为什么不是 16.5%」见 core/config.js 的 NASCENT_RESTLESS_PER_SEC 注释。
    if (nascentIsRestless(person)) {
      const restlessChance = 1 - Math.exp(-NASCENT_RESTLESS_PER_SEC * Math.max(0, dt));
      if (rng() < restlessChance) {
        pushLog(state, `${person.name}的元婴躁动难制，道体崩解，就此陨落。`, 'cultivate', null, now);
        removeCultivator(state, person, now);
        continue;
      }
    }

    // 【策划 C2 / 任务 T-3】走火判定：以 local × 1.0e-4 /秒 的速率到达，每次把**本层**修为清零。
    // 判定写在增量之后：低层猛进「快 2.2 倍」，九层猛进「反而更慢 5%」，
    // 于是「低层猛进、九层缓修」是玩家自己算得出来的策略（docs/91 §三 T-3 三条结论）。
    if (person.push === true) {
      const local = Math.max(1, realmLocalOf(idx));
      const fireRate = local * PUSH_FIRE_PER_LOCAL;
      // dt 可能大于 1（倍速 / 大步长），按泊松近似折算，避免出现 p > 1
      const fireChance = 1 - Math.exp(-fireRate * Math.max(0, dt));
      if (rng() < fireChance) {
        person.xp = 0;
        const stalled = rng() < PUSH_STALL_CHANCE;
        if (stalled) person.stalled = PUSH_STALL_SECONDS;
        pushLog(
          state,
          `${person.name}猛进行气走火，本层修为尽散${stalled ? '，气机滞住，五刻之内不能再修' : ''}。`,
          'cultivate', null, now,
        );
        continue;
      }
    }

    // 同一大档内自动晋升；带瓶颈的那一层停住（交给 systems/breakthrough.js）
    while(person.realmIndex<cap){
      const gate=realmGate(person.realmIndex);
      const need=realmXpNeeded(person.realmIndex);
      if(gate){ if(person.xp>need) person.xp=need; break; }
      // 【策划 C6 / 任务 T-6】金丹期修为满时不再自动晋升，先把决策权交给玩家
      if(coreFoldableIndex(person.realmIndex) && !coreUsedHere(person, person.realmIndex) && person.xp>=need) break;
      // 【策划 C11 / 任务 T-8】化神三层不许在 while 里自动跳级（见上面 continue 的说明）
      if(isTribulationRealm(person.realmIndex) && person.xp>=need) break;
      if(!Number.isFinite(need) || person.xp<need) break;
      person.xp-=need;
      person.realmIndex+=1;
      // 【策划 C14 / 任务 T-2b 验收标准 3】境界一变，入此境之年重置
      person.realmEnteredYear = Math.max(0, Number(state.clock?.year) || 0);
      pushLog(state,`${person.name}闭关有成，晋升${realmName(person.realmIndex)}！`,'cultivate',null,now);
    }
  }
  advanceImmortalEconomy(state,dt,now,rng);
  // 符箓的时间推进：清理过期存货、结束聚灵符
  advanceRunes(state,dt,now);
  // 道心的时间推进：主修邪修功法则持续下坠，否则缓慢回升
  advanceMorality(state,dt,now);
  const bonus=cultivationBonuses(state);
  if (bonus.explorePerSec>0 && state.secrets.length<SECRETS.length) {
    const chance=1-Math.exp(-bonus.explorePerSec*dt);
    if(rng()<chance) grantSecret(state,now,rng);
  }
  // ══════════════════════════════════════════════════════════════════
  // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「实现要点 3」】
  // 线索的**可再生**那条腿：仙道科技「探穴 / 界墟」给的 cluePerSecFlat。
  //
  // ⚠ 必须在这里消费，**不能**加进 cultivationBonuses(state) ——
  //   那是展示用的聚合器（而且它在本次循环里被调用过一次，加进去会变成间接消费，
  //   「登记了但没消费」的检查和真实行为就对不上了）。
  // 小数池：0.0002/秒 直接加到 clues 上会被取整成 0，所以先累到 cluePool，
  //   每满 1 才扣 1 加一条线索。这也是「不给线索加存量上限」的前提。
  // 数值出处：docs/91 T-0 供给侧表（慢路 1.62 条/时，需求 59 条，+56% 余量）。
  // ══════════════════════════════════════════════════════════════════
  const clueRate = Math.max(0, Number(fxTech.cluePerSecFlat) || 0);
  if (clueRate > 0 && dt > 0) {
    c.cluePool = Math.max(0, Number(c.cluePool) || 0) + clueRate * dt;
    if (c.cluePool >= 1) {
      const gain = Math.floor(c.cluePool);
      c.cluePool -= gain;
      c.clues = (c.clues || 0) + gain;
      pushLog(state, `宗族在诸地探得的旧闻凑齐了一条秘闻线索（现共 ${c.clues} 条）。`, 'secret', null, now);
    }
  }
}

