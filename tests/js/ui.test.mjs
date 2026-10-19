import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDOM} from './helpers/minidom.mjs';
import {resources,createHumanGame as createGame,loadHuman} from './helpers/resources.mjs';
import {mountUI} from '../../web/src/ui/index.js';

import {startBattle} from './helpers/battle.mjs';
// No new dependency is required. Browser/e2e tests remain the visual authority.
test('preserved UI renders, dispatches actions, and stays read-only', async () => {
  const document = createDOM(fs.readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8'));
  globalThis.document = document;
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 1100;
  globalThis.matchMedia = () => ({matches:true});
  const $ = id => document.getElementById(id);
  const game = createGame();
  const initial = game.exportSave();
  const ui = mountUI(game);
  try {
    assert.deepEqual(game.exportSave(), initial, 'mounting must not change state');
    assert.equal(document.querySelectorAll('.cell').length, 209);
    assert.equal($('coord').textContent, '0, 0');
    assert.equal($('worldLevel').textContent, '1');

    startBattle(game);ui.render();
    assert.equal(game.observe().phase, 'battle.planning');
    assert.equal($('trainBtn'), null);
    assert.equal($('fleeBtn'), null);
    assert.equal($('battle').classList.contains('active'), true);
    for (const id of ['basic_attack','basic_guard','basic_attack']) {
      await document.querySelector(`[data-action="${id}"]`).onclick();
    }
    assert.deepEqual(game.observe().battle.plan, ['basic_attack','basic_guard','basic_attack']);
    assert.match($('planStatus').textContent, /已安排 3/);
    const planned = game.exportSave();
    ui.render();
    ui.render();
    assert.deepEqual(game.exportSave(), planned, 'preview and rendering must not change state');
    await $('resolvePlanBtn').onclick();
    assert.equal(game.observe().battle.turn, 4);
    assert.equal($('turn').textContent, '4');
    assert.match($('combatAnalysis').textContent, /上一批结算/);
    assert.equal(document.querySelectorAll('.settlement-row').length, 3);
    loadHuman(game,initial);
    assert.equal(game.observe().phase, 'world.ready');
    assert.equal($('world').classList.contains('active'), true);

    $('bookBtn').onclick();
    assert.equal($('bookOverlay').classList.contains('show'), true);
    assert.equal(document.querySelectorAll('.book-card').length, 8);
    $('closeBookBtn').onclick();
    $('newRunBtn').onclick();
    assert.equal(document.querySelectorAll('.class-card').length, 4);
    $('closeClassBtn').onclick();
    $('atlasBtn').onclick();
    assert.equal($('atlasOverlay').classList.contains('show'), true);
    assert.ok($('atlasSvg').querySelectorAll('rect').length > 1);
    $('closeAtlasBtn').onclick();

    const neighbor = game.observe().world.neighbors.find(n => n.legal);
    await document.querySelector(`.cell[data-x="${neighbor.x}"][data-y="${neighbor.y}"]`).onclick();
    assert.equal($('coord').textContent, `${neighbor.x}, ${neighbor.y}`);
    game.control('agent');
    assert.equal($('harvestBtn').disabled, true);
    assert.equal($('controlMode').textContent, 'Agent');
    assert.equal($('takeoverBtn').style.display, 'block');
    const revision = game.observe().revision;
    await $('harvestBtn').onclick();
    assert.equal(game.observe().revision, revision);
    game.control('human');
    assert.equal($('controlMode').textContent, '人工');

    const reward = game.exportSave();
    reward.state.pendingRewards = 1;
    reward.state.pendingDecision = {
      decisionId:'test-reward', kind:'reward', title:'升级奖励', text:'选择构筑', cancelable:false,
      options:[{optionId:'heal', label:'愈合', description:'恢复生命', targetLevel:1, available:true}],
    };
    loadHuman(game,reward);
    assert.equal($('rewardOverlay').classList.contains('show'), true);
    await $('choiceGrid').childNodes[0].onclick();
    assert.equal(game.observe().player.skills.heal, 1);
    assert.equal($('rewardOverlay').classList.contains('show'), false);

    const camp = game.exportSave();
    let campCell = null;
    for (let y=-20;y<=20&&!campCell;y++) for (let x=-20;x<=20;x++) {
      if (game.uiRuntime().tileAt(x,y)==='C') {campCell={x,y};break;}
    }
    assert.ok(campCell);
    Object.assign(camp.state,campCell);
    camp.state.visited.push(`${campCell.x},${campCell.y}`);
    camp.state.discovered.push(`${campCell.x},${campCell.y}`);
    loadHuman(game,camp);
    await $('campBtn').onclick();
    assert.equal($('eventOverlay').classList.contains('show'), true);
    assert.equal(game.observe().pendingDecision.kind, 'camp');
    await $('eventChoices').childNodes.at(-1).onclick();
    assert.equal(game.observe().pendingDecision, null);
    await $('campBtn').onclick();
    await $('eventChoices').childNodes[0].onclick();
    assert.equal(game.observe().pendingDecision, null);
    assert.equal($('campBtn').disabled, true);

    startBattle(game);ui.render();
    const hidden = game.exportSave();
    hidden.state.battle.lockedIntents[0].hidden = true;
    hidden.state.battle.lockedIntents[2].hidden = true;
    hidden.state.battle.hiddenIntentIndex = 2;
    loadHuman(game,hidden);
    assert.equal(document.querySelectorAll('.hidden-intent').length, 2, 'all hidden intents stay hidden');

    let stored;
    const calls = [];
    game.setConnectionStatus('online');
    globalThis.fetch = async (url, options) => {
      calls.push([url,JSON.parse(options.body)]);
      if (url === '/api/v1/saves/manual') stored=game.exportSave();
      if (url === '/api/v1/saves/manual/load') game.importSave(stored);
      if (url === '/api/owner/control') game.control(JSON.parse(options.body));
      return {ok:true,status:200,json:async()=>({ok:true})};
    };
    await $('localSaveBtn').onclick();
    assert.ok(stored.state.battle);
    await $('localLoadBtn').onclick();
    assert.equal(game.observe().battle.battleId, stored.state.battle.id);
    assert.equal(game.getControl(), 'agent');
    assert.equal($('controlMode').textContent, 'Agent');
    assert.equal($('harvestBtn').disabled, true);
    await $('agentControlBtn').onclick();
    await $('takeoverBtn').onclick();
    assert.equal(game.getControl(), 'human');
    assert.deepEqual(calls.map(call=>call[0]), ['/api/v1/saves/manual','/api/v1/saves/manual/load','/api/owner/control','/api/owner/control']);
    assert.deepEqual(calls[2][1], {mode:'agent'});
    assert.deepEqual(calls[3][1], {mode:'human'});
    loadHuman(game,initial);
  } finally {
    ui.destroy();
  }
});

const actionPayload=(game,plan)=>({battleId:game.observe().battle.battleId,batchId:game.observe().battle.batchId,plan});

function animatedUI(t, prepare) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const document = createDOM(fs.readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8'));
  globalThis.document = document;
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 1100;
  globalThis.matchMedia = () => ({matches:false});
  const game = createGame();
  startBattle(game);
  if (prepare) {
    const save = game.exportSave();prepare(save.state);loadHuman(game,save);
  }
  const ui = mountUI(game);
  t.after(() => ui.destroy());
  const $ = id => document.getElementById(id);
  const commit = plan => {
    game.control('agent');
    const o=game.observe(),b=o.battle;
    const command={sessionId:o.sessionId,runId:o.runId,epoch:o.epoch,expectedRevision:o.revision,commandId:'animation-test',type:'battle.commit',payload:{battleId:b.battleId,batchId:b.batchId,plan}};
    const result=game.act(command);
    return {command,result};
  };
  return {document,game,ui,$,commit};
}

test('Agent control preserves availability and animates checkpoints before revealing the next batch', t => {
  const {document,game,ui,$,commit}=animatedUI(t);
  const {command,result}=commit(['basic_attack','basic_guard','basic_attack']);
  const final=game.observe(),saved=game.exportSave();
  assert.equal(final.battle.turn,4,'rules settle immediately');
  assert.equal($('ehp').textContent,'9','display starts from the previous decision boundary');
  assert.equal($('turn').textContent,'1');
  assert.equal($('resolvePlanBtn').disabled,true);
  assert.equal($('resolvePlanBtn').dataset.unavailable,'false');
  assert.equal($('resolvePlanBtn').dataset.controlLocked,'true');
  const revision=final.revision;
  assert.deepEqual(game.act(command),result);
  ui.render();
  assert.equal($('ehp').textContent,'9','receipt lookup and rerenders do not replay or skip');
  assert.throws(()=>game.act({...command,commandId:'blocked',expectedRevision:revision,type:'battle.plan.set',payload:{}}),e=>e.code==='BUSY_PRESENTATION');
  t.mock.timers.tick(80);
  assert.equal($('ehp').textContent,'6');
  assert.equal($('php').textContent,'18');
  assert.equal(document.querySelectorAll('.vfx').length,1);
  assert.equal($('playerPlan').querySelectorAll('.playing').length,1);
  t.mock.timers.tick(500);
  assert.equal($('php').textContent,'16');
  t.mock.timers.tick(450);
  assert.equal($('energy').textContent,'3');
  t.mock.timers.tick(250);
  assert.equal($('pblock').textContent,'3');
  assert.match($('timeline').textContent,/TURN 1/,'the displayed batch keeps its original turn labels');
  t.mock.timers.tick(2400);
  assert.equal($('ehp').textContent,String(final.battle.enemy.hp));
  assert.equal($('php').textContent,String(final.player.hp));
  assert.equal($('turn').textContent,'4');
  assert.equal(game.uiRuntime().presentation,null);
  assert.equal(document.querySelectorAll('.vfx,.float').length,0);
  assert.deepEqual(game.exportSave(),saved,'playback never changes authoritative state');
  game.control('human');
  assert.equal($('resolvePlanBtn').disabled,false);
  assert.equal($('resolvePlanBtn').dataset.controlLocked,'false');
});

test('the killing blow plays before leaving battle and showing level-up rewards', t => {
  const {$,game,commit}=animatedUI(t,state=>{
    state.battle.enemy.hp=3;state.battle.enemy.xp=100;
  });
  commit(['basic_attack',null,null]);
  assert.equal(game.observe().phase,'choice.pending');
  assert.equal($('battle').classList.contains('active'),true);
  assert.equal($('rewardOverlay').classList.contains('show'),false);
  t.mock.timers.tick(80);
  assert.equal($('ehp').textContent,'0');
  assert.equal($('php').textContent,'18','a killed enemy never attacks');
  t.mock.timers.tick(500);
  assert.equal($('world').classList.contains('active'),true);
  assert.equal($('rewardOverlay').classList.contains('show'),true);
  assert.equal($('choiceGrid').childNodes[0].dataset.controlLocked,'true');
  assert.equal($('choiceGrid').childNodes[0].dataset.unavailable,'false');
});

test('hidden intents stay hidden until their action is played', t => {
  const {document,$,game,commit}=animatedUI(t,state=>{
    state.player.hp=3;
    state.battle.lockedIntents[2]={id:'heavy',name:'隐秘重劈',dmg:4,hidden:true};
    state.battle.hiddenIntentIndex=2;
  });
  commit(['basic_guard','basic_guard',null]);
  assert.equal(document.querySelectorAll('.hidden-intent').length,1);
  t.mock.timers.tick(2480);
  assert.equal(document.querySelectorAll('.hidden-intent').length,1);
  assert(!document.querySelector('#timeline').textContent.includes('隐秘重劈'));
  t.mock.timers.tick(500);
  assert.equal(document.querySelectorAll('.hidden-intent').length,0);
  assert.match($('timeline').textContent,/隐秘重劈/);
  assert.equal($('php').textContent,'1');
  assert.equal(game.observe().player.hp,1);
});

test('defeat plays lethal damage before showing the game-over summary', t => {
  const {$,game,commit}=animatedUI(t,state=>{
    state.player.hp=1;
  });
  commit([null,null,null]);
  assert.equal(game.observe().phase,'game.over');
  assert.equal(game.observe().player.hp,0);
  assert.equal($('gameOverOverlay').classList.contains('show'),false);
  assert.equal($('battle').classList.contains('active'),true);
  t.mock.timers.tick(580);
  assert.equal($('php').textContent,'0');
  t.mock.timers.tick(450);
  assert.equal($('world').classList.contains('active'),true);
  assert.equal($('worldHpText').textContent,'0/18');
  assert.equal($('gameOverOverlay').classList.contains('show'),true);
  assert.equal(game.uiRuntime().presentation,null);
});

test('Agent-mode load stays clickable and explains takeover before sending any request',async t=>{
  const {$,game}=animatedUI(t),calls=[],living=game.exportSave();
  game.setConnectionStatus('online');game.control('agent');
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    calls.push(path);
    assert.equal(path,'/api/v1/saves/manual/load');
    game.importSave(living);
    return {ok:true,json:async()=>({ok:true})};
  });
  assert.equal($('localLoadBtn').disabled,false);
  await $('localLoadBtn').onclick();
  assert.equal($('toast').textContent,'请人工接管后读档。');
  assert.deepEqual(calls,[]);assert.equal(game.getControl(),'agent');
  game.control('human');await $('localLoadBtn').onclick();
  assert.deepEqual(calls,['/api/v1/saves/manual/load']);
  assert.equal(game.getControl(),'agent');
});

test('game-over restart takes ownership, allows cancel, and starts the selected class',async t=>{
  const {$,game,commit,document}=animatedUI(t,state=>{state.player.hp=1;});
  const living=game.exportSave(),calls=[];
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    calls.push([path,JSON.parse(options.body)]);
    assert.equal(path,'/api/owner/control');game.control(JSON.parse(options.body).mode);
    return {ok:true,json:async()=>({ok:true})};
  });
  commit([null,null,null]);t.mock.timers.tick(1200);
  const ended=game.exportSave(),runId=game.observe().runId,meta=game.exportMeta();
  assert.equal($('gameOverOverlay').classList.contains('show'),true);
  assert.match($('runStats').textContent,/世界回合/);
  assert.match($('gameOverCause').textContent,/战斗/);
  assert.equal($('restartRunBtn').disabled,false);
  await $('restartRunBtn').onclick();
  assert.deepEqual(calls,[['/api/owner/control',{mode:'human'}]]);
  assert.equal(game.getControl(),'human');
  assert.equal($('classOverlay').classList.contains('show'),true);
  assert.equal($('gameOverOverlay').classList.contains('show'),false);
  $('closeClassBtn').onclick();
  assert.equal($('gameOverOverlay').classList.contains('show'),true);
  assert.deepEqual(game.exportSave(),ended);
  await $('restartRunBtn').onclick();
  await document.querySelector('[data-class="wanderer"]').onclick();
  assert.equal(game.observe().phase,'world.ready');assert.notEqual(game.observe().runId,runId);
  assert.equal($('gameOverOverlay').classList.contains('show'),false);
  assert.equal(game.getControl(),'human');assert.deepEqual(game.exportMeta(),meta);
  loadHuman(game,ended);assert.equal($('gameOverOverlay').classList.contains('show'),true);
  $('gameOverSaveBtn').onclick();assert.equal($('saveOverlay').classList.contains('show'),true);
  assert.equal($('gameOverOverlay').classList.contains('show'),false);
  $('closeSaveBtn').onclick();assert.equal($('gameOverOverlay').classList.contains('show'),true);
  loadHuman(game,living);assert.equal($('gameOverOverlay').classList.contains('show'),false);
});

test('failed ownership transfer keeps the result page and does not restart',async t=>{
  const {$,game,commit}=animatedUI(t,state=>{state.player.hp=1;});
  commit([null,null,null]);t.mock.timers.tick(1200);const ended=game.exportSave();
  t.mock.method(globalThis,'fetch',async()=>({ok:false,status:503,json:async()=>({error:{message:'bridge offline'}})}));
  await $('restartRunBtn').onclick();
  assert.equal(game.getControl(),'agent');assert.deepEqual(game.exportSave(),ended);
  assert.equal($('gameOverOverlay').classList.contains('show'),true);
  assert.equal($('classOverlay').classList.contains('show'),false);
});

test('a presentation exception restores the final state and releases the action lock', t => {
  const {document,game,$,commit}=animatedUI(t);
  commit(['basic_attack',null,null]);
  const final=game.observe(),create=document.createElement;
  document.createElement=tag=>{if(tag==='div')throw new Error('test effect failure');return create(tag);};
  const logged=t.mock.method(console,'error',()=>{});
  t.mock.timers.tick(80);
  document.createElement=create;
  assert.equal(logged.mock.calls.length,1);
  assert.equal(game.uiRuntime().presentation,null);
  assert.equal($('php').textContent,String(final.player.hp));
  assert.equal($('ehp').textContent,String(final.battle.enemy.hp));
});

for (const end of ['takeover','hidden','load','destroy']) test(`${end} cancels playback and releases its lock`, t => {
  const {document,game,ui,$,commit}=animatedUI(t);
  commit([null,null,null]);
  const final=game.observe();
  t.mock.timers.tick(80);
  if(end==='takeover')game.control('human');
  if(end==='hidden'){document.hidden=true;document.dispatchEvent({type:'visibilitychange'});}
  if(end==='load')loadHuman(game,game.exportSave());
  if(end==='destroy')ui.destroy();
  assert.equal(game.uiRuntime().presentation,null);
  assert.equal(document.querySelectorAll('.vfx,.float').length,0);
  if(end!=='destroy')assert.equal($('php').textContent,String(final.player.hp));
  const saved=game.exportSave();
  t.mock.timers.tick(6000);
  assert.deepEqual(game.exportSave(),saved);
  if(game.getControl()==='agent')game.control('human');
  assert.doesNotThrow(()=>game.humanAct('battle.plan.set',actionPayload(game,[null,null,null])));
});
