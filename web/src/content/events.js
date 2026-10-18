export function installEvents(R){const state=R.state;const key=(...a)=>R.key(...a),h2=(...a)=>R.h2(...a),biomeAt=(...a)=>R.biomeAt(...a),addBuff=(...a)=>R.addBuff(...a),gainXP=(...a)=>R.gainXP(...a),toast=(...a)=>R.toast(...a),startBattle=(...a)=>R.startBattle(...a),closeEvent=()=>{};
const showSimpleEvent=(title,text,choices)=>R.captureEvent({title,text,choices});
function regionalEvent(x,y){
 let bio=biomeAt(x,y),r=h2(x+3881,y-2117);
 if(bio.id==='grass')return {title:'风歌商旅',text:'商队在旧道旁修整，给了你一些便携干粮。',choices:[{label:'接受补给',fn:()=>{state.inventory.seedcake++;state.inventory.roots++}}]};
 if(bio.id==='forest')return {title:'黑木猎台',text:'猎人留下了干燥木箱，里面有坚果和一小块熏肉。',choices:[{label:'取走补给',fn:()=>{state.inventory.nuts++;if(r<.6)state.inventory.meat++}},{label:'研究猎径',fn:()=>addBuff({id:'hunter_path',name:'猎径记忆',turns:20,hungerCost:-1,desc:'移动与采集饥饿消耗 -1。'})}]};
 if(bio.id==='mire')return {title:'沼泽鬼火',text:'一团青白火焰在安全的石脊上引路。它似乎知道避开泥潭的方法。',choices:[{label:'跟随鬼火',fn:()=>{gainXP(6+Math.floor((Math.abs(x)+Math.abs(y))/18),true);if(r<.2)addBuff({id:'mire_whisper',name:'沼语',turns:10,attack:-1,desc:'攻击 -1。'})}},{label:'不冒险',fn:()=>state.inventory.bogfruit++}]};
 if(bio.id==='highland')return {title:'山壁旧铁炉',text:'废弃铁炉中还嵌着几块余热不散的符铁。',choices:[{label:'磨利武器',fn:()=>addBuff({id:'forge_edge',name:'符铁锋刃',turns:24,attack:1,desc:'攻击 +1。'})},{label:'修整护具',fn:()=>addBuff({id:'forge_guard',name:'加固护具',turns:24,guard:1,desc:'格挡动作 +1。'})}]};
 return {title:'灰烬祭台',text:'残破祭台仍在索取鲜血，但也确实回应祈求。',choices:[{label:'献血换取知识',fn:()=>{state.player.hp=Math.max(1,state.player.hp-3);gainXP(9+Math.floor((Math.abs(x)+Math.abs(y))/20),true)}},{label:'取走供品',fn:()=>{state.inventory.emberberry++;state.inventory.herb++}}]};
}
function triggerEvent(x,y){let k=key(x,y);state.eventsSeen.add(k);let depth=Math.abs(x)+Math.abs(y);if(h2(x+4511,y-3571)<.32){let ev=regionalEvent(x,y);showSimpleEvent(ev.title,ev.text,ev.choices);return}let idx=Math.floor(h2(x+1501,y-1203)*10);let events=[
 ()=>({title:'被遗弃的补给车',text:'破裂的车轴旁还剩一些没有被雨水泡坏的食物。',choices:[{label:'收下补给',fn:()=>{state.inventory.roots+=2;state.inventory.berries+=1;toast('甜根 ×2，黑莓束 ×1')}}]}),
 ()=>({title:'无名旅者的篝火',text:'一个披着旧斗篷的旅者与你分食烤肉，没有询问你的来处。',choices:[{label:'接受好意',fn:()=>{state.inventory.meat++;state.hunger=Math.min(state.maxHunger,state.hunger+15)}}]}),
 ()=>({title:'路旁符文碑',text:'褪色符文仍有余温。触摸它后，你的武器在暮色中泛起微光。',choices:[{label:'接受祝福',fn:()=>addBuff({id:'rune_edge',name:'符刃祝福',turns:30,attack:1,desc:'攻击 +1'})}]}),
 ()=>({title:'倒塌的守望塔',text:'塔内还有一面能用的旧盾。它无法带走，但你记住了更有效的架盾方式。',choices:[{label:'研习守势',fn:()=>addBuff({id:'watch_guard',name:'守望架势',turns:28,guard:2,desc:'格挡动作 +2'})}]}),
 ()=>({title:'游方药师',text:'药师只收了你一个故事，便递来两束苦叶。',choices:[{label:'道谢',fn:()=>state.inventory.herb+=2}]}),
 ()=>({title:'清泉',text:'石缝中涌出的水没有灰境常见的铁锈味。',choices:[{label:'休息片刻',fn:()=>{state.player.hp=Math.min(state.player.maxHp,state.player.hp+5);state.hunger=Math.min(state.maxHunger,state.hunger+25)}}]}),
 ()=>({title:'老猎人的陷阱线',text:'你发现一只无人认领的猎物。四周没有脚印，只有风。',choices:[{label:'处理猎物',fn:()=>state.inventory.meat+=1}]}),
 ()=>({title:'失落的行军手册',text:'几页战术笔记仍然清晰。你花了一段时间推演其中的战例。',choices:[{label:'阅读',fn:()=>gainXP(7+Math.floor(depth/15),true)}]}),
 ()=>({title:'变质的宴席',text:'废弃营地里食物闻起来尚可，但显然放得太久。',choices:[{label:'冒险吃下',fn:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+25);if(h2(x-991,y+811)<.35){state.player.hp=Math.max(1,state.player.hp-4);toast('食物变质：-4 HP')}else toast('意外地还能吃')}} ,{label:'离开',fn:()=>{}}]}),
 ()=>({title:'灰斗伏击',text:'你刚越过碎石墙，数支短弩便对准了你。',choices:[{label:'迎战',fn:()=>{closeEvent();startBattle('X',false)}}]})
 ][idx]();showSimpleEvent(events.title,events.text,events.choices)}

Object.assign(R,{regionalEvent,triggerEvent});}
