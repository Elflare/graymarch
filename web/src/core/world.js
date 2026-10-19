export function installWorld(R){
const state=R.state,config=R.resources.data.world,growth=R.resources.data.rules.growth; const SEED=config.seed,FINAL_TOWER=config.finalTower;
 const requiredSigils=config.guardians.length;
 const choose=(table,roll)=>table.find(([threshold])=>roll<threshold)[1];
const {tileInfo,BIOME_SIZE,biomeDefs,enemyDefs,enemyTier,biomeEnemyPools,foodDefs}=R;
const classBase=(...a)=>R.classBase(...a);
const startBattle=(...a)=>R.startBattle(...a);
const gainXP=(...a)=>R.gainXP(...a);
const triggerEvent=(...a)=>R.triggerEvent(...a);
const refreshMetaUnlocks=(...a)=>R.refreshMetaUnlocks(...a);
const ensureMetaBare=(...a)=>R.ensureMetaBare(...a);
const toast=(...a)=>R.toast(...a);
function key(x,y){return `${x},${y}`} function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function revealAround(cx,cy,r=config.revealRadius){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.abs(dx)+Math.abs(dy)<=r)state.discovered.add(key(cx+dx,cy+dy))}
function rebuildDiscoveryFromVisited(){state.discovered=new Set();for(let k of state.visited){let [x,y]=k.split(',').map(Number);if(Number.isFinite(x)&&Number.isFinite(y))revealAround(x,y,config.revealRadius)}revealAround(state.x,state.y,config.revealRadius)}
function h2(x,y,s=SEED){let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+s)|0;h^=h>>>13;h=Math.imul(h,1274126177);h^=h>>>16;return (h>>>0)/4294967296}
function xpNeed(lv){return growth.xpBase+lv*growth.xpLinear+Math.floor(Math.pow(lv,growth.xpExponent))}
function activeBuff(id){return state.buffs.find(b=>b.id===id&&b.turns>0)}
function attackBuff(){return state.buffs.reduce((n,b)=>n+(b.attack||0),0)}
function guardBuff(){return state.buffs.reduce((n,b)=>n+(b.guard||0),0)}
function hungerDiscount(){return R.passiveValue(state.player,'pathfinder','discount')}
function journeyHungerMod(){return state.buffs.reduce((n,b)=>n+(b.hungerCost||0),0)}
function pct(v){return `${Math.round(v*100)}%`}
const HARVEST=config.harvest;
function harvestProfile(t){
  let b=HARVEST[t]; if(!b)return null;
  let p=state.player;const find=R.passiveValue(p,'forager','findBonus'),risk=R.passiveValue(p,'forager','riskDiscount');
  return {...b,find:Math.min(config.maxFind,b.find+find),ambush:Math.max(config.minAmbush,b.ambush-risk),debuff:Math.max(config.minDebuff,b.debuff-risk),cost:Math.max(config.minHarvestCost,b.cost+journeyHungerMod())};
}
function recalcStats(){let p=state.player,base=classBase().base,oldMax=p.maxHp||base.hp,oldE=p.maxEnergy||base.energy,oldH=state.maxHunger||base.hunger;p.attack=base.attack+R.gearValue(p,'iron_sword','attack')+attackBuff();p.maxEnergy=base.energy+R.gearValue(p,'rune_ring','energy');p.maxHp=base.hp+R.gearValue(p,'wanderer_cloak','hp');state.maxHunger=base.hunger+R.passiveValue(p,'hearty','hunger');if(p.maxHp>oldMax)p.hp+=p.maxHp-oldMax;if(p.maxEnergy>oldE)p.energy+=p.maxEnergy-oldE;if(state.maxHunger>oldH)state.hunger+=state.maxHunger-oldH;p.hp=Math.min(p.hp,p.maxHp);p.energy=Math.min(p.energy,p.maxEnergy);state.hunger=Math.min(state.hunger,state.maxHunger)}
function basicGuardAmount(p=state.player){return R.resources.data.rules.combat.basicGuard+R.gearValue(p,'tower_shield','guard')+guardBuff()}
function biomeAt(x,y){
 if(Math.abs(x-FINAL_TOWER.x)+Math.abs(y-FINAL_TOWER.y)<config.redRadius)return biomeDefs.red;
 let rx=Math.floor(x/BIOME_SIZE),ry=Math.floor(y/BIOME_SIZE),r=h2(rx*19+701,ry*23-503,SEED^0x5A7719);
 return biomeDefs[choose(config.biomeThresholds,r)];
}
function terrainForBiome(b,r){return choose(config.terrain[b.id],r);}
function tileAt(x,y){
  if(x===FINAL_TOWER.x&&y===FINAL_TOWER.y)return 'B';
  if(x===0&&y===0)return '=';
  let d=Math.abs(x)+Math.abs(y),r=h2(x,y),terrain=h2(x+331,y-117,SEED^0x224466),bio=biomeAt(x,y);
  if(x%config.roadSpacing===0||y%config.roadSpacing===0)return '=';
  let campRoll=h2(x+1211,y-811,SEED^0x334455);
  if(d>config.sites.campMinDistance&&campRoll<config.sites.campChance)return 'C';
  let bias=bio.enemyBias||0;
  if(d>config.sites.eliteMinDistance&&r<config.sites.eliteChance+bias*config.sites.eliteBias)return 'X';
  if(r<config.sites.village)return 'V';
  if(r<config.sites.ruins)return 'R';
  if(r<config.sites.event)return 'Q';
  if(r<config.sites.enemy+bias)return 'E';
  return terrainForBiome(bio,terrain);
}

function enemyFor(x,y,type){
 let d=Math.abs(x)+Math.abs(y),r=h2(x+91,y-37),id,bio=biomeAt(x,y);
  if(type==='B')id=config.boss;
  else if(type==='X')id=config.guardians[Math.min(requiredSigils-1,state.sigils)];
 else{
   let maxTier=config.tierDistance.find(([distance])=>d<distance)?.[1]??config.maxTier;
   let pool=(biomeEnemyPools[bio.id]||biomeEnemyPools.grass).filter(k=>enemyTier[k]<=maxTier);
   if(!pool.length)pool=config.fallbackEnemies;
   id=pool[Math.min(pool.length-1,Math.floor(r*pool.length))];
 }
  let base=enemyDefs[id],distanceScale=type==='B'||type==='X'?0:Math.min(config.distanceScale.max,Math.floor(Math.max(0,d-config.distanceScale.start)/config.distanceScale.divisor));
  let hpBonus=distanceScale*config.distanceScale.hp,atkBonus=Math.floor(distanceScale/config.distanceScale.attackDivisor),maxHp=base.hp+hpBonus,xpBase=config.enemyXp.base+base.hp/config.enemyXp.hpDivisor+distanceScale*config.enemyXp.scale+(type==='X'?config.enemyXp.eliteBonus:0);
  return {...base,...R.resources.enemy(id,{atk:base.atk+atkBonus}),id,...(type==='X'?{eliteRank:Math.min(requiredSigils,state.sigils+1)}:{}),biome:bio.id,maxHp,hp:maxHp,atk:base.atk+atkBonus,baseArmor:base.armor,armor:base.armor,block:0,exposed:0,armorDebuff:null,damageDown:null,bleed:null,burn:null,xp:Math.round(xpBase*(type==='X'?config.enemyXp.eliteMultiplier:type==='B'?config.enemyXp.bossMultiplier:1))}
}

function moveCostFor(t){let m=tileInfo[t].move;if(m==null)return null;return Math.max(config.minMoveCost,m-hungerDiscount()+journeyHungerMod())}
function compassDir(dx,dy){
  let ax=Math.abs(dx),ay=Math.abs(dy);
  if(ax<config.navigation.nearDistance&&ay<config.navigation.nearDistance)return '附近';
  if(ax>ay*config.navigation.axisRatio)return dx>0?'东':'西';
  if(ay>ax*config.navigation.axisRatio)return dy>0?'南':'北';
  return `${dy>0?'南':'北'}${dx>0?'东':'西'}`;
}
function approxDist(n){
  if(n<=config.navigation.distanceBucket)return `${config.navigation.distanceBucket}格内`;
  let lo=Math.max(config.navigation.distanceBucket,Math.floor(n/config.navigation.distanceBucket)*config.navigation.distanceBucket),hi=lo+config.navigation.distanceBucket;
  return `约${lo}–${hi}格`;
}
function findSigilLeads(count=Math.max(0,requiredSigils-state.sigils),maxR=config.leadRadius){
  if(count<=0)return [];
  let out=[];
  for(let y=state.y-maxR;y<=state.y+maxR;y++){
    for(let x=state.x-maxR;x<=state.x+maxR;x++){
      let d=Math.abs(x-state.x)+Math.abs(y-state.y);
      if(!d||d>maxR)continue;
      let k=key(x,y);
      if(!state.cleared.has(k)&&tileAt(x,y)==='X') out.push({x,y,d});
    }
  }
  out.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
  // 只显示尚需塔印数量的最近线索；它们只是导航，不会揭露精确坐标。
  return out.slice(0,count);
}
function canHarvest(t){return Object.hasOwn(HARVEST,t)}
function tickBuffs(){state.buffs.forEach(b=>b.turns--);state.buffs=state.buffs.filter(b=>b.turns>0);recalcStats()}
function advanceTime(hungerCost=config.defaultHungerCost,{training=false}={}){if(training)return;state.worldTurn++;state.hunger=Math.max(0,state.hunger-hungerCost);if(state.hunger===0){state.player.hp=Math.max(0,state.player.hp-config.starvationDamage);toast(R.text('starvation',{damage:config.starvationDamage}))}tickBuffs();if(state.player.hp<=0)collapseFromHunger()}
function collapseFromHunger(){state.x=0;state.y=0;state.player.hp=Math.max(1,Math.ceil(state.player.maxHp*config.collapse.hpRatio));state.hunger=Math.max(config.collapse.minHunger,Math.floor(state.maxHunger*config.collapse.hungerRatio));toast(R.text('collapse'))}
function eatItem(id){if(state.inBattle)return toast(R.text('battleFood'));if((state.inventory[id]||0)<=0)return;state.inventory[id]--;foodDefs[id].eat();}
function harvest(){
  if(state.inBattle)return;
  ensureMetaBare();
  let t=tileAt(state.x,state.y),k=key(state.x,state.y),prof=harvestProfile(t);
  if(!canHarvest(t)||state.harvested.has(k)||!prof)return;
  state.harvested.add(k);state.meta.harvests++;refreshMetaUnlocks(true);
  const originX=state.x,originY=state.y;
  advanceTime(prof.cost);
  if(state.x!==originX||state.y!==originY)return;

  let r=h2(state.x+701,state.y-911),item=null;
  if(r<prof.find){
    let loot=h2(state.x-401,state.y+617);
    item=choose(prof.loot,loot);
    let qty=h2(state.x-231,state.y+441)<R.passiveValue(state.player,'forager','doubleChance')?2:1;
    state.inventory[item]=(state.inventory[item]||0)+qty;
    toast(R.text('harvest',{name:foodDefs[item].cn,quantity:qty}));
  }else toast(R.text('harvestEmpty'));

  let deb=h2(state.x+1907,state.y-1441);
  if(deb<prof.debuff){
    let rr=h2(state.x-811,state.y+1703);
    const id=choose(prof.debuffs,rr),overrides=id==='wet_chill'&&prof.wetChillTurns?{turns:prof.wetChillTurns}:{};
    addBuff(R.resources.buff(id,overrides));
  }

  let amb=h2(state.x+2701,state.y+3119);
  
  if(amb<prof.ambush){
    toast(R.text('harvestAmbush'));
    startBattle('E',false);
  }
}
function resolveArrivalTile(x,y,t){
  let k=key(x,y);
  if(t==='B'&&!state.cleared.has(k)){
    if(state.sigils<requiredSigils){
      toast(R.text('towerLocked',{required:requiredSigils,sigils:state.sigils}));
      
    }else startBattle('B',false);
    return;
  }
  if((t==='E'||t==='X')&&!state.cleared.has(k)){
    startBattle(t,false);
    return;
  }
  if(t==='V'&&!state.spent.has(k)){
    state.spent.add(k);
    state.player.hp=Math.min(state.player.maxHp,state.player.hp+config.village.hp);
    state.hunger=Math.min(state.maxHunger,state.hunger+config.village.hunger);
    for(const[id,n]of Object.entries(config.village.items))state.inventory[id]+=n;
    toast(R.text('village',{...config.village,items:Object.entries(config.village.items).map(([id,n])=>`${foodDefs[id].cn} ×${n}`).join('，')}));
  }else if(t==='R'&&!state.spent.has(k)){
    state.spent.add(k);
    state.player.energy=state.player.maxEnergy;
    gainXP(config.ruins.xpBase+Math.floor((Math.abs(x)+Math.abs(y))/config.ruins.depthDivisor),true);
    toast(R.text('ruins'));
  }else if(t==='Q'&&!state.eventsSeen.has(k)){
    triggerEvent(x,y);
    
    return;
  }
  
}
function addBuff(b){state.buffs=state.buffs.filter(x=>x.id!==b.id);state.buffs.push(b);recalcStats();toast(R.text('buff',b))}

function moveTo(x,y){let t=tileAt(x,y),cost=moveCostFor(t);if(Math.abs(x-state.x)+Math.abs(y-state.y)!==1||cost==null)throw R.error('IMPASSABLE','不可通行');let from={x:state.x,y:state.y};state.x=x;state.y=y;state.visited.add(key(x,y));revealAround(x,y,config.revealRadius);advanceTime(cost);R.events.push({type:'moved',from,to:{x:state.x,y:state.y},cost});if(state.x===x&&state.y===y)resolveArrivalTile(x,y,t);}

Object.assign(R,{key,clamp,revealAround,rebuildDiscoveryFromVisited,h2,xpNeed,activeBuff,attackBuff,guardBuff,hungerDiscount,journeyHungerMod,pct,harvestProfile,recalcStats,basicGuardAmount,biomeAt,terrainForBiome,tileAt,enemyFor,moveCostFor,compassDir,approxDist,findSigilLeads,canHarvest,tickBuffs,advanceTime,collapseFromHunger,eatItem,harvest,resolveArrivalTile,addBuff,moveTo});}
