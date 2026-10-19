/** Serializable decision descriptors. Event callbacks are reconstructed only at selection. */
export function installDecisions(R){
 const s=R.state;
 function offer(kind,title,text,options,extra={}){s.pendingDecision={decisionId:`decision-${++s.sequence}`,kind,title,text,options:options.map((o,i)=>({optionId:String(i),available:true,...o})),cancelable:false,...extra};}
 R.captureEvent=({title,text,choices})=>{if(R.eventCapture){R.eventCapture({title,text,choices});return;}offer('event',title,text,choices.map(c=>({label:c.label,effect:c.effect})),{source:{x:s.x,y:s.y}});};
 R.showSimpleEvent=(title,text,choices)=>offer('victory',title,text,[{label:R.text('continue')}]);
 R.showReward=(rounds=0)=>{s.pendingRewards+=rounds;R.flushRewards();};
 R.closeEvent=()=>{s.pendingDecision=null;};
 R.flushRewards=()=>{if(s.pendingDecision||s.inBattle||!s.pendingRewards)return;let ids=R.rewardChoices();if(!ids.length){s.pendingRewards=0;return;}offer('reward',R.text('rewardTitle'),R.text('rewardText'),ids.map(id=>({optionId:id,label:R.rewardPool[id].cn,targetLevel:R.offerTargetLevel(id),description:R.rewardPool[id].desc(R.offerTargetLevel(id))})),{remainingRounds:s.pendingRewards});};
 const campOptions=()=>R.resources.data.events.camp.map(c=>({...c,label:R.resources.format(c.label,c),...(c.buff?{buff:R.resources.buff(c.buff)}:{})}));
 R.showCampfire=()=>offer('camp',R.text('campTitle'),R.text('campText'),campOptions().map(o=>({...o,available:Object.entries(o.items).every(([k,n])=>s.inventory[k]>=n)})),{cancelable:true});
 R.selectDecision=(id)=>{const consequence=()=>JSON.stringify({player:s.player,inventory:s.inventory,hunger:s.hunger,buffs:s.buffs,xp:s.xp,level:s.level,inBattle:s.inBattle,pendingRewards:s.pendingRewards,spent:[...s.spent]});const before=consequence();const d=s.pendingDecision,o=d.options.find(o=>o.optionId===id);if(!o)throw R.error('UNKNOWN_OPTION','选项不存在');if(!o.available)throw R.error('INSUFFICIENT_RESOURCE','选项资源不足');s.pendingDecision=null;
 if(d.kind==='reward'){const def=R.rewardPool[id],group=def.kind==='skill'?'skills':def.kind==='passive'?'passives':'equipment';s.player[group][id]=o.targetLevel;s.pendingRewards--;R.recalcStats();}
 else if(d.kind==='camp'){let c=o;for(const[k,n]of Object.entries(c.items))s.inventory[k]-=n;s.player.hp=Math.min(s.player.maxHp,s.player.hp+c.hp);s.hunger=Math.min(s.maxHunger,s.hunger+c.hunger);if(c.buff)R.addBuff(c.buff);s.spent.add(R.key(s.x,s.y));R.advanceTime(R.resources.data.world.campHungerCost);}
 else if(d.kind==='event'){if(o.effect)R.applyEventEffect(o.effect);else{let captured;R.eventCapture=ev=>captured=ev;try{R.triggerEvent(d.source.x,d.source.y);}finally{R.eventCapture=null;}if(!captured?.choices[Number(id)])throw R.error('INVALID_SAVE','事件选项无效');captured.choices[Number(id)].fn?.();}}
 R.flushRewards();R.recalcStats();R.events.push({type:'choiceSelected',kind:d.kind,optionId:id});return d.kind!=='event'||before!==consequence();};
}
