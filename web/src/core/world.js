export function installWorld(R){
const state=R.state; const SEED=0x61A5C17,FINAL_TOWER={x:35,y:-28};
const {tileInfo,BIOME_SIZE,biomeDefs,enemyDefs,enemyTier,biomeEnemyPools,foodDefs}=R;
const classBase=(...a)=>R.classBase(...a);
const startBattle=(...a)=>R.startBattle(...a);
const gainXP=(...a)=>R.gainXP(...a);
const triggerEvent=(...a)=>R.triggerEvent(...a);
const refreshMetaUnlocks=(...a)=>R.refreshMetaUnlocks(...a);
const ensureMetaBare=(...a)=>R.ensureMetaBare(...a);
const toast=(...a)=>R.toast(...a);
function key(x,y){return `${x},${y}`} function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function revealAround(cx,cy,r=2){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.abs(dx)+Math.abs(dy)<=r)state.discovered.add(key(cx+dx,cy+dy))}
function rebuildDiscoveryFromVisited(){state.discovered=new Set();for(let k of state.visited){let [x,y]=k.split(',').map(Number);if(Number.isFinite(x)&&Number.isFinite(y))revealAround(x,y,2)}revealAround(state.x,state.y,2)}
function h2(x,y,s=SEED){let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+s)|0;h^=h>>>13;h=Math.imul(h,1274126177);h^=h>>>16;return (h>>>0)/4294967296}
function xpNeed(lv){return 8+lv*4+Math.floor(Math.pow(lv,1.25))}
function activeBuff(id){return state.buffs.find(b=>b.id===id&&b.turns>0)}
function attackBuff(){return state.buffs.reduce((n,b)=>n+(b.attack||0),0)}
function guardBuff(){return state.buffs.reduce((n,b)=>n+(b.guard||0),0)}
function hungerDiscount(){return state.player.passives.pathfinder||0}
function journeyHungerMod(){return state.buffs.reduce((n,b)=>n+(b.hungerCost||0),0)}
function pct(v){return `${Math.round(v*100)}%`}
const HARVEST={
  '.':{cost:4,find:.38,ambush:.08,debuff:.08},
  G:{cost:3,find:.52,ambush:.07,debuff:.06},
  T:{cost:5,find:.60,ambush:.16,debuff:.12},
  S:{cost:6,find:.54,ambush:.14,debuff:.22}
};
function harvestProfile(t){
  let b=HARVEST[t]; if(!b)return null;
  let lv=state.player.passives.forager||0;
  return {...b,find:Math.min(.78,b.find+.07*lv),ambush:Math.max(.04,b.ambush-.01*Math.min(lv,2)),debuff:Math.max(.03,b.debuff-.01*Math.min(lv,2)),cost:Math.max(2,b.cost+journeyHungerMod())};
}
function recalcStats(){let p=state.player,base=classBase().base,oldMax=p.maxHp||base.hp,oldE=p.maxEnergy||base.energy,oldH=state.maxHunger||base.hunger;p.attack=base.attack+(p.equipment.iron_sword||0)+attackBuff();p.maxEnergy=base.energy+(p.equipment.rune_ring||0);p.maxHp=base.hp+2*(p.equipment.wanderer_cloak||0);state.maxHunger=base.hunger+10*(p.passives.hearty||0);if(p.maxHp>oldMax)p.hp+=p.maxHp-oldMax;if(p.maxEnergy>oldE)p.energy+=p.maxEnergy-oldE;if(state.maxHunger>oldH)state.hunger+=state.maxHunger-oldH;p.hp=Math.min(p.hp,p.maxHp);p.energy=Math.min(p.energy,p.maxEnergy);state.hunger=Math.min(state.hunger,state.maxHunger)}
function basicGuardAmount(p=state.player){return 3+(p.equipment.tower_shield||0)+guardBuff()}
function biomeAt(x,y){
 if(Math.abs(x-FINAL_TOWER.x)+Math.abs(y-FINAL_TOWER.y)<13)return biomeDefs.red;
 let rx=Math.floor(x/BIOME_SIZE),ry=Math.floor(y/BIOME_SIZE),r=h2(rx*19+701,ry*23-503,SEED^0x5A7719);
 if(r<.25)return biomeDefs.grass;if(r<.48)return biomeDefs.forest;if(r<.66)return biomeDefs.mire;if(r<.84)return biomeDefs.highland;return biomeDefs.ashen;
}
function terrainForBiome(b,r){
 if(b.id==='grass')return r<.08?'T':r<.13?'S':r<.19?'^':r<.23?'~':r<.66?'G':'.';
 if(b.id==='forest')return r<.52?'T':r<.66?'G':r<.75?'S':r<.82?'^':r<.87?'~':'.';
 if(b.id==='mire')return r<.43?'S':r<.58?'T':r<.69?'~':r<.78?'G':r<.83?'^':'.';
 if(b.id==='highland')return r<.30?'^':r<.43?'T':r<.58?'G':r<.64?'~':r<.69?'S':'.';
 if(b.id==='red')return r<.25?'^':r<.40?'S':r<.50?'T':r<.58?'G':r<.63?'~':'.';
 return r<.17?'^':r<.29?'T':r<.41?'S':r<.51?'G':r<.56?'~':'.';
}
function tileAt(x,y){
  if(x===FINAL_TOWER.x&&y===FINAL_TOWER.y)return 'B';
  if(x===0&&y===0)return '=';
  let d=Math.abs(x)+Math.abs(y),r=h2(x,y),terrain=h2(x+331,y-117,SEED^0x224466),bio=biomeAt(x,y);
  if(x%7===0||y%7===0)return '=';
  let campRoll=h2(x+1211,y-811,SEED^0x334455);
  if(d>5&&campRoll<.018)return 'C';
  let bias=bio.enemyBias||0;
  if(d>8&&r<.032+bias*.15)return 'X';
  if(r<.067)return 'V';
  if(r<.104)return 'R';
  if(r<.145)return 'Q';
  if(r<.255+bias)return 'E';
  return terrainForBiome(bio,terrain);
}

function enemyFor(x,y,type){
 let d=Math.abs(x)+Math.abs(y),r=h2(x+91,y-37),id,bio=biomeAt(x,y);
  if(type==='B')id='lord';
  else if(type==='X')id=['iron_warden','rot_priest','rift_reaver'][Math.min(2,state.sigils)];
 else{
   let maxTier=d<14?1:d<30?2:d<50?3:4;
   let pool=(biomeEnemyPools[bio.id]||biomeEnemyPools.grass).filter(k=>enemyTier[k]<=maxTier);
   if(!pool.length)pool=['wolf','skeleton'];
   id=pool[Math.min(pool.length-1,Math.floor(r*pool.length))];
 }
  let base=enemyDefs[id],distanceScale=type==='B'||type==='X'?0:Math.min(3,Math.floor(Math.max(0,d-22)/38));
  let hpBonus=distanceScale*2,atkBonus=Math.floor(distanceScale/2),maxHp=base.hp+hpBonus,xpBase=5+base.hp/3+distanceScale*1.5+(type==='X'?2:0);
  return {...base,id,...(type==='X'?{eliteRank:Math.min(3,state.sigils+1)}:{}),biome:bio.id,maxHp,hp:maxHp,atk:base.atk+atkBonus,baseArmor:base.armor,armor:base.armor,block:0,exposed:0,armorDebuff:null,damageDown:null,bleed:null,burn:null,xp:Math.round(xpBase*(type==='X'?1.55:type==='B'?3:1))}
}

function moveCostFor(t){let m=tileInfo[t].move;if(m==null)return null;return Math.max(1,m-hungerDiscount()+journeyHungerMod())}
function compassDir(dx,dy){
  let ax=Math.abs(dx),ay=Math.abs(dy);
  if(ax<2&&ay<2)return '附近';
  if(ax>ay*1.8)return dx>0?'东':'西';
  if(ay>ax*1.8)return dy>0?'南':'北';
  return `${dy>0?'南':'北'}${dx>0?'东':'西'}`;
}
function approxDist(n){
  if(n<=5)return '5格内';
  let lo=Math.max(5,Math.floor(n/5)*5),hi=lo+5;
  return `约${lo}–${hi}格`;
}
function findSigilLeads(count=Math.max(0,3-state.sigils),maxR=44){
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
function canHarvest(t){return ['.','G','T','S'].includes(t)}
function tickBuffs(){state.buffs.forEach(b=>b.turns--);state.buffs=state.buffs.filter(b=>b.turns>0);recalcStats()}
function advanceTime(hungerCost=1,{training=false}={}){if(training)return;state.worldTurn++;state.hunger=Math.max(0,state.hunger-hungerCost);if(state.hunger===0){state.player.hp=Math.max(0,state.player.hp-1);toast('饥饿：生命 -1')}tickBuffs();if(state.player.hp<=0)collapseFromHunger()}
function collapseFromHunger(){state.x=0;state.y=0;state.player.hp=Math.max(1,Math.ceil(state.player.maxHp*.4));state.hunger=Math.max(20,Math.floor(state.maxHunger*.25));toast('你因饥饿倒下，被商旅带回旧王道。')}
function eatItem(id){if(state.inBattle)return toast('战斗中无法翻找行囊');if((state.inventory[id]||0)<=0)return;state.inventory[id]--;foodDefs[id].eat();}
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
    if(t==='G') item=loot<.30?'berries':loot<.52?'seedcake':loot<.77?'roots':loot<.90?'emberberry':'herb';
    else if(t==='T') item=loot<.24?'berries':loot<.48?'mushroom':loot<.70?'nuts':loot<.87?'meat':'herb';
    else if(t==='S') item=loot<.34?'mushroom':loot<.60?'bogfruit':loot<.82?'roots':'herb';
    else item=loot<.46?'roots':loot<.72?'nuts':loot<.88?'berries':'herb';

    let qty=(state.player.passives.forager>=2&&h2(state.x-231,state.y+441)<(.12+.05*(state.player.passives.forager-2)))?2:1;
    state.inventory[item]=(state.inventory[item]||0)+qty;
    toast(`采集：${foodDefs[item].cn} ×${qty}`);
  }else toast('采集：没有找到可用物资');

  let deb=h2(state.x+1907,state.y-1441);
  if(deb<prof.debuff){
    let rr=h2(state.x-811,state.y+1703);
    if(t==='S'){
      if(rr<.55)addBuff({id:'marsh_miasma',name:'沼瘴',turns:12,attack:-1,desc:'攻击 -1。'});
      else addBuff({id:'wet_chill',name:'湿冷',turns:10,hungerCost:1,desc:'移动与采集的饥饿消耗 +1。'});
    }else if(t==='T'){
      if(rr<.55)addBuff({id:'thorn_scratch',name:'荆棘划伤',turns:9,guard:-1,desc:'格挡动作 -1。'});
      else addBuff({id:'wet_chill',name:'湿冷',turns:8,hungerCost:1,desc:'移动与采集的饥饿消耗 +1。'});
    }else{
      addBuff({id:'forage_fatigue',name:'采集疲劳',turns:8,hungerCost:1,desc:'移动与采集的饥饿消耗 +1。'});
    }
  }

  let amb=h2(state.x+2701,state.y+3119);
  
  if(amb<prof.ambush){
    toast('采集惊动了附近的敌人！');
    startBattle('E',false);
  }
}
function resolveArrivalTile(x,y,t){
  let k=key(x,y);
  if(t==='B'&&!state.cleared.has(k)){
    if(state.sigils<3){
      toast(`赤塔结界仍在：需要 3 枚塔印（${state.sigils}/3）`);
      
    }else startBattle('B',false);
    return;
  }
  if((t==='E'||t==='X')&&!state.cleared.has(k)){
    startBattle(t,false);
    return;
  }
  if(t==='V'&&!state.spent.has(k)){
    state.spent.add(k);
    state.player.hp=Math.min(state.player.maxHp,state.player.hp+5);
    state.hunger=Math.min(state.maxHunger,state.hunger+20);
    state.inventory.roots++;
    toast('聚落休整：+5 HP，+20 饥饿，甜根 ×1');
  }else if(t==='R'&&!state.spent.has(k)){
    state.spent.add(k);
    state.player.energy=state.player.maxEnergy;
    gainXP(5+Math.floor((Math.abs(x)+Math.abs(y))/12),true);
    toast('探索遗迹：符能恢复，并获得经验');
  }else if(t==='Q'&&!state.eventsSeen.has(k)){
    triggerEvent(x,y);
    
    return;
  }
  
}
function addBuff(b){state.buffs=state.buffs.filter(x=>x.id!==b.id);state.buffs.push(b);recalcStats();toast(`${b.name}：${b.turns} 回合`)}

function moveTo(x,y){let t=tileAt(x,y),cost=moveCostFor(t);if(Math.abs(x-state.x)+Math.abs(y-state.y)!==1||cost==null)throw R.error('IMPASSABLE','不可通行');let from={x:state.x,y:state.y};state.x=x;state.y=y;state.visited.add(key(x,y));revealAround(x,y,2);advanceTime(cost);R.events.push({type:'moved',from,to:{x:state.x,y:state.y},cost});if(state.x===x&&state.y===y)resolveArrivalTile(x,y,t);}

Object.assign(R,{key,clamp,revealAround,rebuildDiscoveryFromVisited,h2,xpNeed,activeBuff,attackBuff,guardBuff,hungerDiscount,journeyHungerMod,pct,harvestProfile,recalcStats,basicGuardAmount,biomeAt,terrainForBiome,tileAt,enemyFor,moveCostFor,compassDir,approxDist,findSigilLeads,canHarvest,tickBuffs,advanceTime,collapseFromHunger,eatItem,harvest,resolveArrivalTile,addBuff,moveTo});}
