import {validateSave} from '../persistence/validation.js';
import {mergeMeta} from '../persistence/meta.js';
import {initialState,cloneState,replaceState,SET_FIELDS} from './state.js';
import {installContent} from '../content/definitions.js';
import {installEvents} from '../content/events.js';
import {installWorld} from './world.js';
import {installProgression} from './progression.js';
import {installDecisions} from './decisions.js';
import {installCombat} from './combat.js';
import {installObservation} from './observation.js';
import {installLifecycle} from './lifecycle.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createGame(options={}){
 const resources=options.resources;
 const state=initialState(resources);Object.assign(state,{sessionId:options.sessionId||uid(),runId:uid(),epoch:1,revision:0,decisionTurn:0,sequence:0,rng:options.seed??resources.data.world.seed,pendingDecision:null});
 const R={state,resources,events:[],FINAL_TOWER:resources.data.world.finalTower,error:(code,message,details)=>Object.assign(new Error(message),{code,details})};
 R.random=()=>{let x=state.rng>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;state.rng=x>>>0;return state.rng/4294967296;};
 R.toast=message=>R.events.push({type:'message',message});
  installContent(R);installLifecycle(R);installWorld(R);installProgression(R);installDecisions(R);installEvents(R);installCombat(R);installObservation(R);R.recalcStats();R.revealAround(0,0,resources.data.world.revealRadius);
 if(options.meta){state.meta=mergeMeta(state.meta,options.meta);R.ensureMeta();}
 let controlMode='agent',connectionStatus='offline',presentation=null,presentationUntil=0;const listeners=new Set(),receipts=new Map();
 const notify=()=>{for(const fn of listeners)try{fn();}catch(e){console.error('UI update failed',e);}};
 const requirePhase=type=>{let f=R.frame();if(!f.allowed.includes(type))throw R.error('INVALID_PHASE',`当前阶段不能执行 ${type}`);};
 function validatePlan(p){if(!Array.isArray(p)||p.length!==3||p.some(x=>x!==null&&typeof x!=='string'))throw R.error('INVALID_PLAN','计划必须为三槽技能ID/null数组');let allowed=new Set(R.actionCatalog().map(x=>x.id));for(let i=0;i<3;i++){if(p[i]!==null&&!allowed.has(p[i]))throw R.error('UNKNOWN_ACTION','未拥有该技能');if(state.battle.sealedSlot===i&&p[i]!==null)throw R.error('LOCKED_SLOT','该槽已被封印');}}
 function validateBattle(p){if(p.battleId!==state.battle.id||p.batchId!==state.battle.batchId)throw R.error('STALE_BATTLE','战斗或计划批次已变化');}
 function act(params,source='agent'){
 if(!params||typeof params!=='object')throw R.error('INVALID_REQUEST','动作请求无效');
 const {commandId,type,payload={}}=params;if(!payload||typeof payload!=='object'||Array.isArray(payload))throw R.error('INVALID_REQUEST','payload需要对象');if(typeof commandId!=='string'||commandId.length<1||commandId.length>128)throw R.error('INVALID_REQUEST','需要commandId');
 const signature=JSON.stringify(canonical(params));let prior=receipts.get(commandId);if(prior){if(prior.signature!==signature)throw R.error('IDEMPOTENCY_CONFLICT','commandId内容冲突');return structuredClone(prior.result);}
 if(source==='agent'&&controlMode!=='agent')throw R.error('CONTROLLER_REQUIRED','请先在页面启用Agent控制');if(source==='human'&&controlMode!=='human')throw R.error('CONTROLLER_REQUIRED','请先暂停并接管');
  if(params.sessionId!==state.sessionId||params.runId!==state.runId||params.epoch!==state.epoch)throw R.error('SESSION_EXPIRED','页面或旅程代次已变化');if(params.expectedRevision!==state.revision)throw R.error('STALE_REVISION','状态版本已变化',{observation:R.observe()});
  if(Date.now()<presentationUntil)throw R.error('BUSY_PRESENTATION','战斗动画正在播放，请稍后再行动',{retryAfterMs:presentationUntil-Date.now()});
 if(type!=='host.newRun')requirePhase(type);else if(source!=='human')throw R.error('CONTROLLER_REQUIRED','新旅程需要人工操作');
 let before=cloneState(state),previousEvents=R.events,revisionBefore=state.revision,turn=true,nextPresentation=null;R.events=[];
 try{
 switch(type){
 case 'world.move':{let d={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]}[payload.direction];if(!d)throw R.error('INVALID_DIRECTION','方向无效');R.moveTo(state.x+d[0],state.y+d[1]);break;}
 case 'world.harvest':R.harvest();break;
 case 'inventory.eat':if(!R.foodDefs[payload.itemId]||!(state.inventory[payload.itemId]>0))throw R.error('INSUFFICIENT_RESOURCE','没有此食物');R.eatItem(payload.itemId);break;
 case 'camp.open':R.showCampfire();turn=false;break;
 case 'choice.select':if(payload.decisionId!==state.pendingDecision.decisionId)throw R.error('STALE_DECISION','选择已变化');turn=R.selectDecision(payload.optionId);break;
 case 'choice.cancel':if(payload.decisionId!==state.pendingDecision.decisionId)throw R.error('STALE_DECISION','选择已变化');if(!state.pendingDecision.cancelable)throw R.error('INVALID_PHASE','此选择不可取消');state.pendingDecision=null;turn=false;break;
 case 'battle.plan.set':validateBattle(payload);validatePlan(payload.plan);state.battle.plan=[...payload.plan];turn=false;break;
 case 'battle.commit':validateBattle(payload);validatePlan(payload.plan);state.battle.plan=[...payload.plan];{const resolved=R.resolvePlan();R.events.push({type:'combatResolved',battleId:resolved.battleId,batchId:resolved.batchId,outcome:resolved.outcome||'ongoing',steps:resolved.steps});nextPresentation={id:commandId,state:before,plan:[...payload.plan],steps:resolved.steps,frames:resolved.frames};}break;
 // 主动撤退暂时禁用，保留原结算入口。
 // case 'battle.retreat':R.endBattle(false);break;
 case 'host.newRun':{let c=R.classDefs[payload.classId];if(!c||!R.classUnlocked(payload.classId))throw R.error('LOCKED_CLASS','职业尚未解锁');let meta=state.meta,sessionId=state.sessionId,epoch=state.epoch+1;replaceState(state,initialState(resources));Object.assign(state,{sessionId,runId:uid(),epoch,revision:revisionBefore,decisionTurn:0,sequence:0,rng:options.seed??resources.data.world.seed,pendingDecision:null,meta,classId:payload.classId,hunger:c.base.hunger,maxHunger:c.base.hunger});state.player={hp:c.base.hp,maxHp:c.base.hp,attack:c.base.attack,energy:Math.min(resources.data.rules.newRun.energy,c.base.energy),maxEnergy:c.base.energy,block:0,skills:{...c.skills},passives:{...c.passives},equipment:{...c.equipment}};state.inventory=Object.fromEntries(Object.keys(R.foodDefs).map(k=>[k,c.inventory[k]||0]));R.recalcStats();R.revealAround(0,0,resources.data.world.revealRadius);turn=false;break;}
 default:throw R.error('UNKNOWN_ACTION','未知动作');
 }
  if(!state.runResult){R.recalcStats();R.flushRewards();}state.revision++;if(turn)state.decisionTurn++;R.events=R.events.slice(-40);
  presentation=nextPresentation;
 const result={commandId,status:'completed',revisionBefore,revisionAfter:state.revision,decisionTurn:state.decisionTurn,events:structuredClone(R.events),observation:R.observe({contextId:params.contextId,knownDefinitionVersions:params.knownDefinitionVersions})};
 const inventoryChanges=Object.fromEntries(Object.entries(state.inventory).filter(([id,count])=>count!==(before.inventory[id]||0)));
 if(Object.keys(inventoryChanges).length)result.inventoryChanges=inventoryChanges;
 receipts.set(commandId,{signature,result});while(receipts.size>512)receipts.delete(receipts.keys().next().value);notify();return structuredClone(result);
 }catch(e){replaceState(state,before);restoreFunctions();R.events=previousEvents;throw e;}
 }
 function restoreFunctions(){if(state.battle)state.battle.enemy.ai=R.enemyDefs[state.battle.enemy.id].ai;}
 function preview(params={}){if(!state.inBattle)throw R.error('INVALID_PHASE','不在战斗中');if(params.expectedRevision!==undefined&&params.expectedRevision!==state.revision)throw R.error('STALE_REVISION','状态版本已变化');if(params.battleId!==undefined)validateBattle(params);validatePlan(params.plan);const old=state.battle.plan;state.battle.plan=[...params.plan];try{return R.simulatePlan();}finally{state.battle.plan=old;}}
 function exportSave(){return {format:'graymarch-save',schemaVersion:1,state:JSON.parse(JSON.stringify(state,(_,v)=>v instanceof Set?[...v]:v))};}
 function importSave(params){const save=params?.save||params;validateSave(save,R);const candidate=JSON.parse(JSON.stringify(save.state));delete candidate.training;delete candidate.battleOrigin;candidate.runResult??=null;candidate.meta=mergeMeta(state.meta,candidate.meta);for(let k of SET_FIELDS)candidate[k]=new Set(candidate[k]);candidate.sessionId=state.sessionId;candidate.epoch=Math.max(state.epoch,candidate.epoch)+1;candidate.revision++;replaceState(state,candidate);R.ensureMeta();restoreFunctions();controlMode='agent';presentation=null;presentationUntil=0;receipts.clear();R.events=[];notify();return {...R.identity(),controlMode,observation:R.observe()};}

 const api={observe:R.observe,information:R.information,catalog:R.catalog,map:R.map,preview,act,exportSave,importSave,exportMeta:()=>({...structuredClone(state.meta),unlocks:[...state.meta.unlocks].sort()}),control(mode){const previous=controlMode;controlMode=typeof mode==='string'?mode:mode.mode;if(!['human','agent'].includes(controlMode)){controlMode='human';throw R.error('INVALID_REQUEST','控制模式无效');}if(previous!==controlMode){presentation=null;presentationUntil=0;}notify();return {...R.identity(),mode:controlMode,controlMode};},getControl:()=>controlMode,humanAct:(type,payload={})=>act({...R.identity(),expectedRevision:state.revision,commandId:uid(),type,payload},'human'),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},uiRuntime:()=>({...R,state:cloneState(state),presentation}),startPresentation(id){if(presentation?.id===id)presentationUntil=Date.now()+5000;},finishPresentation(id){if(presentation?.id===id){presentation=null;presentationUntil=0;}},setConnectionStatus(value){connectionStatus=value;notify();},get connectionStatus(){return connectionStatus;}};
 return api;
}
