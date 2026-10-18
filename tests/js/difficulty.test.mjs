import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../../web/src/core/engine.js';
import {initialState} from '../../web/src/core/state.js';
import {installContent} from '../../web/src/content/definitions.js';
import {installCombat} from '../../web/src/core/combat.js';

function battle(id='skeleton') {
  const R={state:initialState(),toast(){}};
  installContent(R);
  R.state.player.hp=100;
  R.enemyFor=()=>({...R.enemyDefs[id],id,hp:1000,maxHp:1000,baseArmor:0,block:0});
  installCombat(R);R.startBattle(id==='lord'?'B':'X');
  return R;
}

test('control cooldowns use steps, cross batches, and preview matches execution',()=>{
  for(const [id,expected]of [['stagger',[false,true,true]],['time_snare',[false,true,false]]]) {
    const R=battle(),s=R.state;
    s.player.skills[id]=3;s.battle.plan=[id,id,id];
    const preview=R.simulatePlan(),result=R.resolvePlan();
    assert.deepEqual(result.steps,preview.steps);
    assert.deepEqual(result.steps.map(x=>!!x.playerAction.failed),expected);
    assert.equal(s.player.cooldowns?.[id]||0,id==='stagger'?0:1);
    s.battle.plan=[id,'basic_guard','basic_guard'];
    const next=R.simulatePlan();
    assert.equal(!!next.steps[0].playerAction.failed,id==='time_snare');
  }
});

test('cooldown saves restore and training restores the original player',()=>{
  const game=createGame(),save=game.exportSave();save.state.player.skills.stagger=3;
  game.importSave(save);
  const original=game.exportSave().state.player;
  game.humanAct('training.start');
  const b=game.observe().battle;
  game.humanAct('battle.commit',{battleId:b.battleId,batchId:b.batchId,plan:[null,null,'stagger']});
  assert.equal(game.observe().player.cooldowns.stagger,2);
  game.importSave(game.exportSave());
  assert.equal(game.observe().player.cooldowns.stagger,2);
  game.humanAct('training.exit');
  assert.deepEqual(game.exportSave().state.player,original);
});

test('three distinct guardians scale by sigils; enrage strengthens only new attacks',()=>{
  const game=createGame(),ids=[];
  for(let rank=0;rank<3;rank++) {
    const save=game.exportSave();save.state.sigils=rank;game.importSave(save);
    const R=game.uiRuntime(),near=R.enemyFor(10,1,'X'),far=R.enemyFor(300,200,'X');
    ids.push(near.id);
    assert.equal(near.hp,[24,36,48][rank]);
    assert.equal(far.hp,near.hp);
  }
  assert.equal(new Set(ids).size,3);
  const R=battle('iron_warden'),b=R.state.battle;
  b.turn=13;b.lockedIntents=R.makeIntentBatch();
  assert.equal(b.enemy.enrage,1);
  assert.deepEqual(b.lockedIntents.map(a=>a.dmg??a.block),[6,4,7]);
  b.turn=16;b.carryIntents=[{id:'attack',name:'already locked',dmg:3}];
  b.lockedIntents=R.makeIntentBatch();
  assert.equal(b.lockedIntents[0].dmg,3);
  assert.equal(b.enemy.enrage,2);
});
