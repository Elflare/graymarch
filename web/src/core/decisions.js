/** Serializable decision descriptors. Event callbacks are reconstructed only at selection. */
export function installDecisions(R){
 const s=R.state;
 function offer(kind,title,text,options,extra={}){s.pendingDecision={decisionId:`decision-${++s.sequence}`,kind,title,text,options:options.map((o,i)=>({optionId:String(i),available:true,...o})),cancelable:false,...extra};}
 R.captureEvent=({title,text,choices})=>{if(R.eventCapture){R.eventCapture({title,text,choices});return;}offer('event',title,text,choices.map(c=>({label:c.label})),{source:{x:s.x,y:s.y}});};
 R.showSimpleEvent=(title,text,choices)=>offer('victory',title,text,[{label:'继续探索'}]);
 R.showReward=(rounds=0)=>{s.pendingRewards+=rounds;R.flushRewards();};
 R.closeEvent=()=>{s.pendingDecision=null;};
 R.flushRewards=()=>{if(s.pendingDecision||s.inBattle||!s.pendingRewards)return;let ids=R.rewardChoices();if(!ids.length){s.pendingRewards=0;return;}offer('reward','升级奖励','选择一项构筑强化',ids.map(id=>({optionId:id,label:R.rewardPool[id].cn,targetLevel:R.offerTargetLevel(id),description:R.rewardPool[id].desc(R.offerTargetLevel(id))})),{remainingRounds:s.pendingRewards});};
 const campOptions=()=>[
 {label:'休息 · +4 HP / +8 饥饿',items:{},hp:4,hunger:8},
 {label:'炙烤野味 · 熏野味×1',items:{meat:1},hp:6,hunger:32,buff:{id:'camp_sated',name:'饱足',turns:14,hungerCost:-1,desc:'移动与采集饥饿消耗 -1。'}},
 {label:'根茎药汤 · 甜根×1 + 药草×1',items:{roots:1,herb:1},hp:8,hunger:24},
 {label:'烤灰帽菇 · 灰帽菇×1',items:{mushroom:1},hp:0,hunger:20,buff:{id:'camp_warm',name:'暖胃',turns:12,guard:1,desc:'格挡动作 +1。'}},
 {label:'浆果热饮 · 黑莓×1 + 药草×1',items:{berries:1,herb:1},hp:3,hunger:12,buff:{id:'camp_focus',name:'热饮振奋',turns:10,attack:1,desc:'攻击 +1。'}}];
 R.showCampfire=()=>offer('camp','遗火营地','每处营火只能进行一次休整或烹饪。',campOptions().map(o=>({...o,available:Object.entries(o.items).every(([k,n])=>s.inventory[k]>=n)})),{cancelable:true});
 R.selectDecision=(id)=>{const consequence=()=>JSON.stringify({player:s.player,inventory:s.inventory,hunger:s.hunger,buffs:s.buffs,xp:s.xp,level:s.level,inBattle:s.inBattle,pendingRewards:s.pendingRewards,spent:[...s.spent]});const before=consequence();const d=s.pendingDecision,o=d.options.find(o=>o.optionId===id);if(!o)throw R.error('UNKNOWN_OPTION','选项不存在');if(!o.available)throw R.error('INSUFFICIENT_RESOURCE','选项资源不足');s.pendingDecision=null;
 if(d.kind==='reward'){const def=R.rewardPool[id],group=def.kind==='skill'?'skills':def.kind==='passive'?'passives':'equipment';s.player[group][id]=o.targetLevel;s.pendingRewards--;R.recalcStats();}
 else if(d.kind==='camp'){let c=campOptions()[Number(id)];for(const[k,n]of Object.entries(c.items))s.inventory[k]-=n;s.player.hp=Math.min(s.player.maxHp,s.player.hp+c.hp);s.hunger=Math.min(s.maxHunger,s.hunger+c.hunger);if(c.buff)R.addBuff(c.buff);s.spent.add(R.key(s.x,s.y));R.advanceTime(1);}
 else if(d.kind==='event'){let captured;R.eventCapture=ev=>captured=ev;try{R.triggerEvent(d.source.x,d.source.y);}finally{R.eventCapture=null;}if(!captured?.choices[Number(id)])throw R.error('INVALID_SAVE','事件选项无效');captured.choices[Number(id)].fn?.();}
 R.flushRewards();R.recalcStats();R.events.push({type:'choiceSelected',kind:d.kind,optionId:id});return d.kind!=='event'||before!==consequence();};
}
