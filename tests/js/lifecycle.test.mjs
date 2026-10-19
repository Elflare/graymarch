import test from 'node:test';
import assert from 'node:assert/strict';
import {GameResources} from '../../web/src/content/resources.js';
import {createHumanGame,loadHuman,dataCopy} from './helpers/resources.mjs';
import {startBattle} from './helpers/battle.mjs';

const planPayload=(g,plan=[null,null,null])=>({battleId:g.observe().battle.battleId,batchId:g.observe().battle.batchId,plan});
function position(save,x,y){Object.assign(save.state,{x,y});for(const key of ['visited','discovered'])save.state[key].push(`${x},${y}`);}

for(const type of ['E','X','B'])test(`${type} defeat ends the run, freezes its statistics and prevents further actions`,()=>{
  const g=createHumanGame();g.uiRuntime().startBattle(type);
  const save=g.exportSave();save.state.player.hp=1;save.state.battle.enemy.xp=100;
  save.state.battle.lockedIntents=Array.from({length:3},()=>({id:'attack',name:'致命攻击',dmg:99,hidden:false}));
  loadHuman(g,save);
  const result=g.humanAct('battle.commit',planPayload(g));
  assert.equal(result.observation.phase,'game.over');
  assert.equal(result.observation.player.hp,0);
  assert.deepEqual(result.observation.allowed,[]);
  assert.equal(result.observation.battle,null);
  assert.equal(result.observation.pendingDecision,null);
  const ended=g.exportSave();
  assert.deepEqual(ended.state.runResult,{
    cause:'combat',classId:'wanderer',level:1,xp:0,worldTurn:0,wins:0,sigils:0,visited:1,
    build:{skills:{},passives:{},equipment:{}},
  });
  assert.equal(ended.state.pendingRewards,0);
  assert.deepEqual(ended.state.cleared,[]);
  for(const action of ['world.move','world.harvest','inventory.eat','camp.open','choice.select','battle.commit','training.start','training.exit','battle.retreat']){
    assert.throws(()=>g.humanAct(action),e=>e.code==='INVALID_PHASE');
    assert.deepEqual(g.exportSave(),ended);
  }
  assert.deepEqual(g.information().current.runResult,ended.state.runResult);
  assert.deepEqual(g.information({scope:'scene'}).scene.runResult,ended.state.runResult);
  loadHuman(g,ended);
  assert.equal(g.observe().phase,'game.over');
  assert.deepEqual(g.observe().runResult,ended.state.runResult);
});

test('starvation uses current maximum HP, rounds up and starts on the turn hunger reaches zero',()=>{
  for(const [maxHp,expected]of [[18,2],[20,2],[25,3]]){
    const data=dataCopy();data.classes.wanderer.base.hp=maxHp;
    const g=createHumanGame({resources:new GameResources(data)}),save=g.exportSave();
    save.state.hunger=1;loadHuman(g,save);
    g.humanAct('world.move',{direction:'east'});
    assert.equal(g.observe().player.hp,maxHp-expected);
    assert.equal(g.observe().player.hunger,0);
    g.humanAct('world.move',{direction:'west'});
    assert.equal(g.observe().player.hp,maxHp-2*expected);
  }
});

test('world starvation ends the run before a village can heal or grant food',()=>{
  const g=createHumanGame(),R=g.uiRuntime();let target;
  for(let y=-20;y<=20&&!target;y++)for(let x=-20;x<=20&&!target;x++)if(R.tileAt(x,y)==='V')target={x,y};
  assert(target);
  const save=g.exportSave();position(save,target.x-1,target.y);save.state.player.hp=1;save.state.hunger=0;
  loadHuman(g,save);const inventory=g.exportSave().state.inventory;
  const receipt=g.humanAct('world.move',{direction:'east'});
  assert.equal(receipt.observation.phase,'game.over');
  assert.equal(receipt.observation.runResult.cause,'starvation');
  assert.deepEqual(receipt.observation.world.position,target);
  assert.deepEqual(g.exportSave().state.inventory,inventory);
  assert(!g.exportSave().state.spent.includes(`${target.x},${target.y}`));
});

test('fatal harvesting starvation stops loot and ambush, and sync transmits the terminal result',()=>{
  const g=createHumanGame(),save=g.exportSave();position(save,66,-99);save.state.hunger=0;save.state.player.hp=1;
  loadHuman(g,save);const before=g.observe({format:'sync'}),inventory=g.exportSave().state.inventory;
  const receipt=g.humanAct('world.harvest');
  assert.equal(receipt.observation.phase,'game.over');
  assert.equal(receipt.inventoryChanges,undefined);
  assert.deepEqual(g.exportSave().state.inventory,inventory);
  assert(!receipt.events.some(e=>e.type==='sceneEntered'));
  const sync=g.observe({format:'sync',baseRevision:before.revision});
  assert.equal(sync.set.phase,'game.over');
  assert.deepEqual(sync.set.runResult,receipt.observation.runResult);
});

test('combat preview and execution apply starvation per small round and stop at death',()=>{
  const g=createHumanGame();startBattle(g);
  const save=g.exportSave();save.state.hunger=0;save.state.player.hp=5;
  save.state.battle.lockedIntents=Array.from({length:3},()=>({id:'wait',name:'等待',hidden:false}));
  loadHuman(g,save);const before=g.exportSave(),payload=planPayload(g),forecast=g.preview(payload);
  assert.deepEqual(g.exportSave(),before);
  assert.equal(forecast.p.hp,0);assert.equal(forecast.worldTurn,3);assert.equal(forecast.steps.length,3);
  assert.equal(forecast.deathCause,'starvation');
  const receipt=g.humanAct('battle.commit',payload);
  assert.equal(receipt.observation.phase,'game.over');
  assert.equal(receipt.observation.runResult.cause,'starvation');
  assert.equal(receipt.observation.runResult.worldTurn,3);
  assert.equal(receipt.observation.player.hp,forecast.p.hp);
  assert.equal(receipt.observation.decisionTurn,before.state.decisionTurn+1);
});

test('queries and planning cost no starvation damage; food can end starvation before a new turn',()=>{
  const g=createHumanGame(),save=g.exportSave();save.state.hunger=0;loadHuman(g,save);
  const before=g.exportSave();g.observe();g.information();g.map();g.catalog();assert.deepEqual(g.exportSave(),before);
  g.humanAct('inventory.eat',{itemId:'roots'});assert(g.observe().player.hunger>0);
  const hp=g.observe().player.hp;g.humanAct('world.move',{direction:'east'});assert.equal(g.observe().player.hp,hp);
  startBattle(g);const battle=g.exportSave();g.preview(planPayload(g));g.humanAct('battle.plan.set',planPayload(g));
  assert.equal(g.observe().worldTurn,battle.state.worldTurn);assert.equal(g.observe().player.hp,battle.state.player.hp);
});

test('survival configuration controls the percentage and validates its range',()=>{
  const data=dataCopy();data.world.starvationHpRatio=.25;
  const g=createHumanGame({resources:new GameResources(data)}),save=g.exportSave();save.state.hunger=0;loadHuman(g,save);
  g.humanAct('world.move',{direction:'east'});assert.equal(g.observe().player.hp,13);
  for(const ratio of [0,-.1,1.1]){data.world.starvationHpRatio=ratio;assert.throws(()=>new GameResources(data),/starvationHpRatio/);}
});

test('old living saves work, removed training actions fail, and restart preserves permanent progress',()=>{
  const g=createHumanGame({meta:{bossWins:1,bestGrade:'S',harvests:10,unlocks:[]}}),save=g.exportSave();
  delete save.state.runResult;save.state.training=false;save.state.battleOrigin=null;
  loadHuman(g,save);assert.equal(g.observe().runResult,null);assert(!('training' in g.exportSave().state));
  for(const action of ['training.start','training.exit'])assert.throws(()=>g.humanAct(action),{code:'INVALID_PHASE'});
  const starved=g.exportSave();starved.state.hunger=0;starved.state.player.hp=1;loadHuman(g,starved);
  g.humanAct('world.move',{direction:'east'});const meta=g.exportMeta(),run=g.observe().runId;
  const invalid=g.exportSave();invalid.state.runResult.wins=999;
  assert.throws(()=>g.importSave(invalid),{code:'INVALID_SAVE'});
  g.humanAct('host.newRun',{classId:'sentinel'});
  assert.equal(g.getControl(),'human');assert.notEqual(g.observe().runId,run);
  assert.equal(g.observe().phase,'world.ready');assert.equal(g.observe().runResult,null);
  assert.equal(g.observe().worldTurn,0);assert.equal(g.observe().player.classId,'sentinel');
  assert.deepEqual(g.exportMeta(),meta);
});

test('navigation groups distances 3, 4 and 5 in the same straight-line bucket without exposing coordinates',()=>{
  const g=createHumanGame(),save=g.exportSave();position(save,3,12);loadHuman(g,save);
  assert.deepEqual(g.uiRuntime().findSigilLeads().map(p=>p.d),[3,4,5]);
  const leads=g.observe().world.objective.leads;
  assert.deepEqual(leads.map(p=>p.distance),['5格内','5格内','5格内']);
  assert(leads.every(p=>!('x' in p)&&!('y' in p)));
});

test('poison can end a run before hunger, without continuing the remaining plan',()=>{
  const g=createHumanGame();startBattle(g);
  const save=g.exportSave();save.state.player.hp=1;save.state.player.poison={dmg:2,turns:2};
  save.state.hunger=0;save.state.battle.lockedIntents=Array.from({length:3},()=>({id:'wait',name:'等待'}));
  loadHuman(g,save);const forecast=g.preview(planPayload(g));
  assert.equal(forecast.steps.length,1);assert.equal(forecast.deathCause,'combat');
  g.humanAct('battle.commit',planPayload(g));assert.equal(g.observe().phase,'game.over');
  assert.equal(g.observe().runResult.cause,'combat');assert.equal(g.observe().player.hp,0);
});

test('a maximum-HP equipment upgrade changes starvation damage immediately',()=>{
  const g=createHumanGame(),save=g.exportSave();save.state.player.equipment.wanderer_cloak=3;loadHuman(g,save);
  g.humanAct('world.move',{direction:'east'});
  const equipped=g.exportSave();assert(equipped.state.player.maxHp>20);
  equipped.state.hunger=0;loadHuman(g,equipped);
  g.humanAct('world.move',{direction:'west'});
  assert.equal(g.observe().player.hp,equipped.state.player.hp-Math.ceil(equipped.state.player.maxHp*.1));
});
