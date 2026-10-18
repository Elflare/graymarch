import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDOM} from './helpers/minidom.mjs';

function browser(t, fetch) {
  const names = ['document', 'window', 'location', 'fetch', 'WebSocket', 'innerWidth', 'innerHeight', 'matchMedia'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.document = createDOM(fs.readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8'));
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  globalThis.location = {host: '127.0.0.1:8765', protocol: 'http:', reload() {}};
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 1100;
  globalThis.matchMedia = () => ({matches: true});
  globalThis.fetch = fetch;
  globalThis.WebSocket = class { readyState = 0; };
  return id => document.getElementById(id);
}

test('page startup restores metaprogression before mounting or connecting', async t => {
  let finishLoad;
  const loading = new Promise(resolve => { finishLoad = resolve; });
  const $ = browser(t, async path => {
    assert.equal(path, '/api/owner/progress/load');
    return loading;
  });
  const startup = import('../../web/src/main.js?restored');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.graymarch, undefined);
  assert.equal($('trainBtn').onclick, undefined);
  const meta = {bossWins: 1, bestGrade: 'S', harvests: 10,
    unlocks: ['class_arcanist', 'class_hunter', 'class_sentinel', 'interrupt_tactics', 'time_tactics']};
  finishLoad({ok: true, json: async () => ({meta})});
  await startup;
  assert(window.graymarch);
  assert.equal(typeof $('trainBtn').onclick, 'function');
  assert.match($('metaSaveStatus').textContent, /已恢复/);
  $('newRunBtn').onclick();
  assert.equal(document.querySelectorAll('.class-card.locked').length, 0);
});

test('failed startup leaves gameplay unmounted and offers retry', async t => {
  const $ = browser(t, async () => ({ok: false, json: async () => ({error: {message: 'damaged meta'}})}));
  await import('../../web/src/main.js?failed');
  assert.equal(window.graymarch, undefined);
  assert.equal($('trainBtn').onclick, undefined);
  assert.match($('metaSaveStatus').textContent, /读取失败.*damaged meta/);
  assert.equal($('metaLoadRetry').hidden, false);
  assert.equal(typeof $('metaLoadRetry').onclick, 'function');
});
