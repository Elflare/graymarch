const ranks = ['C', 'B', 'A', 'S'];
const unlockIds = new Set(['class_sentinel', 'class_arcanist', 'class_hunter', 'interrupt_tactics', 'time_tactics']);

export function validateMeta(meta) {
  if (!meta || !ranks.includes(meta.bestGrade) ||
      ['bossWins', 'harvests'].some(key => !Number.isSafeInteger(meta[key]) || meta[key] < 0) ||
      !Array.isArray(meta.unlocks) || meta.unlocks.some(id => !unlockIds.has(id))) {
    throw Object.assign(new Error('局外成长数据无效'), {code: 'INVALID_META'});
  }
  return meta;
}

export function mergeMeta(current, incoming) {
  validateMeta(incoming);
  return {
    bossWins: Math.max(current.bossWins, incoming.bossWins),
    bestGrade: ranks[Math.max(ranks.indexOf(current.bestGrade), ranks.indexOf(incoming.bestGrade))],
    harvests: Math.max(current.harvests, incoming.harvests),
    unlocks: [...new Set([...current.unlocks, ...incoming.unlocks])].sort(),
  };
}

export async function postProgress(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), keepalive: true,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '局外成长存取失败');
  return result;
}

export function startMetaAutosave(game, persisted, {
  post = postProgress, status = () => {}, retryMs = 1500,
} = {}) {
  const signature = meta => JSON.stringify({...meta, unlocks: [...meta.unlocks].sort()});
  let saved = signature(persisted), running = null, retry = null, stopped = false;
  function flush() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    clearTimeout(retry);
    retry = null;
    running = (async () => {
      while (!stopped) {
        const meta = game.exportMeta(), next = signature(meta);
        if (next === saved) return;
        status('局外成长保存中…');
        try {
          await post('/api/owner/progress', {meta});
          saved = next;
          status('局外成长已自动保存');
        } catch (error) {
          status(`局外成长保存失败，正在重试：${error.message}`);
          retry = setTimeout(flush, retryMs);
          return;
        }
      }
    })().finally(() => {
      running = null;
      if (!stopped && !retry && signature(game.exportMeta()) !== saved) flush();
    });
    return running;
  }
  const unsubscribe = game.subscribe(flush);
  status('局外成长已恢复 · 自动保存');
  flush();
  return {flush, dispose() { stopped = true; clearTimeout(retry); unsubscribe(); }};
}
