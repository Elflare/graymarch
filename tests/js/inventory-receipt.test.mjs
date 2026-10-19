import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../../web/src/core/engine.js';
import {resources} from './helpers/resources.mjs';

function harvestGame({level=0,item='berries',success=true,ambush=true,double=false}={}) {
  const game=createGame({resources}),save=game.exportSave();
  save.state.player.passives.forager=level;
  game.importSave(save);
  const R=game.uiRuntime();
  let target;
  for(let y=-100;y<=100&&!target;y++)for(let x=-100;x<=100&&!target;x++){
    const terrain=R.tileAt(x,y),p=R.harvestProfile(terrain);
    if(!p)continue;
    const loot=p.loot.find(([threshold])=>R.h2(x-401,y+617)<threshold)[1];
    if(loot!==item||(R.h2(x+701,y-911)<p.find)!==success||
       (R.h2(x+2701,y+3119)<p.ambush)!==ambush||
       (R.h2(x-231,y+441)<R.passiveValue(save.state.player,'forager','doubleChance'))!==double)continue;
    target={x,y};
  }
  assert(target,'a deterministic harvest cell must exist');
  const positioned=game.exportSave();Object.assign(positioned.state,target);
  for(const key of ['visited','discovered'])positioned.state[key].push(`${target.x},${target.y}`);
  game.importSave(positioned);
  return game;
}

function command(game,type,payload={}) {
  const f=game.observe();
  return {sessionId:f.sessionId,runId:f.runId,epoch:f.epoch,expectedRevision:f.revision,commandId:`inventory-${f.revision}`,type,payload};
}

test('harvest ambush reports berries 1 to 2 even though battle compact omits inventory',()=>{
  const game=harvestGame(),before=game.observe(),cmd=command(game,'world.harvest');
  assert.equal(before.player.inventory.berries,1);
  const result=game.act(cmd);
  assert.equal(result.observation.phase,'battle.planning');
  assert.equal(result.observation.player.inventory,undefined);
  assert.equal(game.exportSave().state.inventory.berries,2);
  assert.deepEqual(result.inventoryChanges,{berries:2});
  assert.deepEqual(game.act(cmd),result,'a duplicate returns the original receipt');
  assert.equal(game.exportSave().state.inventory.berries,2,'a duplicate never grants another item');
  assert.equal(game.observe().player.inventory,undefined);
  const b=game.observe().battle;
  const next=game.act(command(game,'battle.commit',{battleId:b.battleId,batchId:b.batchId,plan:['basic_guard','basic_guard','basic_guard']}));
  assert.equal(next.inventoryChanges,undefined);
  assert.equal(next.observation.player.inventory,undefined);
});

for(const scenario of [
  {name:'double harvest plus ambush',level:2,double:true,item:'berries',expected:3},
  {name:'first food acquisition plus ambush',item:'mushroom',expected:1},
  {name:'normal harvest without ambush',ambush:false,item:'berries',expected:2},
])test(scenario.name,()=>{
  const game=harvestGame(scenario),result=game.act(command(game,'world.harvest'));
  assert.deepEqual(result.inventoryChanges,{[scenario.item]:scenario.expected});
  assert.equal(game.exportSave().state.inventory[scenario.item],scenario.expected);
  assert.equal(result.observation.phase,scenario.ambush===false?'world.ready':'battle.planning');
  if(scenario.item==='mushroom')assert(result.observation.definitions.some(d=>d.id==='mushroom'));
});

test('failed harvest followed by ambush does not invent inventory changes',()=>{
  const game=harvestGame({success:false}),before=game.exportSave().state.inventory;
  const result=game.act(command(game,'world.harvest'));
  assert.equal(result.observation.phase,'battle.planning');
  assert.equal(result.inventoryChanges,undefined);
  assert.deepEqual(game.exportSave().state.inventory,before);
});

test('consuming the last item reports an absolute zero',()=>{
  const game=createGame({resources}),result=game.act(command(game,'inventory.eat',{itemId:'berries'}));
  assert.deepEqual(result.inventoryChanges,{berries:0});
});
