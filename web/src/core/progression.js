export function installProgression(R){const state=R.state;const {classDefs,gradeRank,rewardPool,affinityMap}=R;const growth=R.resources.data.rules.growth;const toast=(...a)=>R.toast(...a);
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
 for(const u of growth.unlocks){
  const unlocked=u.field==='bestGrade'?gradeRank[state.meta.bestGrade||'C']>=gradeRank[u.value]:state.meta[u.field]>=u.value;
  if(unlocked)addMetaUnlock(u.id,notify?u.message:'');
 }
}
function ensureMetaBare(){
 if(!state.meta)state.meta={bossWins:0,bestGrade:'C',harvests:0,unlocks:[]};
 state.meta.unlocks=state.meta.unlocks||[];
}
function classUnlocked(id){
 if(id===R.resources.data.rules.initial.classId)return true;
 ensureMetaBare();
 return state.meta.unlocks.includes('class_'+id);
}
function metaContentUnlocked(d){
 if(!d.meta)return true;
 ensureMetaBare();
 return state.meta.unlocks.includes(d.meta);
}
function classBase(){return classDefs[state.classId]||classDefs[R.resources.data.rules.initial.classId]}
function levelOf(id){let d=rewardPool[id];if(d.kind==='skill')return state.player.skills[id]||0;if(d.kind==='passive')return state.player.passives[id]||0;return state.player.equipment[id]||0}
function offerTargetLevel(id){let d=rewardPool[id],lv=levelOf(id);if(lv)return Math.min(d.max,lv+1);return Math.min(d.max,Math.max(1,1+Math.floor((state.level-(d.unlock||1))/growth.catchupEvery)))}
function buildAffinities(){
 let score={};
 for(let id of Object.keys(rewardPool)){
   let lv=levelOf(id),a=affinityMap[id];
   if(lv&&a)score[a]=(score[a]||0)+Math.min(growth.affinityLevelCap,lv);
 }
 return score;
}
function rewardChoices(){
  let pool=Object.keys(rewardPool).filter(id=>(rewardPool[id].unlock||1)<=state.level&&levelOf(id)<rewardPool[id].max&&metaContentUnlocked(rewardPool[id]));
  let affinity=buildAffinities(),weighted=[];
  for(let id of pool){
    let lv=levelOf(id),a=affinityMap[id],d=rewardPool[id],w=d.rare?growth.rareWeight:growth.normalWeight;
    if(lv)w+=growth.ownedWeight;
    if(a&&affinity[a])w+=Math.min(growth.affinityWeightCap,affinity[a]);
    for(let n=0;n<w;n++)weighted.push(id);
  }
  let chosen=[];
  while(chosen.length<growth.rewardCount&&weighted.length){
    let id=weighted[Math.floor(R.random()*weighted.length)];
    if(!chosen.includes(id))chosen.push(id);
    weighted=weighted.filter(x=>x!==id);
  }
  return chosen;
}

function gainXP(n){state.xp+=n;let ups=0;while(state.xp>=R.xpNeed(state.level)){state.xp-=R.xpNeed(state.level);state.level++;ups++;}state.pendingRewards+=ups;R.toast(R.text('xp',{xp:n}));return ups;}
Object.assign(R,{ensureMeta,addMetaUnlock,refreshMetaUnlocks,ensureMetaBare,classUnlocked,metaContentUnlocked,classBase,levelOf,offerTargetLevel,buildAffinities,rewardChoices,gainXP});}
