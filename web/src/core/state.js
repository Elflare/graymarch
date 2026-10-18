export function initialState(){
return {
  x:0,y:0,visited:new Set(['0,0']),discovered:new Set(),spent:new Set(),harvested:new Set(),eventsSeen:new Set(),cleared:new Set(),
  wins:0,level:1,xp:0,sigils:0,victory:false,pendingRewards:0,worldTurn:0,hunger:80,maxHunger:100,
  inventory:{berries:1,mushroom:0,roots:1,meat:0,herb:0,seedcake:0,nuts:0,bogfruit:0,emberberry:0},buffs:[],sound:true,
  inBattle:false,training:false,battleOrigin:null,lastReport:null,classId:'wanderer',
  meta:{bossWins:0,bestGrade:'C',harvests:0,unlocks:[]},
  player:{hp:18,maxHp:18,attack:4,energy:2,maxEnergy:3,block:0,skills:{},passives:{},equipment:{}},battle:null
};
}
export const SET_FIELDS=["visited","discovered","spent","harvested","eventsSeen","cleared"];
export function cloneState(s){const o=JSON.parse(JSON.stringify(s,(_,v)=>v instanceof Set?[...v]:v)); for(const k of SET_FIELDS)o[k]=new Set(o[k]);return o;}
export function replaceState(s,o){for(const k of Object.keys(s))delete s[k];Object.assign(s,o);}
