import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createGame} from '../../web/src/core/engine.js';
import {resources} from './helpers/resources.mjs';
import {migrationFingerprints} from './helpers/migration.mjs';

test('resource migration preserves the original map, enemy intents, harvest and every valid skill level',async()=>{
  const expected=JSON.parse(await fs.readFile(new URL('./fixtures/resources-v1.json',import.meta.url),'utf8'));
  const actual=migrationFingerprints(options=>createGame({resources,...options}));
  assert.equal(actual.map,expected.map,'6,561 map cells');
  assert.equal(actual.intents,expected.intents,'all enemy behaviors and HP phases');
  assert.equal(actual.harvest,expected.harvest,'all terrain and forager levels');
  for(const [id,hash]of Object.entries(expected.combat))assert.equal(actual.combat[id],hash,id);
});

test('pre-resource saves restore world, battle and pending event/camp/reward decisions',async()=>{
  const saves=JSON.parse(await fs.readFile(new URL('./fixtures/saves-v1.json',import.meta.url),'utf8'));
  for(const[kind,save]of Object.entries(saves)){
    const game=createGame({resources});game.importSave(save);
    assert.equal(game.getControl(),'agent');
    const restored=game.exportSave().state;
    for(const key of ['player','inventory','rng','worldTurn','battle','pendingDecision'])assert.deepEqual(restored[key],save.state[key],`${kind}: ${key}`);
    const f=game.observe(),d=f.pendingDecision;
    const type=d?'choice.select':kind==='battle'?'training.exit':'world.move';
    const payload=d?{decisionId:d.decisionId,optionId:d.options[0].optionId}:kind==='battle'?{}:{direction:'east'};
    assert.doesNotThrow(()=>game.act({sessionId:f.sessionId,runId:f.runId,epoch:f.epoch,expectedRevision:f.revision,commandId:'legacy-'+kind,type,payload}));
  }
});
