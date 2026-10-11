/**
 * 把状态整理成可序列化的存档对象。
 *
 * ⚠ **这是一份手写白名单 —— 加顶层字段时必须同步加进来，否则刷新即静默丢失。**
 *   本项目已经因此踩过一次坑：`immortalTechs` / `morality` / `exchangeCount`
 *   三个顶层字段当初漏在这里，于是刷新一次整条仙道科技线归零、道心回 50、
 *   坊市兑换次数回 0，而所有测试都是绿的（因为旧断言只查 cultivation.* 内部）。
 *   现在 scripts/smoke.mjs 里有一条结构性断言守着：
 *   「`createState()` 的每个顶层字段都必须在 serialize() 的键集合里」。
 */
function serialize(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    createdAt: state.createdAt,
    generation: state.generation,
    silver: state.silver,
    population: state.population,
    buildings: state.buildings,
    techs: state.techs,
    // 【策划 T-1 / docs/91-落地任务清单.md §三 T-1】阻断缺陷修复：补三个顶层字段。
    immortalTechs: state.immortalTechs,
    exchangeCount: state.exchangeCount,
    morality: state.morality,
    // 【策划 T-2b / docs/91 §三 T-2b 涉及文件】世界钟（寿元钟）。
    // 它是 T-1 那条结构性断言的**第一个受益者**：加字段的同时就必须加这里。
    clock: state.clock,
    caravans: state.caravans,
    tradeRuns: state.tradeRuns,
    milestones: state.milestones,
    stats: state.stats,
    settings: state.settings,
    wordStats: state.wordStats,
    customQuizStats: state.customQuizStats,
    customWrongBooks: state.customWrongBooks,
    quiz: state.quiz,
    spiritStones: state.spiritStones,
    secrets: state.secrets,
    cultivation: state.cultivation,
    // 【策划 T-1】元进度（轮回点 / 金手指）也是**顶层**字段。
    // 它原来是整个白名单里唯一「写进去又读不回来」的字段：hydrate() 会重建 meta，
    // 而 serialize() 从不写出 —— 于是每次读档都把轮回进度清空。
    // 这属于同一起缺陷（白名单漏顶层字段），一并补上。
    meta: state.meta,
    log: state.log.slice(0, 20),
    ui: state.ui,
  };
}

/** 把存档对象还原成状态，缺失字段一律用默认值补齐。 */
function hydrate(raw) {
  const fresh = createState(raw.createdAt || Date.now());

  fresh.createdAt = num(raw.createdAt, fresh.createdAt);
  fresh.lastSeen = num(raw.savedAt, Date.now());
  fresh.generation = num(raw.generation, 1);
  fresh.silver = Math.max(0, num(raw.silver, fresh.silver));
  fresh.population = Math.max(0, num(raw.population, fresh.population));
  fresh.tradeRuns = Math.max(0, num(raw.tradeRuns, 0));

  for (const def of BUILDINGS) {
    const v = raw.buildings?.[def.id];
    fresh.buildings[def.id] = Math.max(0, Math.floor(num(v, fresh.buildings[def.id])));
  }

  // 科技：新存档直接读；旧存档（没有 techs 字段）按已有建筑回补，
  // 免得玩家手里有房产却被告知「建筑学未研习」。
  if (Array.isArray(raw.techs)) {
    fresh.techs = raw.techs.filter((id) => typeof id === 'string' && TECH_MAP[id]);
  } else {
    for (const def of BUILDINGS) {
      if (def.tech && fresh.buildings[def.id] > 0 && !fresh.techs.includes(def.tech)) {
        fresh.techs.push(def.tech);
      }
    }
  }

  if (Array.isArray(raw.caravans)) {
    const now = Date.now();
    fresh.caravans = raw.caravans
      .filter((c) => c && typeof c.routeId === 'string')
      .map((c) => {
        let remaining = num(c.remaining, NaN);
        let total = num(c.total, NaN);

        if (!Number.isFinite(remaining)) {
          // 旧存档存的是绝对结束时间戳，换算成剩余游戏秒。
          // 已经到期的置 0，下一次 tick 会照常结算，不会吞掉奖励。
          remaining = Math.max(0, (num(c.endsAt, now) - now) / 1000);
          total = Math.max(remaining, 1);
        } else if (!Number.isFinite(total) || total <= 0) {
          total = Math.max(remaining, 1);
        }

        return {
          routeId: c.routeId,
          startedAt: num(c.startedAt, now),
          remaining,
          total,
          invested: num(c.invested, 0),
        };
      });
  }

  if (Array.isArray(raw.milestones)) {
    fresh.milestones = raw.milestones.map((m) => num(m, 0)).filter((m) => m > 0);
  }

  if (raw.stats && typeof raw.stats === 'object') {
    for (const k of Object.keys(fresh.stats)) {
      fresh.stats[k] = Math.max(0, num(raw.stats[k], fresh.stats[k]));
    }
  }

  if (Array.isArray(raw.log)) {
    fresh.log = raw.log
      .filter((e) => e && typeof e.text === 'string')
      .slice(0, 60)
      .map((e) => ({
        text: e.text,
        kind: typeof e.kind === 'string' ? e.kind : 'info',
        key: e.key ?? null,
        at: num(e.at, Date.now()),
        repeat: num(e.repeat, 1),
      }));
  }

  if (raw.ui && typeof raw.ui === 'object') {
    fresh.ui.buyMode = ['1', '10', 'max'].includes(raw.ui.buyMode) ? raw.ui.buyMode : '1';
    fresh.ui.page = PAGES.includes(raw.ui.page) ? raw.ui.page : 'home';
    fresh.ui.hideDoneTechs = raw.ui.hideDoneTechs === true;
    if (raw.ui.collapsed && typeof raw.ui.collapsed === 'object') {
      for (const [key, val] of Object.entries(raw.ui.collapsed)) {
        if (typeof key === 'string' && val === true) fresh.ui.collapsed[key] = true;
      }
    }
  }

  // 通往修仙篇的那条链
  fresh.spiritStones = Math.max(0, num(raw.spiritStones, 0));
  if (Array.isArray(raw.secrets)) {
    fresh.secrets = [...new Set(raw.secrets.map((v) => Number(v)))]
      .filter((v) => Number.isInteger(v) && v >= 0 && v < SECRETS.length);
  }
  if (raw.cultivation && typeof raw.cultivation === 'object') {
    const oldQi = Math.min(CULTIVATOR_LIMIT,Math.max(0, Math.round(num(raw.cultivation.qi, 0))));
    fresh.cultivation.pills = Math.max(0, Math.round(num(raw.cultivation.pills, 0)));
    fresh.cultivation.manuals = Array.isArray(raw.cultivation.manuals)
      ? raw.cultivation.manuals.filter(id=>typeof id==='string' && CULTIVATION_MANUAL_MAP[id]) : [];
    fresh.cultivation.equippedManual = fresh.cultivation.manuals.includes(raw.cultivation.equippedManual)
      ? raw.cultivation.equippedManual : (fresh.cultivation.manuals[0]||null);
    // 秘籍新增字段：辅修位与参悟度。旧存档读进来就是「只有主修、参悟全 0」。
    fresh.cultivation.assistManual = fresh.cultivation.manuals.includes(raw.cultivation.assistManual)
      && raw.cultivation.assistManual!==fresh.cultivation.equippedManual
      ? raw.cultivation.assistManual : null;
    fresh.cultivation.attune = {};
    if (raw.cultivation.attune && typeof raw.cultivation.attune==='object') {
      for (const id of fresh.cultivation.manuals) {
        const v = num(raw.cultivation.attune[id], 0);
        fresh.cultivation.attune[id] = Math.max(0, Math.min(MANUAL_ATTUNE_MAX, Math.floor(v)));
      }
    }
    if (Array.isArray(raw.cultivation.cultivators)) {
      const ids=new Set();
      for(const p of raw.cultivation.cultivators.slice(0,CULTIVATOR_LIMIT)) {
        if(!p || typeof p!=='object') continue;
        let id=Math.max(1,Math.floor(num(p.id,1)));
        while(ids.has(id)) id++;
        ids.add(id);
        const origin=p.origin==='innate'?'innate':'awakened';
        // 境界迁移：更早的存档存的是 person.realm（1..9 的炼气层数）；
        // 新体系是全局 realmIndex，而炼气一层~九层正好也是 1..9，所以旧值直接沿用。
        const rawRealm = p.realmIndex !== undefined ? p.realmIndex : p.realm;
        const realmIndex=Math.max(1,Math.min(REALM_MAX_INDEX,Math.floor(num(rawRealm,1))));
        const need=cultivateXpNeeded(realmIndex);
        // 同 repairCultivation：夹到 need 而不是 need-ε，否则瓶颈状态永远不成立
        const xp=Number.isFinite(need)?Math.min(need,Math.max(0,num(p.xp,0))):0;
        const bf=Math.max(0,Math.floor(num(p.breakFailures,0)));
        // 灵根：老存档没有这个字段，留 null 让 repairCultivation 补掷一次
        const rootGrade=p.root&&ROOT_GRADE_MAP[p.root.grade]?ROOT_GRADE_MAP[p.root.grade]:null;
        const root=rootGrade?{
          grade:rootGrade.id,
          elements:(Array.isArray(p.root.elements)?p.root.elements:[])
            .filter(e=>ROOT_ELEMENTS[e]).slice(0,rootGrade.count),
          rerolls:Math.max(0,Math.floor(num(p.root.rerolls,0))),
        }:null;
        fresh.cultivation.cultivators.push({id,name:cultivateName(id),origin,root,realmIndex,xp,breakFailures:bf,talent:Math.max(1,Math.min(100,num(p.talent,origin==='innate'?1.1:1))),job:CULTIVATOR_JOBS[p.job]?p.job:'retreat',parentage:origin==='innate'?(p.parentage==='cultivator-cultivator'?'cultivator-cultivator':'cultivator-mortal'):'awakening',
          // 【策划 C2 / C14 / C4 / C6】本节点新增的四个逐人字段。
          // 老存档里没有它们 —— 这里只做「搬运」，一律由 repairCultivation()
          // 的 ensurePersonFields() 幂等补默认值（两处共用同一份口径）。
          // 所以旧存档读进来**不报错、也不会被当成损坏而重开**。
          push:p.push===true, stalled:p.stalled, realmEnteredYear:p.realmEnteredYear,
          foundation:p.foundation||null, core:p.core||null,
        });
      }
      fresh.cultivation.nextId=Math.max(Math.floor(num(raw.cultivation.nextId,1)),1,...fresh.cultivation.cultivators.map(p=>p.id+1));
    } else {
      // 老版本仅有 qi 整数：补齐对应人数的后天炼气修士，不二次扣凡人人口
      for(let i=1;i<=oldQi;i++) fresh.cultivation.cultivators.push({id:i,name:cultivateName(i),origin:'awakened',root:null,realmIndex:1,xp:0,breakFailures:0,job:'retreat',talent:1,parentage:'awakening'});
      fresh.cultivation.nextId=oldQi+1;
    }
    // 【策划 T-0 / docs/91-落地任务清单.md §三 T-0「涉及文件」save.js】
    // cluePool 与 clues 一起迁移；老存档没有这个字段 → 0。
    for(const [k,v] of Object.entries({poolBlueprint:false,pool:0,compass:false,veins:[],mineLevel:0,mineWorkers:0,clues:0,cluePool:0,caveRuns:0,conquests:[],humanPills:0})){fresh.cultivation[k]=raw.cultivation[k]===undefined?v:raw.cultivation[k];}
    fresh.cultivation.humanPills=Math.max(0,Math.floor(num(fresh.cultivation.humanPills,0)));
    fresh.cultivation.clues=Math.max(0,Math.floor(num(fresh.cultivation.clues,0)));
    fresh.cultivation.pool=Math.max(0,Math.min(10,Math.floor(num(fresh.cultivation.pool,0))));
    fresh.cultivation.mineWorkers=Math.max(0,Math.min(10000,Math.floor(num(fresh.cultivation.mineWorkers,0))));
    fresh.cultivation.veins=Array.isArray(fresh.cultivation.veins)?fresh.cultivation.veins.slice(0,20).map(v=>({grade:Math.max(1,Math.min(5,Math.floor(num(v.grade,1)))),reserve:Math.max(0,num(v.reserve,0))})):[];
    fresh.cultivation.conquests=Array.isArray(fresh.cultivation.conquests)?fresh.cultivation.conquests.filter(v=>typeof v==='string').slice(0,3):[];
    // 地图：抵达记录 / 已占领地 / 镇守指派 / 民怨
    {
      const rw=raw.cultivation.world&&typeof raw.cultivation.world==='object'?raw.cultivation.world:{};
      const world={
        reached:Array.isArray(rw.reached)?rw.reached.filter(id=>MAP_NODE_MAP[id]):[],
        held:Array.isArray(rw.held)
          ?rw.held.filter(id=>MAP_NODE_MAP[id]&&MAP_NODE_MAP[id].kind==='foe')
          :fresh.cultivation.conquests.slice(),
        garrison:{},
        unrest:{},
      };
      if(rw.garrison&&typeof rw.garrison==='object'){
        for(const [nodeId,pid] of Object.entries(rw.garrison)){
          const n=Math.max(0,Math.floor(num(pid,0)));
          if(n>0&&MAP_NODE_MAP[nodeId]&&world.held.includes(nodeId))world.garrison[nodeId]=n;
        }
      }
      if(rw.unrest&&typeof rw.unrest==='object'){
        for(const [nodeId,v] of Object.entries(rw.unrest)){
          if(world.held.includes(nodeId))world.unrest[nodeId]=Math.max(0,Math.min(1,num(v,0)));
        }
      }
      fresh.cultivation.world=world;
    }
    // 丹房：药材 / 丹药 / 丹炉等级 / 熟练度
    {
      const ra=raw.cultivation.alchemy&&typeof raw.cultivation.alchemy==='object'?raw.cultivation.alchemy:{};
      const herbs={},pills={},prof={};
      if(ra.herbs&&typeof ra.herbs==='object'){
        for(const [k,v] of Object.entries(ra.herbs)){
          if(ALCHEMY_HERB_MAP[k])herbs[k]=Math.max(0,num(v,0));
        }
      }
      if(ra.pills&&typeof ra.pills==='object'){
        for(const [k,v] of Object.entries(ra.pills)){
          // 祛障丹走旧的 cultivation.pills 字段，不接受这里的重复记录
          if(ALCHEMY_RECIPE_MAP[k]&&k!=='quzhang')pills[k]=Math.max(0,Math.floor(num(v,0)));
        }
      }
      if(ra.prof&&typeof ra.prof==='object'){
        for(const [k,v] of Object.entries(ra.prof)){
          if(ALCHEMY_RECIPE_MAP[k])prof[k]=Math.max(0,Math.min(ALCHEMY_PROFICIENCY_MAX,Math.floor(num(v,0))));
        }
      }
      fresh.cultivation.alchemy={
        herbs,pills,prof,
        furnace:Math.max(1,Math.min(ALCHEMY_FURNACE_MAX,Math.floor(num(ra.furnace,1)))),
        crafts:Math.max(0,Math.floor(num(ra.crafts,0))),
      };
    }
    // 器坊：矿料 / 已铸法器 / 装备位 / 耐久 / 熟练度 / 锻造台等级
    {
      const rf=raw.cultivation.forge&&typeof raw.cultivation.forge==='object'?raw.cultivation.forge:{};
      const ores={},durability={},prof={},equipped={};
      if(rf.ores&&typeof rf.ores==='object'){
        for(const [k,v] of Object.entries(rf.ores)){
          if(FORGE_ORE_MAP[k])ores[k]=Math.max(0,num(v,0));
        }
      }
      const owned=Array.isArray(rf.owned)
        ?[...new Set(rf.owned.filter(id=>FORGE_ITEM_MAP[id]))]
        :[];
      if(rf.durability&&typeof rf.durability==='object'){
        for(const [k,v] of Object.entries(rf.durability)){
          if(owned.includes(k))durability[k]=Math.max(0,Math.min(FORGE_DURABILITY_MAX,num(v,0)));
        }
      }
      if(rf.prof&&typeof rf.prof==='object'){
        for(const [k,v] of Object.entries(rf.prof)){
          if(FORGE_ITEM_MAP[k])prof[k]=Math.max(0,Math.min(FORGE_PROFICIENCY_MAX,Math.floor(num(v,0))));
        }
      }
      if(rf.equipped&&typeof rf.equipped==='object'){
        for(const [slot,id] of Object.entries(rf.equipped)){
          const it=FORGE_ITEM_MAP[id];
          if(it&&it.slot===slot&&owned.includes(id))equipped[slot]=id;
        }
      }
      fresh.cultivation.forge={
        ores,owned,equipped,durability,prof,
        level:Math.max(1,Math.min(FORGE_LEVEL_MAX,Math.floor(num(rf.level,1)))),
        crafts:Math.max(0,Math.floor(num(rf.crafts,0))),
      };
    }
    // 符房：符文 / 存货与保质期 / 熟练度 / 挂着的加成 / 符台等级
    {
      const rr=raw.cultivation.runes&&typeof raw.cultivation.runes==='object'?raw.cultivation.runes:{};
      const mats={},stock={},prof={},pending={};
      if(rr.mats&&typeof rr.mats==='object'){
        for(const [k,v] of Object.entries(rr.mats)){
          if(RUNE_MATERIAL_MAP[k])mats[k]=Math.max(0,num(v,0));
        }
      }
      if(rr.stock&&typeof rr.stock==='object'){
        for(const [k,v] of Object.entries(rr.stock)){
          if(!RUNE_ITEM_MAP[k]||!v||typeof v!=='object')continue;
          const n=Math.max(0,Math.floor(num(v.n,0)));
          if(n<=0)continue;
          stock[k]={n,expiresAt:Math.max(0,num(v.expiresAt,0))};
        }
      }
      if(rr.prof&&typeof rr.prof==='object'){
        for(const [k,v] of Object.entries(rr.prof)){
          if(RUNE_ITEM_MAP[k])prof[k]=Math.max(0,Math.min(RUNE_PROFICIENCY_MAX,Math.floor(num(v,0))));
        }
      }
      if(rr.pending&&typeof rr.pending==='object'){
        for(const [k,v] of Object.entries(rr.pending)){
          if(['cave','attack','break'].includes(k))pending[k]=Math.max(0,Math.min(1,num(v,0)));
        }
      }
      fresh.cultivation.runes={
        mats,stock,prof,pending,
        bench:Math.max(1,Math.min(RUNE_BENCH_MAX,Math.floor(num(rr.bench,1)))),
        crafts:Math.max(0,Math.floor(num(rr.crafts,0))),
        used:Math.max(0,Math.floor(num(rr.used,0))),
        trainUntil:Math.max(0,num(rr.trainUntil,0)),
        trainRate:Math.max(0,Math.min(1,num(rr.trainRate,0))),
      };
    }
    repairCultivation(fresh);
    fresh.cultivation.qi=fresh.cultivation.cultivators.length;
    fresh.cultivation.unlocked=fresh.cultivation.qi>=QI_CHAPTER_THRESHOLD;
  }

  // 道心（道德值）。**不跨周目保留** —— 轮回是重新做人，前世的血债不该跟着走。
  // 它没有被列进 REINCARNATION_KEEP，所以重开会回到中庸。
  fresh.morality=Math.max(MORALITY_MIN,Math.min(MORALITY_MAX,num(raw.morality,MORALITY_START)));

  // ══════════════════════════════════════════════════════════════════
  // 【策划 T-1 / docs/91-落地任务清单.md §三 T-1】阻断缺陷修复的**回读侧**。
  //
  // 这两段原来根本没有 —— 因为 serialize() 从不写出它们，所以 raw 里永远是
  // undefined，于是「读回来是默认值」这件事被兜底掩盖了，静默得很干净。
  // 现在写出侧补齐了，回读侧也必须补上：缺字段（老存档）时照旧用默认值。
  //
  // immortalTechs：与 state.techs 平行的那条仙道科技线。
  //   过滤掉已不存在于表中的 id —— 改了数据表之后旧存档仍然能 load。
  // exchangeCount：云深谷坊市的递进兑换次数（界面上画成一条进度条）。
  // ══════════════════════════════════════════════════════════════════
  fresh.immortalTechs = Array.isArray(raw.immortalTechs)
    ? raw.immortalTechs.filter((id) => typeof id === 'string' && IMMORTAL_TECH_MAP[id])
    : [];
  fresh.exchangeCount = Math.max(0, Math.floor(num(raw.exchangeCount, 0)));

  // 【策划 T-2b / docs/91 §三 T-2b 涉及文件】世界钟：老存档没有 clock 字段。
  {
    const rc = raw.clock && typeof raw.clock === 'object' ? raw.clock : {};
    fresh.clock = { year: Math.max(0, num(rc.year, 0)) };
  }

  // 元进度：跨周目保留的那一份。
  // **漏掉这一段等于每次读档都把轮回进度清空** —— 这是这一区块最危险的迁移点。
  {
    const rm=raw.meta&&typeof raw.meta==='object'?raw.meta:{};
    const uniq=(arr,max)=>[...new Set((Array.isArray(arr)?arr:[]).filter(id=>typeof id==='string'&&GOLDEN_FINGER_MAP[id]))].slice(0,max);
    const unlocked=uniq(rm.unlocked,GOLDEN_FINGERS.length);
    fresh.meta={
      cycle:Math.max(1,Math.floor(num(rm.cycle,1))),
      points:Math.max(0,Math.floor(num(rm.points,0))),
      cleared:Math.max(0,Math.floor(num(rm.cleared,0))),
      unlocked,
      // 携带的金手指必须是已解锁的
      active:uniq(rm.active,GOLDEN_FINGER_SLOTS).filter(id=>unlocked.includes(id)),
      history:Array.isArray(rm.history)?rm.history.slice(-20).map(h=>({
        cycle:Math.max(1,Math.floor(num(h&&h.cycle,1))),
        top:Math.max(0,Math.floor(num(h&&h.top,0))),
        points:Math.max(0,Math.floor(num(h&&h.points,0))),
        at:Math.max(0,num(h&&h.at,0)),
      })):[],
    };
    metaOf(fresh);
  }

  // 设置：答题频率、难度、倍速
  if (raw.settings && typeof raw.settings === 'object') {
    if (QUIZ_MODE_MAP[raw.settings.quizMode]) {
      fresh.settings.quizMode = raw.settings.quizMode;
    }
    if (DIFFICULTIES[raw.settings.difficulty]) {
      fresh.settings.difficulty = raw.settings.difficulty;
    }
    const speed = Number(raw.settings.speed);
    if (SPEED_OPTIONS.includes(speed)) fresh.settings.speed = speed;
  }

  // 单词统计
  if (raw.wordStats && typeof raw.wordStats === 'object') {
    for (const [key, v] of Object.entries(raw.wordStats)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0 || !v || typeof v !== 'object') continue;
      fresh.wordStats[id] = {
        seen: Math.max(0, Math.round(num(v.seen, 0))),
        right: Math.max(0, Math.round(num(v.right, 0))),
        wrong: Math.max(0, Math.round(num(v.wrong, 0))),
      };
    }
  }

  // 自定义题库每题统计、错题本（游戏存档中保存，题库正文另存）
  if (raw.customQuizStats && typeof raw.customQuizStats==='object') {
    for (const [bankId,rows] of Object.entries(raw.customQuizStats).slice(0,60)) {
      if (!rows || typeof rows!=='object' || Array.isArray(rows)) continue;
      const dst={};
      for (const [questionId,stat] of Object.entries(rows).slice(0,1000)) {
        if (!stat || typeof stat!=='object') continue;
        dst[questionId]={seen:Math.max(0,Math.round(num(stat.seen,0))),right:Math.max(0,Math.round(num(stat.right,0))),wrong:Math.max(0,Math.round(num(stat.wrong,0)))};
      }
      fresh.customQuizStats[bankId]=dst;
    }
  }
  if (raw.customWrongBooks && typeof raw.customWrongBooks==='object') {
    for (const [bankId,ids] of Object.entries(raw.customWrongBooks).slice(0,60)) {
      if (Array.isArray(ids)) fresh.customWrongBooks[bankId]=ids.filter(id=>typeof id==='string').slice(0,200);
    }
  }

  // 答题总账
  if (raw.quiz && typeof raw.quiz === 'object') {
    const q = fresh.quiz;
    q.total = Math.max(0, Math.round(num(raw.quiz.total, 0)));
    q.right = Math.max(0, Math.round(num(raw.quiz.right, 0)));
    q.wrong = Math.max(0, Math.round(num(raw.quiz.wrong, 0)));
    q.streak = Math.max(0, Math.round(num(raw.quiz.streak, 0)));
    q.bestStreak = Math.max(q.streak, Math.round(num(raw.quiz.bestStreak, 0)));
    q.lost = Math.max(0, num(raw.quiz.lost, 0));
    q.lostStones = Math.max(0, num(raw.quiz.lostStones, 0));
    if (Array.isArray(raw.quiz.wrongBook)) {
      q.wrongBook = raw.quiz.wrongBook
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0)
        .slice(0, 200);
    }
  }

  return fresh;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 道基品阶的取值范围：1..5（5 = 天品地块 + 已镇守越的那一档）。 */
const FOUNDATION_GRADE_MAX_SAVE = 5;

/** 写入本地存档。返回是否成功。 */
function save(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch (err) {
    console.warn('[存档] 写入失败', err);
    return false;
  }
}

/** 读取本地存档，没有则返回 null。 */
function load() {
  let text = null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    console.warn('[存档] 读取失败', err);
    return null;
  }
  if (!text) return null;

  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    return hydrate(raw);
  } catch (err) {
    console.warn('[存档] 解析失败，将重新开局', err);
    return null;
  }
}

/** 清空存档。 */
function clear() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    console.warn('[存档] 清除失败', err);
  }
}
const writeSave = save;
const readSave = load;
const clearSave = clear;

function readThemeChoice() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return THEMES[raw] ? raw : 'classic';
  } catch (err) {
    console.warn('[主题] 读取失败', err);
    return 'classic';
  }
}

function writeThemeChoice(theme) {
  try {
    localStorage.setItem(THEME_KEY, THEMES[theme] ? theme : 'classic');
    return true;
  } catch (err) {
    console.warn('[主题] 写入失败', err);
    return false;
  }
}

function applyThemeChoice(theme, persist = true) {
  const next = THEMES[theme] ? theme : 'classic';
  document.documentElement.setAttribute('data-theme', next);
  document.body?.setAttribute('data-theme', next);
  if (persist) writeThemeChoice(next);
  return next;
}
