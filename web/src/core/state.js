export function initialState(resources){
 const {classes,foods,rules}=resources.data,defaults=rules.initial,c=classes[defaults.classId];
 return {
  x:0,y:0,visited:new Set(['0,0']),discovered:new Set(),spent:new Set(),harvested:new Set(),eventsSeen:new Set(),cleared:new Set(),
  wins:0,level:1,xp:0,sigils:0,victory:false,pendingRewards:0,worldTurn:0,hunger:defaults.hunger,maxHunger:c.base.hunger,
  inventory:Object.fromEntries(Object.keys(foods).map(id=>[id,c.inventory[id]||0])),buffs:[],sound:defaults.sound,
  inBattle:false,training:false,battleOrigin:null,lastReport:null,classId:defaults.classId,
  meta:{bossWins:0,bestGrade:'C',harvests:0,unlocks:[]},
  player:{hp:c.base.hp,maxHp:c.base.hp,attack:c.base.attack,energy:Math.min(defaults.energy,c.base.energy),maxEnergy:c.base.energy,block:0,skills:{...c.skills},passives:{...c.passives},equipment:{...c.equipment}},battle:null
 };
}
export const SET_FIELDS=["visited","discovered","spent","harvested","eventsSeen","cleared"];
export function cloneState(s){const o=JSON.parse(JSON.stringify(s,(_,v)=>v instanceof Set?[...v]:v)); for(const k of SET_FIELDS)o[k]=new Set(o[k]);return o;}
export function replaceState(s,o){for(const k of Object.keys(s))delete s[k];Object.assign(s,o);}
