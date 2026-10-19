/** Bind immutable definitions to this game's rule functions. */
export function installContent(R) {
  const resources=R.resources, data=resources.data;
  const defs=group=>Object.fromEntries(Object.entries(data[group]).map(([id,d])=>[id,Object.freeze({...d,desc:lv=>resources.describe(group,id,lv)})]));
  const activeSkills=defs('skills'),passiveDefs=defs('passives'),equipDefs=defs('equipment');
  const enemyDefs=Object.fromEntries(Object.entries(data.enemies).map(([id,d])=>{
    const {behavior,params,actionNames,tier,...publicData}=d;
    return [id,Object.freeze({...resources.enemy(id),ai:enemyAI(behavior,params,actionNames)})];
  }));
  const foodDefs=Object.fromEntries(Object.keys(data.foods).map(id=>[id,Object.freeze({...resources.food(id),eat:()=>{
    const f=data.foods[id],s=R.state;
    const hp=f.hp+(f.medic?R.passiveValue(s.player,'field_medic','heal'):0);
    s.hunger=Math.max(0,Math.min(s.maxHunger,s.hunger+f.hunger));
    if(hp)s.player.hp=Math.max(1,Math.min(s.player.maxHp,s.player.hp+hp));
    if(f.buff&&(f.chance===undefined||R.random()<f.chance))R.addBuff(resources.buff(f.buff));
    if(f.message)R.toast(resources.format(f.message,{hp,hunger:f.hunger}));
  }})]));
  Object.assign(R,{
    classDefs:Object.fromEntries(Object.keys(data.classes).map(id=>[id,Object.freeze(resources.characterClass(id))])),gradeRank:data.rules.growth.gradeRank,tileInfo:data.world.tileInfo,
    BIOME_SIZE:data.world.biomeSize,FINAL_TOWER:data.world.finalTower,biomeDefs:data.world.biomes,
    enemyDefs,enemyTier:Object.fromEntries(Object.entries(data.enemies).map(([id,d])=>[id,d.tier])),biomeEnemyPools:data.world.enemyPools,
    activeSkills,passiveDefs,equipDefs,rewardPool:{...activeSkills,...passiveDefs,...equipDefs},foodDefs,affinityMap:data.rules.growth.affinity,
    text:(key,values={})=>resources.format(data.rules.messages[key],values,'rules.json.messages.'+key),
    skillParams:(id,lv)=>resources.level('skills',id,lv),
    passiveValue:(p,id,key)=>resources.amount('passives',id,p.passives[id]||0,key),
    gearValue:(p,id,key)=>resources.amount('equipment',id,p.equipment[id]||0,key),
  });
}

/** Existing enemy behaviors, with all tuning and action names supplied by JSON. */
function enemyAI(id,p,n) {
  return (t,e)=>{
    const action=(key,values={})=>({id:key,name:n[key],...values});
    switch(id) {
      case 'wolf':case 'boar':case 'ogre':return t%p.period===0?action('heavy',{dmg:e.atk+p.heavyBonus}):action('attack',{dmg:e.atk});
      case 'skeleton':return t%p.period===0?action('heavy',{dmg:e.atk+p.heavyBonus}):e.hp<=e.maxHp*p.guardRatio&&t%p.guardPeriod===0?action('guard',{block:p.block}):action('attack',{dmg:e.atk});
      case 'spider':return t%p.period===0?action('venom',{dmg:e.atk,poison:p.poison}):action('attack',{dmg:e.atk});
      case 'bandit':return t%p.period===1?action('attack',{dmg:e.atk}):t%p.period===2?action('guard',{block:p.block}):action('heavy',{dmg:e.atk+p.heavyBonus});
      case 'knight':return t%p.period===0?action('heavy',{dmg:e.atk+p.heavyBonus}):t%p.guardPeriod===0?action('guard',{block:p.block}):action('attack',{dmg:e.atk});
      case 'golem':return t%p.period===0?action('heavy',{dmg:e.atk+p.heavyBonus,expose:true}):action('attack',{dmg:e.atk,expose:true});
      case 'wraith':return t%p.guardPeriod===0?action('guard',{block:p.block}):t%p.heavyPeriod===1?action('heavy',{dmg:e.atk+p.heavyBonus,drain:t%p.drainPeriod===0?p.drain:0}):action('attack',{dmg:e.atk,drain:t%p.drainPeriod===0?p.drain:0});
      case 'iron_warden':return t%p.period===1?action('guard',{block:p.block}):t%p.period===2?action('attack',{dmg:e.atk}):action('heavy',{dmg:e.atk+p.heavyBonus,expose:true});
      case 'rot_priest':return t%p.period===1?action('drain',{dmg:e.atk+p.drainBonus,drain:p.drain}):t%p.period===2?action('guard',{block:p.block}):action('venom',{dmg:e.atk,poison:p.poison});
      case 'rift_reaver':return t%p.period===1?action('wait'):t%p.period===2?{id:'heavy',name:n.burst,dmg:e.atk+p.burstBonus}:t%p.period===3?action('attack',{dmg:e.atk}):action('heavy',{dmg:e.atk+p.heavyBonus,expose:true});
      case 'lord':{
        const ratio=e.hp/e.maxHp;
        if(ratio>p.phaseRatios[0])return t%p.period===0?action('heavy',{dmg:e.atk+p.heavyBonus}):t%p.guardPeriod===0?action('guard',{block:p.block}):action('attack',{dmg:e.atk});
        if(ratio>p.phaseRatios[1])return t%p.period===0?action('drain',{dmg:e.atk+p.drainBonus,drain:p.drain}):{id:'heavy',name:n.pressure,dmg:e.atk+p.heavyBonus};
        return {id:'heavy',name:t%p.period===0?n.collapse:n.final,dmg:e.atk+(t%p.period===0?p.finalHeavyBonus:p.finalBonus)};
      }
    }
  };
}
