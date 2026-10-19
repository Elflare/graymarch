import {loadHuman} from './resources.mjs';

// Only tests can construct this fixed encounter; production has no practice API.
export function startBattle(game) {
  const mode=game.getControl(),R=game.uiRuntime();
  R.startBattle('E');
  const save=game.exportSave(),e={...R.enemyDefs.skeleton,...R.resources.enemy('skeleton',{atk:2}),id:'skeleton',maxHp:9,hp:9,atk:2,baseArmor:1,armor:1,block:0,exposed:0,xp:0};
  save.state.battle.enemy=JSON.parse(JSON.stringify(e));
  save.state.battle.lockedIntents=Array.from({length:3},(_,i)=>({...e.ai(i+1,e),hidden:false}));
  if(mode==='human')loadHuman(game,save);else game.importSave(save);
}
