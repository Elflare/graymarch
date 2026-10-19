import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDOM} from './helpers/minidom.mjs';
import {readResource} from './helpers/resources.mjs';

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
  globalThis.fetch = async (path,options) => {
    if(path instanceof URL && path.pathname.includes('/data/'))return {ok:true,json:()=>readResource(path.pathname.split('/').at(-1))};
    return fetch(path,options);
  };
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
  assert.equal($('controlMode').textContent, 'Agent');
  assert.equal($('trainBtn').disabled, true);
  assert.match($('metaSaveStatus').textContent, /已恢复/);
  $('newRunBtn').onclick();
  assert.equal(document.querySelectorAll('.class-card.locked').length, 0);
});

test('failed startup leaves gameplay unmounted and offers retry', async t => {
  const $ = browser(t, async () => ({ok: false, json: async () => ({error: {message: 'damaged meta'}})}));
  await import('../../web/src/main.js?failed');
  assert.equal(window.graymarch, undefined);
  assert.equal($('trainBtn').onclick, undefined);
  assert.match($('metaSaveStatus').textContent, /启动失败.*damaged meta/);
  assert.equal($('metaLoadRetry').hidden, false);
  assert.equal(typeof $('metaLoadRetry').onclick, 'function');
});

for(const scenario of ['missing','syntax','invalid'])test('resource '+scenario+' failure prevents gameplay and bridge startup',async t=>{
  let progressReads=0,sockets=0;
  const $=browser(t,async()=>{progressReads++;return {ok:true,json:async()=>({meta:{bossWins:0,bestGrade:'C',harvests:0,unlocks:[]}})};});
  globalThis.WebSocket=class{constructor(){sockets++;}};
  const fetch=globalThis.fetch;
  globalThis.fetch=async(path,options)=>{
    if(path instanceof URL&&path.pathname.endsWith('/classes.json')){
      if(scenario==='missing')return {ok:false,status:404};
      if(scenario==='syntax')return {ok:true,json:async()=>{throw new SyntaxError('broken JSON');}};
      const data=await readResource('classes.json');data.wanderer.base.hp=-1;
      return {ok:true,json:async()=>data};
    }
    return fetch(path,options);
  };
  await import('../../web/src/main.js?resource-'+scenario);
  assert.equal(window.graymarch,undefined);assert.equal($('trainBtn').onclick,undefined);
  assert.equal(progressReads,0);assert.equal(sockets,0);
  assert.match($('metaSaveStatus').textContent,/启动失败.*classes.json/);
  if(scenario==='invalid')assert.match($('metaSaveStatus').textContent,/wanderer.base.hp/);
  assert.equal($('metaLoadRetry').hidden,false);
});
