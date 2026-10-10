
/* ────────────────────────────────────────────────────────────────
 * 区块：修士规则：修为增长、战力加成、名册修补
 * 原属 src/data/cultivation.js 第 220–326 行
 * ──────────────────────────────────────────────────────────────── */
const CULTIVATOR_LIMIT = 300;            // 防止超大存档和每帧渲染过重
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

/** 从 index 升到 index+1 需要多少修为（转发 data/realms.js 的曲线）。 */
function cultivateXpNeeded(realmIndex) { return realmXpNeeded(realmIndex); }

/** 该境界的单人基础战力（转发 data/realms.js 的曲线）。 */
function cultivateBasePower(realmIndex) { return realmPower(realmIndex); }
function averageTalent(state) { const ps=state.cultivation?.cultivators||[]; return ps.length ? ps.reduce((a,p)=>a+Math.max(1,Number(p.talent)||1),0)/ps.length : 1; }
function repairCultivation(state) {
  const c=state.cultivation; if(!c)return;
  // ── 境界：把旧的 person.realm（1..9 的炼气层数）迁移到全局 realmIndex ──
  // 炼气一层~九层在新体系里正好也是 index 1..9，所以旧值可以直接用。
  // 保底：负数、NaN、超界的都夹回合法范围。
  for(const p of c.cultivators||[]){
    const raw = p.realmIndex !== undefined ? p.realmIndex : p.realm;
    p.realmIndex = Math.max(1, Math.min(REALM_MAX_INDEX, Math.floor(Number(raw) || 1)));
    delete p.realm;                       // 旧字段清掉，避免两处真相
    const need = realmXpNeeded(p.realmIndex);
    // 修为最多夹到「本层所需」。注意**不能**夹到 need - ε：
    // 那样修为永远到不了满值，大境界的瓶颈状态（blocked）就永远不成立，
    // 冲关按钮也就永远不出现。
    p.xp = Number.isFinite(need)
      ? Math.max(0, Math.min(need, Number(p.xp) || 0))
      : 0;
    const bf = Number(p.breakFailures);
    p.breakFailures = Number.isFinite(bf) ? Math.max(0, Math.floor(bf)) : 0;
    // 灵根：老存档里的修士没有这个字段，补掷一次
    ensureRoot(p);
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
  for(const [k,v] of Object.entries({poolBlueprint:false,pool:0,compass:false,veins:[],mineLevel:0,mineWorkers:0,clues:0,caveRuns:0,conquests:[]})){if(c[k]===undefined)c[k]=v;}
  // 地图世界状态：抵达、占领、镇守、民怨（worldOf 会顺手把旧 conquests 迁进来）
  worldOf(state);
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
  if (c.cultivators.length >= CULTIVATOR_LIMIT || (parentage!=='cultivator-cultivator' && state.population < 1)) return null;
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
function cultivationBonuses(state) {
  const people=state.cultivation?.cultivators || [];
  // 家族层面的加成（不过滤灵根），用于界面上展示「这套功法一共值多少」
  const familyManual=manualBonus(state);
  // 法器加成是全族共享的（装备在家族名下，不是某个人身上）。
  // 耐久为 0 的法器不计入 —— 这是炼器的负面对价。
  const art=artifactBonus(state);
  let corePower=0, guardBonus=0, workUnits=0, exploreUnits=0, retreat=0, innate=0;
  for(const p of people){
    // 每个人吃自己灵根能修的那一份；天灵根对本系功法还有专精
    const mb=manualBonusFor(state,p);
    // 法器与功法加成相加（都是「百分比加成」，相加比相乘更好解释给玩家）
    const powerMult=1+mb.power+art.power;
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
    explorePerSec:(exploreUnits/9600)};
}
function progressCultivators(state,dt,now=Date.now(),rng=Math.random,births=0) {
  const c=state.cultivation;
  if(!c || !(dt>0)) return;
  const people=c.cultivators||[];
  // 天生灵根来自本次自然出生的凡人；已有修士不参与凡人死亡率
  if(births>0 && people.length>0 && people.length<CULTIVATOR_LIMIT && state.population>=1) {
    // 泊松事件近似。小步模拟时避免逐一枚举上千名婴儿
    const eventChance=1-Math.exp(-births*INNATE_CHANCE_PER_BIRTH*Math.min(5,people.length/10));
    if(rng()<eventChance) addCultivator(state,'innate',now,false,'cultivator-mortal',rng);
  }
  if(people.length>=2 && c.cultivators.length<CULTIVATOR_LIMIT){
    const pairChance=1-Math.exp(-Math.floor(people.length/2)*dt/3000000);
    if(rng()<pairChance)addCultivator(state,'innate',now,false,'cultivator-cultivator',rng);
  }
  for(const person of people) {
    if(!['retreat','sect'].includes(person.job)) continue;
    const cap=cultivateLevelCap(person);
    const idx=Math.max(0,Math.floor(person.realmIndex)||0);
    if(idx>=cap) continue;
    // 卡在大境界瓶颈上（本档最后一层 + 修为已满）就停止积累，等玩家去冲关。
    // 这是「主动突破」的全部实现：系统不会替你跨大档。
    if(realmGate(idx) && person.xp>=realmXpNeeded(idx)) continue;

    // 家族功法只对「闭关」生效——宗门修的是宗门的法，传不进山门。
    // 所以宗门是安全的 3.5× 固定路线，闭关则随功法收藏成长，收藏够了会反超。
    // 功法的倍率要过灵根（manualTrainingMultiplierFor）：灵根不合的人吃不到。
    const manualMult = person.job==='retreat' ? manualTrainingMultiplierFor(state,person) : 1;
    // 聚灵符是全族生效的限时加成（对宗门弟子也算 —— 符贴在静室里，谁回来都能用）
    const runeMult = runeTrainingMult(state, now);
    // 金手指：掌天瓶的代价（分心）与天生道体的增益
    const metaMult = metaTrainMult(state);
    // 灵根是第四个乘数：天灵根 ×2.0，五灵根 ×0.7
    person.xp += REALM_XP_RATE*dt*manualMult*runeMult*metaMult*rootSpeedMult(person)*(Number(person.talent)||1)*(person.job==='sect'?3.5:1);

    // 同一大档内自动晋升；带瓶颈的那一层停住（交给 systems/breakthrough.js）
    while(person.realmIndex<cap){
      const gate=realmGate(person.realmIndex);
      const need=realmXpNeeded(person.realmIndex);
      if(gate){ if(person.xp>need) person.xp=need; break; }
      if(!Number.isFinite(need) || person.xp<need) break;
      person.xp-=need;
      person.realmIndex+=1;
      pushLog(state,`${person.name}闭关有成，晋升${realmName(person.realmIndex)}！`,'cultivate',null,now);
    }
  }
  advanceImmortalEconomy(state,dt,now,rng);
  // 符箓的时间推进：清理过期存货、结束聚灵符
  advanceRunes(state,dt,now);
  const bonus=cultivationBonuses(state);
  if (bonus.explorePerSec>0 && state.secrets.length<SECRETS.length) {
    const chance=1-Math.exp(-bonus.explorePerSec*dt);
    if(rng()<chance) grantSecret(state,now,rng);
  }
}

