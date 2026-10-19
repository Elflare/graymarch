/** Immutable gameplay data. File I/O belongs to the entrypoint, never the kernel. */
export const RESOURCE_FILES = Object.freeze(['classes', 'skills', 'passives', 'equipment', 'enemies', 'foods', 'buffs', 'events', 'world', 'rules']);

const LEVEL_FIELDS = {
  skills: {
    power_strike:'damageBonus shatter unblockedBonus', guard_stance:'block attackBonus thornsDamage thornsTurns',
    heal:'heal cleanse block', armor_break:'damage armorDown turns zeroArmorDamage', charge:'bonus energy pierce',
    execute:'threshold damage fallbackDamage killEnergy', fireball:'damage turns burnDamage burningBonus',
    bleed_strike:'turns bleedDamage bleedingBonus', frost_bind:'damage damageDown turns guardDown shatter',
    riposte:'block damage turns', life_drain:'damage healRate overflowBlock', whirlwind:'hits damageBonus',
    mirror_guard:'attackBonus block energy', break_rhythm:'damageBonus reduce cancelGuard', stagger:'damageBonus threshold',
    time_snare:'block energy', fate_swap:'block energy', combo_strike:'damageBonus comboBonus comboEnergy',
  },
  passives: {
    third_strike:'interval bonus', even_guard:'interval block', low_hp_fury:'hpRatio bonus', precise_kill:'energy', reserve:'energy',
    pathfinder:'discount', forager:'findBonus riskDiscount doubleChance', hearty:'hunger', field_medic:'heal',
    precise_guard:'energy block', parity_edge:'interval remainder bonus', divisible_edge:'divisor bonus', exact_finish:'xpRate',
  },
  equipment: {iron_sword:'attack', tower_shield:'guard', rune_ring:'energy', wanderer_cloak:'hp'},
};
const AI_FIELDS = {
  wolf:'period heavyBonus', boar:'period heavyBonus', skeleton:'period heavyBonus guardPeriod guardRatio block',
  spider:'period poison', bandit:'period block heavyBonus', knight:'period guardPeriod block heavyBonus',
  golem:'period heavyBonus', wraith:'guardPeriod heavyPeriod drainPeriod block heavyBonus drain', ogre:'period heavyBonus',
  iron_warden:'period block heavyBonus', rot_priest:'period drainBonus drain block poison',
  rift_reaver:'period burstBonus heavyBonus', lord:'period guardPeriod block heavyBonus drainBonus drain finalBonus finalHeavyBonus phaseRatios',
};
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const fail = (path, message) => { throw Object.assign(new Error(`${path}: ${message}`), {code:'INVALID_RESOURCE'}); };
const object = (value,path) => { if(!value || typeof value!=='object' || Array.isArray(value)) fail(path,'需要对象'); };
const text = (value,path) => { if(typeof value!=='string' || !value.length) fail(path,'需要非空文本'); };
const number = (value,path,min=0,max=Infinity) => { if(typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) fail(path,`需要 ${min} 到 ${max} 范围内的数值`); };
const positive = (value,path) => { number(value,path); if(value===0)fail(path,'必须大于零'); };
const integer = (value,path,min=0) => { number(value,path,min);if(!Number.isSafeInteger(value))fail(path,'需要整数'); };
const fields = (value,names,path) => { object(value,path); for(const name of names.split(' '))if(value[name]===undefined)fail(`${path}.${name}`,'缺少字段'); };
const reference = (table,id,path) => { if(!Object.hasOwn(table,id))fail(path,`未知 ID ${id}`); };
const table = (rows,refs,path) => {
  if(!Array.isArray(rows)||!rows.length)fail(path,'需要非空阈值表');
  let previous=0;
  rows.forEach(([threshold,id],i)=>{number(threshold,`${path}[${i}][0]`,previous,1);if(threshold<=previous)fail(path,'阈值必须递增');previous=threshold;reference(refs,id,`${path}[${i}][1]`);});
  if(previous!==1)fail(path,'最后一个阈值必须为 1');
};

function validate(d) {
  for(const file of RESOURCE_FILES)object(d[file],`${file}.json`);
  // Reject non-JSON inputs too; tests and file loaders share this boundary.
  const json = (v,p) => {
    if(typeof v==='number' && !Number.isFinite(v))fail(p,'数值必须有限');
    if(v!==null && !['object','string','number','boolean'].includes(typeof v))fail(p,'需要 JSON 数据');
    if(v && typeof v==='object')for(const [k,x] of Object.entries(v))json(x,`${p}.${k}`);
  };
  for(const file of RESOURCE_FILES)json(d[file],`${file}.json`);
  for(const [group,required] of Object.entries(LEVEL_FIELDS)) {
    for(const id of Object.keys(required))reference(d[group],id,`${group}.json`);
    for(const [id,def] of Object.entries(d[group])) {
      const p=`${group}.json.${id}`;fields(def,'cn kind unlock max levels',p);text(def.cn,`${p}.cn`);
      if(!Number.isInteger(def.max)||def.max<1||!Array.isArray(def.levels)||def.levels.length!==def.max)fail(`${p}.levels`,'等级表必须完整覆盖 1..max');
      if(!required[id])fail(p,'尚未实现此机制');
      number(def.unlock,`${p}.unlock`,1);
      if(group==='skills'){integer(def.cost,`${p}.cost`);if(def.cooldown!==undefined)integer(def.cooldown,`${p}.cooldown`);}
      if(def.details){if(!Array.isArray(def.details))fail(`${p}.details`,'需要说明片段列表');def.details.forEach((part,i)=>{fields(part,'when text',`${p}.details[${i}]`);if(!required[id].split(' ').includes(part.when))fail(`${p}.details[${i}].when`,'需要本机制的参数名');text(part.text,`${p}.details[${i}].text`);});}
      def.levels.forEach((row,i)=>{
        const q=`${p}.levels[${i}]`;fields(row,required[id]+' description',q);text(row.description,`${q}.description`);
        for(const [key,value]of Object.entries(row))if(key!=='description') {
          if(['cleanse','pierce','overflowBlock','cancelGuard'].includes(key)){if(typeof value!=='boolean')fail(`${q}.${key}`,'需要布尔值');}
          else {if(!required[id].split(' ').includes(key))fail(`${q}.${key}`,'未知等级参数');number(value,`${q}.${key}`);if(/Rate$|Ratio$|Chance$|Discount$|findBonus/.test(key))number(value,`${q}.${key}`,0,1);if(['interval','divisor','hits','turns'].includes(key))integer(value,`${q}.${key}`,1);}
        }
      });
    }
  }
  const itemCounts = (items,path) => { object(items,path);for(const[id,n]of Object.entries(items)){reference(d.foods,id,`${path}.${id}`);integer(n,`${path}.${id}`);} };
  for(const [id,def]of Object.entries(d.classes)) {
    const p=`classes.json.${id}`;fields(def,'cn desc base skills passives equipment inventory unlock',p);for(const key of ['cn','desc','unlock'])text(def[key],`${p}.${key}`);
    for(const key of ['hp','attack','energy','hunger'])positive(def.base[key],`${p}.base.${key}`);integer(def.base.hunger,`${p}.base.hunger`,1);
    for(const group of ['skills','passives','equipment']){object(def[group],`${p}.${group}`);for(const[key,lv]of Object.entries(def[group])){reference(d[group],key,`${p}.${group}.${key}`);if(!Number.isInteger(lv)||lv<1||lv>d[group][key].max)fail(`${p}.${group}.${key}`,'等级无效');}}
    itemCounts(def.inventory,`${p}.inventory`);
  }
  for(const [id,def]of Object.entries(d.buffs)) {
    const p=`buffs.json.${id}`;fields(def,'name turns desc',p);integer(def.turns,`${p}.turns`,1);text(def.name,`${p}.name`);text(def.desc,`${p}.desc`);
    for(const field of ['attack','guard','hungerCost'])if(def[field]!==undefined)number(def[field],`${p}.${field}`,-Infinity);
  }
  for(const [id,def]of Object.entries(d.foods)) {
    const p=`foods.json.${id}`;fields(def,'cn desc hp hunger',p);text(def.cn,`${p}.cn`);text(def.desc,`${p}.desc`);number(def.hp,`${p}.hp`,-Infinity);integer(def.hunger,`${p}.hunger`,-Infinity);
    if(def.buff)reference(d.buffs,def.buff,`${p}.buff`);if(def.chance!==undefined)number(def.chance,`${p}.chance`,0,1);
  }
  for(const [id,def]of Object.entries(d.enemies)) {
    const p=`enemies.json.${id}`;fields(def,'cn en art tags summary hp atk armor scene pattern behavior params actionNames tier',p);reference(AI_FIELDS,def.behavior,`${p}.behavior`);fields(def.params,AI_FIELDS[def.behavior],`${p}.params`);
    positive(def.hp,`${p}.hp`);number(def.atk,`${p}.atk`);number(def.armor,`${p}.armor`);integer(def.tier,`${p}.tier`);if(def.enrageAfter!==undefined)integer(def.enrageAfter,`${p}.enrageAfter`);
    for(const key of ['cn','en','art','summary','scene'])text(def[key],`${p}.${key}`);
    for(const key of ['tags','pattern']){if(!Array.isArray(def[key])||!def[key].length)fail(`${p}.${key}`,'需要文本列表');def[key].forEach((v,i)=>text(v,`${p}.${key}[${i}]`));}
    object(def.actionNames,`${p}.actionNames`);for(const[key,value]of Object.entries(def.actionNames))text(value,`${p}.actionNames.${key}`);
    for(const[key,v]of Object.entries(def.params)){if(key==='phaseRatios'){if(!Array.isArray(v)||v.length!==2)fail(`${p}.params.${key}`,'需要两个阶段阈值');v.forEach(n=>number(n,`${p}.params.${key}`,0,1));if(v[0]<=v[1])fail(`${p}.params.${key}`,'阶段阈值必须递减');}else {number(v,`${p}.params.${key}`,key.endsWith('Bonus')?-Infinity:0);if(/period$/i.test(key))integer(v,`${p}.params.${key}`,1);if(key==='guardRatio')number(v,`${p}.params.${key}`,0,1);}}
  }
  const w=d.world;
  fields(w,'seed finalTower biomeSize redRadius roadSpacing revealRadius observationRadius leadRadius minMoveCost minHarvestCost maxFind minAmbush minDebuff starvationDamage collapse village ruins biomeThresholds tileInfo biomes enemyPools guardians boss tierDistance maxTier fallbackEnemies distanceScale enemyXp sites terrain harvest navigation defaultHungerCost campHungerCost','world.json');
  for(const key of ['tileInfo','biomes','enemyPools','terrain','harvest'])object(w[key],`world.json.${key}`);
  fields(w.navigation,'nearDistance axisRatio distanceBucket','world.json.navigation');for(const key of ['nearDistance','axisRatio','distanceBucket'])positive(w.navigation[key],`world.json.navigation.${key}`);
  integer(w.defaultHungerCost,'world.json.defaultHungerCost');integer(w.campHungerCost,'world.json.campHungerCost');
  for(const key of ['biomeSize','roadSpacing','minMoveCost','minHarvestCost','leadRadius'])positive(w[key],`world.json.${key}`);
  for(const key of ['biomeSize','roadSpacing','revealRadius','observationRadius','leadRadius'])integer(w[key],`world.json.${key}`);
  for(const key of ['maxFind','minAmbush','minDebuff'])number(w[key],`world.json.${key}`,0,1);
  number(w.seed,'world.json.seed',0,0xffffffff);number(w.finalTower.x,'world.json.finalTower.x',-Infinity);number(w.finalTower.y,'world.json.finalTower.y',-Infinity);
  fields(w.collapse,'hpRatio minHunger hungerRatio','world.json.collapse');number(w.collapse.hpRatio,'world.json.collapse.hpRatio',0,1);number(w.collapse.hungerRatio,'world.json.collapse.hungerRatio',0,1);
  for(const [id,tile]of Object.entries(w.tileInfo)){fields(tile,'cls icon name desc move enemyRate gather',`world.json.tileInfo.${id}`);if(tile.move!==null)integer(tile.move,`world.json.tileInfo.${id}.move`,1);}
  for(const key of ['.','=','B','E','X','C','V','R','Q'])reference(w.tileInfo,key,'world.json.tileInfo');
  table(w.biomeThresholds,w.biomes,'world.json.biomeThresholds');
  for(const [id,rows]of Object.entries(w.terrain)){reference(w.biomes,id,`world.json.terrain.${id}`);table(rows,w.tileInfo,`world.json.terrain.${id}`);}
  for(const [id,pool]of Object.entries(w.enemyPools)){reference(w.biomes,id,`world.json.enemyPools.${id}`);if(!Array.isArray(pool)||!pool.length)fail(`world.json.enemyPools.${id}`,'需要敌人列表');pool.forEach(x=>reference(d.enemies,x,`world.json.enemyPools.${id}`));}
  if(!Array.isArray(w.guardians)||!w.guardians.length)fail('world.json.guardians','需要塔印守卫');
  [...w.guardians,...w.fallbackEnemies,w.boss].forEach(id=>reference(d.enemies,id,'world.json.enemies'));
  if(!d.enemies[w.boss].params.phaseRatios)fail('world.json.boss','最终 Boss 必须使用已实现的阶段机制');
  for(const [id,profile]of Object.entries(w.harvest)) {
    const p=`world.json.harvest.${id}`;reference(w.tileInfo,id,p);fields(profile,'cost find ambush debuff loot debuffs',p);integer(profile.cost,`${p}.cost`,1);for(const key of ['find','ambush','debuff'])number(profile[key],`${p}.${key}`,0,1);table(profile.loot,d.foods,`${p}.loot`);table(profile.debuffs,d.buffs,`${p}.debuffs`);
  }
  itemCounts(w.village.items,'world.json.village.items');
  fields(w.village,'hp hunger items','world.json.village');number(w.village.hp,'world.json.village.hp');number(w.village.hunger,'world.json.village.hunger');
  fields(w.ruins,'xpBase depthDivisor','world.json.ruins');number(w.ruins.xpBase,'world.json.ruins.xpBase');positive(w.ruins.depthDivisor,'world.json.ruins.depthDivisor');
  fields(w.distanceScale,'start divisor max hp attackDivisor','world.json.distanceScale');for(const[key,value]of Object.entries(w.distanceScale))number(value,`world.json.distanceScale.${key}`);positive(w.distanceScale.divisor,'world.json.distanceScale.divisor');positive(w.distanceScale.attackDivisor,'world.json.distanceScale.attackDivisor');
  fields(w.enemyXp,'base hpDivisor scale eliteBonus eliteMultiplier bossMultiplier','world.json.enemyXp');for(const[key,value]of Object.entries(w.enemyXp))number(value,`world.json.enemyXp.${key}`);positive(w.enemyXp.hpDivisor,'world.json.enemyXp.hpDivisor');
  fields(w.sites,'campMinDistance campChance eliteMinDistance eliteChance eliteBias village ruins event enemy','world.json.sites');for(const[key,value]of Object.entries(w.sites))number(value,`world.json.sites.${key}`);for(const key of ['campChance','eliteChance','village','ruins','event','enemy'])number(w.sites[key],`world.json.sites.${key}`,0,1);
  if(!Array.isArray(w.tierDistance)||!w.tierDistance.length)fail('world.json.tierDistance','需要距离等级表');let previousDistance=0;for(const[i,[distance,tier]]of w.tierDistance.entries()){positive(distance,`world.json.tierDistance[${i}][0]`);if(distance<=previousDistance)fail('world.json.tierDistance','距离必须递增');previousDistance=distance;integer(tier,`world.json.tierDistance[${i}][1]`,1);}
  const r=d.rules;
  fields(r,'initial newRun combat growth messages handbook','rules.json');fields(r.initial,'classId hunger energy sound','rules.json.initial');reference(d.classes,r.initial.classId,'rules.json.initial.classId');
  for(const key of ['hunger','energy'])number(r.initial[key],`rules.json.initial.${key}`);fields(r.newRun,'energy','rules.json.newRun');number(r.newRun.energy,'rules.json.newRun.energy');
  fields(r.growth,'xpBase xpLinear xpExponent catchupEvery affinityLevelCap affinityWeightCap rewardCount rareWeight normalWeight ownedWeight gradeRank affinity unlocks','rules.json.growth');
  object(r.growth.gradeRank,'rules.json.growth.gradeRank');object(r.growth.affinity,'rules.json.growth.affinity');if(!Array.isArray(r.growth.unlocks))fail('rules.json.growth.unlocks','需要解锁条件列表');
  fields(r.combat,'basicGuard minDamage energyPerStep hungerPerStep exposedArmor exposedTurns poisonTurns enrageInterval trainingEnemy trainingStats retreat fallbackXp bossHiddenPhase bossHiddenSlot bossSealedPhase defenseActions grades','rules.json.combat');
  reference(d.enemies,r.combat.trainingEnemy,'rules.json.combat.trainingEnemy');positive(r.combat.enrageInterval,'rules.json.combat.enrageInterval');
  fields(r.combat.basicActions,'basic_attack basic_guard','rules.json.combat.basicActions');
  for(const[id,a]of Object.entries(r.combat.basicActions)){fields(a,'cn description cost cls',`rules.json.combat.basicActions.${id}`);text(a.cn,`rules.json.combat.basicActions.${id}.cn`);text(a.description,`rules.json.combat.basicActions.${id}.description`);number(a.cost,`rules.json.combat.basicActions.${id}.cost`);}
  fields(r.messages,'starvation collapse battleFood harvest harvestEmpty harvestAmbush towerLocked village ruins buff trainingEnd retreat sigil victoryTitle victoryText continue bossPhase armorDown xp rewardTitle rewardText campTitle campText wait sealed unknown attack','rules.json.messages');
  for(const[key,value]of Object.entries(r.messages))text(value,`rules.json.messages.${key}`);
  if(!Array.isArray(r.handbook)||!r.handbook.length)fail('rules.json.handbook','需要规则说明');r.handbook.forEach((row,i)=>{text(row.cn,`rules.json.handbook[${i}].cn`);text(row.text,`rules.json.handbook[${i}].text`);});
  for(const key of ['hp','atk','armor'])number(r.combat.trainingStats[key],`rules.json.combat.trainingStats.${key}`);
  fields(r.combat.retreat,'hpRatio energy minHunger','rules.json.combat.retreat');number(r.combat.retreat.hpRatio,'rules.json.combat.retreat.hpRatio',0,1);number(r.combat.retreat.energy,'rules.json.combat.retreat.energy');number(r.combat.retreat.minHunger,'rules.json.combat.retreat.minHunger');
  for(const key of ['basicGuard','minDamage','energyPerStep','hungerPerStep','exposedArmor','exposedTurns','poisonTurns','fallbackXp'])integer(r.combat[key],`rules.json.combat.${key}`);
  integer(r.combat.bossHiddenSlot,'rules.json.combat.bossHiddenSlot');if(r.combat.bossHiddenSlot>=3)fail('rules.json.combat.bossHiddenSlot','三槽计划的索引必须为 0..2');
  if(!Array.isArray(r.combat.grades)||!r.combat.grades.length)fail('rules.json.combat.grades','需要评价表');
  for(const [i,g]of r.combat.grades.entries()){const p=`rules.json.combat.grades[${i}]`;fields(g,'id damage steps xp',p);reference(r.growth.gradeRank,g.id,`${p}.id`);if(g.damage!==null)number(g.damage,`${p}.damage`);if(g.steps!==null)integer(g.steps,`${p}.steps`);number(g.xp,`${p}.xp`,0,1);}
  const fallback=r.combat.grades.at(-1);if(fallback.damage!==null||fallback.steps!==null)fail('rules.json.combat.grades','最后一档必须覆盖其余战斗');
  positive(r.growth.catchupEvery,'rules.json.growth.catchupEvery');positive(r.growth.rewardCount,'rules.json.growth.rewardCount');
  for(const key of ['xpBase','xpLinear','xpExponent'])number(r.growth[key],`rules.json.growth.${key}`);positive(r.growth.xpBase,'rules.json.growth.xpBase');integer(r.growth.xpBase,'rules.json.growth.xpBase');integer(r.growth.xpLinear,'rules.json.growth.xpLinear');
  for(const key of ['catchupEvery','affinityLevelCap','affinityWeightCap','rewardCount','rareWeight','normalWeight','ownedWeight'])integer(r.growth[key],`rules.json.growth.${key}`);
  for(const [id]of Object.entries(r.growth.affinity))reference({...d.skills,...d.passives,...d.equipment},id,`rules.json.growth.affinity.${id}`);
  for(const [i,unlock]of r.growth.unlocks.entries()){const p=`rules.json.growth.unlocks[${i}]`;fields(unlock,'field value id message',p);if(!['bestGrade','bossWins','harvests'].includes(unlock.field))fail(p,'未知解锁条件');if(unlock.field==='bestGrade')reference(r.growth.gradeRank,unlock.value,p);else number(unlock.value,p);}
  const effect=(e,p)=>{
    object(e,p);for(const key of Object.keys(e))if(!['items','hp','hunger','buff','xp','battle','message','extra','roll','chance','otherwise'].includes(key))fail(`${p}.${key}`,'未知事件效果');
    if(e.items)itemCounts(e.items,`${p}.items`);if(e.buff)reference(d.buffs,e.buff,`${p}.buff`);if(e.battle&&!['E','X','B'].includes(e.battle))fail(`${p}.battle`,'未知战斗类型');
    for(const key of ['hp','hunger'])if(e[key]!==undefined)number(e[key],`${p}.${key}`,-Infinity);if(e.hunger!==undefined)integer(e.hunger,`${p}.hunger`,-Infinity);
    if(e.xp){fields(e.xp,'base depthDivisor',`${p}.xp`);integer(e.xp.base,`${p}.xp.base`);positive(e.xp.depthDivisor,`${p}.xp.depthDivisor`);}
    if(e.extra){effect(e.extra,`${p}.extra`);number(e.extra.chance,`${p}.extra.chance`,0,1);if(!['regional','meal'].includes(e.extra.roll))fail(`${p}.extra.roll`,'未知随机来源');if(e.extra.extra)fail(`${p}.extra.extra`,'不支持嵌套条件');}
  };
  fields(d.events,'regionalChance regional regionalFallback common camp','events.json');object(d.events.regional,'events.json.regional');number(d.events.regionalChance,'events.json.regionalChance',0,1);reference(d.events.regional,d.events.regionalFallback,'events.json.regionalFallback');
  const event=(e,p)=>{fields(e,'title text choices',p);text(e.title,`${p}.title`);text(e.text,`${p}.text`);if(!Array.isArray(e.choices)||!e.choices.length)fail(`${p}.choices`,'需要选项');e.choices.forEach((c,i)=>{text(c.label,`${p}.choices[${i}].label`);effect(c.effect,`${p}.choices[${i}].effect`);});};
  for(const [id,e]of Object.entries(d.events.regional)){reference(w.biomes,id,`events.json.regional.${id}`);event(e,`events.json.regional.${id}`);}
  if(!Array.isArray(d.events.common)||!d.events.common.length)fail('events.json.common','需要事件列表');d.events.common.forEach((e,i)=>event(e,`events.json.common[${i}]`));
  if(!Array.isArray(d.events.camp)||!d.events.camp.length)fail('events.json.camp','需要营火配方');d.events.camp.forEach((c,i)=>{const p=`events.json.camp[${i}]`;fields(c,'label items hp hunger',p);text(c.label,`${p}.label`);itemCounts(c.items,`${p}.items`);number(c.hp,`${p}.hp`);number(c.hunger,`${p}.hunger`);if(c.buff)reference(d.buffs,c.buff,`${p}.buff`);});
}

export class GameResources {
  constructor(data) {
    validate(data);
    this.data=freeze(structuredClone(data));
    // Verify every shipped template at the same boundary as numeric data.
    for(const group of ['skills','passives','equipment'])for(const[id,d]of Object.entries(this.data[group]))for(let lv=1;lv<=d.max;lv++)this.describe(group,id,lv);
    for(const id of Object.keys(this.data.buffs))this.buff(id);
    for(const id of Object.keys(this.data.foods))this.food(id);
    for(const id of Object.keys(this.data.enemies))this.enemy(id);
    for(const id of Object.keys(this.data.classes))this.characterClass(id);
    Object.freeze(this);
  }
  static async load(read) {
    const entries=await Promise.all(RESOURCE_FILES.map(async file=>{
      try {return [file,await read(file+'.json')];}
      catch(error){throw Object.assign(new Error(`${file}.json: ${error.message}`),{code:'RESOURCE_LOAD_FAILED'});}
    }));
    return new GameResources(Object.fromEntries(entries));
  }
  get(group,id) {return this.data[group][id];}
  level(group,id,level) {return this.data[group][id].levels[level-1];}
  amount(group,id,level,key) {return level ? this.level(group,id,level)[key] : 0;}
  format(template,values,path='resource') {
    return template.replace(/\{(\w+)\}/g,(_,key)=>{if(values[key]===undefined)fail(path,`未知模板参数 ${key}`);return String(values[key]);});
  }
  describe(group,id,level) {
    const d=this.get(group,id),p=this.level(group,id,level);
    const path=`${group}.json.${id}.levels[${level-1}].description`;
    const values={...d,...p,healPercent:Math.round((p.healRate||0)*100),attackBonusText:p.attackBonus?`+${p.attackBonus}`:'',hpPercent:Math.round((p.hpRatio||0)*100),findPercent:Math.round((p.findBonus||0)*100),xpPercent:Math.round((p.xpRate||0)*100),retainedBlock:p.block&&d.blockDescription?this.format(d.blockDescription,p,path):'',minMoveCost:this.data.world.minMoveCost};
    values.details=(d.details||[]).filter(part=>p[part.when]).map(part=>this.format(part.text,values,path)).join('');
    return this.format(p.description,values,path);
  }
  characterClass(id) {
    const d=this.data.classes[id],condition=this.data.rules.growth.unlocks.find(u=>u.id==='class_'+id);
    return {...d,unlock:this.format(d.unlock,{required:condition?.value},`classes.json.${id}.unlock`)};
  }
  buff(id,overrides={}) {
    const b={id,...this.data.buffs[id],...overrides};
    return {...b,desc:this.format(b.desc,{...b,minMoveCost:this.data.world.minMoveCost},`buffs.json.${id}.desc`)};
  }
  food(id) {
    const f=this.data.foods[id],b=f.buff?this.buff(f.buff):{};
    return {...f,desc:this.format(f.desc,{...f,chancePercent:Math.round((f.chance||0)*100),buffName:b.name,buffTurns:b.turns,buffGuard:b.guard,buffAttack:b.attack,buffHungerCost:b.hungerCost},`foods.json.${id}.desc`)};
  }
  enemy(id,stats={}) {
    const {behavior,params:p,actionNames,tier,...d}=this.data.enemies[id],c=this.data.rules.combat;
    const v={...d,...p,...stats};
    Object.assign(v,{beforePeriod:p.period-1,heavyDamage:v.atk+(p.heavyBonus||0),drainDamage:v.atk+(p.drainBonus||0),burstDamage:v.atk+(p.burstBonus||0),finalDamage:v.atk+(p.finalBonus||0),finalHeavyDamage:v.atk+(p.finalHeavyBonus||0),guardPercent:Math.round((p.guardRatio||0)*100),phaseHighPercent:Math.floor((p.phaseRatios?.[0]||0)*100),phaseLowPercent:Math.floor((p.phaseRatios?.[1]||0)*100),enrageStart:(d.enrageAfter||0)+1,enrageInterval:c.enrageInterval,poisonTurns:c.poisonTurns});
    return {...d,...stats,summary:this.format(d.summary,v,`enemies.json.${id}.summary`),pattern:d.pattern.map((t,i)=>this.format(t,v,`enemies.json.${id}.pattern[${i}]`))};
  }
}
