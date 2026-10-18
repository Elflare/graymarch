import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../../web/src/core/engine.js';
function send(g,type,payload={}){let o=g.observe();return g.humanAct(type,payload);}
function battlePayload(g,plan){let b=g.observe().battle;return {plan,battleId:b.battleId,batchId:b.batchId};}
test('queries are pure and unknown coordinates are absent',()=>{let g=createGame(),before=g.exportSave();for(let i=0;i<3;i++){g.observe();g.information();g.catalog();g.map();}assert.deepEqual(g.exportSave(),before);assert.equal(g.observe().world.map.length,13);assert(!JSON.stringify(g.observe()).includes('rng'));});
test('move, plan editing, empty commit and training turn counts',()=>{let g=createGame();send(g,'world.move',{direction:'east'});assert.equal(g.observe().decisionTurn,1);send(g,'training.start');assert.equal(g.observe().decisionTurn,1);send(g,'battle.plan.set',battlePayload(g,[null,null,null]));assert.equal(g.observe().decisionTurn,1);send(g,'battle.commit',battlePayload(g,[null,null,null]));assert.equal(g.observe().decisionTurn,2);send(g,'training.exit');assert.equal(g.observe().decisionTurn,2);});
test('invalid commands rollback and retries execute once',()=>{let g=createGame();g.control('agent');let o=g.observe(),p={sessionId:o.sessionId,runId:o.runId,epoch:o.epoch,expectedRevision:o.revision,commandId:'move',type:'world.move',payload:{direction:'east'}};let r=g.act(p);assert.deepEqual(g.act(p),r);assert.equal(g.observe().decisionTurn,1);assert.throws(()=>g.act({...p,payload:{direction:'west'}}),e=>e.code==='IDEMPOTENCY_CONFLICT');let before=g.exportSave();assert.throws(()=>g.act({...p,commandId:'other'}),e=>e.code==='STALE_REVISION');assert.deepEqual(g.exportSave(),before);});
test('world RNG and training save roundtrip restore complete simulation',()=>{let g=createGame();send(g,'inventory.eat',{itemId:'berries'});let save=g.exportSave();let h=createGame();h.importSave({save});assert.equal(h.exportSave().state.rng,save.state.rng);send(g,'training.start');send(g,'battle.plan.set',battlePayload(g,['basic_guard','basic_attack',null]));let bsave=g.exportSave();h.importSave({save:bsave});assert.deepEqual(h.observe().battle.plan,['basic_guard','basic_attack',null]);send(h,'battle.commit',battlePayload(h,['basic_guard','basic_attack',null]));send(h,'training.exit');assert.deepEqual(h.exportSave().state.player,save.state.player);});
test('preview uses actual shared settlement without state changes',()=>{let g=createGame();send(g,'training.start');let before=g.exportSave(),p=battlePayload(g,['basic_guard','basic_attack',null]);let f=g.preview(p);assert.deepEqual(g.exportSave(),before);send(g,'battle.commit',p);let after=g.observe();if(after.battle){assert.equal(after.player.hp,f.p.hp);assert.equal(after.player.energy,f.p.energy);assert.equal(after.battle.enemy.hp,f.e.hp);}});
test('sync delta replacement matches fresh compact projection',()=>{let g=createGame(),a=g.observe({format:'sync'});send(g,'world.move',{direction:'east'});let d=g.observe({format:'sync',baseRevision:a.revision}),fresh=g.observe();assert.equal(d.kind,'delta');let merged={...a,...d.set};for(let[k,v]of Object.entries(d.set))assert.deepEqual(merged[k],fresh[k]);});
test('map pages keep original snapshot revision',()=>{let g=createGame(),a=g.map({limit:2});send(g,'world.move',{direction:'east'});let b=g.map({snapshotId:a.snapshotId,cursor:a.cursor,limit:2});assert.equal(b.revision,a.revision);assert.notDeepEqual(a.cells,b.cells);});
test('old saves and malformed input fail before mutation',()=>{let g=createGame(),before=g.exportSave();assert.throws(()=>g.importSave({version:31,player:{}}),e=>e.code==='INVALID_SAVE');let malformed=g.exportSave();malformed.state.inventory.berries=-1;assert.throws(()=>g.importSave(malformed));assert.deepEqual(g.exportSave(),before);});
test('compact contexts yield local map deltas and battle frame omits unrelated inventory/map',()=>{let g=createGame();let first=g.observe({contextId:'test'});assert(first.baseline);send(g,'world.move',{direction:'east'});let next=g.observe({contextId:'test'});assert.equal(next.baseline,false);assert(next.world.mapDelta);assert.equal(next.world.map,undefined);send(g,'training.start');let b=g.observe();assert.equal(b.world.map,undefined);assert.equal(b.player.inventory,undefined);});
test('combined information pagination freezes player and map revision together',()=>{let g=createGame(),a=g.information({scope:['player','discovered_map'],limit:2});send(g,'world.move',{direction:'east'});let b=g.information({scope:['player','discovered_map'],snapshotId:a.snapshotId,cursor:a.cursor,limit:2});assert.equal(b.revision,a.revision);assert.deepEqual(b.player,a.player);assert.equal(b.map.revision,a.map.revision);});
test('HTTP definition cache accepts serialized JSON and rejects malformed input',()=>{let g=createGame(),a=g.observe(),known=Object.fromEntries(a.definitions.map(d=>[d.id,`${d.version}:${d.level||0}`]));assert.equal(g.observe({knownDefinitionVersions:JSON.stringify(known)}).definitions.length,0);assert.throws(()=>g.observe({knownDefinitionVersions:'broken'}),e=>e.code==='INVALID_REQUEST');});

test('presentation checkpoints are transient and busy rejects never advance the game', t => {
 t.mock.timers.enable({apis:['Date'],now:1000});
 const g=createGame();send(g,'training.start');g.control('agent');
 const o=g.observe(),command={sessionId:o.sessionId,runId:o.runId,epoch:o.epoch,expectedRevision:o.revision,commandId:'animated',type:'battle.commit',payload:battlePayload(g,['basic_attack','basic_guard','basic_attack'])};
 const result=g.act(command),trace=g.uiRuntime().presentation;
 assert.equal(trace.frames.length,3);
 assert.equal(trace.frames[0].afterPlayer.enemy.hp,6);
 assert.equal(trace.frames[0].afterEnemy.player.hp,16);
 assert.equal(trace.frames[0].afterRound.player.energy,3);
 for(const value of [result,g.observe(),g.information(),g.exportSave()])assert(!JSON.stringify(value).includes('afterPlayer'));
 g.startPresentation(trace.id);
 const saved=g.exportSave();
 assert.throws(()=>g.act({...command,commandId:'next',expectedRevision:g.observe().revision}),e=>e.code==='BUSY_PRESENTATION'&&e.details.retryAfterMs>0);
 assert.deepEqual(g.act(command),result,'idempotent receipt remains available while playing');
 assert.deepEqual(g.exportSave(),saved);
 g.finishPresentation('older-playback');
 assert.throws(()=>g.humanAct('training.exit'),e=>e.code==='CONTROLLER_REQUIRED');
 assert.throws(()=>g.act({...command,commandId:'still-busy',expectedRevision:g.observe().revision}),e=>e.code==='BUSY_PRESENTATION');
 t.mock.timers.tick(5000);
 assert.doesNotThrow(()=>g.act({...command,commandId:'after-deadline',expectedRevision:g.observe().revision,payload:battlePayload(g,[null,null,null])}));
 g.startPresentation(g.uiRuntime().presentation.id);
 g.control('human');
 assert.equal(g.uiRuntime().presentation,null);
 assert.doesNotThrow(()=>g.humanAct('training.exit'));
});

test('loading a stable save clears playback without persisting its lock',()=>{
 const g=createGame();send(g,'training.start');send(g,'battle.commit',battlePayload(g,[null,null,null]));
 g.startPresentation(g.uiRuntime().presentation.id);
 const save=g.exportSave();g.importSave(save);
 assert.equal(g.uiRuntime().presentation,null);
 assert.doesNotThrow(()=>g.humanAct('training.exit'));
});
