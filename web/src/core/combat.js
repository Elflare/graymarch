/** Deterministic combat rules. This module never touches the DOM or a timer. */
export function installCombat(R) {
  // The runtime may replace state when starting or loading a journey.
  const state = new Proxy({}, {
    get: (_, key) => R.state[key],
    set: (_, key, value) => { R.state[key] = value; return true; },
  });
  const activeSkills = R.activeSkills;
  const enemyDefs = R.enemyDefs;
  const config=R.resources.data.rules.combat, world=R.resources.data.world, requiredSigils=world.guardians.length;
  const passive=(p,id,key)=>R.passiveValue(p,id,key);
  const gear=(p,id,key)=>R.gearValue(p,id,key);
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const call = (name, ...args) => typeof R[name] === 'function' ? R[name](...args) : undefined;
  const buffTotal = (buffs = [], property) => buffs.reduce((total, buff) => total + (buff.turns > 0 ? (buff[property] || 0) : 0), 0);
  const gradeRank = R.gradeRank;

  function startBattle(type = 'E', training = false) {
    if (state.inBattle || state.battle) return state.battle;
    call('recalcStats');
    const p = state.player;
    state.battleOrigin = training ? copy({ player: p, hunger: state.hunger, maxHunger: state.maxHunger, buffs: state.buffs, worldTurn: state.worldTurn }) : null;
    const e = training
      ? { ...enemyDefs[config.trainingEnemy], ...R.resources.enemy(config.trainingEnemy,config.trainingStats), id: config.trainingEnemy, maxHp: config.trainingStats.hp, hp: config.trainingStats.hp, atk: config.trainingStats.atk, baseArmor: config.trainingStats.armor, armor: config.trainingStats.armor, block: 0, exposed: 0, xp: 0 }
      : R.enemyFor(state.x, state.y, type);
    state.inBattle = true;
    state.training = !!training;
    Object.assign(p, { block: 0, charge: 0, chargePierce: false, damageCount: 0, poison: null, riposte: null, thorns: null, prevActionId: null });
    delete p.cooldowns;
    delete p.currentEnemyIntent;
    p.energy = Math.min(p.maxEnergy, p.energy + passive(p,'reserve','energy'));
    state.combatCounter = (state.combatCounter || 0) + 1;
    const id = `${state.runId || state.seed || 'journey'}:battle:${state.combatCounter}`;
    state.battle = {
      id, batchId: null, batchCounter: 0, enemy: e, turn: 1, type,
      plan: [null, null, null], lockedIntents: [], carryIntents: [],
      sealedSlot: null, hiddenIntentIndex: null, resolving: false, lastBossPhase: null,
      stats: { damageDealt: 0, damageTaken: 0, blocked: 0, exactBlocks: 0, rounds: 0, exactKill: false },
    };
    state.battle.lockedIntents = makeIntentBatch();
    state.screen = 'battle';
    R.events?.push({ type: 'sceneEntered', scene: { kind: 'battle', id }, battleId: id, batchId: state.battle.batchId, training: !!training });
    return state.battle;
  }

  function battleGrade(stats = {}) {
    return config.grades.find(g=>(g.damage===null||(stats.damageTaken||0)<=g.damage)&&(g.steps===null||(stats.rounds||0)<=g.steps)).id;
  }

  function makeBattleReport(b, baseXp) {
    const st = b.stats || {}, grade = battleGrade(st);
    const pct = config.grades.find(g=>g.id===grade).xp;
    const exactLevel = state.player.passives.exact_finish || 0;
    return {
      enemy: b.enemy.cn, grade, damageDealt: st.damageDealt || 0, damageTaken: st.damageTaken || 0,
      blocked: st.blocked || 0, exactBlocks: st.exactBlocks || 0, rounds: st.rounds || 0,
      bonusXp: Math.ceil(baseXp * pct) + (st.exactKill && exactLevel ? Math.ceil(baseXp * passive(state.player,'exact_finish','xpRate')) : 0),
      exactKill: !!st.exactKill,
    };
  }

  function updateMetaFromReport(report) {
    call('ensureMetaBare');
    if (state.meta && report?.grade && gradeRank[report.grade] > gradeRank[state.meta.bestGrade || 'C']) state.meta.bestGrade = report.grade;
    call('refreshMetaUnlocks', true);
  }

  function endBattle(win) {
    const b = state.battle;
    if (!b) return null;
    const p = state.player;
    if (state.training) {
      const origin = state.battleOrigin;
      if (!origin?.player) throw call('error', 'INVALID_SAVE', '缺少完整训练快照') || new Error('缺少完整训练快照');
      state.player = copy(origin.player);
      state.hunger = origin.hunger;
      state.maxHunger = origin.maxHunger;
      state.buffs = copy(origin.buffs);
      state.worldTurn = origin.worldTurn;
      state.inBattle = false;
      state.training = false;
      state.battle = null;
      state.battleOrigin = null;
      state.screen = 'world';
      R.events?.push({ type: 'sceneExited', scene: { kind: 'battle', id: b.id }, battleId: b.id, outcome: win ? 'victory' : 'defeat', training: true });
      call('toast', R.text('trainingEnd'));
      return { win: !!win, training: true };
    }
    delete p.currentEnemyIntent;
    state.inBattle = false;
    state.training = false;
    state.battle = null;
    state.battleOrigin = null;
    state.screen = 'world';
    delete p.cooldowns;
    R.events?.push({ type: 'sceneExited', scene: { kind: 'battle', id: b.id }, battleId: b.id, outcome: win ? 'victory' : 'defeat', training: false });
    if (!win) {
      p.hp = Math.max(1, Math.ceil(p.maxHp * config.retreat.hpRatio));
      p.energy = Math.min(p.maxEnergy, config.retreat.energy);
      state.hunger = Math.max(state.hunger, config.retreat.minHunger);
      call('toast', R.text('retreat'));
      return { win: false, training: false };
    }
    state.wins = (state.wins || 0) + 1;
    state.cleared.add(call('key', state.x, state.y) ?? `${state.x},${state.y}`);
    if (b.type === 'X' && state.sigils < requiredSigils) {
      state.sigils++;
      call('toast', R.text('sigil',{sigils:state.sigils,required:requiredSigils}));
    }
    const baseXp = b.enemy.xp || config.fallbackXp, report = makeBattleReport(b, baseXp);
    state.lastReport = report;
    updateMetaFromReport(report);
    const xp = baseXp + report.bonusXp;
    if (b.type === 'B') {
      call('gainXP', xp, false);
      state.victory = true;
      call('ensureMetaBare');
      if (state.meta) state.meta.bossWins = (state.meta.bossWins || 0) + 1;
      call('refreshMetaUnlocks', true);
      call('showSimpleEvent', R.text('victoryTitle'), R.text('victoryText',report), [{
        label: R.text('continue'),
        fn: () => {
          call('closeEvent');
          const rewards = state.pendingRewards || 0;
          state.pendingRewards = 0;
          if (rewards) call('showReward', rewards);
        },
      }]);
    } else call('gainXP', xp, true);
    return { win: true, training: false, report, xp };
  }

  function bossPhase(e) {
    if (e.id !== world.boss) return 0;
    const ratio = e.hp / e.maxHp;
    const thresholds=R.resources.data.enemies[world.boss].params.phaseRatios;
    return ratio > thresholds[0] ? 1 : ratio > thresholds[1] ? 2 : 3;
  }

  function syncHiddenIndex(b, intents = b.lockedIntents) {
    const index = intents.findIndex(intent => intent?.hidden === true);
    b.hiddenIntentIndex = index < 0 ? null : index;
  }

  function configureBossRules(b, intents = b.lockedIntents) {
    b.sealedSlot = null;
    b.lastBossPhase = bossPhase(b.enemy);
    if (b.enemy.id === world.boss) {
      if (b.lastBossPhase === config.bossHiddenPhase && intents[config.bossHiddenSlot]) intents[config.bossHiddenSlot].hidden = true;
      if (b.lastBossPhase === config.bossSealedPhase) b.sealedSlot = Math.floor((b.turn - 1) / 3) % 3;
    }
    syncHiddenIndex(b, intents);
  }

  function makeIntentBatch() {
    const b = state.battle;
    if (!b) return [];
    const out = (b.carryIntents || []).splice(0, 3);
    const ai = b.enemy.ai || enemyDefs[b.enemy.id]?.ai;
    const rageAt = turn => b.enemy.enrageAfter ? Math.max(0, Math.ceil((turn - b.enemy.enrageAfter) / config.enrageInterval)) : 0;
    if (rageAt(b.turn)) b.enemy.enrage = rageAt(b.turn);
    else delete b.enemy.enrage;
    let offset = 0;
    while (out.length < 3) {
      const intent = ai ? ai(b.turn + offset, b.enemy) : { id: 'attack', name: R.text('attack'), dmg: b.enemy.atk || 0 };
      out.push({ ...copy(intent), ...(typeof intent.dmg==='number'?{dmg:intent.dmg+rageAt(b.turn+offset)}:{}), hidden: false });
      offset++;
    }
    b.batchCounter = (b.batchCounter || 0) + 1;
    b.batchId = `${b.id}:batch:${b.batchCounter}`;
    configureBossRules(b, out);
    return out;
  }

  function currentIntent(i = 0) {
    const b = state.battle;
    return b?.lockedIntents[i] || null;
  }

  function filledPlanCount(b = state.battle) { return b ? b.plan.filter(Boolean).length : 0; }
  function nextPlanSlot(b = state.battle) {
    if (!b) return -1;
    for (let i = 0; i < 3; i++) if (i !== b.sealedSlot && !b.plan[i]) return i;
    return -1;
  }
  function actionIsDefense(id) { return config.defenseActions.includes(id); }
  function armorOf(e) {
    const debuff = e.armorDebuff?.turns > 0 ? e.armorDebuff.amount : 0;
    return Math.max(0, (e.baseArmor ?? e.armor ?? 0) - debuff - (e.exposed > 0 ? config.exposedArmor : 0));
  }

  function actionCatalog(p = state.player, ctx = {}) {
    const basic = [
      { id: 'basic_attack', cn: config.basicActions.basic_attack.cn, desc: R.resources.format(config.basicActions.basic_attack.description,{attack:p.attack}), cost: config.basicActions.basic_attack.cost, cls: config.basicActions.basic_attack.cls },
      { id: 'basic_guard', cn: config.basicActions.basic_guard.cn, desc: R.resources.format(config.basicActions.basic_guard.description,{block:config.basicGuard + gear(p,'tower_shield','guard') + buffTotal(ctx.buffs ?? state.buffs, 'guard')}), cost: config.basicActions.basic_guard.cost, cls: config.basicActions.basic_guard.cls },
    ];
    const learned = Object.entries(p.skills).filter(([id, lv]) => lv > 0 && activeSkills[id]).map(([id, lv]) => ({ id, cn: activeSkills[id].cn, desc: activeSkills[id].desc(lv), cost: activeSkills[id].cost, ...(activeSkills[id].cooldown ? {cooldown: activeSkills[id].cooldown} : {}), cls: actionIsDefense(id) ? 'def' : 'special' }));
    return [...basic, ...learned];
  }
  function actionInfo(id, p = state.player, ctx = {}) { return actionCatalog(p, ctx).find(action => action.id === id); }
  function projectedEnergyBeforeSlot(slot) {
    if (!state.battle) return state.player.energy;
    const forecast = simulatePlan({ maxSteps: Math.max(0, Math.min(3, slot)) });
    return forecast.partial ? null : forecast.p.energy;
  }
  function projectedCooldownBeforeSlot(id, slot) {
    if (!state.battle) return 0;
    const forecast = simulatePlan({ maxSteps: Math.max(0, Math.min(3, slot)) });
    return forecast.partial ? null : (forecast.p.cooldowns?.[id] || 0);
  }
  function cloneBattleState() {
    if (!state.battle) return null;
    return { p: copy(state.player), e: copy(state.battle.enemy), hunger: state.hunger, buffs: copy(state.buffs), worldTurn: state.worldTurn };
  }

  function bonusFor(p, e) {
    let bonus = 0;
    p.damageCount = (p.damageCount || 0) + 1;
    if ((p.passives.third_strike || 0) && p.damageCount % passive(p,'third_strike','interval') === 0) bonus += passive(p,'third_strike','bonus');
    if ((p.passives.low_hp_fury || 0) && p.hp <= p.maxHp * passive(p,'low_hp_fury','hpRatio')) bonus += passive(p,'low_hp_fury','bonus');
    if ((p.passives.parity_edge || 0) && (p.combatTurn || 1) % passive(p,'parity_edge','interval') === passive(p,'parity_edge','remainder')) bonus += passive(p,'parity_edge','bonus');
    if ((p.passives.divisible_edge || 0) && e?.hp > 0 && e.hp % passive(p,'divisible_edge','divisor') === 0) bonus += passive(p,'divisible_edge','bonus');
    if (p.charge) { bonus += p.charge; p.charge = 0; }
    return bonus;
  }

  function dealEnemy(p, e, base, { ignoreArmor = false, noBonus = false } = {}) {
    if (p.chargePierce) { ignoreArmor = true; p.chargePierce = false; }
    let damage = ignoreArmor ? Math.max(0, base) : Math.max(config.minDamage, base - armorOf(e));
    if (!noBonus) damage += bonusFor(p, e);
    const absorbed = Math.min(e.block || 0, damage);
    e.block = Math.max(0, (e.block || 0) - absorbed);
    damage -= absorbed;
    const before = Math.max(0, e.hp), actual = Math.min(before, damage), overkill = Math.max(0, damage - before);
    e.hp = Math.max(0, before - damage);
    return { dmg: actual, absorbed, overkill, exactKill: before > 0 && actual === before && overkill === 0 };
  }

  function dealPlayer(p, e, raw) {
    let damage = Math.max(0, raw - (e.damageDown?.turns > 0 ? e.damageDown.amount : 0));
    const absorbed = Math.min(p.block || 0, damage);
    p.block = Math.max(0, (p.block || 0) - absorbed);
    damage -= absorbed;
    const actual = Math.min(p.hp, damage);
    p.hp = Math.max(0, p.hp - damage);
    let rip = 0, exactKill = false;
    if (p.riposte?.turns > 0 && damage === 0 && absorbed > 0 && e.hp > 0) {
      const hit = dealEnemy(p, e, p.riposte.damage, { ignoreArmor: true, noBonus: true });
      rip += hit.dmg; exactKill ||= hit.exactKill; p.riposte = null;
    }
    if (p.thorns?.turns > 0 && absorbed > 0 && e.hp > 0) {
      const hit = dealEnemy(p, e, p.thorns.damage, { ignoreArmor: true, noBonus: true });
      rip += hit.dmg; exactKill ||= hit.exactKill;
    }
    return { dmg: actual, absorbed, rip, exactKill };
  }

  function applyPlayerAction(id,p,e,ctx={}){
    const a=actionInfo(id,p,ctx);
    if(p.cooldowns?.[id])return {name:a?.cn||R.text('unknown'),failed:true,reason:'cooldown',remaining:p.cooldowns[id]};
    if(!a||a.cost>p.energy)return {name:a?.cn||R.text('unknown'),failed:true,reason:'energy'};
    const lv=p.skills[id]||0,prev=p.prevActionId;
    p.energy-=a.cost;
    if(id==='basic_attack')return {name:a.cn,...dealEnemy(p,e,p.attack)};
    if(id==='basic_guard'){const n=config.basicGuard+gear(p,'tower_shield','guard')+buffTotal(ctx.buffs??state.buffs,'guard');p.block+=n;return{name:a.cn,block:n};}
    const q=R.skillParams(id,lv);
    if(a.cooldown){p.cooldowns||={};p.cooldowns[id]=a.cooldown+1;}
    if(id==='power_strike'){
      if(q.shatter&&e.block>0)e.block=Math.max(0,e.block-q.shatter);
      return{name:a.cn,...dealEnemy(p,e,p.attack+q.damageBonus+(e.block===0?q.unblockedBonus:0))};
    }
    if(id==='guard_stance'){
      let n=q.block,intent=p.currentEnemyIntent;
      if(q.attackBonus&&intent&&intent.id!=='guard')n+=q.attackBonus;
      p.block+=n;if(q.thornsTurns)p.thorns={damage:q.thornsDamage,turns:q.thornsTurns};
      return{name:a.cn,block:n};
    }
    if(id==='heal'){
      const n=Math.min(p.maxHp-p.hp,q.heal);p.hp+=n;
      if(q.cleanse)p.poison=null;p.block+=q.block;
      return{name:a.cn,heal:n,block:q.block};
    }
    if(id==='armor_break'){
      const hit=dealEnemy(p,e,q.damage);
      e.armorDebuff={amount:q.armorDown,turns:q.turns};
      if(q.zeroArmorDamage&&armorOf(e)===0&&e.hp>0){const ex=dealEnemy(p,e,q.zeroArmorDamage,{ignoreArmor:true,noBonus:true});hit.dmg+=ex.dmg;hit.exactKill=hit.exactKill||ex.exactKill;}
      return{name:a.cn,...hit,debuff:R.text('armorDown',e.armorDebuff)};
    }
    if(id==='execute'){
      const qualifies=e.hp<=q.threshold,hit=dealEnemy(p,e,qualifies?q.damage:q.fallbackDamage,{ignoreArmor:true});
      if(qualifies&&e.hp===0)p.energy=Math.min(p.maxEnergy,p.energy+q.killEnergy);
      return{name:a.cn,...hit};
    }
    if(id==='charge'){
      p.charge=q.bonus;p.energy=Math.min(p.maxEnergy,p.energy+q.energy);if(q.pierce)p.chargePierce=true;
      return{name:a.cn,charge:p.charge};
    }
    if(id==='fireball'){
      const hit=dealEnemy(p,e,q.damage+(e.burn?.turns>0?q.burningBonus:0),{ignoreArmor:true});
      e.burn={dmg:q.burnDamage,turns:q.turns};return{name:a.cn,...hit,burn:e.burn.turns};
    }
    if(id==='bleed_strike'){
      const hit=dealEnemy(p,e,p.attack),extra=e.bleed?.turns>0?q.bleedingBonus:0;
      e.bleed={dmg:q.bleedDamage+extra,turns:q.turns};return{name:a.cn,...hit,bleed:e.bleed.turns};
    }
    if(id==='frost_bind'){
      if(q.shatter&&e.block>0)e.block=Math.max(0,e.block-q.shatter);
      const hit=dealEnemy(p,e,q.damage,{ignoreArmor:true});
      e.damageDown={amount:q.damageDown,turns:q.turns};
      if(q.guardDown)e.guardDown={amount:q.guardDown,turns:q.turns};
      return{name:a.cn,...hit,frost:q.turns};
    }
    if(id==='riposte'){
      p.block+=q.block;p.riposte={damage:q.damage,turns:q.turns};return{name:a.cn,block:q.block,riposte:true};
    }
    if(id==='life_drain'){
      const hit=dealEnemy(p,e,q.damage,{ignoreArmor:true}),want=Math.ceil(hit.dmg*q.healRate);
      const heal=Math.min(p.maxHp-p.hp,want);p.hp+=heal;const overflow=Math.max(0,want-heal);if(q.overflowBlock)p.block+=overflow;
      return{name:a.cn,...hit,heal,block:q.overflowBlock?overflow:0};
    }
    if(id==='whirlwind'){
      let total=0,absorbed=0,exactKill=false;
      for(let i=0;i<q.hits&&e.hp>0;i++){const h=dealEnemy(p,e,p.attack+q.damageBonus);total+=h.dmg;absorbed+=h.absorbed;exactKill=exactKill||h.exactKill;}
      return{name:a.cn,dmg:total,absorbed,exactKill};
    }
    if(id==='mirror_guard'){
      const intent=p.currentEnemyIntent,raw=intent&&intent.id!=='guard'?Math.max(0,(intent.dmg||0)-(e.damageDown?.turns>0?e.damageDown.amount:0)):0;
      const n=raw>0?raw+q.attackBonus:q.block;p.block+=n;p.energy=Math.min(p.maxEnergy,p.energy+q.energy);
      return{name:a.cn,block:n};
    }
    if(id==='break_rhythm'){
      const hit=dealEnemy(p,e,p.attack+q.damageBonus),intent=p.currentEnemyIntent;
      if(q.cancelGuard&&intent?.id==='guard')return{name:a.cn,...hit,cancelCurrent:true,disrupt:true};
      if(intent?.id==='guard')e.intentDisrupt={guardReduce:q.reduce};else if(intent)e.intentDisrupt={dmgReduce:q.reduce};
      return{name:a.cn,...hit,disrupt:true};
    }
    if(id==='stagger'){
      const hit=dealEnemy(p,e,p.attack+q.damageBonus);return{name:a.cn,...hit,cancelCurrent:hit.dmg>=q.threshold};
    }
    if(id==='time_snare'||id==='fate_swap'){
      p.block+=q.block;p.energy=Math.min(p.maxEnergy,p.energy+q.energy);
      return{name:a.cn,block:q.block,...(id==='time_snare'?{delayCurrent:true}:{swapFuture:true})};
    }
    if(id==='combo_strike'){
      const combo=actionIsDefense(prev),hit=dealEnemy(p,e,p.attack+q.damageBonus+(combo?q.comboBonus:0));
      if(combo)p.energy=Math.min(p.maxEnergy,p.energy+q.comboEnergy);
      return{name:a.cn,...hit,combo};
    }
  }

  function applyEnemyAction(a, p, e) {
    const disrupt = e.intentDisrupt;
    e.intentDisrupt = null;
    if (!a || a.id === 'wait') return { name: a?.name || R.text('wait'), wait: true };
    if (a.id === 'guard') {
      const block = Math.max(0, (a.block || 0) - (disrupt?.guardReduce || 0) - (e.guardDown?.turns > 0 ? e.guardDown.amount : 0));
      e.block += block;
      return { name: a.name, block, disrupted: !!disrupt };
    }
    const raw = Math.max(0, (a.dmg || 0) - (disrupt?.dmgReduce || 0));
    const adjusted = Math.max(0, raw - (e.damageDown?.turns > 0 ? e.damageDown.amount : 0));
    const beforeBlock = p.block, hit = dealPlayer(p, e, raw);
    const exactGuard = adjusted > 0 && beforeBlock === adjusted && hit.dmg === 0;
    if (exactGuard && p.passives.precise_guard) {
      const lv = p.passives.precise_guard;
      p.energy = Math.min(p.maxEnergy, p.energy + passive(p,'precise_guard','energy'));
      p.block += passive(p,'precise_guard','block');
    }
    // A lethal counter ends the action before secondary poison/drain effects.
    if (e.hp > 0 && p.hp > 0) {
      if (a.expose) e.exposed = config.exposedTurns;
      if (a.poison) p.poison = { dmg: a.poison, turns: config.poisonTurns };
      if (a.drain) p.energy = Math.max(0, p.energy - a.drain);
    }
    return { name: a.name, ...hit, exactGuard, poison: e.hp > 0 ? a.poison || 0 : 0, drain: e.hp > 0 ? a.drain || 0 : 0 };
  }

  function endRoundState(p, e, ctx) {
    let dots = 0;
    ctx.endDamageTaken = 0;
    for (const property of ['bleed', 'burn']) {
      const effect = e[property];
      if (effect?.turns > 0 && e.hp > 0) {
        const damage = Math.min(e.hp, effect.dmg);
        e.hp -= damage;
        dots += damage;
        effect.turns--;
        if (!effect.turns) e[property] = null;
        if (e.hp <= 0) return dots;
      }
    }
    if (p.poison?.turns > 0) {
      const damage = Math.min(p.hp, p.poison.dmg);
      p.hp -= damage;
      ctx.endDamageTaken += damage;
      p.poison.turns--;
      if (!p.poison.turns) p.poison = null;
      if (p.hp <= 0) return dots;
    }
    for (const property of ['armorDebuff', 'damageDown', 'guardDown']) {
      if (e[property]?.turns > 0 && --e[property].turns === 0) e[property] = null;
    }
    if (e.exposed > 0) e.exposed--;
    for (const property of ['riposte', 'thorns']) {
      if (p[property]?.turns > 0 && --p[property].turns === 0) p[property] = null;
    }
    p.energy = Math.min(p.maxEnergy, p.energy + config.energyPerStep);
    if (p.cooldowns) {
      for (const id of Object.keys(p.cooldowns)) if (--p.cooldowns[id] === 0) delete p.cooldowns[id];
      if (!Object.keys(p.cooldowns).length) delete p.cooldowns;
    }
    ctx.turn++;
    if (p.passives.even_guard && ctx.turn % passive(p,'even_guard','interval') === 0) p.block += passive(p,'even_guard','block');
    if (ctx.simulateWorld !== false) {
      ctx.worldTurn = (ctx.worldTurn || 0) + 1;
      ctx.hunger = Math.max(0, ctx.hunger - config.hungerPerStep);
      if (ctx.hunger === 0) {
        const damage = Math.min(p.hp, world.starvationDamage);
        p.hp -= damage;
        ctx.endDamageTaken += damage;
      }
      // Both preview and execution decay the same copied context, never global state.
      const before = buffTotal(ctx.buffs, 'attack');
      ctx.buffs = (ctx.buffs || []).map(buff => ({ ...buff, turns: buff.turns - 1 })).filter(buff => buff.turns > 0);
      p.attack += buffTotal(ctx.buffs, 'attack') - before;
    }
    e.armor = armorOf(e);
    return dots;
  }

  function playerDependsOnIntent(id, p) {
    return id === 'mirror_guard' || id === 'break_rhythm' || (id === 'guard_stance' && R.skillParams(id,p.skills[id]).attackBonus>0);
  }

  function publicIntent(intent) {
    if (!intent) return null;
    return intent.hidden ? { hidden: true } : copy(intent);
  }

  /** One synchronous kernel owns ordering for previews and committed resolution. */
  function runPlan(b, { preview = false, maxSteps = 3 } = {}) {
    const cloned = preview ? cloneBattleState() : { p: state.player, e: b.enemy, hunger: state.hunger, buffs: state.buffs, worldTurn: state.worldTurn };
    const { p, e } = cloned;
    const ctx = { ...cloned, turn: b.turn, simulateWorld: !state.training };
    const start = { php: p.hp, ehp: e.hp, pblock: p.block, eblock: e.block, en: p.energy, hunger: ctx.hunger };
    const intents = copy(b.lockedIntents);
    const carryIntents = copy(b.carryIntents || []), steps = [];
    // Display checkpoints are collected only for committed combat, never previews.
    const frames = [];
    const displaySnapshot = () => {
      const player = copy(p);
      delete player.currentEnemyIntent;
      return { player, enemy: copy(e), hunger: ctx.hunger, buffs: copy(ctx.buffs), worldTurn: ctx.worldTurn, turn: ctx.turn, intents: intents.map(publicIntent) };
    };
    const stats = preview ? copy(b.stats) : b.stats;
    let outcome = null, partial = false, blockedAt = null;
    for (let i = 0; i < Math.min(3, maxSteps); i++) {
      if (p.hp <= 0) { outcome = 'defeat'; break; }
      if (e.hp <= 0) { outcome = 'victory'; break; }
      const id = i === b.sealedSlot ? null : (b.plan[i] || null), intent = intents[i];
      const unknown = preview && intent?.hidden === true;
      if (unknown && playerDependsOnIntent(id, p)) {
        partial = true; blockedAt = { index: i, phase: 'player' }; break;
      }
      p.combatTurn = ctx.turn;
      p.currentEnemyIntent = unknown ? null : intent;
      const pa = id ? applyPlayerAction(id, p, e, ctx) : { name: i === b.sealedSlot ? R.text('sealed') : R.text('wait'), wait: true };
      const step = { index: i, turn: ctx.turn, actionId: id, playerAction: copy(pa), enemyIntent: publicIntent(intent), enemyAction: null, dots: 0 };
      steps.push(step);
      stats.damageDealt += pa.dmg || 0;
      if (pa.exactKill) stats.exactKill = true;
      if (pa.swapFuture && i + 2 < intents.length) [intents[i + 1], intents[i + 2]] = [intents[i + 2], intents[i + 1]];
      p.prevActionId = id || 'wait';
      const frame = preview ? null : { afterPlayer: displaySnapshot(), afterEnemy: null, afterRound: null };
      if (frame) frames.push(frame);
      if (e.hp <= 0) { stats.rounds++; outcome = 'victory'; break; }
      if (pa.delayCurrent) {
        if (intent) carryIntents.push(copy(intent));
        step.enemyAction = { delayed: true };
      } else if (pa.cancelCurrent) step.enemyAction = { canceled: true };
      else {
        if (unknown) { partial = true; blockedAt = { index: i, phase: 'enemy' }; break; }
        if (intent) intent.hidden = false;
        step.enemyIntent = publicIntent(intent);
        const ea = applyEnemyAction(intent, p, e);
        step.enemyAction = copy(ea);
        stats.damageDealt += ea.rip || 0;
        stats.damageTaken += ea.dmg || 0;
        stats.blocked += ea.absorbed || 0;
        if (ea.exactGuard) stats.exactBlocks++;
        if (ea.exactKill) stats.exactKill = true;
      }
      if (frame) frame.afterEnemy = displaySnapshot();
      stats.rounds++;
      if (p.hp <= 0) { outcome = 'defeat'; break; }
      if (e.hp <= 0) { outcome = 'victory'; break; }
      step.dots = endRoundState(p, e, ctx);
      stats.damageDealt += step.dots;
      stats.damageTaken += ctx.endDamageTaken || 0;
      if (frame) frame.afterRound = displaySnapshot();
      if (e.hp <= 0) { outcome = 'victory'; break; }
      if (p.hp <= 0) { outcome = 'defeat'; break; }
    }
    delete p.currentEnemyIntent;
    // Kill-triggered combat passives are part of the shared prediction as well.
    if (outcome === 'victory' && p.passives.precise_kill) p.energy = Math.min(p.maxEnergy, p.energy + passive(p,'precise_kill','energy'));
    if (!preview) {
      state.hunger = ctx.hunger;
      state.buffs = ctx.buffs;
      state.worldTurn = ctx.worldTurn;
      b.turn = ctx.turn;
      b.lockedIntents = intents;
      b.carryIntents = carryIntents;
      syncHiddenIndex(b);
    }
    return {
      p: copy(p), e: copy(e), start, hunger: ctx.hunger, buffs: copy(ctx.buffs), worldTurn: ctx.worldTurn,
      turn: ctx.turn, partial, blockedAt, steps, outcome, stats: copy(stats),
      intents: intents.map(publicIntent), carryIntents: carryIntents.map(publicIntent),
      ...(!preview ? { frames } : {}),
    };
  }

  function simulatePlan(options = {}) {
    if (!state.battle) return null;
    return runPlan(state.battle, { ...options, preview: true });
  }

  function resolvePlan(expectedBatchId) {
    const b = state.battle;
    if (!b) return { ok: false, error: 'NO_BATTLE' };
    if (b.resolving) return { ok: false, error: 'RESOLVING' };
    if (expectedBatchId && expectedBatchId !== b.batchId) return { ok: false, error: 'STALE_BATCH' };
    b.resolving = true;
    const batchId = b.batchId, phaseAtStart = bossPhase(b.enemy);
    let result;
    try {
      result = runPlan(b);
      b.lastResolvedBatchId = batchId;
      if (result.outcome === 'victory') result.battleResult = onEnemyDefeated({ rewardApplied: true });
      else if (result.outcome === 'defeat') result.battleResult = endBattle(false);
      else {
        b.plan = [null, null, null];
        b.lockedIntents = makeIntentBatch();
        const phaseNow = bossPhase(b.enemy);
        if (b.enemy.id === world.boss && phaseNow !== phaseAtStart) call('toast', R.text('bossPhase',{phase:phaseNow}));
      }
    } finally { b.resolving = false; }
    return { ok: true, battleId: b.id, batchId, ...result };
  }

  function onEnemyDefeated({ rewardApplied = false } = {}) {
    const p = state.player;
    if (!rewardApplied && p.passives.precise_kill) p.energy = Math.min(p.maxEnergy, p.energy + passive(p,'precise_kill','energy'));
    return endBattle(true);
  }

  const installed = {
    startBattle, endBattle, bossPhase, configureBossRules, makeIntentBatch, currentIntent,
    filledPlanCount, nextPlanSlot, actionIsDefense, armorOf, actionCatalog, actionInfo,
    projectedEnergyBeforeSlot, projectedCooldownBeforeSlot, cloneBattleState, bonusFor, dealEnemy, dealPlayer,
    applyPlayerAction, applyEnemyAction, endRoundState, simulatePlan, resolvePlan,
    onEnemyDefeated, battleGrade, makeBattleReport, updateMetaFromReport,
  };
  Object.assign(R, installed);
  return installed;
}
