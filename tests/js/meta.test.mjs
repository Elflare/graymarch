import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../../web/src/core/engine.js';
import {startMetaAutosave} from '../../web/src/persistence/meta.js';

const empty = () => ({bossWins: 0, bestGrade: 'C', harvests: 0, unlocks: []});
const payload = (game, plan) => {
  const {battleId, batchId} = game.observe().battle;
  return {battleId, batchId, plan};
};

test('startup restores unlocks; old journeys and new runs preserve permanent progress', () => {
  const old = createGame().exportSave();
  const meta = {bossWins: 2, bestGrade: 'S', harvests: 10, unlocks: ['class_arcanist']};
  const game = createGame({meta});
  const restored = game.exportMeta();
  assert(restored.unlocks.includes('class_sentinel'));
  assert(restored.unlocks.includes('class_hunter'));
  game.importSave(old);
  assert.deepEqual(game.exportMeta(), restored);
  game.humanAct('host.newRun', {classId: 'arcanist'});
  assert.equal(game.exportSave().state.classId, 'arcanist');
  assert.deepEqual(game.exportMeta(), restored);
  game.importSave(old);
  assert.deepEqual(game.exportMeta(), restored);
  const bad = structuredClone(old);
  bad.state.meta.harvests = -1;
  const before = game.exportSave();
  assert.throws(() => game.importSave(bad), {code: 'INVALID_META'});
  assert.deepEqual(game.exportSave(), before);
});

test('real boss victory saves immediately; training, preview and unrelated actions do not', async () => {
  const game = createGame(), writes = [];
  const sync = startMetaAutosave(game, game.exportMeta(), {post: async (path, body) => writes.push(body.meta)});
  try {
    await sync.flush();
    game.humanAct('training.start');
    const plan = ['basic_attack', null, null];
    game.preview(payload(game, plan));
    assert.throws(() => game.humanAct('world.move', {direction: 'east'}));
    game.humanAct('battle.commit', payload(game, plan));
    game.humanAct('training.exit');
    await sync.flush();
    assert.equal(writes.length, 0);

    game.humanAct('training.start');
    const save = game.exportSave();
    save.state.training = false;
    save.state.battleOrigin = null;
    save.state.battle.type = 'B';
    save.state.battle.enemy.hp = 1;
    game.importSave(save);
    game.humanAct('battle.commit', payload(game, plan));
    await sync.flush();
    assert.equal(writes.at(-1).bossWins, 1);
    assert(writes.at(-1).unlocks.includes('class_arcanist'));
    assert(writes.at(-1).unlocks.includes('time_tactics'));
    assert.notEqual(writes.at(-1).bestGrade, 'C');
    const refreshed = createGame({meta: writes.at(-1)});
    assert.deepEqual(refreshed.exportMeta(), game.exportMeta());
  } finally { sync.dispose(); }
});

test('autosave serializes changes arriving while a write is pending', async () => {
  const game = createGame(), writes = [], releases = [];
  const sync = startMetaAutosave(game, game.exportMeta(), {
    post: (path, body) => { writes.push(body.meta); return new Promise(resolve => releases.push(resolve)); },
  });
  try {
    await sync.flush();
    const save = game.exportSave();
    save.state.meta.harvests = 9;
    game.importSave(save);
    assert.equal(writes.length, 1);
    save.state.meta.harvests = 10;
    game.importSave(save);
    assert.equal(writes.length, 1);
    releases.shift()({});
    await Promise.resolve();
    assert.equal(writes.length, 2);
    assert(writes[1].unlocks.includes('class_hunter'));
    releases.shift()({});
    await sync.flush();
    game.setConnectionStatus('online');
    await sync.flush();
    assert.equal(writes.length, 2);
  } finally { sync.dispose(); }
});

test('failed writes retry and report success only after persistence succeeds', async () => {
  const game = createGame(), messages = [], attempts = [];
  let succeeded;
  const saved = new Promise(resolve => { succeeded = resolve; });
  const sync = startMetaAutosave(game, empty(), {
    retryMs: 1,
    status: message => { messages.push(message); if (message === '局外成长已自动保存') succeeded(); },
    post: async (path, body) => {
      attempts.push(body.meta);
      if (attempts.length === 1) throw new Error('disk unavailable');
    },
  });
  try {
    const save = game.exportSave();
    save.state.meta.harvests = 10;
    game.importSave(save);
    await saved;
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert(messages.some(message => message.includes('保存失败')));
    assert.equal(messages.at(-1), '局外成长已自动保存');
  } finally { sync.dispose(); }
});
