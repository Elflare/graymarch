/** Shared survival rules for exploration and the combat/preview kernel. */
export const starvationDamage = (resources, maxHp) => Math.ceil(maxHp * resources.data.world.starvationHpRatio);

export function installLifecycle(R) {
  const s = R.state;
  R.finishRun = (cause) => {
    if (s.runResult) return;
    s.player.hp = 0;
    s.inBattle = false;
    s.battle = null;
    s.pendingDecision = null;
    s.pendingRewards = 0;
    s.screen = 'world';
    s.runResult = {
      cause, classId: s.classId, level: s.level, xp: s.xp,
      worldTurn: s.worldTurn, wins: s.wins, sigils: s.sigils, visited: s.visited.size,
      build: structuredClone({skills: s.player.skills, passives: s.player.passives, equipment: s.player.equipment}),
    };
    R.events.push({type: 'runEnded', result: structuredClone(s.runResult)});
  };
}
