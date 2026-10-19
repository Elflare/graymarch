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
