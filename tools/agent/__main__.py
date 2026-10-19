"""CLI for explicit Graymarch operations. Run ./gm --help from the repository."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from urllib.error import URLError

from .client import GameAPIError, GraymarchClient
from .views import battle_view, choice_view, definition_view, player_view, query_view, world_view


def json_object(value):
    try:
        result = json.loads(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"payload 必须是 JSON 对象：{exc}") from None
    if not isinstance(result, dict):
        raise argparse.ArgumentTypeError("payload 必须是 JSON 对象")
    return result


def wait_seconds(value):
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise argparse.ArgumentTypeError("等待时限必须是大于 0 的秒数")
    return seconds


def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--url", default=argparse.SUPPRESS, help="本机 API 地址")
    common.add_argument("--token-file", type=Path, default=argparse.SUPPRESS, help="Agent token 文件")
    common.add_argument("--raw", action="store_true", default=argparse.SUPPRESS, help="输出未经精简的 API 响应")
    common.add_argument("--wait-timeout", type=wait_seconds, default=argparse.SUPPRESS, help="回执和动画等待总时限，默认 30 秒")
    root = argparse.ArgumentParser(prog="./gm", description="Graymarch 常用 Agent 操作；游戏页面需开启 Agent 控制。", parents=[common])
    commands = root.add_subparsers(dest="operation")
    for name, help_text in [
        ("status", "连接与控制权"),
        ("catalog", "公开定义"), ("harvest", "采集一次"), ("camp", "打开当前营火"),
        ("cancel", "取消当前可取消选择"),
        # 主动撤退暂时禁用。
        # ("retreat", "撤退，承担实际游戏后果"),
    ]:
        commands.add_parser(name, help=help_text, parents=[common])
    observe = commands.add_parser("observe", help="当前决策（默认命令），可指定查询范围", parents=[common])
    observe.add_argument("--scope", choices=["current", "scene", "player", "build", "inventory", "map"], default="current")
    info = commands.add_parser("information", help="主动完整信息查询", parents=[common])
    info.add_argument("--scope", default="current", help="例如 current、player,scene、discovered_map")
    map_parser = commands.add_parser("map", help="已发现地图分页", parents=[common])
    map_parser.add_argument("--limit", type=int, default=100)
    map_parser.add_argument("--cursor")
    map_parser.add_argument("--snapshot-id")
    move = commands.add_parser("move", help="沿指定方向移动，遇决策或障碍停止", parents=[common])
    move.add_argument("direction", choices=["north", "south", "east", "west"])
    move.add_argument("steps", nargs="?", type=int, default=1, help="连续移动步数，默认 1")
    eat = commands.add_parser("eat", help="吃一个指定食物", parents=[common])
    eat.add_argument("item_id")
    choose = commands.add_parser("choose", help="选择当前 optionId", parents=[common])
    choose.add_argument("option_id")
    for name, help_text in [("preview", "只读预演"), ("plan", "只编辑计划"), ("fight", "提交并执行计划")]:
        command = commands.add_parser(name, help=help_text, parents=[common])
        command.add_argument("slots", nargs=3, metavar="ACTION", help="技能 ID；wait 表示空槽")
    train = commands.add_parser("train", help="进入或退出训练", parents=[common])
    train.add_argument("training_operation", choices=["start", "exit"])
    receipt = commands.add_parser("command", help="查询原 commandId 的回执", parents=[common])
    receipt.add_argument("command_id")
    action = commands.add_parser("act", help="通用语义动作", parents=[common])
    action.add_argument("action_type")
    action.add_argument("payload", type=json_object, nargs="?", default={})
    return root


def changed_fields(before, after):
    changes = {}
    for key, value in after.items():
        if key not in before:
            changes[key] = value
        elif isinstance(value, dict) and isinstance(before[key], dict):
            nested = changed_fields(before[key], value)
            if nested:
                changes[key] = nested
        elif value != before[key]:
            changes[key] = value
    for key in before.keys() - after.keys():
        changes[key] = None
    return changes


def observation_changes(before, after):
    changes = {}
    for key in ("phase", "worldTurn"):
        if before[key] != after[key]:
            changes[key] = after[key]
    old_player = player_view(before["player"], sparse=False)
    new_player = player_view(after["player"], sparse=False)
    # Compact frames omit inventory in battle. A scope change is not an item change.
    common = [key for key in new_player if key in old_player]
    player = changed_fields({key: old_player[key] for key in common}, {key: new_player[key] for key in common})
    if player:
        changes["player"] = player
    position = after.get("world", {}).get("position")
    if position != before.get("world", {}).get("position"):
        changes["position"] = position
    if after["phase"] == "world.ready":
        old_world = world_view(before) if before["phase"] == "world.ready" else {}
        new_world = world_view(after)
        old_world.pop("position", None)
        new_world.pop("position", None)
        world = changed_fields(old_world, new_world)
        if world:
            changes["world"] = world
    old_battle, new_battle = before.get("battle"), after.get("battle")
    if old_battle and not new_battle:
        exited = next((event for event in after.get("events", [])
                       if event["type"] == "sceneExited" and event.get("battleId") == old_battle["battleId"]), None)
        changes["battle"] = {"outcome": exited["outcome"]} if exited else "exited"
        if exited and exited["outcome"] == "victory" and not exited.get("training"):
            changes["battle"]["grade"] = after["lastReport"]["grade"]
    elif new_battle and (not old_battle or old_battle["battleId"] != new_battle["battleId"]):
        changes["battle"] = battle_view(new_battle)
    elif new_battle:
        battle = changed_fields(battle_view(old_battle), battle_view(new_battle))
        if old_battle["batchId"] != new_battle["batchId"]:
            battle["batchChanged"] = True
        if battle:
            changes["battle"] = battle
    old_choice, new_choice = before.get("pendingDecision"), after.get("pendingDecision")
    if (old_choice or {}).get("decisionId") != (new_choice or {}).get("decisionId"):
        changes["choice"] = choice_view(new_choice) if new_choice else "closed"
    unlocks = [event["message"].removeprefix("永久解锁：") for event in after.get("events", [])
               if event["type"] == "message" and event.get("message", "").startswith("永久解锁：")]
    if unlocks:
        changes["unlocks"] = unlocks
    return changes


def action_summary(result, client):
    movement = result.get("movement")
    if result.get("status") != "completed" or result.get("error"):
        brief = {key: result[key] for key in ("commandId", "status", "error", "query") if key in result}
        if client and client.last_command:
            brief.setdefault("commandId", client.last_command["commandId"])
        if isinstance(brief.get("error"), dict):
            error = brief["error"] = dict(brief["error"])
            if isinstance(error.get("details"), dict):
                error["details"] = {key: value for key, value in error["details"].items() if key != "observation"}
        if movement and movement["moved"]:
            brief["revision"] = client.current["revision"]
            brief["changes"] = observation_changes(client.before_command, client.current)
    else:
        after = result["observation"]
        brief = {"status": "completed", "revision": after["revision"],
                 "changes": observation_changes(client.before_command, after)}
        inventory = result.get("inventoryChanges", {})
        if inventory:
            brief["changes"].setdefault("player", {}).setdefault("inventory", {}).update(inventory)
        learned = set()
        for group in ("skills", "passives", "equipment"):
            old = client.before_command["player"].get(group, {})
            learned.update(identifier for identifier, level in after["player"].get(group, {}).items() if old.get(identifier) != level)
        old_inventory = client.before_command["player"].get("inventory", {})
        if "inventory" in client.before_command["player"]:
            after_inventory = {**after["player"].get("inventory", {}), **inventory}
            learned.update(identifier for identifier, count in after_inventory.items() if count and not old_inventory.get(identifier))
        definitions = [definition_view(client.definitions[identifier]) for identifier in sorted(learned) if identifier in client.definitions]
        if definitions:
            brief["changes"]["definitions"] = definitions
    if movement:
        brief["movement"] = movement
        if movement["stop"] == "blocked" and client.current["phase"] == "world.ready":
            brief.setdefault("changes", {})["world"] = world_view(client.current)
    return brief


def run(client, args):
    operation = args.operation or "observe"
    if operation == "observe" and args.scope in ("player", "inventory", "map"):
        return client.information("scene" if args.scope == "map" else "player")
    if operation == "information":
        return client.information(args.scope)
    if operation == "map":
        return client.map(limit=args.limit, cursor=args.cursor, snapshot_id=args.snapshot_id)
    if operation in ("preview", "plan", "fight"):
        plan = [None if slot == "wait" else slot for slot in args.slots]
        return getattr(client, {"plan": "set_plan"}.get(operation, operation))(plan)
    if operation == "move":
        return client.move(args.direction, args.steps)
    if operation == "eat":
        return client.eat(args.item_id)
    if operation == "choose":
        return client.choose(args.option_id)
    if operation == "train":
        return client.train(args.training_operation)
    if operation == "command":
        return client.command(args.command_id)
    if operation == "act":
        return client.execute(args.action_type, args.payload)
    return getattr(client, operation)()


def main(argv=None):
    defaults = argparse.Namespace(url="http://127.0.0.1:8765", token_file=None, raw=False, wait_timeout=30, scope="current")
    args = parser().parse_args(argv, namespace=defaults)
    client = None
    try:
        client = GraymarchClient(args.url, args.token_file, wait_timeout=args.wait_timeout)
        result = run(client, args)
    except GameAPIError as exc:
        result = exc.body
    except (OSError, URLError, ValueError) as exc:
        result = {"error": {"code": "CLIENT_ERROR", "message": str(exc)}}
        if client and client.last_command:
            result.update(commandId=client.last_command["commandId"], status="unknown")
    if not args.raw:
        if result.get("error") or result.get("movement") or (client and client.last_command):
            result = action_summary(result, client)
        else:
            result = query_view(result, args.operation or "observe", client.definitions if client else {}, args.scope,
                                client.current if client else None)
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.raw else None,
                     separators=None if args.raw else (",", ":")))
    if result.get("status") in ("pending", "unknown"):
        return 2
    return 1 if result.get("error") or result.get("status") == "rejected" else 0


if __name__ == "__main__":
    raise SystemExit(main())
