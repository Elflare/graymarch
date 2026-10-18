export function installProgression(R){const state=R.state;const {classDefs,gradeRank,rewardPool,affinityMap}=R;const toast=(...a)=>R.toast(...a);
function ensureMeta(){
 if(!state.meta)state.meta={bossWins:0,bestGrade:'C',harvests:0,unlocks:[]};
 state.meta.unlocks=state.meta.unlocks||[];
 if(state.victory&&state.meta.bossWins<1)state.meta.bossWins=1;
 if(state.lastReport?.grade&&gradeRank[state.lastReport.grade]>gradeRank[state.meta.bestGrade||'C'])state.meta.bestGrade=state.lastReport.grade;
 refreshMetaUnlocks(false);
}
function addMetaUnlock(id,msg){
 if(!state.meta.unlocks.includes(id)){state.meta.unlocks.push(id);if(msg)toast(msg);return true}
 return false
}
function refreshMetaUnlocks(notify=true){
 ensureMetaBare();
 if(gradeRank[state.meta.bestGrade||'C']>=gradeRank.S)addMetaUnlock('class_sentinel',notify?'永久解锁：盾誓守卫':'');
 if(state.meta.bossWins>=1){
   addMetaUnlock('class_arcanist',notify?'永久解锁：符文术士':'');
   addMetaUnlock('time_tactics',notify?'永久解锁：时间系稀有战术':'');
 }
 if(state.meta.harvests>=10)addMetaUnlock('class_hunter',notify?'永久解锁：黑木猎手':'');
 if(gradeRank[state.meta.bestGrade||'C']>=gradeRank.A)addMetaUnlock('interrupt_tactics',notify?'永久解锁：打断系稀有战术':'');
}
function ensureMetaBare(){
 if(!state.meta)state.meta={bossWins:0,bestGrade:'C',harvests:0,unlocks:[]};
 state.meta.unlocks=state.meta.unlocks||[];
}
function classUnlocked(id){
 if(id==='wanderer')return true;
 ensureMetaBare();
 return state.meta.unlocks.includes('class_'+id);
}
function metaContentUnlocked(d){
 if(!d.meta)return true;
 ensureMetaBare();
 return state.meta.unlocks.includes(d.meta);
}
function classBase(){return classDefs[state.classId]||classDefs.wanderer}
function levelOf(id){let d=rewardPool[id];if(d.kind==='skill')return state.player.skills[id]||0;if(d.kind==='passive')return state.player.passives[id]||0;return state.player.equipment[id]||0}
function offerTargetLevel(id){let d=rewardPool[id],lv=levelOf(id);if(lv)return Math.min(d.max,lv+1);return Math.min(d.max,Math.max(1,1+Math.floor((state.level-(d.unlock||1))/3)))}
function buildAffinities(){
 let score={};
 for(let id of Object.keys(rewardPool)){
   let lv=levelOf(id),a=affinityMap[id];
   if(lv&&a)score[a]=(score[a]||0)+Math.min(3,lv);
 }
 return score;
}
function rewardChoices(){
  let pool=Object.keys(rewardPool).filter(id=>(rewardPool[id].unlock||1)<=state.level&&levelOf(id)<rewardPool[id].max&&metaContentUnlocked(rewardPool[id]));
  let affinity=buildAffinities(),weighted=[];
  for(let id of pool){
    let lv=levelOf(id),a=affinityMap[id],d=rewardPool[id],w=d.rare?1:2;
    if(lv)w+=2;
    if(a&&affinity[a])w+=Math.min(4,affinity[a]);
    for(let n=0;n<w;n++)weighted.push(id);
  }
  let chosen=[];
  while(chosen.length<3&&weighted.length){
    let id=weighted[Math.floor(R.random()*weighted.length)];
    if(!chosen.includes(id))chosen.push(id);
    weighted=weighted.filter(x=>x!==id);
  }
  return chosen;
}

function gainXP(n){state.xp+=n;let ups=0;while(state.xp>=R.xpNeed(state.level)){state.xp-=R.xpNeed(state.level);state.level++;ups++;}state.pendingRewards+=ups;R.toast(`获得 ${n} EXP`);return ups;}
Object.assign(R,{ensureMeta,addMetaUnlock,refreshMetaUnlocks,ensureMetaBare,classUnlocked,metaContentUnlocked,classBase,levelOf,offerTargetLevel,buildAffinities,rewardChoices,gainXP});}
