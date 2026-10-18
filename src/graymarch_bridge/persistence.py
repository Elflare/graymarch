"""Manual journeys and automatic metaprogression, under the project saves folder."""
import json
import math
import re
import os
import tempfile
from pathlib import Path

MAX_SAVE = 4 * 1024 * 1024
META_DEFAULT = {"bossWins": 0, "bestGrade": "C", "harvests": 0, "unlocks": []}
GRADES = ("C", "B", "A", "S")
UNLOCKS = {"class_sentinel", "class_arcanist", "class_hunter", "interrupt_tactics", "time_tactics"}


def validate_meta(meta):
    if not isinstance(meta, dict):
        raise ValueError("Invalid metaprogression")
    for key in ("bossWins", "harvests"):
        if type(meta.get(key)) is not int or not 0 <= meta[key] <= 2**53 - 1:
            raise ValueError("Invalid metaprogression field: " + key)
    if meta.get("bestGrade") not in GRADES or not isinstance(meta.get("unlocks"), list):
        raise ValueError("Invalid metaprogression grade or unlocks")
    if any(not isinstance(value, str) or value not in UNLOCKS for value in meta["unlocks"]):
        raise ValueError("Unknown permanent unlock")
    return {key: meta[key] for key in META_DEFAULT} | {"unlocks": sorted(set(meta["unlocks"]))}


def merge_meta(current, incoming):
    return {"bossWins": max(current["bossWins"], incoming["bossWins"]),
            "bestGrade": max((current["bestGrade"], incoming["bestGrade"]), key=GRADES.index),
            "harvests": max(current["harvests"], incoming["harvests"]),
            "unlocks": sorted(set(current["unlocks"]) | set(incoming["unlocks"]))}


def validate_save(save):
    if not isinstance(save, dict) or save.get("format") != "graymarch-save" or type(save.get("schemaVersion")) is not int or save["schemaVersion"] != 1 or not isinstance(save.get("state"), dict):
        raise ValueError("Unsupported save schema; legacy saves are not supported")
    state = save["state"]
    def require(condition, field):
        if not condition:
            raise ValueError("Invalid save field: " + field)
    def number(value):
        return type(value) in (int, float) and math.isfinite(value)
    for field in ("sessionId", "runId"):
        require(isinstance(state.get(field), str) and 0 < len(state[field]) <= 256, field)
    for field in ("epoch", "revision", "decisionTurn", "sequence", "rng", "worldTurn"):
        require(type(state.get(field)) is int and 0 <= state[field] <= 2**53-1, field)
    for field in ("x", "y"):
        require(type(state.get(field)) is int and abs(state[field]) <= 2**31-1, field)
    for field in ("level", "xp", "sigils", "hunger", "maxHunger", "pendingRewards"):
        require(number(state.get(field)) and state[field] >= 0, field)
    require(state["level"] >= 1, "level")
    for field in ("player", "inventory", "meta"):
        require(isinstance(state.get(field), dict), field)
    player = state["player"]
    for field in ("hp", "maxHp", "attack", "energy", "maxEnergy", "block"):
        require(number(player.get(field)) and player[field] >= 0, "player." + field)
    for field in ("skills", "passives", "equipment"):
        require(isinstance(player.get(field), dict), "player." + field)
    for field in ("visited", "discovered", "spent", "harvested", "eventsSeen", "cleared"):
        values = state.get(field)
        require(isinstance(values, list) and len(values) <= 100000, field)
        require(all(isinstance(v, str) and re.fullmatch(r"-?[0-9]{1,10},-?[0-9]{1,10}", v) for v in values), field)
    require(isinstance(state.get("buffs"), list), "buffs")
    for field in ("inBattle", "training"):
        require(type(state.get(field)) is bool, field)
    for field in ("battle", "pendingDecision"):
        require(field in state and (state[field] is None or isinstance(state[field], dict)), field)
    def walk(value, depth=0):
        require(depth <= 40, "nesting depth")
        if isinstance(value, dict):
            require(len(value) <= 100000, "object size")
            for key, child in value.items():
                require(isinstance(key, str) and len(key) <= 4096, "object key")
                walk(child, depth + 1)
        elif isinstance(value, list):
            require(len(value) <= 100000, "array size")
            for child in value:
                walk(child, depth + 1)
        elif type(value) in (int, float):
            require(math.isfinite(value), "finite number")
        elif isinstance(value, str):
            require(len(value) <= 100000, "string size")
        else:
            require(value is None or type(value) is bool, "JSON value")
    walk(save)
    raw = json.dumps(save, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(raw) > MAX_SAVE:
        raise ValueError("Save exceeds size limit")
    return raw


class SaveStore:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def slot(self, name="manual"):
        folder = self.root / "saves"
        if folder.is_symlink():
            raise ValueError("Save directory must not be a symlink")
        folder.mkdir(mode=0o700, exist_ok=True)
        target = folder / (name + ".json")
        if folder.resolve().parent != self.root or target.is_symlink():
            raise ValueError("Unsafe save path")
        return target

    def write(self, save):
        raw = validate_save(save)
        return self._write(raw, "manual")

    def _write(self, raw, name):
        target = self.slot(name)
        fd, temporary = tempfile.mkstemp(prefix="." + name + "-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            # The replace is already committed; directory sync is best-effort on
            # platforms/filesystems which do not support directory descriptors.
            try:
                directory = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            except OSError:
                pass
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return {"saved": True, "slot": name, "bytes": len(raw)}

    def read(self):
        save = self._read("manual")
        validate_save(save)
        return save

    def _read(self, name):
        target = self.slot(name)
        fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            raw = stream.read(MAX_SAVE + 1)
        if len(raw) > MAX_SAVE:
            raise ValueError("Save exceeds size limit")
        return json.loads(raw)

    def read_meta(self):
        try:
            save = self._read("meta")
        except FileNotFoundError:
            try:
                meta = validate_meta(self.read()["state"]["meta"])
            except FileNotFoundError:
                return {**META_DEFAULT, "unlocks": []}
            self._write_meta(meta)
            return meta
        if not isinstance(save, dict) or save.get("format") != "graymarch-meta" or type(save.get("schemaVersion")) is not int or save["schemaVersion"] != 1:
            raise ValueError("Unsupported metaprogression schema")
        return validate_meta(save.get("meta"))

    def _write_meta(self, meta):
        save = {"format": "graymarch-meta", "schemaVersion": 1, "meta": meta}
        return self._write(json.dumps(save, ensure_ascii=False, allow_nan=False).encode("utf-8"), "meta")

    def write_meta(self, incoming):
        incoming = validate_meta(incoming)
        meta = merge_meta(self.read_meta(), incoming)
        result = self._write_meta(meta)
        return {**result, "meta": meta}
