
/* ────────────────────────────────────────────────────────────────
 * 区块：炼气篇操作入口（一个 kind 一个分支）
 * 原属 src/data/cultivation.js 第 398–475 行
 * ──────────────────────────────────────────────────────────────── */
function immortalAction(s,kind,param,rng=Math.random){
 const c=s.cultivation; repairCultivation(s);
 const fail=reason=>({ok:false,reason});
 let msg='';
 if(kind==='pool-blueprint'){
   if(s.secrets.length<12)return fail('需要已发现12条秘闻');
   if(s.spiritStones<2)return fail('需要2灵石');
   if(c.poolBlueprint)return fail('已拥有灵池蓝图');
   s.spiritStones-=2;c.poolBlueprint=true;msg='购得灵池蓝图，已可营造灵池';
 }else if(kind==='pool-build'){
   if(!c.poolBlueprint)return fail('请先在坊市购买灵池蓝图');
   if(c.pool>=10)return fail('灵池已达上限');
   if(s.spiritStones<3 || s.silver<50000)return fail('营造需要3灵石与5万银两');
   s.spiritStones-=3;s.silver-=50000;c.pool++;msg=`灵池营造完成（${c.pool}座），持续消耗灵石祛障`;
 }else if(kind==='compass'){
   if(s.secrets.length<15)return fail('需要15条秘闻');
   if(s.spiritStones<3)return fail('研习寻龙尺需3灵石');
   if(c.compass)return fail('已掌握寻龙尺');
   s.spiritStones-=3;c.compass=true;msg='研习寻龙尺成功，可探寻灵脉';
 }else if(kind==='survey'){
   if(!c.compass)return fail('先研习寻龙尺');
   if(s.spiritStones<1)return fail('探脉需要1灵石');
   if(c.veins.length>=20)return fail('最多保有20处灵脉记录');
   s.spiritStones-=1;
   const grade=1+Math.floor(Math.pow(rng(),2)*5);
   c.veins.push({grade,reserve:Math.round((10+grade*17)*(0.8+rng()*.5))});
   msg=`发现${grade}阶灵脉，可开采灵石（储量有限）`;
 }else if(kind==='mine-build'){
   if(!c.veins.some(v=>v.reserve>0))return fail('请先找到尚有储量的灵脉');
   if(c.mineLevel>0)return fail('矿场已建造');
   if(s.silver<80000 || s.spiritStones<2)return fail('矿场需要8万银两与2灵石');
   s.silver-=80000;s.spiritStones-=2;c.mineLevel=1;c.mineWorkers=50;
   msg='矿场开始运转，已投入50名凡人矿工（存在持续死亡风险）';
 }else if(kind==='mine-workers'){
   if(!c.mineLevel)return fail('请先建造矿场');
   c.mineWorkers=Math.max(0,Math.min(1000,Math.round(Number(param)||0)));
   msg=`矿场用工调整为${c.mineWorkers}人`;
 }else if(kind==='sect'){
   const p=c.cultivators.find(v=>v.id===Number(param)); if(!p)return fail('修士不存在');
   if(p.job==='sect')return fail('已在宗门修行');
   // 宗门只看灵根资质（R3 起由灵根决定，不再看天赋）——三灵根及以上才收
   if(rootRank(p)<SECT_MIN_ROOT_RANK)return fail(`宗门只收${ROOT_GRADE_MAP.triple.name}及以上的资质（${p.name}是${rootText(p)}）`);
   // 引荐礼：资质越好，宗门出的价越高。
   // 这是「好灵根留不住」的落点 —— 换灵石（突破门槛的硬通货）还是留人，由玩家选。
   const gift=sectReferralReward(p);
   state.spiritStones=(state.spiritStones||0)+gift;
   p.job='sect';
   msg=`${p.name}入宗门修行，宗门赠引荐礼 ${gift} 灵石。安全成长，但不再提供驻守、劳作或探索加成`;
 }else if(kind==='cave'){
   // param 形如 "修士id:地图节点id"
   const [id,nodeId]=String(param).split(':');
   const r=commitExplore(s,nodeId,Number(id),Date.now(),rng);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='attack'){
   const r=commitAttack(s,param,Date.now(),rng);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='garrison'){
   // param 形如 "节点id" 或 "节点id:修士id"（后者表示指派，前者表示撤回）
   const [nodeId,pid]=String(param).split(':');
   const r=pid?mapAssignGarrison(s,nodeId,Number(pid)):mapClearGarrison(s,nodeId);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='rune'){
   const r=commitRune(s,param,Date.now(),rng);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='rune-bench'){
   const r=commitBenchUpgrade(s,Date.now());
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='rune-use'){
   const r=useRune(s,param,Date.now());
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='forge'){
   // param = 法器 id
   const r=commitForge(s,param,Date.now(),rng);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='forge-level'){
   const r=commitForgeUpgrade(s,Date.now());
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='artifact-equip'){
   const r=equipArtifact(s,param);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='artifact-repair'){
   const r=commitRepair(s,param,Date.now());
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='craft'){
   const r=commitCraft(s,param,Date.now(),rng);
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='furnace'){
   const r=commitFurnaceUpgrade(s,Date.now());
   if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='equip'||kind==='assist'){
    const r=equipManual(s,param,kind==='assist'?'assist':'main');if(!r.ok)return fail(r.reason);msg=r.reason;
 }else if(kind==='attune'){
    const r=attuneManual(s,param,rng);if(!r.ok)return fail(r.reason);msg=r.reason;
 }else{return fail('未知操作')}
 pushLog(s,msg,'cultivate',null,Date.now());return {ok:true,reason:msg};
}
