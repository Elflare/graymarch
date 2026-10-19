import assert from 'node:assert/strict';
import test from 'node:test';
import {startBattle} from './helpers/battle.mjs';
import {resources,createHumanGame as createGame,loadHuman} from './helpers/resources.mjs';
import {initialState} from '../../web/src/core/state.js';
import {installContent} from '../../web/src/content/definitions.js';
import {installLifecycle} from '../../web/src/core/lifecycle.js';
import {installCombat} from '../../web/src/core/combat.js';
const copy=x=>JSON.parse(JSON.stringify(x));
function runtime(){const R={resources,state:initialState(resources),toast(){},gainXP(){},key:(x,y)=>`${x},${y}`,showSimpleEvent(...a){R.event=a;}}; R.events=[];installLifecycle(R);installContent(R);R.enemyFor=()=>({...R.enemyDefs.skeleton,id:'skeleton',hp:1000,maxHp:1000,atk:2,armor:1,baseArmor:1,block:0,xp:5});installCombat(R);return R;}
function started(){let R=runtime();R.startBattle();return R;}
function samePreviewExecution(R){let before=copy(R.state),f=R.simulatePlan();assert.deepEqual(copy(R.state),before);const result=R.resolvePlan();for(let key of ['p','e','hunger','buffs','worldTurn','turn','outcome','stats','steps','intents','carryIntents'])assert.deepEqual(result[key],f[key],`${key} differs`);assert.equal(result.ok,true);return result;}
for(let lv=1;lv<=5;lv++) for(let id of ['basic_attack','basic_guard',...Object.keys(runtime().activeSkills)]) if(!runtime().activeSkills[id]||lv<=runtime().activeSkills[id].max)test(`Shared kernel: ${id} level ${lv}`,()=>{
 let R=started(),p=R.state.player,b=R.state.battle;p.hp=100;p.maxHp=100;p.maxEnergy=30;p.energy=20;p.skills[id]=lv;
 p.passives={third_strike:2,low_hp_fury:2,parity_edge:2,divisible_edge:2,precise_guard:3,even_guard:2};p.equipment={tower_shield:2};
 R.state.buffs=[{id:'a',attack:2,guard:1,turns:1},{id:'b',attack:-1,guard:-1,turns:2}];p.attack+=1;
 p.poison={dmg:1,turns:2};b.enemy.bleed={dmg:1,turns:2};b.enemy.burn={dmg:1,turns:3};b.enemy.block=3;
 b.lockedIntents=[{id:'attack',name:'a',dmg:3},{id:'guard',name:'g',block:2},{id:'drain',name:'d',dmg:4,drain:1,poison:1}];
 b.plan=[id,id,id];samePreviewExecution(R);
});
test("Hidden intent swap: its unknown payload may not influence or appear in a forecast.",()=>{let R=started(),p=R.state.player,b=R.state.battle;p.skills.fate_swap=1;b.plan=['fate_swap','basic_attack','basic_guard'];b.lockedIntents=[{id:'guard',name:'known1',block:1},{id:'guard',name:'known2',block:1},{id:'heavy',name:'SECRET_ALPHA',dmg:123456,hidden:true}];b.hiddenIntentIndex=2;let f=R.simulatePlan();assert.equal(f.partial,true);assert.deepEqual(f.blockedAt,{index:1,phase:'enemy'});assert(!JSON.stringify(f).includes('SECRET_ALPHA'));assert(!JSON.stringify(f).includes('123456'));b.lockedIntents[2]={id:'drain',name:'SECRET_BETA',dmg:987654,drain:99,hidden:true};assert.deepEqual(R.simulatePlan(),f);});
test("Intent-dependent skills stop before paying/acting on concealed information.",()=>{let R=started(),p=R.state.player,b=R.state.battle;p.skills.mirror_guard=3;b.plan=['mirror_guard',null,null];b.lockedIntents[0].hidden=true;let f=R.simulatePlan();assert.deepEqual(f.blockedAt,{index:0,phase:'player'});assert.equal(f.p.energy,p.energy);assert.equal(f.p.block,p.block);});
test("Delaying a hidden action carries only an opaque placeholder in previews.",()=>{let R=started(),p=R.state.player,b=R.state.battle;p.skills.time_snare=3;b.plan=['time_snare','basic_guard','basic_guard'];b.lockedIntents[0]={id:'heavy',name:'SECRET_DELAY',dmg:12345,hidden:true};let f=R.simulatePlan();assert.equal(f.partial,false);assert.deepEqual(f.carryIntents,[{hidden:true}]);assert(!JSON.stringify(f).includes('SECRET_DELAY'));});
test("Hunger kills during first round; there is no map collapse or continued batch.",()=>{let R=started(),s=R.state,b=s.battle;s.player.hp=1;s.hunger=0;b.plan=['basic_guard',null,null];let result=samePreviewExecution(R);assert.equal(result.outcome,'defeat');assert.equal(result.steps.length,1);assert.equal(s.inBattle,false);assert.equal(s.worldTurn,1);assert.equal(s.x,0);});
test("Counter victory happens before poison/hunger can tick.",()=>{let R=started(),s=R.state,b=s.battle;s.player.hp=1;s.hunger=0;s.player.poison={dmg:100,turns:2};s.player.skills.riposte=1;b.enemy.hp=3;b.plan=['riposte',null,null];let result=samePreviewExecution(R);assert.equal(result.outcome,'victory');assert.equal(result.steps.length,1);assert.equal(result.p.hp,1);assert.equal(result.stats.damageDealt,3);assert.equal(s.worldTurn,0);});
test("Bleeding victory likewise precedes poison and starvation and caps actual DOT damage.",()=>{let R=started(),s=R.state,b=s.battle;s.player.hp=1;s.hunger=0;s.player.poison={dmg:100,turns:2};b.enemy.hp=1;b.enemy.bleed={dmg:10,turns:2};b.plan=['basic_guard',null,null];let result=samePreviewExecution(R);assert.equal(result.outcome,'victory');assert.equal(result.p.hp,1);assert.equal(result.stats.damageDealt,1);assert.equal(s.worldTurn,0);});
test("Boss victory exposes only the continue action.",()=>{let R=started();R.state.battle.type='B';R.state.battle.enemy.hp=0;R.endBattle(true);assert.equal(R.event[2].length,1);assert.equal(R.event[2][0].label,'继续探索');});
test("IDs change per batch, and stale batch commits cannot mutate.",()=>{let R=started(),b=R.state.battle,id=b.id,batch=b.batchId;R.resolvePlan(batch);assert.equal(b.id,id);assert.notEqual(b.batchId,batch);let before=copy(R.state);assert.equal(R.resolvePlan(batch).error,'STALE_BATCH');assert.deepEqual(copy(R.state),before);});

function payload(game, plan) {
  const battle = game.observe().battle;
  return { battleId: battle.battleId, batchId: battle.batchId, plan };
}

test('Scene transitions are present in command receipts', () => {
  const game = createGame();
  const saved=game.exportSave();Object.assign(saved.state,{x:66,y:-99});for(const key of ['visited','discovered'])saved.state[key].push('66,-99');loadHuman(game,saved);
  const entered = game.humanAct('world.harvest');
  const event = entered.events.find(event => event.type === 'sceneEntered');
  assert.equal(event.scene.kind, 'battle');
  assert.equal(event.scene.id, entered.observation.battle.battleId);
  const battleSave=game.exportSave();battleSave.state.battle.enemy.hp=1;loadHuman(game,battleSave);
  const exited = game.humanAct('battle.commit',payload(game,['basic_attack',null,null]));
  assert.equal(exited.events.find(event => event.type === 'sceneExited').scene.id, event.scene.id);
});

test('Battle level-ups yield a complete sequence of serializable rewards', () => {
  const game = createGame({ seed: 123 });
  startBattle(game);
  const save = game.exportSave();
  save.state.battle.enemy.hp = 1;
  save.state.battle.enemy.xp = 100;
  loadHuman(game,save);
  const resolved = game.humanAct('battle.commit', payload(game, ['basic_attack', null, null]));
  assert.equal(resolved.observation.phase, 'choice.pending');
  const rounds = game.exportSave().state.pendingRewards;
  assert(rounds > 1);
  let chosen = 0;
  while (game.observe().pendingDecision) {
    const decision = game.observe().pendingDecision;
    assert.equal(decision.kind, 'reward');
    const roundtrip = game.exportSave();
    loadHuman(game,roundtrip);
    assert.deepEqual(game.observe().pendingDecision, decision);
    const option = decision.options[0];
    game.humanAct('choice.select', { decisionId: decision.decisionId, optionId: option.optionId });
    chosen++;
    assert.equal(game.exportSave().state.pendingRewards, rounds - chosen);
    assert(chosen <= rounds);
  }
  assert.equal(chosen, rounds);
  assert.equal(game.observe().phase, 'world.ready');
});

test('An XP event immediately hands off to reward choice and survives a pending save', () => {
  const game = createGame({ seed: 456 }), runtime = game.uiRuntime();
  let target;
  for (let y = -30; y <= 30 && !target; y++) for (let x = -30; x <= 30 && !target; x++) {
    if (runtime.tileAt(x, y) === 'Q' && runtime.h2(x + 4511, y - 3571) >= .32 && Math.floor(runtime.h2(x + 1501, y - 1203) * 10) === 7) target = { x, y };
  }
  assert(target);
  const save = game.exportSave();
  save.state.x = target.x - 1;
  save.state.y = target.y;
  save.state.xp = runtime.xpNeed(1) - 1;
  for (const field of ['visited', 'discovered']) save.state[field].push(`${target.x - 1},${target.y}`);
  loadHuman(game,save);
  game.humanAct('world.move', { direction: 'east' });
  const event = game.observe().pendingDecision;
  assert.equal(event.title, '失落的行军手册');
  loadHuman(game,game.exportSave());
  game.humanAct('choice.select', { decisionId: event.decisionId, optionId: event.options[0].optionId });
  assert.equal(game.observe().pendingDecision.kind, 'reward');
  assert.equal(game.observe().player.level, 2);
  const reward = game.observe().pendingDecision;
  game.humanAct('choice.select', { decisionId: reward.decisionId, optionId: reward.options[0].optionId });
  assert.equal(game.observe().phase, 'world.ready');
});

test('Complete battle save roundtrip preserves all gameplay state and deterministic continuation', () => {
  const game = createGame({ seed: 789 });
  startBattle(game);
  const save = game.exportSave();
  save.state.buffs = [{ id: 'test_guard', name: '守势', turns: 3, guard: 2, attack: 1 }];
  save.state.player.attack += 1;
  save.state.player.skills.time_snare = 3;
  save.state.player.skills.fate_swap = 3;
  save.state.battle.plan = ['time_snare', 'fate_swap', null];
  save.state.battle.enemy.burn = { dmg: 1, turns: 3 };
  save.state.battle.carryIntents = [{ id: 'attack', name: '延迟斩击', dmg: 1, hidden: true }];
  save.state.battle.stats.exactBlocks = 2;
  save.state.worldTurn = 21;
  save.state.hunger = 44;
  save.state.harvested.push('1,2');
  save.state.spent.push('3,4');
  save.state.eventsSeen.push('5,6');
  save.state.cleared.push('7,8');
  loadHuman(game,save);
  const other = createGame({ seed: 999 });
  loadHuman(other,game.exportSave());
  function gameplay(saved) {
    const result = copy(saved.state);
    delete result.sessionId; delete result.epoch; delete result.revision;
    return result;
  }
  assert.deepEqual(gameplay(other.exportSave()), gameplay(game.exportSave()));
  const plan = ['basic_guard', 'basic_guard', null];
  assert.deepEqual(other.preview(payload(other, plan)), game.preview(payload(game, plan)));
  game.humanAct('battle.commit', payload(game, plan));
  other.humanAct('battle.commit', payload(other, plan));
  assert.deepEqual(gameplay(other.exportSave()), gameplay(game.exportSave()));
});

test('Public preview and observation never expose hidden intent payloads after fate swap', () => {
  const game = createGame();
  startBattle(game);
  let save = game.exportSave();
  save.state.player.skills.fate_swap = 1;
  save.state.battle.enemy.hp = 100;
  save.state.battle.enemy.maxHp = 100;
  save.state.battle.hiddenIntentIndex = 2;
  save.state.battle.lockedIntents = [
    { id: 'guard', name: '已知守势一', block: 1, hidden: false },
    { id: 'guard', name: '已知守势二', block: 1, hidden: false },
    { id: 'heavy', name: 'SECRET_HIDDEN_ONE', dmg: 1234, hidden: true },
  ];
  loadHuman(game,save);
  const plan = ['fate_swap', 'basic_guard', 'basic_guard'];
  const first = game.preview(payload(game, plan));
  assert(first.partial);
  assert.deepEqual(first.blockedAt, { index: 1, phase: 'enemy' });
  assert(!JSON.stringify(game.observe()).includes('SECRET_HIDDEN_ONE'));
  assert(!JSON.stringify(first).includes('SECRET_HIDDEN_ONE'));
  assert(!JSON.stringify(first).includes('1234'));
  save = game.exportSave();
  save.state.battle.lockedIntents[2] = { id: 'drain', name: 'SECRET_HIDDEN_TWO', dmg: 9876, drain: 2, hidden: true };
  loadHuman(game,save);
  assert.deepEqual(game.preview(payload(game, plan)), first);
});

test('Killing-blow energy recovery is forecast and applied exactly once', () => {
  const game = createGame();
  startBattle(game);
  const save = game.exportSave();
  save.state.battle.enemy.hp = 1;
  save.state.battle.enemy.xp = 1;
  save.state.player.energy = 0;
  save.state.player.passives.precise_kill = 1;
  loadHuman(game,save);
  const plan = ['basic_attack', null, null];
  const forecast = game.preview(payload(game, plan));
  assert.equal(forecast.outcome, 'victory');
  assert.equal(forecast.p.energy, 1);
  game.humanAct('battle.commit', payload(game, plan));
  assert.equal(game.observe().player.energy, forecast.p.energy);
});

test('Boss victory continuation preserves earned rewards without offering a new journey', () => {
  const game = createGame();
  startBattle(game);
  const save = game.exportSave();
  save.state.battle.type = 'B';
  save.state.battle.enemy.id = 'lord';
  save.state.battle.enemy.hp = 1;
  save.state.battle.enemy.maxHp = 28;
  save.state.battle.enemy.xp = 100;
  loadHuman(game,save);
  game.humanAct('battle.commit', payload(game, ['basic_attack', null, null]));
  const victory = game.observe().pendingDecision;
  assert.equal(victory.kind, 'victory');
  assert.equal(victory.options.length, 1);
  assert.equal(victory.options[0].label, '继续探索');
  const earned = game.exportSave().state.pendingRewards;
  assert(earned > 1);
  loadHuman(game,game.exportSave());
  game.humanAct('choice.select', { decisionId: victory.decisionId, optionId: victory.options[0].optionId });
  assert.equal(game.observe().pendingDecision.kind, 'reward');
  assert.equal(game.exportSave().state.pendingRewards, earned);
  assert.equal(game.exportSave().state.meta.bossWins, 1);
});

test('Historical training saves are rejected', () => {
  const game = createGame();
  startBattle(game);
  const before = game.exportSave(), malformed = copy(before);
  malformed.state.training=true;
  assert.throws(() => loadHuman(game,malformed), error => error.code === 'INVALID_SAVE');
  assert.deepEqual(game.exportSave(), before);
});
