import fs from 'node:fs/promises';
import {GameResources} from '../../../web/src/content/resources.js';
import {createGame} from '../../../web/src/core/engine.js';

export const readResource = async file => JSON.parse(await fs.readFile(new URL('../../../web/data/' + file, import.meta.url), 'utf8'));
export const resources = await GameResources.load(readResource);
export const dataCopy = () => structuredClone(resources.data);

// Legacy gameplay tests explicitly exercise the human controller. Control-mode
// and startup tests use the real factory, whose default is Agent.
export function createHumanGame(options = {}) {
  const game = createGame({resources, ...options});
  game.control('human');
  return game;
}
export function loadHuman(game, save) {
  const result = game.importSave(save);
  game.control('human');
  return result;
}
