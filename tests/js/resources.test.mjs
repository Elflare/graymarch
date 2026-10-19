import test from 'node:test';
import assert from 'node:assert/strict';
import {GameResources} from '../../web/src/content/resources.js';
import {createGame} from '../../web/src/core/engine.js';
import {resources, dataCopy, readResource} from './helpers/resources.mjs';

function act(game,type,payload={}) {
  const f=game.observe();
  return game.act({sessionId:f.sessionId,runId:f.runId,epoch:f.epoch,expectedRevision:f.revision,commandId:'resource-'+f.revision,type,payload});
}
function battlePlan(game,plan) {
  const {battleId,batchId}=game.observe().battle;return {battleId,batchId,plan};
}

test('Agent owns a newly created game, human takeover and save reload work',()=>{
  const game=createGame({resources});
  assert.equal(game.getControl(),'agent');
  assert.throws(()=>game.humanAct('training.start'),{code:'CONTROLLER_REQUIRED'});
  act(game,'training.start');
  const old=game.observe(),save=game.exportSave();
  game.control('human');
  assert.throws(()=>act(game,'training.exit'),{code:'CONTROLLER_REQUIRED'});
  const result=game.importSave(save);
  assert.equal(result.controlMode,'agent');assert.equal(game.getControl(),'agent');
  assert(game.observe().epoch>old.epoch);
  assert.equal(game.uiRuntime().presentation,null);
  act(game,'training.exit');
  assert(!JSON.stringify(game.exportSave()).includes('levels'));
});

test('invalid saves preserve the journey and an existing human pause',()=>{
  const game=createGame({resources});game.control('human');
  const before=game.exportSave();
  assert.throws(()=>game.importSave({format:'damaged'}),{code:'INVALID_SAVE'});
  assert.equal(game.getControl(),'human');assert.deepEqual(game.exportSave(),before);
});

test('resources copy their source, freeze nested rows, and can be shared by independent games',()=>{
  const data=dataCopy(),r=new GameResources(data);
  data.classes.wanderer.base.hp=999;
  assert.equal(r.get('classes','wanderer').base.hp,18);
  assert.throws(()=>{r.level('skills','heal',1).heal=999;},TypeError);
  const a=createGame({resources:r}),b=createGame({resources:r});act(a,'world.move',{direction:'east'});
  assert.equal(b.observe().revision,0);assert.equal(b.observe().world.position.x,0);
});

for(const [name,change,path]of [
  ['missing file',d=>delete d.foods,'foods.json'],
  ['missing field',d=>delete d.skills.power_strike.levels[0].damageBonus,'skills.json.power_strike.levels[0].damageBonus'],
  ['incomplete level table',d=>d.skills.heal.levels.pop(),'skills.json.heal.levels'],
  ['invalid probability',d=>{d.foods.berries.chance=2;},'foods.json.berries.chance'],
  ['unknown food',d=>{d.classes.wanderer.inventory.unknown=1;},'classes.json.wanderer.inventory.unknown'],
  ['unknown enemy',d=>{d.world.guardians[0]='unknown';},'world.json.enemies'],
  ['invalid threshold',d=>{d.world.terrain.grass[1][0]=0;},'world.json.terrain.grass'],
  ['unknown buff',d=>{d.events.common[0].choices[0].effect.buff='unknown';},'events.json.common[0].choices[0].effect.buff'],
  ['unknown effect',d=>{d.events.common[0].choices[0].effect.execute='anything';},'events.json.common[0].choices[0].effect.execute'],
  ['unknown template field',d=>{d.skills.heal.levels[0].description='{missing}';},'skills.json.heal.levels[0].description'],
  ['invalid AI period',d=>{d.enemies.wolf.params.period=0;},'enemies.json.wolf.params.period'],
  ['zero scaling divisor',d=>{d.world.distanceScale.divisor=0;},'world.json.distanceScale.divisor'],
  ['negative XP requirement',d=>{d.rules.growth.xpBase=-1;},'rules.json.growth.xpBase'],
  ['fractional item count',d=>{d.classes.wanderer.inventory.roots=.5;},'classes.json.wanderer.inventory.roots'],
  ['unknown description condition',d=>{d.skills.heal.details[0].when='unknown';},'skills.json.heal.details[0].when'],
])test('resource boundary rejects '+name+' with its location',()=>{
  const data=dataCopy();change(data);
  assert.throws(()=>new GameResources(data),e=>e.code==='INVALID_RESOURCE'&&e.message.includes(path));
});

test('loader names files on I/O and JSON failures',async()=>{
  await assert.rejects(GameResources.load(async file=>{if(file==='foods.json')throw new SyntaxError('broken JSON');return readResource(file);}),e=>e.code==='RESOURCE_LOAD_FAILED'&&e.message.includes('foods.json')&&e.message.includes('broken JSON'));
});

test('edited JSON changes starting stats, skill settlement, descriptions, food, harvest and growth',()=>{
  const data=dataCopy();
  data.classes.wanderer.base.hp=24;data.classes.wanderer.base.attack=9;
  data.classes.wanderer.skills={power_strike:1};
  data.skills.power_strike.levels[0].damageBonus=17;
  data.foods.roots.hunger=31;data.world.harvest.G.cost=7;data.rules.growth.xpBase=80;
  const game=createGame({resources:new GameResources(data)});
  assert.equal(game.observe().player.maxHp,24);assert.equal(game.observe().player.attack,9);
  assert.equal(game.observe().player.xpNeed,85);assert.equal(game.uiRuntime().harvestProfile('G').cost,7);
  const def=game.observe().definitions.find(d=>d.id==='power_strike');assert.match(def.effect,/17/);
  assert.match(game.observe().definitions.find(d=>d.id==='roots').effect,/31/);
  const save=game.exportSave();save.state.hunger=10;game.importSave(save);
  act(game,'inventory.eat',{itemId:'roots'});assert.equal(game.observe().player.hunger,41);
  act(game,'training.start');
  const plan=battlePlan(game,['power_strike',null,null]),forecast=game.preview(plan),result=act(game,'battle.commit',plan);
  assert.equal(forecast.steps[0].playerAction.dmg,9); // capped by the training opponent's remaining HP
  assert.equal(forecast.steps[0].playerAction.overkill,16);
  assert.deepEqual(result.events.find(e=>e.type==='combatResolved').steps,forecast.steps);
});

test('public definition caches invalidate when resource effects change',()=>{
  const a=createGame({resources}),first=a.observe();
  const known=Object.fromEntries(first.definitions.map(d=>[d.id,`${d.version}:${d.level||0}`]));
  assert.equal(a.observe({knownDefinitionVersions:known}).definitions.length,0);
  const data=dataCopy();data.foods.roots.hunger++;
  const b=createGame({resources:new GameResources(data)}),next=b.observe({knownDefinitionVersions:known});
  assert(next.definitions.some(d=>d.id==='roots'));
  assert.notEqual(b.catalog().catalogVersion,a.catalog().catalogVersion);
  assert.equal(next.definitions.some(d=>d.id==='berries'),false);
});

test('resources do not add internal enemy behavior data to observations or saves',()=>{
  const game=createGame({resources});act(game,'training.start');
  for(const value of [game.observe(),game.information(),game.exportSave()]){
    const text=JSON.stringify(value);assert(!text.includes('actionNames'));assert(!text.includes('phaseRatios'));assert(!text.includes('behavior'));
  }
});

test('conditional descriptions, enemy dossiers and unlock labels follow edited parameters',()=>{
  const data=dataCopy();
  data.skills.power_strike.levels[0].shatter=4;
  data.skills.heal.levels[2].cleanse=false;
  data.enemies.wolf.atk=8;data.enemies.wolf.params.heavyBonus=5;
  data.rules.growth.unlocks.find(u=>u.id==='class_hunter').value=20;
  const r=new GameResources(data),game=createGame({resources:r});
  assert.match(r.describe('skills','power_strike',1),/粉碎敌人 4 Block/);
  assert(!r.describe('skills','heal',3).includes('清除中毒'));
  assert.match(r.enemy('wolf').pattern[1],/13/);
  assert.match(game.uiRuntime().classDefs.hunter.unlock,/20/);
});

test('basic action energy cost comes from the same definition shown to Agent',()=>{
  const data=dataCopy();data.rules.combat.basicActions.basic_attack.cost=1;data.rules.combat.energyPerStep=0;
  const game=createGame({resources:new GameResources(data)});act(game,'training.start');
  const f=game.preview(battlePlan(game,['basic_attack',null,null]));
  assert.equal(game.observe().battle.actions.find(a=>a.id==='basic_attack').cost,1);
  assert.equal(f.steps[0].playerAction.failed,undefined);
  assert.equal(f.p.energy,1); // The configured cost is paid before any end-of-step recovery.
  const save=game.exportSave();save.state.player.energy=0;game.importSave(save);
  const empty=game.preview(battlePlan(game,['basic_attack',null,null]));
  assert.equal(empty.steps[0].playerAction.reason,'energy');
});

test('pending event and camp outcomes survive resource edits without exposing hidden effects',()=>{
  const data=dataCopy();data.events.regionalChance=0;data.events.common=[data.events.common[0]];
  const first=createGame({resources:new GameResources(data)});
  first.uiRuntime().triggerEvent(0,0);
  const saved=first.exportSave(),before=saved.state.inventory.roots;
  assert(saved.state.pendingDecision.options[0].effect);
  const publicDecision=first.observe().pendingDecision;
  assert(!Object.hasOwn(publicDecision.options[0],'effect'));
  assert(!Object.hasOwn(first.information({scope:'scene'}).scene.pendingDecision.options[0],'effect'));
  data.events.common[0].choices[0].effect.items.roots=99;
  const second=createGame({resources:new GameResources(data)});second.importSave(saved);
  const decision=second.observe().pendingDecision;
  act(second,'choice.select',{decisionId:decision.decisionId,optionId:decision.options[0].optionId});
  assert.equal(second.observe().player.inventory.roots,before+2);

  const camp=createGame({resources});const seed=camp.exportSave();seed.state.player.hp=10;seed.state.hunger=40;camp.importSave(seed);
  camp.uiRuntime().showCampfire();const campSave=camp.exportSave();
  data.events.camp[0].hp=99;data.events.camp[0].hunger=99;
  const restored=createGame({resources:new GameResources(data)});restored.importSave(campSave);
  const choice=restored.observe().pendingDecision;
  act(restored,'choice.select',{decisionId:choice.decisionId,optionId:choice.options[0].optionId});
  assert.equal(restored.observe().player.hp,14);assert.equal(restored.observe().player.hunger,47);
});

test('malformed serialized effects fail before replacing the journey',()=>{
  const game=createGame({resources});game.uiRuntime().triggerEvent(0,0);
  const before=game.exportSave(),bad=structuredClone(before);
  bad.state.pendingDecision.options[0].effect={items:{roots:-10}};
  assert.throws(()=>game.importSave(bad),{code:'INVALID_SAVE'});assert.deepEqual(game.exportSave(),before);
});

test('boss snapshots with ordinary greater-than signs in dossier text round-trip',()=>{
  const game=createGame({resources});game.uiRuntime().startBattle('B');
  const save=game.exportSave();assert(save.state.battle.enemy.pattern.some(t=>t.includes('>')));
  assert.doesNotThrow(()=>game.importSave(save));
  assert.deepEqual(game.exportSave().state.battle.lockedIntents,save.state.battle.lockedIntents);
});
