"""Small player-visible views. Presentation only; no gameplay rules or simulation."""


def pick(record, keys):
    return {key: record[key] for key in keys if key in record}


def definition_view(definition):
    return {key: value for key, value in definition.items() if key != "version"}


def player_view(player, *, sparse=True):
    result = pick(player, ("hp", "maxHp", "attack", "energy", "maxEnergy", "hunger", "maxHunger",
                           "level", "xp", "xpNeed", "sigils", "victory", "block", "charge", "chargePierce",
                           "poison", "riposte", "thorns", "cooldowns", "buffs", "skills", "passives", "equipment", "inventory"))
    if player.get("passives", {}).get("third_strike"):
        result.update(pick(player, ("damageCount",)))
    if player.get("skills", {}).get("combo_strike"):
        result.update(pick(player, ("prevActionId",)))
    if sparse:
        for key in ("block", "charge", "chargePierce", "poison", "riposte", "thorns", "buffs", "victory", "skills", "passives", "equipment"):
            if not result.get(key):
                result.pop(key, None)
        if "inventory" in result:
            result["inventory"] = {key: value for key, value in result["inventory"].items() if value}
    return result


def enemy_view(enemy):
    result = pick(enemy, ("id", "name", "hp", "maxHp", "armor", "block", "eliteRank", "enrageAfter"))
    if "cn" in enemy:
        result["name"] = enemy["cn"]
    if "atk" in enemy or "attack" in enemy:
        result["attack"] = enemy.get("atk", enemy.get("attack"))
    for key in ("exposed", "armorDebuff", "damageDown", "guardDown", "bleed", "burn", "intentDisrupt", "enrage"):
        if enemy.get(key):
            result[key] = enemy[key]
    return result


def tile_view(tile):
    result = {"terrain": tile["terrain"], "cost": tile["moveCost"]}
    for key in ("spent", "harvested", "cleared"):
        if tile.get(key):
            result[key] = True
    if tile.get("enemy"):
        result["enemy"] = enemy_view(tile["enemy"])
    return result


def world_view(frame):
    world = frame.get("world") or {}
    result = {}
    if world.get("position") is not None:
        result["position"] = world["position"]
    if world.get("current"):
        result["tile"] = tile_view(world["current"])
    if "neighbors" in world:
        result["neighbors"] = {tile["direction"]: tile_view(tile) for tile in world["neighbors"]}
    if world.get("objective", {}).get("leads"):
        result["navigation"] = world["objective"]["leads"]
    result["actions"] = [action for action in frame.get("allowed", []) if action in ("world.harvest", "camp.open")]
    return result


def battle_view(battle, *, full_actions=False):
    result = {"turn": battle["turn"], "enemy": enemy_view(battle["enemy"])}
    result["intents"] = [
        {"hidden": True} if intent.get("known") is False or intent.get("hidden") else
        {key: value for key, value in intent.items() if key not in ("slot", "known", "hidden", "name")}
        for intent in battle["intents"]
    ]
    if battle.get("sealedSlot") is not None:
        result["sealedSlot"] = battle["sealedSlot"]
    if any(battle.get("plan", [])):
        result["plan"] = battle["plan"]
    if full_actions:
        result["actions"] = [{"id": action["id"], "cost": action["cost"], "effect": action["desc"]} for action in battle["actions"]]
    else:
        result["actions"] = {action["id"]: action["cost"] for action in battle["actions"]}
    return result


def choice_view(choice):
    result = pick(choice, ("kind",))
    if choice["kind"] not in ("reward", "camp", "victory"):
        result.update(pick(choice, ("title", "text")))
    elif choice["kind"] != "reward":
        result.update(pick(choice, ("title",)))
    if choice.get("remainingRounds", 0) > 1:
        result["remainingRounds"] = choice["remainingRounds"]
    result["options"] = []
    for option in choice["options"]:
        item = pick(option, ("optionId", "label", "description", "targetLevel", "reason"))
        if option.get("available") is False:
            item["available"] = False
        else:
            item.update({key: option[key] for key in ("items", "hp", "hunger", "buff") if option.get(key)})
        result["options"].append(item)
    if choice.get("cancelable"):
        result["cancelable"] = True
    return result


def scene_view(frame, *, full_actions=False):
    if frame.get("pendingDecision"):
        return {"choice": choice_view(frame["pendingDecision"])}
    if frame.get("battle"):
        return {"battle": battle_view(frame["battle"], full_actions=full_actions)}
    return {"world": world_view(frame)}


def decision_view(frame, scope="current", definitions=None):
    result = pick(frame, ("revision", "phase"))
    player = frame.get("player", {})
    if scope in ("current", "player"):
        result["player"] = player_view(player)
    if scope in ("current", "scene"):
        result.update(scene_view(frame, full_actions=True))
    if scope == "build":
        result["build"] = pick(player, ("skills", "passives", "equipment"))
        result["definitions"] = [definition_view(d) for d in (definitions or {}).values() if d.get("kind")]
    if scope == "inventory":
        inventory = {key: value for key, value in player.get("inventory", {}).items() if value}
        result["inventory"] = inventory
        foods = [definition_view(d) for key, d in (definitions or {}).items() if key in inventory]
        if foods:
            result["definitions"] = foods
    if scope == "map":
        world = frame["world"]
        result["map"] = map_view({"cells": world["map"], "scope": "local", "center": world["position"],
                                  "radius": world["mapScope"]["radius"]})
    return result


def map_view(result):
    brief = pick(result, ("revision", "snapshotId", "total", "hasMore", "cursor", "scope", "center", "radius"))
    brief["columns"] = ["position", "terrain", "cost", "flags"]
    brief["flags"] = {"v": "visited", "s": "spent", "h": "harvested", "c": "cleared"}
    brief["tiles"] = [[tile["id"], tile["terrain"], tile["moveCost"],
                       "".join(flag for flag, key in (("v", "visited"), ("s", "spent"), ("h", "harvested"), ("c", "cleared")) if tile.get(key))]
                      for tile in result["cells"]]
    enemies = {tile["id"]: enemy_view(tile["enemy"]) for tile in result["cells"] if tile.get("enemy")}
    if enemies:
        brief["enemies"] = enemies
    return brief


def preview_view(result, before=None):
    brief = pick(result, ("partial", "blockedAt", "outcome", "hunger"))
    brief["player"] = pick(result["p"], ("hp", "energy", "block"))
    brief["enemy"] = pick(result["e"], ("hp", "armor", "block"))
    old_player = (before or {}).get("player", {})
    old_enemy = ((before or {}).get("battle") or {}).get("enemy", {})
    for source, old, target, keys in ((result["p"], old_player, brief["player"], ("charge", "poison", "cooldowns")),
                                      (result["e"], old_enemy, brief["enemy"], ("bleed", "burn", "armorDebuff", "damageDown", "guardDown"))):
        for key in keys:
            if source.get(key) or old.get(key):
                target[key] = source.get(key)
    brief["steps"] = []
    for step in result["steps"]:
        row = {"action": step["actionId"]}
        for source, target in (("playerAction", "player"), ("enemyAction", "enemy")):
            value = step.get(source)
            if value is not None:
                row[target] = {key: val for key, val in value.items() if key != "name" and (val or key == "dmg")}
        if step.get("dots"):
            row["dots"] = step["dots"]
        brief["steps"].append(row)
    return brief


def query_view(result, operation, definitions, scope="current", current=None):
    if operation == "status":
        return pick(result, ("connected", "ready", "controlMode", "phase", "revision", "activeCommand"))
    if operation == "observe":
        if scope == "map":
            result = {"revision": result["revision"], **result["scene"]}
        return decision_view(result, scope, definitions)
    if operation == "map":
        return map_view(result)
    if operation == "preview":
        return preview_view(result, current)
    if operation == "catalog":
        return {"definitions": [definition_view(d) for d in result["definitions"]],
                "basicActions": [{"id": a["id"], "cost": a["cost"], "effect": a["desc"]} for a in result["actions"] if a["id"].startswith("basic_")]}
    if operation == "information":
        brief = pick(result, ("revision",))
        if result.get("current"):
            brief.update(decision_view(result["current"], definitions=definitions))
        if result.get("player"):
            brief["player"] = player_view(result["player"])
        if result.get("scene"):
            brief.update(pick(result["scene"], ("phase",)))
            brief.update(scene_view(result["scene"], full_actions=True))
        if result.get("map"):
            brief["map"] = map_view(result["map"])
        return brief
    if operation == "command":
        return pick(result, ("commandId", "status", "revisionAfter", "error", "query"))
    return result
