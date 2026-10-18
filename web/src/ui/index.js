import {playerSVG, enemySVG} from './artwork.js';

/**
 * Original Graymarch presentation, adapted to an authoritative engine.
 * UI holds a disposable snapshot only. Every game change goes through humanAct.
 */
export function mountUI(game) {
  let R = game.uiRuntime();
  const $ = id => document.getElementById(id);
  const VIEW_W = 19, VIEW_H = 11;
  const {classDefs, tileInfo, foodDefs, activeSkills, passiveDefs, equipDefs, rewardPool, enemyDefs, FINAL_TOWER} = R;
  let state = R.state;
  let audioEnabled = state.sound !== false;
  let mounted = true;
  let busy = false;
  let ownershipBusy = false;
  let currentScreen = state.inBattle ? 'battle' : 'world';
  let lastBattleId = null;
  let lastCombatReport = null;
  let lastEpoch = state.epoch;
  let displayedRevision = state.revision;
  let previousInBattle = state.inBattle;
  let playback = null;
  let lastPresentationId = null;
  const effectTimers = new Set();
  const queryNames = ['tileAt','biomeAt','enemyFor','harvestProfile','xpNeed','moveCostFor','basicGuardAmount','currentIntent','filledPlanCount','nextPlanSlot','armorOf','bossPhase','actionCatalog','actionInfo','projectedEnergyBeforeSlot','simulatePlan','levelOf','offerTargetLevel'];
  for (const name of queryNames) {
    if (typeof R[name] !== 'function') throw new Error(`Missing UI query: ${name}`);
  }
  const tileAt = (...args) => R.tileAt(...args);
  const biomeAt = (...args) => R.biomeAt(...args);
  const enemyFor = (...args) => R.enemyFor(...args);
  const harvestProfile = (...args) => R.harvestProfile(...args);
  const xpNeed = (...args) => R.xpNeed(...args);
  const moveCostFor = (...args) => R.moveCostFor(...args);
  const basicGuardAmount = (...args) => R.basicGuardAmount(...args);
  const currentIntent = (i = 0) => state.battle?.lockedIntents[i];
  const filledPlanCount = (...args) => R.filledPlanCount(...args);
  const nextPlanSlot = (...args) => R.nextPlanSlot(...args);
  const armorOf = (...args) => R.armorOf(...args);
  const bossPhase = (...args) => R.bossPhase(...args);
  const actionCatalog = () => R.actionCatalog(state.player, {buffs:state.buffs});
  const actionInfo = id => R.actionInfo(id, state.player, {buffs:state.buffs});
  const projectedEnergyBeforeSlot = (...args) => playback ? null : R.projectedEnergyBeforeSlot(...args);
  const projectedCooldownBeforeSlot = (...args) => playback ? null : R.projectedCooldownBeforeSlot(...args);
  const simulatePlan = (...args) => playback ? null : R.simulatePlan(...args);
  const levelOf = (...args) => R.levelOf(...args);
  const offerTargetLevel = (...args) => R.offerTargetLevel(...args);
  const classBase = () => classDefs[state.classId] || classDefs.wanderer;
  const classUnlocked = id => id === 'wanderer' || (state.meta?.unlocks || []).includes('class_' + id);
  const pct = v => `${Math.round(v * 100)}%`;
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MOVE_MS=150;
let mapMoving=false;
let mapBuilt=false;
let cameraX=0,cameraY=0;
function resetMapMotion(){
  mapMoving=false;
  let marker=$('mapPlayer');
  if(marker){
    marker.getAnimations?.().forEach(a=>a.cancel());
    marker.style.transform='';
  }
}
function resetMapCamera(){cameraX=state.x;cameraY=state.y}
function mapX0(){return cameraX-Math.floor(VIEW_W/2)}
function mapY0(){return cameraY-Math.floor(VIEW_H/2)}
function worldCell(x,y){return $('worldMap')?.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)||null}
function ensureMapGrid(){
  let m=$('worldMap'),marker=$('mapPlayer');
  if(!m)return;
  let cells=m.querySelectorAll('.cell');
  if(mapBuilt&&cells.length===VIEW_W*VIEW_H)return;

  cells.forEach(el=>el.remove());
  let frag=document.createDocumentFragment();
  for(let vy=0;vy<VIEW_H;vy++)for(let vx=0;vx<VIEW_W;vx++){
    let el=document.createElement('div');
    el.className='cell hidden';
    el.dataset.vx=vx;el.dataset.vy=vy;
    el.style.gridColumn=String(vx+1);
    el.style.gridRow=String(vy+1);
    frag.appendChild(el);
  }
  m.insertBefore(frag,marker||null);
  mapBuilt=true;
}
function playerGridPos(x=state.x,y=state.y){
  let vx=x-mapX0(),vy=y-mapY0();
  if(vx<0||vx>=VIEW_W||vy<0||vy>=VIEW_H)return null;
  return {col:vx+1,row:vy+1};
}
function placePlayerGrid(x=state.x,y=state.y,{animate=false}={}){
  let marker=$('mapPlayer'),pos=playerGridPos(x,y);
  if(!marker||!pos)return false;

  marker.getAnimations?.().forEach(a=>a.cancel());
  if(!animate){
    marker.style.transform='';
    marker.style.gridColumn=String(pos.col);
    marker.style.gridRow=String(pos.row);
    marker.classList.add('ready');
    return true;
  }

  let oldRect=marker.getBoundingClientRect();
  marker.style.gridColumn=String(pos.col);
  marker.style.gridRow=String(pos.row);
  marker.classList.add('ready');
  let newRect=marker.getBoundingClientRect();
  let dx=oldRect.left-newRect.left,dy=oldRect.top-newRect.top;
  marker.style.transform='';

  if(matchMedia('(prefers-reduced-motion: reduce)').matches||(!dx&&!dy))return true;
  marker.animate(
    [{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0px,0px)'}],
    {duration:MOVE_MS,easing:'cubic-bezier(.22,.8,.35,1)',fill:'both'}
  );
  return true;
}
function playerInsideCamera(x=state.x,y=state.y){return !!playerGridPos(x,y)}
function recenterCamera(){cameraX=state.x;cameraY=state.y}
function key(x,y){return `${x},${y}`} function clamp(v,a,b){return Math.max(a,Math.min(b,v))}

function enemyArt(id){return enemyDefs[id]?.art||id}
function renderSigils(){
  let n=Math.max(0,Math.min(3,state.sigils||0));
  let text=$('worldSigilText'); if(text)text.textContent=`${n}/3`;
  let host=$('worldSigils');
  if(host){
    host.innerHTML=[0,1,2].map(i=>`<span class="sigil-mark ${i<n?'filled':''}">${i<n?'◆':'◇'}</span>`).join('')+`<span class="sigil-label">${n<3?'击败精英获得':'<b>赤塔封印已解除</b>'}</span>`;
  }
}
function renderMeta(){$('metaSigils').textContent=`${state.sigils}/3`;$('soundBtn').textContent=audioEnabled?'🔊 音效':'🔇 静音';renderSigils()}

function compassDir(dx,dy){
  let ax=Math.abs(dx),ay=Math.abs(dy);
  if(ax<2&&ay<2)return '附近';
  if(ax>ay*1.8)return dx>0?'东':'西';
  if(ay>ax*1.8)return dy>0?'南':'北';
  return `${dy>0?'南':'北'}${dx>0?'东':'西'}`;
}
function approxDist(n){
  if(n<=5)return '5格内';
  let lo=Math.max(5,Math.floor(n/5)*5),hi=lo+5;
  return `约${lo}–${hi}格`;
}
function findSigilLeads(count=Math.max(0,3-state.sigils),maxR=44){
  if(count<=0)return [];
  let out=[];
  for(let y=state.y-maxR;y<=state.y+maxR;y++){
    for(let x=state.x-maxR;x<=state.x+maxR;x++){
      let d=Math.abs(x-state.x)+Math.abs(y-state.y);
      if(!d||d>maxR)continue;
      let k=key(x,y);
      if(!state.cleared.has(k)&&tileAt(x,y)==='X') out.push({x,y,d});
    }
  }
  out.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
  // 只显示尚需塔印数量的最近线索；它们只是导航，不会揭露精确坐标。
  return out.slice(0,count);
}
function navPoint(dx,dy,index=0){
  let ax=Math.abs(dx)||.001,ay=Math.abs(dy)||.001;
  let sx=44/ax,sy=41/ay,scale=Math.min(sx,sy);
  let x=50+dx*scale,y=50+dy*scale;
  // 多个目标方向相近时略微错开，避免标签完全重叠。
  let jitter=(index%3-1)*4;
  if(Math.abs(dx)>=Math.abs(dy)) y+=jitter; else x+=jitter;
  return {x:Math.max(6,Math.min(94,x)),y:Math.max(7,Math.min(93,y))};
}
function arrowFor(dx,dy){
  let dir=compassDir(dx,dy);
  return ({东:'→',西:'←',南:'↓',北:'↑',东北:'↗',西北:'↖',东南:'↘',西南:'↙',附近:'◆'})[dir]||'◆';
}
function renderNavMarkers(){
  let host=$('navMarkers'); if(!host)return;
  let items=[];
  if(state.sigils<3){
    let leads=findSigilLeads();
    leads.forEach((p,i)=>{
      let dx=p.x-state.x,dy=p.y-state.y,pos=navPoint(dx,dy,i);
      items.push(`<div class="nav-marker sigil" style="left:${pos.x}%;top:${pos.y}%"><span class="arrow">${arrowFor(dx,dy)}</span>塔印线索 · ${compassDir(dx,dy)} · ${approxDist(p.d)}</div>`);
    });
  }else if(!state.victory){
    let dx=FINAL_TOWER.x-state.x,dy=FINAL_TOWER.y-state.y,d=Math.abs(dx)+Math.abs(dy),pos=navPoint(dx,dy,0);
    items.push(`<div class="nav-marker boss" style="left:${pos.x}%;top:${pos.y}%"><span class="arrow">${arrowFor(dx,dy)}</span>赤塔 · ${compassDir(dx,dy)} · ${approxDist(d)}</div>`);
  }
  host.innerHTML=items.join('');
}
function objectiveText(){
  if(state.victory)return `<div class="goal-line goal-done"><b>✓ 赤塔领主已被击败</b><br>灰境主线完成，你仍可继续无尽探索。</div>`;
  if(state.sigils<3){
    let remain=3-state.sigils,leads=findSigilLeads(remain);
    let hint=leads.length?`地图边缘已标出 ${leads.length} 条最近的塔印线索。`:`继续向外探索，寻找精英留下的塔印线索。`;
    return `<div class="goal-line"><b>主线：收集赤塔印记</b><br>已获得 <b>${state.sigils}/3</b>，还需要 <b>${remain}</b> 枚。<br>${hint}<br><span class="muted">赤塔位置会在三枚塔印集齐后显现。</span></div>`;
  }
  let dx=FINAL_TOWER.x-state.x,dy=FINAL_TOWER.y-state.y,d=Math.abs(dx)+Math.abs(dy);
  return `<div class="goal-line"><b>主线：前往赤塔</b><br>三枚塔印已经共鸣，赤塔方位已显现。<br>位于 <b>${compassDir(dx,dy)}</b> 方，${approxDist(d)}。</div>`;
}
function terrainTooltip(x,y,t){
  let inf=tileInfo[t],bio=biomeAt(x,y),cost=moveCostFor(t),html=`<b>${inf.name}</b><br><span class="muted">区域：</span>${bio.name}<br>${inf.desc}<br><span class="muted">移动饥饿：</span><span class="tip-move">${cost==null?'不可通行':cost}</span>`;
  let hp=harvestProfile(t);
  if(hp){
    html+=`<br><span class="muted">可采集：</span><span class="tip-gather">${inf.gather}</span>`;
    html+=`<br><span class="muted">采集消耗：</span><span class="tip-cost">${hp.cost} 饥饿 / 1回合</span>`;
    html+=`<br><span class="muted">找到物资：</span><span class="tip-find">${pct(hp.find)}</span>`;
    html+=`<br><span class="muted">采集伏击：</span><span class="tip-risk">${pct(hp.ambush)}</span>`;
    html+=`<br><span class="muted">负面状态：</span><span class="tip-debuff">${pct(hp.debuff)}</span>`;
  }else{
    html+=`<br><span class="muted">采集：</span><span class="tip-gather">${inf.gather}</span>`;
  }
  html+=`<br><span class="muted">地形敌对：</span><span class="tip-enemy-rate">${inf.enemyRate}</span>`;
  let k=key(x,y);
  if(state.harvested.has(k))html+='<br><span class="muted">此地已采集。</span>';
  if((t==='E'||t==='X'||t==='B')&&!state.cleared.has(k)){
    let e=enemyFor(x,y,t);
    html+=`<hr style="border:0;border-top:1px solid #3b382f"><b>${e.cn} / ${e.en}</b><br><span class="tip-hp">HP ${e.maxHp}</span> · <span class="tip-atk">ATK ${e.atk}</span> · <span class="tip-armor">ARMOR ${e.baseArmor}</span> · <span class="tip-exp">EXP ${e.xp}</span><br><span class="tip-id">${e.id||''}</span>${e.id?'<br>':''}${e.summary}`;
    if(t==='B'&&state.sigils<3)html+=`<br><b>赤塔仍被迷雾与封印遮蔽。</b>`;
  }
  return html
}
function showTip(ev,html){let t=$('hoverTip');t.innerHTML=html;t.classList.add('show');let x=Math.min(innerWidth-310,ev.clientX+14),y=Math.min(innerHeight-170,ev.clientY+14);t.style.left=x+'px';t.style.top=y+'px'} function hideTip(){$('hoverTip').classList.remove('show')}
function openAtlas(){
  
  let pts=[...state.discovered].map(k=>k.split(',').map(Number)).filter(a=>Number.isFinite(a[0])&&Number.isFinite(a[1]));
  if(!pts.length)return toast('还没有探索记录');
  let xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs)-1,maxX=Math.max(...xs)+1,minY=Math.min(...ys)-1,maxY=Math.max(...ys)+1;
  let cell=14,w=(maxX-minX+1)*cell,h=(maxY-minY+1)*cell,svg=$('atlasSvg');
  let colors={'.':'#4b503a','G':'#496b43','T':'#28452e','S':'#42564e','=':'#766247','^':'#5b5953','~':'#314f5c','V':'#9b7745','R':'#716154','Q':'#735d83','E':'#763e39','X':'#724166','B':'#9c4037'};
  let parts=[`<rect width="${w}" height="${h}" fill="#0a0b09"/>`];
  for(let [x,y] of pts){let t=tileAt(x,y),fill=colors[t]||'#555',opacity=state.visited.has(key(x,y))?1:.62;parts.push(`<rect x="${(x-minX)*cell}" y="${(y-minY)*cell}" width="${cell-1}" height="${cell-1}" rx="2" fill="${fill}" opacity="${opacity}"/>`)}
  let px=(state.x-minX)*cell+cell/2,py=(state.y-minY)*cell+cell/2;parts.push(`<circle cx="${px}" cy="${py}" r="${Math.max(4,cell*.38)}" fill="#f2d38b" stroke="#2b2111" stroke-width="2"/>`);
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.innerHTML=parts.join('');$('atlasOverlay').classList.add('show')
}
function renderMap(){
  
  ensureMapGrid();
  if(!playerInsideCamera())recenterCamera();

  let m=$('worldMap'),x0=mapX0(),y0=mapY0(),cells=[...m.querySelectorAll('.cell')];
  for(let i=0;i<cells.length;i++){
    let el=cells[i],vx=i%VIEW_W,vy=Math.floor(i/VIEW_W);
    let x=x0+vx,y=y0+vy,k=key(x,y),t=tileAt(x,y),info=tileInfo[t];
    let md=Math.abs(x-state.x)+Math.abs(y-state.y),visible=md<=2,known=visible||state.discovered.has(k);
    let bossHidden=(t==='B'&&state.sigils<3&&!(x===state.x&&y===state.y));
    if(bossHidden){info=tileInfo['.'];known=visible||state.discovered.has(k)}

    el.dataset.x=x;el.dataset.y=y;
    el.className=`cell ${known?info.cls:'hidden'}`;
    el.textContent=known?info.icon:' ';
    if(known&&!visible)el.classList.add('memory');
    if((t==='V'||t==='R'||t==='Q'||t==='C')&&(state.spent.has(k)||state.eventsSeen.has(k)))el.classList.add('spent');
    if((t==='E'||t==='X'||t==='B')&&state.cleared.has(k)){
      el.className='cell plain'+(known&&!visible?' memory':'');
      el.textContent='·';
    }

    let pass=moveCostFor(t)!=null;
    if(md===1&&pass&&!mapMoving){
      el.classList.add('adjacent','passable');
      el.onclick=()=>moveTo(x,y);
    }else el.onclick=null;

    if(known){
      el.onmouseenter=ev=>showTip(ev,terrainTooltip(x,y,t));
      el.onmousemove=ev=>showTip(ev,terrainTooltip(x,y,t));
      el.onmouseleave=hideTip;
    }else{
      el.onmouseenter=null;el.onmousemove=null;el.onmouseleave=null;
    }
  }

  if(!mapMoving)placePlayerGrid(state.x,state.y,{animate:false});

  let cur=tileAt(state.x,state.y),inf=tileInfo[cur];
  let bio=biomeAt(state.x,state.y);$('placeName').textContent=`${bio.name} · ${inf.name}`;
  $('placeDesc').textContent=`${bio.desc} ${inf.desc}`;
  $('coord').textContent=`${state.x}, ${state.y}`;
  $('visited').textContent=state.discovered.size;
  $('worldTurn').textContent=state.worldTurn;
  $('worldClass').textContent=classBase().cn;$('worldLevel').textContent=state.level;
  $('worldHpText').textContent=`${state.player.hp}/${state.player.maxHp}`;
  $('worldHpBar').style.width=`${100*state.player.hp/state.player.maxHp}%`;
  $('hungerText').textContent=`${state.hunger}/${state.maxHunger}`;
  $('hungerBar').style.width=`${100*state.hunger/state.maxHunger}%`;
  $('xpText').textContent=`${state.xp}/${xpNeed(state.level)}`;
  $('xpBar').style.width=`${100*state.xp/xpNeed(state.level)}%`;
  $('objective').innerHTML=objectiveText();
  renderNavMarkers();renderInventory();renderBuffs();renderSigils();renderLastReport();
  let hb=$('harvestBtn');
  setAvailability(hb,canHarvest(cur)&&!state.harvested.has(key(state.x,state.y)));
  hb.textContent=state.harvested.has(key(state.x,state.y))?'已采集':'采集';
  let cb=$('campBtn'),ck=key(state.x,state.y);
  setAvailability(cb,cur==='C'&&!state.spent.has(ck));
  cb.textContent=cur==='C'&&state.spent.has(ck)?'营火已熄':'营火';
  renderMeta();
}
function canHarvest(t){return ['.','G','T','S'].includes(t)}
function renderInventory(){$('inventoryGrid').innerHTML=Object.entries(foodDefs).map(([id,d])=>`<button class="inv-btn" data-eat="${id}" data-unavailable="${(state.inventory[id]||0)<=0}" ${(state.inventory[id]||0)<=0?'disabled':''}><b>${d.cn} ×${state.inventory[id]||0}</b><span>${d.desc}</span></button>`).join('');document.querySelectorAll('[data-eat]').forEach(b=>b.onclick=()=>humanAction('inventory.eat',{itemId:b.dataset.eat}))}
function renderBuffs(){
  let list=state.buffs.filter(b=>b.turns>0),host=$('buffList');host.innerHTML='';
  if(!list.length){host.innerHTML='<span class="small">无</span>';return}
  list.forEach((b,i)=>{
    let el=document.createElement('span');
    let bad=(b.attack||0)<0||(b.guard||0)<0||(b.hungerCost||0)>0;
    el.className=`buff-chip ${bad?'bad':'good'}`;
    el.textContent=`${b.name} · ${b.turns}回合`;
    let tip=`<b>${escapeHtml(b.name)}</b><br>${escapeHtml(b.desc||'暂无说明')}<br><span class="muted">剩余：</span>${b.turns} 回合`;
    el.onmouseenter=e=>showTip(e,tip);el.onmousemove=e=>showTip(e,tip);el.onmouseleave=hideTip;
    host.appendChild(el);
  })
}

function setScreen(name){
  currentScreen=name;
  hideTip();
  resetMapMotion();
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  $(name).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.screen===name));
}


function renderLastReport(){
 let el=$('lastBattleReport'),r=state.lastReport;if(!el)return;
 if(!r){el.className='last-report';el.innerHTML='';return}
 el.className='last-report show';
 el.innerHTML=`<div class="report-head"><div><div class="report-name">最近战斗 · ${escapeHtml(r.enemy)}</div><b>战术评价</b></div><div class="grade ${escapeHtml(['S','A','B','C'].includes(r.grade)?r.grade:'C')}">${escapeHtml(['S','A','B','C'].includes(r.grade)?r.grade:'C')}</div></div>
 <div class="report-stats"><span>造成伤害 <b>${escapeHtml(r.damageDealt)}</b></span><span>受到伤害 <b>${escapeHtml(r.damageTaken)}</b></span><span>格挡伤害 <b>${escapeHtml(r.blocked)}</b></span><span>精准格挡 <b>${escapeHtml(r.exactBlocks)}</b></span><span>战斗回合 <b>${escapeHtml(r.rounds)}</b></span><span>额外 EXP <b>+${escapeHtml(r.bonusXp)}</b></span></div>`;
}

function actionIcon(id){
  const icons={
    basic_attack:'⚔',attack:'⚔',heavy:'✦',
    basic_guard:'◆',guard:'◆',guard_stance:'◆',riposte:'↩',
    heal:'✚',armor_break:'⌁',charge:'▲',execute:'☠',
    fireball:'●',bleed_strike:'滴',frost_bind:'❄',
    life_drain:'✧',whirlwind:'⟳',mirror_guard:'◇',break_rhythm:'✂',stagger:'⊘',time_snare:'◷',fate_swap:'⇄',combo_strike:'⚔',venom:'☣',wait:'·'
  };
  return icons[id]||'✦';
}
function actionIconClass(id){
  if(['basic_guard','guard','guard_stance','riposte','mirror_guard'].includes(id))return 'defense';
  if(['time_snare','fate_swap'].includes(id))return 'magic';
  if(id==='heal')return 'heal';
  if(id==='fireball')return 'fire';
  if(id==='bleed_strike')return 'bleed';
  if(id==='frost_bind')return 'frost';
  if(id==='venom')return 'poison';
  if(['charge','life_drain'].includes(id))return 'magic';
  if(id==='wait')return 'wait';
  return 'attack';
}
function actionNameHtml(id,name){
  return `<span class="act-name"><span class="act-icon ${actionIconClass(id)}">${actionIcon(id)}</span><span>${escapeHtml(name)}</span></span>`;
}

function statusChip(host,icon,label,desc,cls=''){
 let el=document.createElement('span');el.className=`cstatus ${cls}`;el.innerHTML=`<b>${escapeHtml(icon)}</b>${escapeHtml(label)}`;
 let tip=`<b>${escapeHtml(label)}</b><br>${escapeHtml(desc)}`;el.onmouseenter=e=>showTip(e,tip);el.onmousemove=e=>showTip(e,tip);el.onmouseleave=hideTip;host.appendChild(el)
}
function renderCombatStatuses(){
 let b=state.battle;if(!b)return;let p=state.player,e=b.enemy,ph=$('pStatusIcons'),eh=$('eStatusIcons');ph.innerHTML='';eh.innerHTML='';
 if(p.charge)statusChip(ph,'▲',`蓄力 +${p.charge}`,'下一次造成伤害时增加该数值。','magic');
 if(p.riposte?.turns)statusChip(ph,'↩',`反击 ${p.riposte.turns}`,'完全格挡敌人攻击时触发反击。','good');if(p.thorns?.turns)statusChip(ph,'✣',`荆棘 ${p.thorns.turns}`,'格挡敌人攻击时反伤 2。','good');
  if(p.poison?.turns)statusChip(ph,'☣',`中毒 ${p.poison.turns}`,'回合结束受到毒素伤害。','bad');
  for(let[id,n]of Object.entries(p.cooldowns||{}))statusChip(ph,'◷',`${activeSkills[id].cn} ${n} 步`,`${n} 步内无法再次施放，冷却跨计划批次延续。`,'magic');
 for(let x of state.buffs.filter(x=>x.turns>0&&(x.attack||x.guard)))statusChip(ph,x.attack?'⚔':'◆',`${x.name} ${x.turns}`,x.desc||'旅途效果。',x.attack<0||x.guard<0?'bad':'good');
 if(e.bleed?.turns)statusChip(eh,'滴',`流血 ${e.bleed.turns}`,`每回合受到 ${e.bleed.dmg} 伤害。`,'bad');
 if(e.burn?.turns)statusChip(eh,'●',`灼烧 ${e.burn.turns}`,`每回合受到 ${e.burn.dmg} 伤害。`,'fire');
 if(e.armorDebuff?.turns)statusChip(eh,'⌁',`破甲 ${e.armorDebuff.turns}`,`护甲 -${e.armorDebuff.amount}。`,'bad');
 if(e.damageDown?.turns)statusChip(eh,'❄',`霜缚 ${e.damageDown.turns}`,`造成伤害 -${e.damageDown.amount}。`,'frost');if(e.guardDown?.turns)statusChip(eh,'◇',`冻盾 ${e.guardDown.turns}`,`格挡效果 -${e.guardDown.amount}。`,'frost');
 if(e.exposed>0)statusChip(eh,'✧',`破绽 ${e.exposed}`,'当前护甲视为降低。','magic');
  if(e.intentDisrupt)statusChip(eh,'✂','破势','下一次行动已被削弱。','bad');
  if(e.enrage)statusChip(eh,'✦',`狂暴 +${e.enrage}`,'攻击伤害已提高；每经过 3 步再 +1。','bad');
}
function renderBattle(){if(!state.battle)return;let p=state.player,e=state.battle.enemy,b=state.battle;$('battle').classList.toggle('resolving',!!b.resolving);
let bio=e.biome||biomeAt(state.x,state.y).id;$('battlefield').className=`battlefield biome-${e.id==='lord'?'red':bio}`;$('sceneTitle').textContent=e.scene;$('enemyName').textContent=e.cn;$('enemyTrait').textContent=e.tags.join(' / ');$('php').textContent=p.hp;$('pmax').textContent=p.maxHp;$('patk').textContent=p.attack;$('energy').textContent=p.energy;$('emax').textContent=p.maxEnergy;$('pblock').textContent=p.block;$('battleHunger').textContent=state.hunger;$('battleHungerMax').textContent=state.maxHunger;$('ehp').textContent=e.hp;$('ehpMax').textContent=e.maxHp;$('earmor').textContent=armorOf(e);$('eblock').textContent=e.block;$('turn').textContent=b.turn;$('phpBar').style.width=`${100*p.hp/p.maxHp}%`;$('ehpBar').style.width=`${100*e.hp/e.maxHp}%`;$('energyBar').style.width=`${100*p.energy/p.maxEnergy}%`;$('pblockBar').style.width=`${Math.min(100,100*p.block/p.maxHp)}%`;$('battleHungerBar').style.width=`${100*state.hunger/state.maxHunger}%`;$('eblockBar').style.width=`${Math.min(100,100*e.block/e.maxHp)}%`;$('energyHint').textContent=`Energy ${p.energy}/${p.maxEnergy} · Hunger ${state.hunger}/${state.maxHunger}`;$('dossierCn').textContent=e.cn;$('dossierEn').textContent=e.en.toUpperCase();$('enemySummary').textContent=e.summary;let phaseTag=e.id==='lord'?`<span class="tag">${e.hp/e.maxHp>2/3?'阶段 I · 守势试探':e.hp/e.maxHp>1/3?'阶段 II · 猩红压制':'阶段 III · 濒死狂攻'}</span>`:'';
$('enemyTags').innerHTML=e.tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')+phaseTag;$('patternList').innerHTML=e.pattern.map((x,i)=>`<div class="pattern-line"><span>${i+1}</span><b>${escapeHtml(x)}</b></div>`).join('');
let br=$('bossRule');if(e.id==='lord'){let ph=bossPhase(e);br.style.display='block';br.innerHTML=ph===1?'阶段规则：完整公开三步。':ph===2?'阶段规则：第 3 个敌人行动被迷雾隐藏，预估只计算已知行动。':`阶段规则：本轮第 ${b.sealedSlot+1} 个玩家计划槽被封印。`;}else br.style.display='none';
 $('timeline').innerHTML=[0,1,2].map(i=>{if(b.lockedIntents[i]?.hidden)return `<div class="intent-card enemy-card hidden-intent"><div class="turn">TURN ${(playback?.trace.state.battle.turn ?? b.turn)+i}</div><b>${actionNameHtml('time_snare','???')}</b><span>赤塔迷雾遮蔽行动</span></div>`;let a=currentIntent(i),detail=a.id==='wait'?'蓄势，不造成伤害':a.id==='guard'?`+${Math.max(0,a.block-(e.guardDown?.turns>0?e.guardDown.amount:0))} Block`:`${Math.max(0,a.dmg-(e.damageDown?.turns>0?e.damageDown.amount:0))} 伤害${a.poison?' + 毒':''}${a.drain?' -能量':''}`;return `<div class="intent-card enemy-card"><div class="turn">TURN ${(playback?.trace.state.battle.turn ?? b.turn)+i}</div><b>${actionNameHtml(a.id,a.name)}</b><span>${detail}</span></div>`}).join('');renderPlan();renderActions();renderForecast();renderCombatStatuses();renderBuild();renderMeta()}


function clearForecastHud(){['phpDelta','energyDelta','pblockDelta','hungerDelta','ehpDelta','eblockDelta'].forEach(id=>{let el=$(id);if(el){el.textContent='';el.className='delta'}});['phpForecast','energyForecast','pblockForecast','hungerForecast','ehpForecast','eblockForecast'].forEach(id=>{let el=$(id);if(el){el.className='forecast-segment';el.style.left='0%';el.style.width='0%'}});$('playerStat')?.classList.remove('preview-change');$('enemyStat')?.classList.remove('preview-change')}
function setForecastDelta(deltaId,segId,current,pred,max){let d=pred-current,el=$(deltaId),seg=$(segId);if(!el||!seg||d===0)return;el.textContent=(d>0?'+':'')+d;el.className=`delta show ${d>0?'gain':'loss'}`;let a=clamp(100*current/max,0,100),bb=clamp(100*pred/max,0,100);seg.style.left=`${Math.min(a,bb)}%`;seg.style.width=`${Math.max(1,Math.abs(bb-a))}%`;seg.className=`forecast-segment show ${d>0?'gain':'loss'}`}
function renderForecast(){clearForecastHud();let b=state.battle;if(!b||b.resolving)return;let f=simulatePlan();if(!f)return;setForecastDelta('phpDelta','phpForecast',f.start.php,f.p.hp,state.player.maxHp);setForecastDelta('energyDelta','energyForecast',f.start.en,f.p.energy,state.player.maxEnergy);setForecastDelta('pblockDelta','pblockForecast',f.start.pblock,f.p.block,state.player.maxHp);if(!state.training)setForecastDelta('hungerDelta','hungerForecast',f.start.hunger,f.hunger,state.maxHunger);setForecastDelta('ehpDelta','ehpForecast',f.start.ehp,f.e.hp,b.enemy.maxHp);setForecastDelta('eblockDelta','eblockForecast',f.start.eblock,f.e.block,b.enemy.maxHp)}
function renderPlan(){
 let b=state.battle,filled=filledPlanCount(b);
 $('playerPlan').innerHTML=[0,1,2].map(i=>{
   let en=projectedEnergyBeforeSlot(i);
   if(b.sealedSlot===i)return `<div class="intent-card plan-card sealed"><div class="slot">第 ${i+1} 步</div><b>${actionNameHtml('wait','封印')}</b><span>赤塔领主封锁此计划槽</span><div class="costline">无法安排</div></div>`;
   let id=b.plan[i],a=id?actionInfo(id):null;
   return a?`<div class="intent-card plan-card filled" data-plan-index="${i}"><div class="slot">第 ${i+1} 步</div><b>${actionNameHtml(id,a.cn)}</b><span>${a.desc}</span><div class="costline">预计能量 ${en == null ? '未知' : en} · ${playback?'播放中':'点击撤回'}</div></div>`:`<div class="intent-card plan-card empty"><div class="slot">第 ${i+1} 步</div><b>${actionNameHtml('wait','等待')}</b><span>本回合不行动</span><div class="costline">预计能量 ${en == null ? '未知' : en}</div></div>`;
 }).join('');
 document.querySelectorAll('[data-plan-index]').forEach(el=>el.onclick=()=>{if(!b.resolving){let plan=[...b.plan];plan[+el.dataset.planIndex]=null;setPlan(plan)}});
 $('planStatus').textContent=`已安排 ${filled} / ${b.sealedSlot==null?3:2}${b.sealedSlot!=null?' · 1 槽被封印':''}`;
 setAvailability($('resolvePlanBtn'),true);setAvailability($('clearPlanBtn'),!!filled)
}
function renderActions(){
 let b=state.battle,slot=nextPlanSlot(b),en=slot>=0?projectedEnergyBeforeSlot(slot):0;
  $('actions').innerHTML=actionCatalog().map(a=>{let cd=slot>=0&&a.cooldown?projectedCooldownBeforeSlot(a.id,slot):0,unavailable=slot<0||(en!=null&&a.cost>en)||cd>0;return `<button class="action ${a.cls}" data-action="${a.id}" data-unavailable="${unavailable}" title="${a.desc.replace(/"/g,'&quot;')}" ${(unavailable||b.resolving)?'disabled':''}><strong>${actionNameHtml(a.id,a.cn)}</strong>${a.cost?`<span class="cost">-${a.cost} EN</span>`:''}${cd>0?`<span class="cost">冷却 ${cd} 步</span>`:''}<small>${a.desc}</small></button>`}).join('');
 document.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=()=>{let slot2=nextPlanSlot(b),a=actionInfo(btn.dataset.action);if(slot2<0)return;let energy=projectedEnergyBeforeSlot(slot2);if(energy!=null&&a.cost>energy)return toast('预计能量不足');if(projectedCooldownBeforeSlot(a.id,slot2)>0)return toast('技能仍在冷却');let plan=[...b.plan];plan[slot2]=btn.dataset.action;setPlan(plan)})
}

function renderBuild(){let items=[];for(let [id,lv] of Object.entries(state.player.skills))if(lv)items.push(`<div class="build-item" title="${activeSkills[id].desc(lv)}"><b>${activeSkills[id].cn} Lv.${lv}</b></div>`);for(let [id,lv] of Object.entries(state.player.passives))if(lv)items.push(`<div class="build-item" title="${passiveDefs[id].desc(lv)}"><b>${passiveDefs[id].cn} Lv.${lv}</b></div>`);for(let [id,lv] of Object.entries(state.player.equipment))if(lv)items.push(`<div class="build-item" title="${equipDefs[id].desc(lv)}"><b>${equipDefs[id].cn} Lv.${lv}</b></div>`);$('buildList').innerHTML=items.length?items.join(''):'<div class="build-item"><b>尚无构筑</b><div>升级时进行三选一。</div></div>'}
function openBook(){
 let cards=[
  {cn:'三步规划',text:'敌人先锁定未来三步。你最多安排三步行动，未填槽位视为等待；预估会实时显示，点击执行后一次结算三回合。'},
  {cn:'成长与流派',text:'击败敌人获得 EXP。升级才触发三选一；后期新技能会追赶等级，并轻度偏向你已经形成的构筑流派，但仍会出现跨流派选项。'},
  {cn:'区域生态',text:'无限世界由大型生态区域组成：风歌平原、黑木密林、灰苔湿地、裂脊高地、灰烬边境。区域会影响地形聚集和常见敌人。'},
  {cn:'营火与料理',text:'地图上偶尔会出现遗火营地。每处营火只能使用一次，可休息或把高风险食材加工成更稳定、更有针对性的料理。'},
  {cn:'稀有战术',text:'紫色三选一代表稀有战术技能。高级战术可以打断、延迟或交换敌人三步计划；部分需要永久解锁。'},
  {cn:'职业与永久解锁',text:'S 评价可解锁盾誓守卫；击败赤塔领主可解锁符文术士和时间系战术；累计采集 10 次可解锁黑木猎手。局外成长自动保存至项目 saves 目录，打开游戏自动恢复。'},
  {cn:'战术评价',text:'战后按受伤与战斗回合给出 S/A/B/C 评价，并奖励少量额外经验。精准格挡、精确终结等构筑进一步奖励小数值计算。'},
  {cn:'生存',text:'地图移动、采集与真实战斗都会消耗饥饿。采集可能遭遇伏击或负面状态；不同食物也有各自的利弊。饥饿为 0 后每回合损失 1 HP。'}
 ];
 for(let [id,d] of Object.entries(rewardPool)){let lv=levelOf(id);if(lv)cards.push({cn:`${d.cn} · Lv.${lv}`,text:d.desc(lv)})}
 $('bookGrid').innerHTML=cards.map(c=>`<div class="book-card"><h3>${c.cn}</h3><p>${c.text}</p></div>`).join('');
 $('bookOverlay').classList.add('show')
}

function openNewRun(){
 let ids=Object.keys(classDefs),host=$('classGrid');
 host.innerHTML=ids.map(id=>{let d=classDefs[id],ok=classUnlocked(id);return `<div class="class-card ${ok?'':'locked'}" data-class="${id}"><div class="eyebrow">${ok?'AVAILABLE':'LOCKED'}</div><h3>${d.cn}</h3><p>${d.desc}</p><div class="start">HP ${d.base.hp} · ATK ${d.base.attack} · EN ${d.base.energy} · 饥饿 ${d.base.hunger}</div><div class="unlock">${ok?'点击选择':d.unlock}</div></div>`}).join('');
 document.querySelectorAll('[data-class]').forEach(el=>el.onclick=()=>{let id=el.dataset.class;if(!classUnlocked(id))return;beginNewRun(id)});
 let m=state.meta;$('metaProgress').innerHTML=`<div class="row"><span>赤塔通关</span><b>${escapeHtml(m.bossWins)}</b></div><div class="row"><span>最佳战术评价</span><b>${escapeHtml(m.bestGrade)}</b></div><div class="row"><span>累计采集</span><b>${escapeHtml(m.harvests)}</b></div><div class="small">局外成长自动保存；打开游戏自动恢复，读取旧旅程不会回退解锁。</div>`;
 $('classOverlay').classList.add('show')
}

function toast(msg){let t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('show'),1700)}
function effectLater(fn,ms){const timer=setTimeout(()=>{effectTimers.delete(timer);if(mounted)fn();},ms);effectTimers.add(timer);}
function fx(id,cls){let e=$(id);e.classList.remove(cls);void e.offsetWidth;e.classList.add(cls);effectLater(()=>e.classList.remove(cls),520)}
function floatText(id,txt,color){let host=$('battlefield'),target=$(id),r=target.getBoundingClientRect(),hr=host.getBoundingClientRect(),f=document.createElement('div');f.className='float';f.textContent=txt;f.style.color=color;f.style.left=`${r.left-hr.left+r.width/2}px`;f.style.top=`${r.top-hr.top+80}px`;host.appendChild(f);effectLater(()=>f.remove(),900)}

  function setAvailability(button, available) {
    button.dataset.unavailable = String(!available);
    button.disabled = !available;
  }

  function controlMode() {
    const control = game.getControl?.() ?? 'human';
    return typeof control === 'string' ? control : control.mode || 'human';
  }

  function canInteract() {
    return controlMode() === 'human' && !busy && !ownershipBusy && !playback;
  }

  function actionIds() {
    const observed = game.observe();
    const battle = observed.battle || {};
    return {
      battleId: battle.battleId ?? state.battle?.battleId ?? observed.battleId,
      batchId: battle.batchId ?? state.battle?.batchId ?? observed.batchId,
    };
  }

  async function humanAction(type, payload = {}) {
    if (!canInteract()) {
      toast(controlMode() === 'agent' ? 'Agent 正在操作，请先暂停并人工接管。' : '正在处理，请稍候。');
      return null;
    }
    busy = true;
    updateControlUI();
    try {
      const result = await game.humanAct(type, payload);
      if (result?.ok === false || result?.error) {
        const err = result.error;
        throw new Error(err?.message || result.message || (typeof err === 'string' ? err : '操作未完成'));
      }
      if (type !== 'battle.commit') playTone(type);
      const messages = result?.events?.filter(event => event.type === 'message') || result?.messages || result?.receipt?.messages;
      if (Array.isArray(messages) && messages.length) toast(messages.map(x => typeof x === 'string' ? x : x.message || '').filter(Boolean).join(' · '));
      return result;
    } catch (error) {
      toast(error.message || '操作未完成');
      return null;
    } finally {
      busy = false;
      render();
    }
  }

  function moveTo(x, y) {
    const dx = x - state.x, dy = y - state.y;
    const direction = dx === 1 && dy === 0 ? 'east' : dx === -1 && dy === 0 ? 'west' : dy === 1 && dx === 0 ? 'south' : dy === -1 && dx === 0 ? 'north' : null;
    if (direction) return humanAction('world.move', {direction});
  }

  function setPlan(plan) {
    return humanAction('battle.plan.set', {...actionIds(), plan});
  }

  async function beginNewRun(classId) {
    const result = await humanAction('host.newRun', {classId});
    if (result) {
      $('classOverlay').classList.remove('show');
      resetMapCamera();
      setScreen('world');
      render();
      toast(`新旅程：${classDefs[classId].cn}`);
    }
  }

  function renderDecision() {
    const decision = state.pendingDecision;
    $('rewardOverlay').classList.remove('show');
    $('eventOverlay').classList.remove('show');
    if (!decision) return;
    hideTip();
    const isReward = decision.kind === 'reward';
    const overlay = $(isReward ? 'rewardOverlay' : 'eventOverlay');
    const host = $(isReward ? 'choiceGrid' : 'eventChoices');
    host.replaceChildren();
    if (isReward) {
      overlay.querySelector('h2').textContent = decision.title || '升级 · 三选一';
      overlay.querySelector('.small').textContent = decision.text || '选择一项构筑奖励。';
    } else {
      $('eventTitle').textContent = decision.title || '旅途事件';
      $('eventSub').textContent = decision.kind === 'camp' ? '营火与料理' : decision.kind === 'victory' ? '赤塔之战' : '灰境中的偶遇';
      $('eventBody').replaceChildren();
      const paragraph = document.createElement('p');
      paragraph.textContent = decision.text || '';
      $('eventBody').appendChild(paragraph);
    }
    for (const option of decision.options || []) {
      const button = document.createElement('button');
      const available = option.available !== false;
      setAvailability(button, available);
      button.dataset.optionId = option.optionId;
      if (isReward) {
        const rewardId = option.rewardId || option.itemId || option.optionId;
        const definition = rewardPool[rewardId];
        button.className = `choice ${definition?.rare ? 'rare' : ''}`;
        const kind = definition?.rare ? '稀有战术' : definition?.kind === 'skill' ? '主动技能' : definition?.kind === 'passive' ? '被动规则' : definition?.kind === 'equipment' ? '装备' : '构筑奖励';
        const previous = definition ? levelOf(rewardId) : 0;
        button.innerHTML = `<div class="kind">${kind}</div><h3>${escapeHtml(option.label || definition?.cn || rewardId)}</h3><p>${escapeHtml(option.description || '')}</p>${option.targetLevel ? `<div class="upgrade">${previous ? `Lv.${previous} → Lv.${escapeHtml(option.targetLevel)}` : `NEW · 直接获得 Lv.${escapeHtml(option.targetLevel)}`}</div>` : ''}`;
      } else {
        button.textContent = option.label || option.optionId;
        if (option.description) button.title = option.description;
      }
      if (!available && option.reason) {
        const reason = document.createElement('span');
        reason.className = 'decision-reason';
        reason.textContent = option.reason;
        button.appendChild(reason);
      }
      button.onclick = () => humanAction('choice.select', {decisionId: decision.decisionId, optionId: option.optionId});
      host.appendChild(button);
    }
    if (decision.cancelable) {
      const cancel = document.createElement('button');
      cancel.className = 'ghost event-cancel';
      cancel.textContent = '离开';
      setAvailability(cancel, true);
      cancel.onclick = () => humanAction('choice.cancel', {decisionId: decision.decisionId});
      host.appendChild(cancel);
    }
    overlay.classList.add('show');
  }

  function updateControlUI() {
    const mode = controlMode();
    const status = game.connectionStatus;
    const connection = typeof status === 'string' ? status : status?.status;
    const online = status === true || status?.connected === true || ['connected', 'online', 'ready'].includes(connection);
    $('bridgeStatus').dataset.online = String(online);
    $('bridgeStatusText').textContent = online ? '本地桥接在线' : ['connecting', 'reconnecting'].includes(connection) ? '桥接连接中' : '本地桥接离线';
    $('controlMode').textContent = mode === 'agent' ? 'Agent' : '人工';
    $('humanControlBtn').disabled = ownershipBusy;
    $('takeoverBtn').disabled = ownershipBusy;
    $('takeoverBtn').style.display = mode === 'agent' ? 'block' : 'none';
    $('agentControlBtn').disabled = ownershipBusy || mode === 'agent' || !online;
    $('humanControlBtn').classList.toggle('primary', mode === 'agent');
    $('agentControlBtn').classList.toggle('primary', mode === 'human');
    $('bridgeNote').textContent = mode === 'agent' ? 'Agent 正在接管。人工游戏操作已锁定；点击“暂停 · 人工接管”可立即收回控制权。' : online ? '人工模式下可用鼠标与方向键探索。交给 Agent 后，人工游戏操作会锁定；随时可暂停接管。' : '当前可继续人工游玩。桥接连接恢复前，Agent 控制与本地存档服务可能不可用。';
    const observed = game.observe();
    $('revisionText').textContent = Number.isFinite(observed.revision) ? `revision ${observed.revision}` : '';
    document.body.classList.toggle('human-controls-locked', mode !== 'human' || !!playback);
    const locked = !canInteract();
    setAvailability($('newRunBtn'), true);
    setAvailability($('trainBtn'), !state.inBattle && !state.pendingDecision);
    setAvailability($('fleeBtn'), !!state.inBattle);
    document.querySelectorAll('[data-action],[data-eat],#harvestBtn,#campBtn,#trainBtn,#resolvePlanBtn,#clearPlanBtn,#fleeBtn,#newRunBtn,[data-option-id],.event-cancel').forEach(button => {
      button.dataset.controlLocked = String(locked);
      button.disabled = locked || button.dataset.unavailable === 'true';
    });
    $('localSaveBtn').disabled = busy || ownershipBusy || !online;
    $('localLoadBtn').disabled = locked || !online;
    $('fleeBtn').textContent = state.training ? '退出训练' : '撤退 · 返回地图';
    document.querySelectorAll('[data-class]').forEach(card => card.setAttribute('aria-disabled', String(locked || !classUnlocked(card.dataset.class))));
  }

  async function postLocal(path, body = {}) {
    const response = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await response.json(); } catch { /* A status alone still yields a useful error. */ }
    if (!response.ok || data?.ok === false || data?.error) {
      const error = data?.error;
      throw new Error(error?.message || data?.message || (typeof error === 'string' ? error : `本地服务返回 ${response.status}`));
    }
    return data;
  }

  async function setControl(mode) {
    if (ownershipBusy) return;
    ownershipBusy = true;
    updateControlUI();
    try {
      await postLocal('/api/owner/control', {mode});
      toast(mode === 'human' ? '已暂停 Agent，人工接管。' : '已将控制权交给 Agent。');
    } catch (error) {
      toast(error.message || '控制权切换失败');
    } finally {
      ownershipBusy = false;
      render();
    }
  }

  async function saveOrLoad(load) {
    if (load && !canInteract()) return toast('请先暂停并人工接管。');
    if (busy) return;
    busy = true;
    updateControlUI();
    try {
      await postLocal(load ? '/api/v1/saves/manual/load' : '/api/v1/saves/manual', {});
      if (load) {
        $('saveOverlay').classList.remove('show');
        R = game.uiRuntime();
        state = R.state;
        resetMapCamera();
        setScreen(state.inBattle ? 'battle' : 'world');
      }
      toast(load ? '已读取本地存档 manual' : '已保存本地存档 manual');
    } catch (error) {
      toast(error.message || (load ? '读取失败' : '保存失败'));
    } finally {
      busy = false;
      render();
    }
  }

  let audioContext = null;
  function playTone(type) {
    if (!audioEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext ||= new AudioContext();
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      const time = audioContext.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(type === 'world.move' ? 110 : type === 'battle.commit' ? 170 : 320, time);
      oscillator.frequency.exponentialRampToValueAtTime(type === 'battle.commit' ? 75 : 160, time + .09);
      gain.gain.setValueAtTime(.025, time);
      gain.gain.exponentialRampToValueAtTime(.001, time + .1);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(time);
      oscillator.stop(time + .1);
    } catch { /* Audio is optional and never affects simulation. */ }
  }

  function resultSummary(result, enemy = false) {
    if (!result) return '未行动';
    if (result.failed) return result.reason==='cooldown'?`冷却剩余 ${result.remaining} 步，未执行`:'能量不足，未执行';
    if (result.delayed) return '行动已延迟';
    if (result.canceled) return '行动被打断';
    if (result.wait) return '等待';
    const parts = [];
    if (Number.isFinite(result.dmg)) parts.push(`造成 ${result.dmg} 伤害`);
    if (result.absorbed) parts.push(`${enemy ? '被你格挡' : '被敌人格挡'} ${result.absorbed}`);
    if (result.block) parts.push(`获得 ${result.block} 格挡`);
    if (result.heal) parts.push(`恢复 ${result.heal} 生命`);
    if (result.rip) parts.push(`反击 ${result.rip} 伤害`);
    if (result.charge) parts.push(`蓄力 +${result.charge}`);
    if (result.burn) parts.push(`灼烧 ${result.burn} 回合`);
    if (result.bleed) parts.push(`流血 ${result.bleed} 回合`);
    if (result.poison) parts.push('附加中毒');
    if (result.drain) parts.push(`汲取 ${result.drain} 能量`);
    return parts.join(' · ') || '效果已生效';
  }

  function settlementHtml() {
    if (!lastCombatReport) return '';
    const rows = (lastCombatReport.steps || []).map(step => {
      const action = step.playerAction || {};
      const enemy = step.enemyAction;
      const actionName = action.name || (step.actionId ? actionInfo(step.actionId)?.cn : '等待') || step.actionId;
      const enemyName = enemy?.name || step.enemyIntent?.name || '敌方';
      return `<div class="settlement-row"><span class="settlement-turn">第 ${escapeHtml(step.turn)} 回合</span><span>${escapeHtml(actionName)}：${escapeHtml(resultSummary(action))}</span><span>${escapeHtml(enemyName)}：${escapeHtml(resultSummary(enemy, true))}${step.dots ? ` · 持续伤害 ${escapeHtml(step.dots)}` : ''}</span></div>`;
    }).join('');
    return `<div class="settlement"><b>上一批结算</b>${rows}</div>`;
  }

  function clearCombatEffects() {
    for (const timer of effectTimers) clearTimeout(timer);
    effectTimers.clear();
    document.querySelectorAll('.vfx,.float').forEach(node => node.remove());
    for (const id of ['playerUnit','enemyUnit']) $(id).classList.remove('shake','lunge','guardfx','castfx');
    $('battlefield').classList.remove('impact');
  }

  function finishPlayback(renderFinal = true) {
    if (!playback) return;
    const current = playback;
    playback = null;
    for (const timer of current.timers) clearTimeout(timer);
    clearCombatEffects();
    game.finishPresentation(current.id);
    if (renderFinal && mounted) render();
  }

  function combatEffect(kind, targetId) {
    const target = $(targetId).getBoundingClientRect(), host = $('battlefield').getBoundingClientRect();
    const effect = document.createElement('div');
    effect.className = `vfx ${kind}`;
    effect.style.left = `${target.left - host.left + target.width / 2 - 45}px`;
    effect.style.top = `${target.top - host.top + target.height / 2 - 45}px`;
    $('effectLayer').appendChild(effect);
    effectLater(() => effect.remove(), 850);
  }

  function presentCheckpoint(token, snapshot, step, stage) {
    const previous = {player:token.view.player, enemy:token.view.battle.enemy};
    Object.assign(token.view, {player:snapshot.player, hunger:snapshot.hunger, buffs:snapshot.buffs, worldTurn:snapshot.worldTurn});
    Object.assign(token.view.battle, {enemy:snapshot.enemy, turn:snapshot.turn, lockedIntents:snapshot.intents});
    token.index = step.index;
    token.stage = stage;
    token.label = stage === 'player' ? `${step.playerAction.name}：${resultSummary(step.playerAction)}`
      : stage === 'enemy' ? `${step.enemyAction.name || '敌方'}：${resultSummary(step.enemyAction, true)}` : '回合末效果与能量恢复';
    render();
    for (const [actor, unit] of [['player','playerUnit'],['enemy','enemyUnit']]) {
      const next = actor === 'player' ? snapshot.player : snapshot.enemy;
      const hp = next.hp - previous[actor].hp, block = next.block - previous[actor].block;
      const energy = actor === 'player' ? next.energy - previous.player.energy : 0;
      const changes = [[hp,'HP'],[block,'格挡'],[energy,'EN']].filter(([delta]) => delta).map(([delta,name]) => `${delta > 0 ? '+' : ''}${delta} ${name}`);
      if (changes.length) floatText(unit, changes.join(' · '), hp < 0 ? '#ff9a8c' : '#e4cb82');
      if (hp < 0) {fx(unit, 'shake');fx('battlefield', 'impact');}
    }
    if (stage === 'round') return;
    const result = stage === 'player' ? step.playerAction : step.enemyAction;
    const unit = stage === 'player' ? 'playerUnit' : 'enemyUnit';
    if (result.failed || result.wait || result.canceled || result.delayed) {
      floatText(unit, resultSummary(result), '#c7bca7');
      return;
    }
    const kind = stage === 'player' ? activeSkills[step.actionId]?.vfx || (step.actionId === 'basic_guard' ? 'shield' : 'slash')
      : result.block ? 'shield' : step.enemyIntent?.id === 'heavy' ? 'heavy' : result.poison ? 'bleed' : result.drain ? 'drain' : 'slash';
    const target = ['shield','heal','charge'].includes(kind) ? unit : stage === 'player' ? 'enemyUnit' : 'playerUnit';
    combatEffect(kind, target);
    fx(unit, kind === 'shield' ? 'guardfx' : ['slash','heavy','execute','break','bleed'].includes(kind) ? 'lunge' : 'castfx');
    playTone('battle.commit');
  }

  function startPlayback(trace) {
    const view = structuredClone(trace.state);
    view.battle.plan = [...trace.plan];
    view.battle.resolving = true;
    const token = playback = {id:trace.id, trace, view, timers:new Set(), index:0, stage:'player', label:'开始执行本批计划'};
    game.startPresentation(trace.id);
    currentScreen = 'battle';
    const schedule = (ms, fn) => {
      const timer = setTimeout(() => {
        token.timers.delete(timer);
        if (playback !== token || !mounted) return;
        try {fn();} catch (error) {
          console.error('Combat presentation failed', error);
          finishPlayback();
        }
      }, ms);
      token.timers.add(timer);
    };
    let time = 80;
    trace.steps.forEach((step, i) => {
      const frame = trace.frames[i];
      schedule(time, () => presentCheckpoint(token, frame.afterPlayer, step, 'player'));
      time += 500;
      if (frame.afterEnemy) {
        schedule(time, () => presentCheckpoint(token, frame.afterEnemy, step, 'enemy'));
        time += 450;
      }
      if (frame.afterRound) {
        schedule(time, () => presentCheckpoint(token, frame.afterRound, step, 'round'));
        time += 250;
      }
    });
    schedule(time, () => finishPlayback());
    schedule(5000, () => finishPlayback());
  }

  const visibilityHandler = () => {if (document.hidden) finishPlayback();};
  document.addEventListener('visibilitychange', visibilityHandler);

  function render() {
    if (!mounted) return;
    R = game.uiRuntime();
    if (playback && R.presentation?.id !== playback.id) finishPlayback(false);
    if (!playback && R.presentation && R.presentation.id !== lastPresentationId) {
      lastPresentationId = R.presentation.id;
      if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches && R.presentation.frames.length) startPlayback(R.presentation);
      else game.finishPresentation(R.presentation.id);
    }
    state = playback ? playback.view : R.state;
    if (displayedRevision !== state.revision) {
      displayedRevision = state.revision;
      const messages = (R.events || []).filter(event => event.type === 'message').map(event => event.message);
      if (!busy && messages.length) toast(messages.join(' · '));
    }
    if (lastEpoch !== state.epoch) {lastCombatReport = null;lastEpoch = state.epoch;}
    if (!!state.inBattle !== !!previousInBattle) {
      currentScreen = state.inBattle ? 'battle' : 'world';
      previousInBattle = state.inBattle;
    }
    renderMap();
    if (state.battle) {
      const battleId = state.battle.id || state.battle.battleId || state.battle.enemy.id;
      if (battleId !== lastBattleId) {
        lastCombatReport = null;
        $('playerPortrait').innerHTML = playerSVG();
        $('enemyPortrait').innerHTML = enemySVG(enemyArt(state.battle.enemy.id));
        lastBattleId = battleId;
      }
      const settled = (R.events || []).filter(event => event.type === 'combatResolved' && event.battleId === battleId).at(-1);
      if (settled && !playback) lastCombatReport = settled;
      renderBattle();
      const forecast = simulatePlan();
      $('combatAnalysis').innerHTML = forecast ? `<b>${forecast.partial ? '已知行动预估：' : '三步预估：'}</b>生命 ${forecast.start.php} → ${forecast.p.hp} · 敌方生命 ${forecast.start.ehp} → ${forecast.e.hp} · 能量 ${forecast.start.en} → ${forecast.p.energy}${forecast.partial ? '。迷雾后的行动未计入。' : '。空槽会等待，每回合结束恢复 1 点能量。'}` : '<b>规划阶段：</b>安排三步行动，然后执行。';
      if (playback) {
        $('combatAnalysis').innerHTML = `<b>正在播放第 ${playback.index + 1} 步：</b>${escapeHtml(playback.label)}`;
        $('planStatus').textContent = `正在播放第 ${playback.index + 1} 步`;
        for (const [id, stage] of [['playerPlan','player'],['timeline','enemy']]) {
          $(id).querySelectorAll('.intent-card').forEach((card,i) => card.classList.toggle('playing', i === playback.index && (stage === playback.stage || playback.stage === 'round')));
        }
      } else $('combatAnalysis').innerHTML += settlementHtml();
    } else {
      lastBattleId = null;
      clearForecastHud();
      if (currentScreen === 'battle') currentScreen = 'world';
    }
    setScreen(currentScreen);
    const battleTab = document.querySelector('[data-screen="battle"]');
    battleTab.disabled = !state.battle;
    renderDecision();
    updateControlUI();
  }

  const keyHandler = event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || ['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName)) return;
    if (event.key === 'Escape') {
      for (const id of ['bookOverlay','saveOverlay','classOverlay','atlasOverlay']) $(id).classList.remove('show');
      hideTip();
      return;
    }
    if (state.inBattle || mapMoving || document.querySelector('.overlay.show') || !canInteract()) return;
    const delta = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
    if (delta) {
      event.preventDefault();
      moveTo(state.x + delta[0], state.y + delta[1]);
    }
  };
  let resizeTimer = null;
  const resizeHandler = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {if (mounted) render();}, 80);
  };
  window.addEventListener('keydown', keyHandler);
  window.addEventListener('resize', resizeHandler);
  document.querySelectorAll('.tab').forEach(button => button.onclick = () => setScreen(button.dataset.screen));
  const modalBindings = [['atlasBtn','atlasOverlay','closeAtlasBtn',openAtlas],['bookBtn','bookOverlay','closeBookBtn',openBook],['saveBtn','saveOverlay','closeSaveBtn',null],['newRunBtn','classOverlay','closeClassBtn',openNewRun]];
  for (const [openId, overlayId, closeId, opener] of modalBindings) {
    $(openId).onclick = opener || (() => $(overlayId).classList.add('show'));
    $(closeId).onclick = () => $(overlayId).classList.remove('show');
    $(overlayId).onclick = event => {if (event.target === $(overlayId)) $(overlayId).classList.remove('show');};
  }
  $('resolvePlanBtn').onclick = () => humanAction('battle.commit', {...actionIds(), plan:[...state.battle.plan]});
  $('clearPlanBtn').onclick = () => setPlan([null,null,null]);
  $('fleeBtn').onclick = () => humanAction(state.training ? 'training.exit' : 'battle.retreat', actionIds());
  $('trainBtn').onclick = () => humanAction('training.start');
  $('harvestBtn').onclick = () => humanAction('world.harvest');
  $('campBtn').onclick = () => humanAction('camp.open');
  $('soundBtn').onclick = () => {audioEnabled = !audioEnabled;renderMeta();if (audioEnabled) playTone('toggle');};
  $('humanControlBtn').onclick = () => setControl('human');
  $('takeoverBtn').onclick = () => setControl('human');
  $('agentControlBtn').onclick = () => setControl('agent');
  $('localSaveBtn').onclick = () => saveOrLoad(false);
  $('localLoadBtn').onclick = () => saveOrLoad(true);
  resetMapCamera();
  $('playerPortrait').innerHTML = playerSVG();
  const unsubscribe = game.subscribe(render);
  render();
  return {
    render,
    destroy() {
      mounted = false;
      finishPlayback(false);
      clearCombatEffects();
      unsubscribe?.();
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('resize', resizeHandler);
      clearTimeout(resizeTimer);
      audioContext?.close?.();
    },
  };
}
