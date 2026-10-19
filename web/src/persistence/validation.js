import {SET_FIELDS} from '../core/state.js';
// Effects are private, serialized decision snapshots. Validate them once on
// import; selecting a decision consumes this checked descriptor directly.
function validateEffect(effect,R){
 const invalid=()=>{throw R.error('INVALID_SAVE','事件或营火效果无效');};
 if(!effect||typeof effect!=='object'||Array.isArray(effect))invalid();
 for(const key of ['hp','hunger','xp'])if(effect[key]!==undefined&&!Number.isFinite(effect[key]))invalid();
 if(effect.hunger!==undefined&&!Number.isSafeInteger(effect.hunger))invalid();
 if(effect.xp!==undefined&&(!Number.isSafeInteger(effect.xp)||effect.xp<0))invalid();
 if(effect.items){if(typeof effect.items!=='object'||Array.isArray(effect.items))invalid();for(const[id,n]of Object.entries(effect.items))if(!R.foodDefs[id]||!Number.isSafeInteger(n)||n<0)invalid();}
 if(effect.buff){const b=effect.buff;if(typeof b.id!=='string'||typeof b.name!=='string'||typeof b.desc!=='string'||!Number.isSafeInteger(b.turns)||b.turns<1)invalid();for(const key of ['attack','guard','hungerCost'])if(b[key]!==undefined&&!Number.isFinite(b[key]))invalid();}
 if(effect.battle!==undefined&&!['E','X','B'].includes(effect.battle))invalid();
 if(effect.message!==undefined&&typeof effect.message!=='string')invalid();
 if(effect.extra)validateEffect(effect.extra,R);
}
 export function validateSave(save,R){if(save?.format!=='graymarch-save'||save.schemaVersion!==1||!save.state)throw R.error('INVALID_SAVE','仅支持新版完整存档');let s=save.state;let walk=(v,d=0)=>{if(d>30)throw R.error('INVALID_SAVE','存档层级过深');if(typeof v==='number'&&!Number.isFinite(v))throw R.error('INVALID_SAVE','非有限数值');if(typeof v==='string'&&(v.length>20000||v.includes('<')))throw R.error('INVALID_SAVE','无效文本');if(v&&typeof v==='object')for(let[k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw R.error('INVALID_SAVE','危险字段');walk(x,d+1);}};walk(s);
 for(let k of ['x','y','epoch','revision','decisionTurn','sequence','rng','worldTurn','level','xp','sigils','hunger','maxHunger','pendingRewards'])if(!Number.isSafeInteger(s[k])||Math.abs(s[k])>(k==='rng'?4294967295:1e9)||(k!=='x'&&k!=='y'&&s[k]<0))throw R.error('INVALID_SAVE',`无效字段 ${k}`);
 for(let k of SET_FIELDS)if(!Array.isArray(s[k])||s[k].length>100000||s[k].some(v=>typeof v!=='string'||!/^\-?\d+,\-?\d+$/.test(v)))throw R.error('INVALID_SAVE',`无效地图 ${k}`);
 if(!R.classDefs[s.classId]||!s.player||!s.meta||!Array.isArray(s.meta.unlocks)||!Array.isArray(s.buffs)||!s.inventory)throw R.error('INVALID_SAVE','缺少角色数据');
 for(let k of ['hp','maxHp','attack','energy','maxEnergy','block'])if(!Number.isFinite(s.player[k])||s.player[k]<0||s.player[k]>100000)throw R.error('INVALID_SAVE',`角色数值无效 ${k}`);
  for(let group of ['skills','passives','equipment']){if(!s.player[group]||typeof s.player[group]!=='object')throw R.error('INVALID_SAVE','构筑无效');for(let[id,n]of Object.entries(s.player[group]))if(!R.rewardPool[id]||!Number.isInteger(n)||n<0||n>R.rewardPool[id].max)throw R.error('INVALID_SAVE','构筑等级无效');}
 if(s.player.cooldowns!==undefined){if(!s.player.cooldowns||typeof s.player.cooldowns!=='object'||Array.isArray(s.player.cooldowns))throw R.error('INVALID_SAVE','冷却数据无效');for(let[id,n]of Object.entries(s.player.cooldowns))if(!s.player.skills[id]||!Number.isInteger(n)||n<1||n>(R.activeSkills[id]?.cooldown||0))throw R.error('INVALID_SAVE','冷却步数无效');}
 for(let id of Object.keys(R.foodDefs))if(!Number.isInteger(s.inventory[id])||s.inventory[id]<0)throw R.error('INVALID_SAVE','背包无效');
 if(typeof s.inBattle!=='boolean'||typeof s.training!=='boolean'||typeof s.runId!=='string'||s.level<1||s.hunger>s.maxHunger||s.player.hp>s.player.maxHp||s.player.energy>s.player.maxEnergy)throw R.error('INVALID_SAVE','状态不变量无效');
 if(!!s.inBattle!==!!s.battle)throw R.error('INVALID_SAVE','战斗阶段不一致');if(s.battle){let b=s.battle;if(!R.enemyDefs[b.enemy?.id]||!Array.isArray(b.plan)||b.plan.length!==3||!Array.isArray(b.lockedIntents)||b.lockedIntents.length!==3||!Array.isArray(b.carryIntents)||!b.stats||!b.id||!b.batchId)throw R.error('INVALID_SAVE','战斗数据不完整');if(s.training&&!s.battleOrigin?.player)throw R.error('INVALID_SAVE','缺少训练快照');}
 if(s.battle){for(let k of ['hp','maxHp','atk','baseArmor','block'])if(!Number.isFinite(s.battle.enemy[k])||s.battle.enemy[k]<0)throw R.error('INVALID_SAVE','敌人数值无效');for(let a of [...s.battle.lockedIntents,...s.battle.carryIntents])if(!a||!['attack','heavy','guard','venom','drain','wait'].includes(a.id)||typeof a.name!=='string')throw R.error('INVALID_SAVE','敌人意图无效');for(let id of s.battle.plan)if(id!==null&&!['basic_attack','basic_guard',...Object.keys(s.player.skills)].includes(id))throw R.error('INVALID_SAVE','战斗计划无效');}
 for(let b of s.buffs)if(!b||typeof b.id!=='string'||!Number.isInteger(b.turns)||b.turns<1)throw R.error('INVALID_SAVE','状态效果无效');
 if(s.pendingDecision&&(!['camp','event','reward','victory'].includes(s.pendingDecision.kind)||!Array.isArray(s.pendingDecision.options)||!s.pendingDecision.decisionId))throw R.error('INVALID_SAVE','选择数据无效');
 if(s.pendingDecision){let d=s.pendingDecision;if(!d.options.length||d.options.length>10||d.options.some(o=>!o||typeof o.optionId!=='string'||typeof o.label!=='string'||typeof o.available!=='boolean'))throw R.error('INVALID_SAVE','选择选项无效');if(new Set(d.options.map(o=>o.optionId)).size!==d.options.length)throw R.error('INVALID_SAVE','重复选项');if(d.kind==='reward'){for(let o of d.options){let def=R.rewardPool[o.optionId];if(!def||!Number.isInteger(o.targetLevel)||o.targetLevel<1||o.targetLevel>def.max)throw R.error('INVALID_SAVE','奖励等级无效');}if(s.pendingRewards<1)throw R.error('INVALID_SAVE','奖励轮次无效');}if(d.kind==='event'&&(!Number.isInteger(d.source?.x)||!Number.isInteger(d.source?.y)))throw R.error('INVALID_SAVE','事件来源无效');}
 if(s.pendingDecision)for(const o of s.pendingDecision.options){
  if(s.pendingDecision.kind==='event'&&o.effect!==undefined)validateEffect(o.effect,R);
  if(s.pendingDecision.kind==='camp'){validateEffect(o,R);if(!o.items||!Number.isFinite(o.hp)||!Number.isFinite(o.hunger)||o.hp<0||o.hunger<0)throw R.error('INVALID_SAVE','营火配方无效');if(o.available&&Object.entries(o.items).some(([id,n])=>s.inventory[id]<n))throw R.error('INVALID_SAVE','营火资源不足');}
 }
 }
