
/* ────────────────────────────────────────────────────────────────
 * 区块：功法掉落与掉落文案
 * 原属 src/data/cultivation.js 第 349–377 行
 * ──────────────────────────────────────────────────────────────── */
function grantManual(state,grade=1,rng=Math.random){
 const c=state.cultivation;
 const tier=Math.min(3,Math.max(1,Math.floor(grade)||1));
 const pool=CULTIVATION_MANUALS.filter(m=>m.tier===tier);
 const manual=pool[Math.min(pool.length-1,Math.floor(rng()*pool.length))]||pool[0];
 if(!manual)return {name:'',tier,isNew:false,attune:0,stones:0};
 if(!c.manuals.includes(manual.id)){
   c.manuals.push(manual.id);
   // 只填空位，不抢占玩家已经选定的配置——换不换由玩家决定
   if(!c.equippedManual)c.equippedManual=manual.id;
   else if(!c.assistManual && !manualDaoTaken(state,manual.dao,manual.id))c.assistManual=manual.id;
   return {name:manual.name,tier:manual.tier,isNew:true,attune:0,stones:0};
 }
 const cur=manualAttune(state,manual.id);
 if(cur<MANUAL_ATTUNE_MAX){
   c.attune[manual.id]=cur+1;
   return {name:manual.name,tier:manual.tier,isNew:false,attune:cur+1,stones:0};
 }
 state.spiritStones+=MANUAL_DUPLICATE_STONES;
 return {name:manual.name,tier:manual.tier,isNew:false,attune:cur,stones:MANUAL_DUPLICATE_STONES};
}

/** 把一次掉落写成给玩家看的文案。 */
function manualDropText(drop){
 if(!drop||!drop.name)return '';
 if(drop.isNew)return `，获得《${drop.name}》（${MANUAL_TIER_NAME[drop.tier]}）`;
 if(drop.stones>0)return `，再得《${drop.name}》残卷，已悟无可悟，折为 ${drop.stones} 灵石`;
 return `，《${drop.name}》参悟至 ${drop.attune} 层`;
}