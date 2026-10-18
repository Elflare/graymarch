export function installContent(R) {
const state=R.state; const addBuff=(...a)=>R.addBuff(...a),toast=(...a)=>R.toast(...a);
const classDefs={
 wanderer:{cn:'灰境行者',desc:'均衡、稳定，适合任何构筑。',base:{hp:18,attack:4,energy:3,hunger:100},skills:{},passives:{},equipment:{},inventory:{berries:1,roots:1},unlock:'默认解锁'},
 sentinel:{cn:'盾誓守卫',desc:'生命与防御更高，擅长精准格挡与反击。',base:{hp:22,attack:4,energy:3,hunger:100},skills:{guard_stance:1},passives:{precise_guard:1},equipment:{tower_shield:1},inventory:{roots:2},unlock:'获得一次 S 级战术评价'},
 arcanist:{cn:'符文术士',desc:'生命较低但符能充足，从火球术起步。',base:{hp:15,attack:3,energy:4,hunger:90},skills:{fireball:1},passives:{reserve:1},equipment:{rune_ring:1},inventory:{emberberry:1,herb:1},unlock:'击败赤塔领主'},
 hunter:{cn:'黑木猎手',desc:'探索与持续伤害能力强，适合资源路线与流血构筑。',base:{hp:17,attack:4,energy:3,hunger:110},skills:{bleed_strike:1},passives:{forager:1,pathfinder:1},equipment:{},inventory:{berries:2,nuts:1},unlock:'累计采集 10 次'}
};
const gradeRank={C:0,B:1,A:2,S:3};
const tileInfo={
 '.':{cls:'plain',icon:'·',name:'灰境荒原',desc:'贫瘠开阔，能挖到少量根茎。',move:2,enemyRate:'约 13%',gather:'甜根 / 坚果 / 药草'},
 G:{cls:'grass',icon:'❧',name:'风草原',desc:'草籽与药草丰富，适合补给。',move:1,enemyRate:'约 10%',gather:'浆果 / 草籽饼 / 甜根 / 药草'},
 T:{cls:'forest',icon:'♣',name:'黑木林',desc:'食物丰富，但穿行更耗体力。',move:3,enemyRate:'约 18%',gather:'浆果 / 蘑菇 / 坚果 / 野味'},
 S:{cls:'swamp',icon:'≈',name:'灰苔沼泽',desc:'泥泞而危险，能找到蘑菇和药草。',move:4,enemyRate:'约 20%',gather:'蘑菇 / 沼果 / 药草 / 根茎'},
 '=':{cls:'road',icon:'═',name:'旧王道',desc:'移动最省食物，沿路也最安全。',move:1,enemyRate:'约 6%',gather:'无'},
 '^':{cls:'mountain',icon:'▲',name:'裂脊山',desc:'陡峭岩壁，当前无法直接翻越。',move:null,enemyRate:'—',gather:'无'},
 '~':{cls:'water',icon:'≈',name:'沉水河',desc:'深水阻路，需绕行。',move:null,enemyRate:'—',gather:'无'},
 V:{cls:'village',icon:'⌂',name:'石炉聚落',desc:'首次抵达可休整并获得少量补给。',move:1,enemyRate:'0%',gather:'无'},
 R:{cls:'ruins',icon:'†',name:'旧礼拜堂遗迹',desc:'首次探索可恢复符能并获得经验。',move:2,enemyRate:'低',gather:'无'},
 C:{cls:'camp',icon:'♨',name:'遗火营地',desc:'残存火堆适合休息与加工食材；每处营火只能使用一次。',move:1,enemyRate:'0%',gather:'可烹饪'},
 Q:{cls:'event',icon:'?',name:'未知事件',desc:'灰境中的偶遇，大多会带来帮助。',move:2,enemyRate:'事件决定',gather:'无'},
 E:{cls:'enemy',icon:'⚔',name:'敌对踪迹',desc:'普通敌人盘踞于此。',move:2,enemyRate:'100%',gather:'击败后获得经验'},
 X:{cls:'elite',icon:'✦',name:'精英踪迹',desc:'危险敌人。击败不同精英可夺取赤塔印记。',move:3,enemyRate:'100%',gather:'无'},
 B:{cls:'finalboss',icon:'♜',name:'赤塔',desc:'灰境旅途的终点。需要 3 枚塔印解除封锁。',move:2,enemyRate:'最终 Boss',gather:'无'}
};
const BIOME_SIZE=18;
const biomeDefs={
 grass:{id:'grass',name:'风歌平原',desc:'开阔草海与旧道交错，补给容易，危险较低。',enemyBias:-.02},
 forest:{id:'forest',name:'黑木密林',desc:'林地资源丰富，但野兽和伏击者更多。',enemyBias:.025},
 mire:{id:'mire',name:'灰苔湿地',desc:'沼泽与水道密布，采集收益高而风险明显。',enemyBias:.04},
 highland:{id:'highland',name:'裂脊高地',desc:'山岩与荒地占据大半区域，重甲敌人常见。',enemyBias:.02},
 ashen:{id:'ashen',name:'灰烬边境',desc:'贫瘠、诡异而危险，亡灵与秘法敌人更常出现。',enemyBias:.045},
 red:{id:'red',name:'赤塔疆域',desc:'赤塔周边的腐化土地，空气里带着铁锈与余烬。',enemyBias:.06}
};
const enemyDefs={
 wolf:{cn:'荒原狼',en:'Wasteland Wolf',art:'wolf',tags:['野兽','迅捷','无甲'],summary:'每三回合发动扑击，其余时间持续撕咬。',hp:7,atk:2,armor:0,scene:'BLACKWOOD EDGE',pattern:['1-2：撕咬 2','3：扑击 4','循环重复'],ai:(t,e)=>t%3===0?{id:'heavy',name:'扑击',dmg:e.atk+2}:{id:'attack',name:'撕咬',dmg:e.atk}},
 boar:{cn:'黑鬃野猪',en:'Blackmane Boar',art:'boar',tags:['野兽','冲锋','厚皮'],summary:'平时顶撞，第四回合蓄力冲锋，伤害明显提高。',hp:10,atk:2,armor:1,scene:'WINDGRASS',pattern:['1-3：顶撞 2','4：冲锋 5','循环重复'],ai:(t,e)=>t%4===0?{id:'heavy',name:'獠牙冲锋',dmg:e.atk+3}:{id:'attack',name:'顶撞',dmg:e.atk}},
 skeleton:{cn:'墓园剑骨',en:'Grave Skeleton',art:'skeleton',tags:['亡灵','轻甲','防御型'],summary:'生命过半后频繁格挡，每第四回合使用重劈。',hp:9,atk:2,armor:1,scene:'FALLEN CHAPEL',pattern:['每 4 回合：重击 4','HP ≤ 50% 且每 3 回合：格挡 3','其余：劈砍 2'],ai:(t,e)=>t%4===0?{id:'heavy',name:'骸骨重劈',dmg:e.atk+2}:(e.hp<=e.maxHp/2&&t%3===0?{id:'guard',name:'举盾',block:3}:{id:'attack',name:'劈砍',dmg:e.atk})},
 spider:{cn:'沼纹毒蛛',en:'Fenstripe Spider',art:'spider',tags:['野兽','毒素','爆发'],summary:'第三回合喷吐毒液；毒液会在随后两回合继续损伤生命。',hp:8,atk:2,armor:0,scene:'GREY MIRE',pattern:['1-2：撕咬 2','3：毒液 2 + 中毒','循环重复'],ai:(t,e)=>t%3===0?{id:'venom',name:'毒液喷吐',dmg:e.atk,poison:1}:{id:'attack',name:'撕咬',dmg:e.atk}},
 bandit:{cn:'灰斗佣兵',en:'Graycloak Mercenary',art:'bandit',tags:['人类','节奏型'],summary:'严格按刺击、招架、重击三拍循环。',hp:10,atk:3,armor:0,scene:'OLD KING\'S ROAD',pattern:['1：刺击 3','2：格挡 2','3：重击 5','循环重复'],ai:(t,e)=>t%3===1?{id:'attack',name:'刺击',dmg:e.atk}:t%3===2?{id:'guard',name:'招架',block:2}:{id:'heavy',name:'重击',dmg:e.atk+2}},
 knight:{cn:'失誓骑士',en:'Oathless Knight',art:'knight',tags:['人类','重甲','稳健'],summary:'格挡与攻击交替，第五回合会用穿甲重斩。',hp:14,atk:3,armor:2,scene:'BROKEN CAUSEWAY',pattern:['偶数回合：格挡 3','每 5 回合：穿甲重斩 6','其余：剑击 3'],ai:(t,e)=>t%5===0?{id:'heavy',name:'穿甲重斩',dmg:e.atk+3}:t%2===0?{id:'guard',name:'塔盾架势',block:3}:{id:'attack',name:'剑击',dmg:e.atk}},
 golem:{cn:'符文石像',en:'Rune Golem',art:'golem',tags:['构装','重甲','慢速'],summary:'护甲很高；每次攻击后短暂露出破绽。',hp:13,atk:3,armor:2,scene:'BROKEN SHRINE',pattern:['奇数：石拳 3','偶数：震地 5','行动后短暂破绽'],ai:(t,e)=>t%2===0?{id:'heavy',name:'震地',dmg:e.atk+2,expose:true}:{id:'attack',name:'石拳',dmg:e.atk,expose:true}},
 wraith:{cn:'暮影巫徒',en:'Dusk Cultist',art:'wraith',tags:['秘法','爆发','吸能'],summary:'暗焰爆发高，并会周期性削减你的能量。',hp:11,atk:3,armor:0,scene:'ASHEN MARSH',pattern:['奇数：暗焰 5','每 4 回合：暮影屏障 3','每 6 回合额外吸取 1 能量'],ai:(t,e)=>t%4===0?{id:'guard',name:'暮影屏障',block:3}:(t%2===1?{id:'heavy',name:'暗焰',dmg:e.atk+2,drain:t%6===0?1:0}:{id:'attack',name:'法术',dmg:e.atk,drain:t%6===0?1:0})},
 ogre:{cn:'裂石食人魔',en:'Stonecleaver Ogre',art:'ogre',tags:['巨人','高血量','重击'],summary:'几乎不防御，每两回合一次大力挥砸，适合抢攻或提前架盾。',hp:17,atk:4,armor:0,scene:'SHATTERED HILLS',pattern:['奇数：横扫 4','偶数：巨槌 7'],ai:(t,e)=>t%2===0?{id:'heavy',name:'巨槌',dmg:e.atk+3}:{id:'attack',name:'横扫',dmg:e.atk}},
 iron_warden:{cn:'铁誓卫长',en:'Iron Oath Warden',art:'knight',tags:['塔印守卫','重甲','破绽'],summary:'第一枚塔印守卫。架盾、剑击、重锤三拍循环；重锤后短暂露出破绽。第 13 步起，每 3 步攻击伤害 +1。',hp:24,atk:3,armor:2,enrageAfter:12,scene:'THE IRON VIGIL',pattern:['1：铁誓壁垒 +6 格挡','2：誓刃 3 伤害','3：破城重锤 6 伤害，随后露出破绽','第 13 步起，每 3 步伤害 +1'],ai:(t,e)=>t%3===1?{id:'guard',name:'铁誓壁垒',block:6}:t%3===2?{id:'attack',name:'誓刃',dmg:e.atk}:{id:'heavy',name:'破城重锤',dmg:e.atk+3,expose:true}},
 rot_priest:{cn:'蚀符祭司',en:'Blight Rune Priest',art:'wraith',tags:['塔印守卫','吸能','毒咒'],summary:'第二枚塔印守卫。汲能、符盾、毒咒三拍循环；格挡也无法阻止汲能与施毒。第 13 步起，每 3 步攻击伤害 +1。',hp:36,atk:4,armor:1,enrageAfter:12,scene:'THE BLIGHT SANCTUM',pattern:['1：蚀符汲能 3 伤害，吸取 1 能量','2：腐印屏障 +5 格挡','3：瘴毒咒 4 伤害，中毒 2 步，每步 1 伤害','第 13 步起，每 3 步伤害 +1'],ai:(t,e)=>t%3===1?{id:'drain',name:'蚀符汲能',dmg:e.atk-1,drain:1}:t%3===2?{id:'guard',name:'腐印屏障',block:5}:{id:'venom',name:'瘴毒咒',dmg:e.atk,poison:1}},
 rift_reaver:{cn:'裂冠猎手',en:'Crown Rift Reaver',art:'ogre',tags:['塔印守卫','蓄势爆发','错拍'],summary:'第三枚塔印守卫。蓄势后连续三次攻击，四拍循环会与三步计划错开；裂冠斩后露出破绽。第 13 步起，每 3 步攻击伤害 +1。',hp:48,atk:5,armor:1,enrageAfter:12,scene:'THE SHATTERED CROWN',pattern:['1：锁定猎物，不造成伤害','2：断崖猛袭 9 伤害','3：追猎 5 伤害','4：裂冠斩 7 伤害，随后露出破绽','第 13 步起，每 3 步伤害 +1'],ai:(t,e)=>t%4===1?{id:'wait',name:'锁定猎物'}:t%4===2?{id:'heavy',name:'断崖猛袭',dmg:e.atk+4}:t%4===3?{id:'attack',name:'追猎',dmg:e.atk}:{id:'heavy',name:'裂冠斩',dmg:e.atk+2,expose:true}},
 lord:{cn:'赤塔领主',en:'Lord of the Red Tower',art:'lord',tags:['最终 Boss','重甲','三阶段'],summary:'会随生命进入三种阶段：守势试探、猩红压制、濒死狂攻。第 19 步起，每 3 步攻击伤害 +1。',hp:72,atk:5,armor:2,enrageAfter:18,scene:'THE RED TOWER',pattern:['HP > 66%：王剑 5 / 架势 +4 格挡 / 重斩 8','HP 33–66%：猩红斩 8 与吸能术 6 交替','HP ≤ 33%：狂王连斩 9 / 赤塔崩落 11，不再防御','第 19 步起，每 3 步伤害 +1'],ai:(t,e)=>{
  let ratio=e.hp/e.maxHp;
  if(ratio>2/3)return t%3===0?{id:'heavy',name:'王权重斩',dmg:e.atk+3}:t%2===0?{id:'guard',name:'赤塔架势',block:4}:{id:'attack',name:'王剑',dmg:e.atk};
  if(ratio>1/3)return t%3===0?{id:'drain',name:'血印汲取',dmg:e.atk+1,drain:1}:{id:'heavy',name:'猩红斩',dmg:e.atk+3};
  return t%3===0?{id:'heavy',name:'赤塔崩落',dmg:e.atk+6}:{id:'heavy',name:'狂王连斩',dmg:e.atk+4};
 }}
};
const enemyTier={wolf:1,boar:1,skeleton:1,spider:2,bandit:2,knight:3,golem:3,wraith:3,ogre:4,lord:5};
const biomeEnemyPools={
 grass:['wolf','boar','bandit','knight','ogre'],
 forest:['wolf','boar','spider','bandit','wraith'],
 mire:['spider','wraith','golem','ogre','skeleton'],
 highland:['boar','bandit','knight','golem','ogre'],
 ashen:['skeleton','wraith','golem','knight','ogre'],
 red:['wraith','knight','golem','ogre','skeleton']
};
const activeSkills={
 power_strike:{kind:'skill',cn:'重斩',unlock:1,cost:1,max:5,desc:l=>`消耗 1 能量，造成 攻击+${2+l}。${l>=3?' 施放前粉碎敌人 2 Block。':''}${l>=5?' 若敌人没有 Block，额外 +2 伤害。':''}`,vfx:'heavy',sfx:'slash'},
 guard_stance:{kind:'skill',cn:'守势',unlock:1,cost:0,max:5,desc:l=>`获得 ${3+l*2} 格挡。${l>=3?' 若本步敌人准备攻击，再 +2 Block。':''}${l>=5?' 并进入荆棘架势 2 回合：受格挡的攻击反伤 2。':''}`,vfx:'shield',sfx:'block'},
 heal:{kind:'skill',cn:'治愈祷言',unlock:1,cost:1,max:5,desc:l=>`恢复 ${3+l*2} HP。${l>=3?' 清除中毒。':''}${l>=5?' 并获得 3 Block。':''}`,vfx:'heal',sfx:'heal'},
 armor_break:{kind:'skill',cn:'破甲斩',unlock:2,cost:1,max:5,desc:l=>`造成 ${2+l} 基础伤害，并使护甲 -${1+Math.floor((l-1)/2)}，持续 ${2+Math.ceil(l/2)} 回合。${l>=5?' 若因此降至 0 护甲，追加 3 点无视护甲伤害。':''}`,vfx:'break',sfx:'metal'},
 charge:{kind:'skill',cn:'蓄力',unlock:2,cost:0,max:5,desc:l=>`下一次造成伤害时额外 +${3+l}。${l>=3?' 立即恢复 1 能量。':''}${l>=5?' 下一次伤害同时无视护甲。':''}`,vfx:'charge',sfx:'magic'},
 execute:{kind:'skill',cn:'处决',unlock:3,cost:2,max:5,desc:l=>`敌人 HP ≤ ${4+l} 时造成 ${6+l*2} 无视护甲伤害，否则造成 1。${l>=5?' 处决击杀时返还 2 能量。':''}`,vfx:'execute',sfx:'metal'},
 fireball:{kind:'skill',cn:'火球术',unlock:3,cost:2,max:5,desc:l=>`造成 ${3+l*2} 无视护甲伤害，并灼烧 ${2+Math.floor(l/2)} 回合，每回合 ${l>=3?2:1}。${l>=5?' 已在燃烧的敌人额外受到 3 伤害。':''}`,vfx:'fireball',sfx:'fireball'},
 bleed_strike:{kind:'skill',cn:'放血斩',unlock:4,cost:1,max:5,desc:l=>`造成普通攻击伤害，并施加 ${2+Math.floor(l/2)} 回合流血，每回合 ${1+Math.floor((l-1)/2)}。${l>=3?' 对已流血目标再提高每回合 1 点流血。':''}`,vfx:'bleed',sfx:'slash'},
 frost_bind:{kind:'skill',cn:'霜缚',unlock:4,cost:1,max:5,desc:l=>`造成 ${1+l} 无视护甲伤害，并使敌人伤害 -${1+Math.floor(l/2)}，持续 ${2+Math.ceil(l/2)} 回合。${l>=3?' 同时使其格挡效果 -2。':''}${l>=5?' 施放时粉碎 3 Block。':''}`,vfx:'frost',sfx:'magic'},
 riposte:{kind:'skill',cn:'反击架势',unlock:5,cost:0,max:5,desc:l=>`获得 ${2+l} 格挡；完全挡住攻击时反击 ${2+l}。${l>=3?' 架势持续 2 回合。':''}${l>=5?' 反击伤害 +3。':''}`,vfx:'shield',sfx:'block'},
 life_drain:{kind:'skill',cn:'汲取生命',unlock:6,cost:2,max:5,desc:l=>`造成 ${2+l*2} 无视护甲伤害，并恢复实际伤害的${l>=5?'75%':'一半'}。${l>=3?' 溢出的治疗转化为 Block。':''}`,vfx:'drain',sfx:'magic'},
 whirlwind:{kind:'skill',cn:'旋风双斩',unlock:7,cost:2,max:5,desc:l=>`连续攻击${l>=5?'三':'两'}次，每次造成 攻击+${Math.floor(l/2)} 的伤害。`,vfx:'heavy',sfx:'slash'},
 mirror_guard:{kind:'skill',rare:true,cn:'镜式格挡',unlock:4,cost:1,max:3,desc:l=>`根据本步敌人行动架盾：若其攻击，获得等于预计伤害${l>1?`+${l-1}`:''}的 Block；若其不攻击，获得 ${2+l} Block。${l>=3?' 恢复 1 能量。':''}`,vfx:'shield',sfx:'block'},
 break_rhythm:{kind:'skill',rare:true,cn:'破势',unlock:5,cost:1,max:3,desc:l=>`造成 攻击+${l} 伤害，并削弱本步敌人行动：伤害/格挡 -${2+l}。${l>=3?' 若本步是格挡，则直接打断该格挡。':''}`,vfx:'break',sfx:'metal'},
 stagger:{kind:'skill',rare:true,meta:'interrupt_tactics',cn:'断势击',unlock:4,cost:1,cooldown:2,max:3,desc:l=>`造成 攻击+${l} 伤害；若实际造成至少 ${5-l} 点伤害，取消敌人本步行动。施放后冷却 2 步。`,vfx:'interrupt',sfx:'metal'},
 time_snare:{kind:'skill',rare:true,meta:'time_tactics',cn:'时滞刻印',unlock:5,cost:1,cooldown:1,max:3,desc:l=>`本步不造成伤害，将敌人本步行动推迟到下一组计划。${l>=2?' 获得 2 Block。':''}${l>=3?' 并恢复 1 能量。':''}施放后冷却 1 步。`,vfx:'time',sfx:'magic'},
 fate_swap:{kind:'skill',rare:true,meta:'time_tactics',cn:'逆序符',unlock:5,cost:1,max:3,desc:l=>`交换本步之后剩余的两个敌人行动。${l>=2?' 获得 1 能量。':''}${l>=3?' 再获得 2 Block。':''}`,vfx:'swap',sfx:'magic'},
 combo_strike:{kind:'skill',rare:true,cn:'连携斩',unlock:4,cost:1,max:5,desc:l=>`造成 攻击+${l} 伤害；若上一步是防御类行动，再 +${2+l}。${l>=5?' 连携成功时返还 1 能量。':''}`,vfx:'slash',sfx:'slash'}
};
const passiveDefs={
 third_strike:{kind:'passive',cn:'第三击',unlock:1,desc:l=>`每第 3 次造成伤害时，额外 +${1+l}。`,max:5},
 even_guard:{kind:'passive',cn:'偶数防线',unlock:2,desc:l=>`偶数战斗回合开始时获得 ${l} 格挡。`,max:5},
 low_hp_fury:{kind:'passive',cn:'困兽',unlock:2,desc:l=>`HP ≤ 50% 时，造成伤害 +${l}。`,max:5},
 precise_kill:{kind:'passive',cn:'精准收尾',unlock:3,desc:l=>`击杀敌人恢复 ${Math.min(3,l)} 能量。`,max:3},
 reserve:{kind:'passive',cn:'符能储备',unlock:3,desc:l=>`每场战斗开始额外获得 ${l} 能量。`,max:3},
 pathfinder:{kind:'passive',cn:'寻路者',unlock:2,desc:l=>`地图移动饥饿消耗 -${l}（最低 1）。`,max:2},
 forager:{kind:'passive',cn:'采集者',unlock:2,desc:l=>`采集成功率 +${l*7}%，并略微降低采集伏击/负面状态概率；高等级时有概率获得双份。`,max:3},
 hearty:{kind:'passive',cn:'大胃囊',unlock:3,desc:l=>`最大饥饿 +${l*10}。`,max:4},
 field_medic:{kind:'passive',cn:'野战医术',unlock:4,desc:l=>`药草额外恢复 ${l*2} HP。`,max:4},
 precise_guard:{kind:'passive',cn:'精准格挡',unlock:2,desc:l=>`若你的 Block 恰好等于敌人本次伤害并完全挡住：恢复 ${l>=3?2:1} 能量${l>=2?'，并保留 1 Block':''}。`,max:3},
 parity_edge:{kind:'passive',cn:'奇数锋刃',unlock:3,desc:l=>`战斗的奇数回合，你造成的伤害 +${l}。`,max:4},
 divisible_edge:{kind:'passive',cn:'三分律',unlock:4,desc:l=>`造成伤害前，若敌人当前 HP 能被 3 整除，伤害 +${l}。`,max:4},
 exact_finish:{kind:'passive',cn:'精确终结',unlock:5,desc:l=>`若最后一击伤害恰好等于敌人剩余 HP，额外获得 ${l*5}% 战斗经验。`,max:3}
};
const equipDefs={
 iron_sword:{kind:'equip',cn:'铁脊长剑',unlock:1,slot:'weapon',desc:l=>`攻击 +${l}。`,max:4},
 tower_shield:{kind:'equip',cn:'旧塔盾',unlock:1,slot:'shield',desc:l=>`基础格挡额外 +${l}。`,max:4},
 rune_ring:{kind:'equip',cn:'符文指环',unlock:2,slot:'ring',desc:l=>`最大能量 +${l}。`,max:3},
 wanderer_cloak:{kind:'equip',cn:'行者披风',unlock:2,slot:'cloak',desc:l=>`最大生命 +${2*l}。`,max:4}
};
const rewardPool={...activeSkills,...passiveDefs,...equipDefs};
const foodDefs={
 berries:{cn:'黑莓束',desc:'+11 饥饿；25% 获得“清醒”8回合（格挡+1）',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+11);if(R.random()<.25)addBuff({id:'berry_focus',name:'清醒',turns:8,guard:1,desc:'格挡动作 +1。'})}},
 roots:{cn:'甜根',desc:'+16 饥饿；稳定、安全',eat:()=>state.hunger=Math.min(state.maxHunger,state.hunger+16)},
 mushroom:{cn:'灰帽菇',desc:'+22 饥饿；30% 胃寒10回合（移动/采集额外耗饥饿）',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+22);if(R.random()<.30)addBuff({id:'stomach_cold',name:'胃寒',turns:10,hungerCost:1,desc:'移动与采集的饥饿消耗 +1。'})}},
 meat:{cn:'熏野味',desc:'+28 饥饿、+4 HP；25% 口渴8回合（移动/采集额外耗饥饿）',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+28);state.player.hp=Math.min(state.player.maxHp,state.player.hp+4);if(R.random()<.25)addBuff({id:'thirsty',name:'口渴',turns:8,hungerCost:1,desc:'移动与采集的饥饿消耗 +1。'})}},
 herb:{cn:'苦叶药草',desc:'恢复生命，但 -4 饥饿',eat:()=>{let n=6+2*(state.player.passives.field_medic||0);state.player.hp=Math.min(state.player.maxHp,state.player.hp+n);state.hunger=Math.max(0,state.hunger-4);toast(`苦叶药草：+${n} HP，-4 饥饿`)}},
 seedcake:{cn:'草籽饼',desc:'+9 饥饿；获得“耐行”10回合（移动/采集消耗-1）',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+9);addBuff({id:'trail_food',name:'耐行',turns:10,hungerCost:-1,desc:'移动与采集的饥饿消耗 -1（最低仍为1）。'})}},
 nuts:{cn:'铁壳坚果',desc:'+14 饥饿、+2 HP',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+14);state.player.hp=Math.min(state.player.maxHp,state.player.hp+2)}},
 bogfruit:{cn:'赤沼果',desc:'+20 饥饿，但 -2 HP',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+20);state.player.hp=Math.max(1,state.player.hp-2);toast('赤沼果：+20 饥饿，-2 HP')}},
 emberberry:{cn:'火刺莓',desc:'+7 饥饿；获得“辛烈”10回合（攻击+1）',eat:()=>{state.hunger=Math.min(state.maxHunger,state.hunger+7);addBuff({id:'ember_spice',name:'辛烈',turns:10,attack:1,desc:'攻击 +1。'})}}
};

const affinityMap={
 power_strike:'burst',charge:'burst',execute:'burst',iron_sword:'burst',low_hp_fury:'burst',exact_finish:'precision',
 guard_stance:'guard',riposte:'guard',tower_shield:'guard',even_guard:'guard',precise_guard:'guard',
 fireball:'fire',bleed_strike:'bleed',life_drain:'sustain',heal:'sustain',wanderer_cloak:'sustain',
 armor_break:'precision',frost_bind:'control',divisible_edge:'precision',parity_edge:'tempo',
 whirlwind:'tempo',break_rhythm:'tempo',stagger:'tempo',time_snare:'control',fate_swap:'control',combo_strike:'tempo',third_strike:'tempo',rune_ring:'tempo',mirror_guard:'guard',
 pathfinder:'survival',forager:'survival',hearty:'survival',field_medic:'survival'
};

Object.assign(R,{classDefs,gradeRank,tileInfo,BIOME_SIZE,biomeDefs,enemyDefs,enemyTier,biomeEnemyPools,activeSkills,passiveDefs,equipDefs,rewardPool,foodDefs,affinityMap});
}
