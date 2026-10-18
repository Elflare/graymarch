import {createGame} from './core/engine.js';
import {mountUI} from './ui/index.js';
import {connectBridge} from './bridge/client.js';
import {postProgress,startMetaAutosave} from './persistence/meta.js';

const status = message => { document.getElementById('metaSaveStatus').textContent = message; };
try {
  const {meta} = await postProgress('/api/owner/progress/load');
  const game = createGame({meta});
  mountUI(game);
  startMetaAutosave(game, meta, {status});
  connectBridge(game);
  // Deliberately exclude host save, internal runtime, and control capabilities.
  window.graymarch=Object.freeze({observe:game.observe,preview:game.preview,information:game.information,catalog:game.catalog,map:game.map,act:game.act});
} catch (error) {
  status(`局外成长读取失败：${error.message}`);
  const retry = document.getElementById('metaLoadRetry');
  retry.hidden = false;
  retry.onclick = () => location.reload();
}
