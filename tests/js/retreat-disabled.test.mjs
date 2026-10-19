import test from 'node:test';
import assert from 'node:assert/strict';
import {createHumanGame,loadHuman} from './helpers/resources.mjs';

for(const type of ['E','X','B'])test(`${type} battles reject retreat for both controllers, including after reload`,()=>{
  const game=createHumanGame();
  game.uiRuntime().startBattle(type);
  loadHuman(game,game.exportSave());
  assert.equal(game.observe().battle.type,type);
  assert(!game.observe().allowed.includes('battle.retreat'));
  assert(!game.observe().allowed.includes('training.exit'));
  for(const mode of ['human','agent']){
    game.control(mode);
    const before=game.exportSave(),frame=game.observe();
    const retreat=()=>mode==='human'?game.humanAct('battle.retreat'):game.act({
      sessionId:frame.sessionId,runId:frame.runId,epoch:frame.epoch,
      expectedRevision:frame.revision,commandId:`retreat-${type}`,type:'battle.retreat',payload:{},
    });
    assert.throws(retreat,e=>e.code==='INVALID_PHASE');
    assert.deepEqual(game.exportSave(),before,'rejection preserves state, RNG and counters');
    assert.deepEqual(game.observe(),frame,'rejection preserves the public frame');
  }
});

test('training still exits and restores its origin, without accepting retreat',()=>{
  const game=createHumanGame(),origin=game.exportSave().state;
  game.humanAct('training.start');
  assert(game.observe().allowed.includes('training.exit'));
  assert(!game.observe().allowed.includes('battle.retreat'));
  const before=game.exportSave();
  assert.throws(()=>game.humanAct('battle.retreat'),e=>e.code==='INVALID_PHASE');
  assert.deepEqual(game.exportSave(),before);
  game.humanAct('training.exit');
  const restored=game.exportSave().state;
  assert.equal(game.observe().phase,'world.ready');
  for(const key of ['player','hunger','maxHunger','buffs','worldTurn'])assert.deepEqual(restored[key],origin[key]);
});
