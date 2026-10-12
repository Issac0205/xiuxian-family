
/* ────────────────────────────────────────────────────────────────
 * 区块：炼气经济：灵池、灵脉矿场与城市作坊的结算
 * 原属 src/data/cultivation.js 第 378–397 行
 *
 * 这里同时是**仙凡咬合**的三处结算点：
 *   1. 灵池   —— 花灵石维持，换来更多天生灵根的孩子（仙养凡）
 *   2. 灵脉矿场 —— 修士探明矿脉、凡人下去挖，凡人会死（凡养仙，代价在人）
 *   3. 城市作坊 —— 人口换成药材/矿料/符料（凡养仙，代价是劳力被抽走）
 * 数值口径全在 core/config.js 的「仙凡经济」一节，本文件不含魔法数字。
 * ──────────────────────────────────────────────────────────────── */
function advanceImmortalEconomy(state,dt,now,rng){
 const c=state.cultivation; if(!c)return;
 // 领地赋税与民怨（占领的势力节点）
 advanceTerritories(state,dt,now);
 // 城市作坊：把人口换成仙道生产线的原料。
 // 放在这里而不是 simulate() 里，是因为它与灵池、矿场共用同一批凡人 ——
 // 「人只有那么多」这条约束要靠三处一起看才成立。
 advanceCityWorkshops(state,dt);
 const fx=techEffects(state);
 // ── 灵池 ──
 // 灵池的产出是「觉醒的修士」，同时它拉高天生灵根的诞生率（见 innatePoolBonus）。
 if(c.pool>0 && state.population>=1){
   const cost=c.pool*POOL_STONE_PER_SEC*dt;
   const operating=Math.min(1,cost>0?state.spiritStones/cost:0);
   state.spiritStones=Math.max(0,state.spiritStones-cost*operating);
   // 灵池不吃 immortalCapFlat 吗？—— 吃的。名册满了就不再产人，
   // 所以「开脉」「化神大道」对灵池同样有意义。
   if(operating>0 && (c.cultivators||[]).length<cultivatorLimit(state)){
     const chance=1-Math.exp(-c.pool*dt*operating/4800);
     if(rng()<chance)addCultivator(state,'awakened',now,false,'',rng);
   }
 }
 // ── 灵脉矿场：修士探明，凡人开挖 ──
 // 出石受两级科技加成：
 //   mineYieldMult   仙道侧（开脉/灵脉感应/周天搬运）
 //   灵石矿场建筑    凡人侧的采掘队（core/formulas.js 的 SPIRIT_MINE 计数）
 // 两者必须同时存在才出石 —— 一条矿脉，两班人。
 const mine=c.veins?.find(v=>v.reserve>0);
 if(mine && c.mineLevel>0 && c.mineWorkers>0 && state.population>=c.mineWorkers){
   const cityCrew=1+(state.buildings?.spiritmine||0)*SPIRIT_MINE_CITY_BONUS_PER;
   const yieldRate=Math.min(mine.reserve,c.mineWorkers*STONE_MINE_BASE_RATE*mine.grade*cityCrew*(1+fx.mineYieldMult)*dt);
   mine.reserve=Math.max(0,mine.reserve-yieldRate);
   state.spiritStones+=yieldRate;
   // 矿工的命是凡人在填。mineDeathMult 是仙道科技给的减负（引灵/灵枢通气）。
   const deathMult=Math.max(0,1+fx.mineDeathMult);
   const deaths=Math.min(state.population,c.mineWorkers*(.0000025+mine.grade*.000001)*deathMult*dt);
   state.population-=deaths; state.stats.deaths+=deaths;
 }
}

/**
 * 城中作坊的产出结算。
 *
 * 药材/矿料/符料按秒累积成小数，所以这里不做取整；
 * 真正消耗它们的地方（炼丹/炼器/炼符）会按整数取用 ——
 * 与「灵石是小数」是同一套口径（STONE_DECIMALS）。
 *
 * 用地如此直接的原因：这三样东西在其它地方是**地图领地的专利**，
 * 城里能自产一点点，就足以让「城越大，仙道上限越高」这句话落地。
 */
function advanceCityWorkshops(state,dt){
  if(!(dt>0))return;
  const d=derive(state);
  if(d.cityHerbPerSec>0) addHerbs(state,'grass',d.cityHerbPerSec*dt);
  if(d.cityOrePerSec>0) addOres(state,'lingmu',d.cityOrePerSec*dt);
  if(d.cityRunePerSec>0) addRuneMats(state,'paper',d.cityRunePerSec*dt);
}
