
/* ────────────────────────────────────────────────────────────────
 * 区块：炼气经济：灵池与灵脉矿场结算
 * 原属 src/data/cultivation.js 第 378–397 行
 * ──────────────────────────────────────────────────────────────── */
function advanceImmortalEconomy(state,dt,now,rng){
 const c=state.cultivation; if(!c)return;
 // 领地赋税与民怨（占领的势力节点）
 advanceTerritories(state,dt,now);
 if(c.pool>0 && state.population>=1){
   const cost=c.pool*.00013*dt;
   const operating=Math.min(1,cost>0?state.spiritStones/cost:0);
   state.spiritStones=Math.max(0,state.spiritStones-cost*operating);
   if(operating>0 && (c.cultivators||[]).length<CULTIVATOR_LIMIT){
     const chance=1-Math.exp(-c.pool*dt*operating/4800);
     if(rng()<chance)addCultivator(state,'awakened',now,false,'',rng);
   }
 }
 const mine=c.veins?.find(v=>v.reserve>0);
 if(mine && c.mineLevel>0 && c.mineWorkers>0 && state.population>=c.mineWorkers){
   const yieldRate=Math.min(mine.reserve,c.mineWorkers*(.000012*mine.grade)*dt);
   mine.reserve=Math.max(0,mine.reserve-yieldRate);
   state.spiritStones+=yieldRate;
   const deaths=Math.min(state.population,c.mineWorkers*(.0000025+mine.grade*.000001)*dt);
   state.population-=deaths; state.stats.deaths+=deaths;
 }
}