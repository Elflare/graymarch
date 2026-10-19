/** Event descriptors stay serializable; only selection executes their effects. */
export function installEvents(R) {
  const s=R.state, data=R.resources.data.events;
  function resolve(effect,x,y) {
    const {extra,roll,chance,otherwise,...result}=structuredClone(effect);
    if(effect.xp)result.xp=effect.xp.base+Math.floor((Math.abs(x)+Math.abs(y))/effect.xp.depthDivisor);
    if(effect.buff)result.buff=R.resources.buff(effect.buff);
    if(extra){
      const value=extra.roll==='regional'?R.h2(x+3881,y-2117):R.h2(x-991,y+811);
      if(value<extra.chance)result.extra=resolve(extra,x,y);
      else if(extra.otherwise)result.extra={message:extra.otherwise};
    }
    return result;
  }
  function apply(effect) {
    if(effect.items)for(const[id,n]of Object.entries(effect.items))s.inventory[id]+=n;
    if(effect.hp)s.player.hp=Math.max(1,Math.min(s.player.maxHp,s.player.hp+effect.hp));
    if(effect.hunger)s.hunger=Math.max(0,Math.min(s.maxHunger,s.hunger+effect.hunger));
    if(effect.xp)R.gainXP(effect.xp,true);
    if(effect.buff)R.addBuff(structuredClone(effect.buff));
    if(effect.message)R.toast(effect.message);
    if(effect.battle)R.startBattle(effect.battle);
    if(effect.extra)apply(effect.extra);
  }
  const bind=(event,x,y)=>({title:event.title,text:event.text,choices:event.choices.map(c=>{const effect=resolve(c.effect,x,y);return {label:c.label,effect,fn:()=>apply(effect)};})});
  const regionalEvent=(x,y)=>bind(data.regional[R.biomeAt(x,y).id]||data.regional[data.regionalFallback],x,y);
  function triggerEvent(x,y){
    s.eventsSeen.add(R.key(x,y));
    const ev=R.h2(x+4511,y-3571)<data.regionalChance?regionalEvent(x,y):bind(data.common[Math.floor(R.h2(x+1501,y-1203)*data.common.length)],x,y);
    R.captureEvent(ev);
  }
  Object.assign(R,{regionalEvent,triggerEvent,applyEventEffect:apply});
}
