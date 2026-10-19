import {createHash} from 'node:crypto';
import {startBattle} from './battle.mjs';

// These fingerprints were captured from the pre-resource kernel. Exclude prose
// (now parameterized), random session IDs and function properties, retain outcomes.
function normalized(value) {
  if(Array.isArray(value))return value.map(normalized);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort()
    .filter(k=>!['sessionId','runId','batchId','battleId','description','desc','summary','pattern','ai'].includes(k))
    .map(k=>[k,normalized(value[k])]));
  return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');

export function migrationFingerprints(factory) {
  const game=()=>{
    const g=factory({seed:12345}),save=g.exportSave();
    save.state.runId='migration';save.state.sessionId='migration';g.importSave(save);g.control('human');return g;
  };
  const R=game().uiRuntime(),map=[],intents=[],harvest=[];
  for(let y=-40;y<=40;y++)for(let x=-40;x<=40;x++){
    const e=R.enemyFor(x,y,'E');
    map.push([x,y,R.tileAt(x,y),R.biomeAt(x,y).id,e.id,e.hp,e.atk,e.baseArmor,e.xp]);
  }
  for(const[id,d]of Object.entries(R.enemyDefs))for(const ratio of [1,.5,.25])for(let t=1;t<=24;t++)intents.push([id,ratio,t,d.ai(t,{...d,hp:d.hp*ratio,maxHp:d.hp})]);
  for(const terrain of ['.','G','T','S'])for(let lv=0;lv<=3;lv++){
    const g=game(),save=g.exportSave();save.state.player.passives.forager=lv;g.importSave(save);
    const p=g.uiRuntime().harvestProfile(terrain);harvest.push([terrain,lv,p.cost,p.find,p.ambush,p.debuff]);
  }
  const combat={};
  for(const[id,d]of Object.entries(R.activeSkills))for(let lv=1;lv<=d.max;lv++)for(const block of [0,3]){
    const g=game();startBattle(g);
    const save=g.exportSave(),s=save.state,p=s.player,e=s.battle.enemy;
    p.hp=15;p.maxHp=100;p.energy=20;p.maxEnergy=30;p.skills[id]=lv;
    p.passives={third_strike:2,low_hp_fury:2,parity_edge:2,divisible_edge:2,precise_guard:3,even_guard:2};
    p.equipment={tower_shield:2};p.poison={dmg:1,turns:2};
    e.hp=1000;e.maxHp=1000;e.block=block;e.burn={dmg:1,turns:3};e.bleed={dmg:1,turns:2};
    s.battle.lockedIntents=[{id:'attack',name:'a',dmg:3},{id:'guard',name:'g',block:2},{id:'drain',name:'d',dmg:4,drain:1,poison:1}];
    s.battle.plan=[id,id,id];g.importSave(save);
    const preview=g.uiRuntime().simulatePlan();
    // Historical fingerprints predate real-world time in this fixed encounter.
    preview.hunger=80;preview.worldTurn=0;
    combat[`${id}:${lv}:${block}`]=digest(preview);
  }
  return {map:digest(map),intents:digest(intents),harvest:digest(harvest),combat};
}

export function legacySaves(factory) {
  const game=()=>{const g=factory({seed:12345});const save=g.exportSave();save.state.runId='legacy';save.state.sessionId='legacy';g.importSave(save);return g;};
  const world=game(),battle=game(),event=game(),camp=game(),reward=game();
  startBattle(battle);
  event.uiRuntime().triggerEvent(11,13);
  camp.uiRuntime().showCampfire();
  reward.uiRuntime().showReward(1);
  return Object.fromEntries(Object.entries({world,battle,event,camp,reward}).map(([k,g])=>[k,g.exportSave()]));
}
