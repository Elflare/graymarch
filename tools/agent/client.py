"""Standard-library transport and explicit gameplay helpers; no autonomous strategy."""
from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

IDENTITY = ("sessionId", "runId", "epoch")
ROOT = Path(__file__).resolve().parents[2]


class GameAPIError(RuntimeError):
    def __init__(self, status, body):
        self.status, self.body = status, body
        super().__init__(f"HTTP {status}: {json.dumps(body, ensure_ascii=False)}")


class GraymarchClient:
    def __init__(self, base_url="http://127.0.0.1:8765", token_file=None, *, wait_timeout=30):
        self.base_url = base_url.rstrip("/")
        path = Path(token_file) if token_file else ROOT / ".runtime/agent-token"
        self._token = path.read_text(encoding="utf-8").strip()
        self.wait_timeout = wait_timeout
        self.current = None
        self.last_command = None
        self.before_command = None
        self.context_id = str(uuid4())
        self.known_definitions = {}
        self.definitions = {}

    def _accept(self, result, *, historical=False):
        frame = result.get("observation", result.get("current", result))
        # Status replies contain identity fields too, but are not decision frames.
        if not isinstance(frame, dict) or not all(k in frame for k in (*IDENTITY, "revision", "scene", "player")):
            return
        same = self.current is not None and all(self.current[k] == frame[k] for k in IDENTITY)
        if self.current is not None and ((historical and not same) or (same and frame["revision"] < self.current["revision"])):
            return
        if self.current is not None and not same:
            self.context_id = str(uuid4())
            self.known_definitions.clear()
            self.definitions.clear()
        self.current = frame
        for definition in frame.get("definitions", []):
            identifier = definition["id"]
            self.definitions[identifier] = definition
            self.known_definitions[identifier] = f"{definition['version']}:{definition.get('level', 0)}"

    def request(self, path, payload=None, *, timeout=30):
        raw = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(self.base_url + path, data=raw, headers={
            "Authorization": "Bearer " + self._token,
            "Content-Type": "application/json",
        })
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.load(response)
        except HTTPError as exc:
            try:
                body = json.load(exc)
            except ValueError:
                body = {"error": {"code": "HTTP_ERROR", "message": f"HTTP {exc.code}: non-JSON response"}}
            raise GameAPIError(exc.code, body) from None
        self._accept(result, historical=path.startswith("/api/v1/commands/"))
        return result

    def status(self):
        return self.request("/api/v1/status")

    def observe(self, *, timeout=30):
        return self.request("/api/v1/observation?" + urlencode({
            "contextId": self.context_id,
            "knownDefinitionVersions": json.dumps(self.known_definitions),
        }), timeout=timeout)

    def information(self, scope="current"):
        return self.request("/api/v1/information?" + urlencode({"scope": scope}))

    def map(self, *, limit=100, cursor=None, snapshot_id=None):
        params = {"limit": limit, "cursor": cursor, "snapshotId": snapshot_id}
        return self.request("/api/v1/map?" + urlencode({k: v for k, v in params.items() if v is not None}))

    def catalog(self):
        return self.request("/api/v1/catalog")

    def act(self, action_type, payload=None, command_id=None, *, timeout=30):
        """Submit once. Kept compatible with the original example client."""
        if self.current is None:
            raise RuntimeError("Call observe() before act(), or use execute() and the gameplay helpers")
        command = {k: self.current[k] for k in IDENTITY}
        command.update(commandId=command_id or str(uuid4()), expectedRevision=self.current["revision"],
                       type=action_type, payload=payload if payload is not None else {},
                       contextId=self.context_id, knownDefinitionVersions=self.known_definitions.copy())
        self.last_command = command
        self.before_command = self.current
        return self.request("/api/v1/actions", command, timeout=timeout)

    def command(self, command_id, *, timeout=30):
        return self.request("/api/v1/commands/" + quote(command_id, safe=""), timeout=timeout)

    def _ensure_current(self):
        if self.current is None:
            self.observe()

    def _decision_key(self):
        frame = self.current
        battle = frame.get("battle") or {}
        choice = frame.get("pendingDecision") or {}
        return (*(frame[k] for k in IDENTITY), frame["revision"], frame["scene"]["id"], frame["phase"],
                battle.get("battleId"), battle.get("batchId"), choice.get("decisionId"))

    def _resolve(self, result, command_id, deadline):
        while result.get("status") == "pending":
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return result
            time.sleep(min(.25, remaining))
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return result
            try:
                result = self.command(command_id, timeout=min(30, remaining))
            except (URLError, OSError):
                # Polling never submits or replays the action.
                continue
        return result

    def execute(self, action_type, payload=None):
        """Submit one explicit decision and resolve only its own receipt."""
        self._ensure_current()
        baseline = self._decision_key()
        deadline = time.monotonic() + self.wait_timeout
        while True:
            try:
                result = self.act(action_type, payload, timeout=min(30, max(.001, deadline - time.monotonic())))
            except GameAPIError as exc:
                if exc.body.get("error", {}).get("code") != "BUSY_PRESENTATION":
                    raise
                result = exc.body
            except (URLError, OSError):
                command_id = self.last_command["commandId"]
                try:
                    result = self.command(command_id, timeout=min(30, max(.001, deadline - time.monotonic())))
                except (URLError, OSError):
                    return {"commandId": command_id, "status": "unknown", "error": {
                        "code": "RESULT_UNKNOWN", "message": "提交后未能确认回执，请查询此 commandId，勿重复提交。",
                    }}
            command_id = self.last_command["commandId"]
            result = self._resolve(result, command_id, deadline)
            if result.get("error", {}).get("code") != "BUSY_PRESENTATION":
                return result
            delay = max(.05, result["error"].get("details", {}).get("retryAfterMs", 250) / 1000)
            remaining = deadline - time.monotonic()
            if delay >= remaining:
                return result
            time.sleep(delay)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return result
            self.observe(timeout=min(30, remaining))
            if self._decision_key() != baseline:
                raise GameAPIError(409, {"commandId": command_id, "status": "rejected", "error": {
                    "code": "STATE_CHANGED", "message": "动画等待期间决策状态已变化，请根据新观察重新决策。",
                }, "observation": self.current})
            # BUSY_PRESENTATION explicitly rejected the attempt. A fresh ID is safe
            # only after confirming that the intended decision is still current.

    def _battle_payload(self, plan):
        self._ensure_current()
        battle = self.current.get("battle")
        if not battle:
            raise GameAPIError(409, {"error": {"code": "INVALID_PHASE", "message": "当前不在战斗中。"}})
        return {"battleId": battle["battleId"], "batchId": battle["batchId"], "plan": list(plan)}

    def preview(self, plan):
        return self.request("/api/v1/preview", {**self._battle_payload(plan), "expectedRevision": self.current["revision"]})

    def set_plan(self, plan):
        return self.execute("battle.plan.set", self._battle_payload(plan))

    def fight(self, plan):
        return self.execute("battle.commit", self._battle_payload(plan))

    def move(self, direction, steps=1):
        if steps < 1:
            raise ValueError("移动步数必须大于 0")
        if steps == 1:
            return self.execute("world.move", {"direction": direction})
        self._ensure_current()
        before = self.current
        movement = {"requested": steps, "moved": 0, "stop": "completed"}
        result = {"status": "completed", "observation": self.current}
        dx, dy = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}[direction]
        try:
            for _ in range(steps):
                if self.current["phase"] != "world.ready":
                    movement["stop"] = self.current["phase"]
                    break
                neighbor = next(tile for tile in self.current["world"]["neighbors"] if tile["direction"] == direction)
                if not neighbor["legal"]:
                    movement["stop"] = "blocked"
                    break
                position = self.current["world"]["position"]
                expected = {"x": position["x"] + dx, "y": position["y"] + dy}
                result = self.execute("world.move", {"direction": direction})
                if result.get("status") != "completed":
                    movement["stop"] = result.get("status", "error")
                    break
                movement["moved"] += 1
                tile = self.current.get("world", {}).get("current")
                if tile and tile["terrain"] in ("C", "V", "R"):
                    movement.setdefault("sites", []).append({
                        "position": self.current["world"]["position"], "terrain": tile["terrain"], "used": tile["spent"],
                    })
                if self.current["phase"] != "world.ready":
                    movement["stop"] = self.current["phase"]
                    break
                if self.current["world"]["position"] != expected:
                    movement["stop"] = "relocated"
                    break
        except GameAPIError as exc:
            movement["stop"] = exc.body.get("error", {}).get("code", "error")
            raise GameAPIError(exc.status, {**exc.body, "movement": movement}) from None
        except (URLError, OSError):
            movement["stop"] = "RESULT_UNKNOWN"
            result = {"status": "unknown", "commandId": self.last_command["commandId"], "error": {
                "code": "RESULT_UNKNOWN", "message": "连续移动中断，请查询原命令；已确认的移动保留，不重复执行。",
            }}
        finally:
            # The CLI reports the whole route, rather than just the final step.
            self.before_command = before
        return {**result, "movement": movement}

    def harvest(self):
        return self.execute("world.harvest")

    def eat(self, item_id):
        return self.execute("inventory.eat", {"itemId": item_id})

    def camp(self):
        return self.execute("camp.open")

    def _choice_payload(self):
        self._ensure_current()
        choice = self.current.get("pendingDecision")
        if not choice:
            raise GameAPIError(409, {"error": {"code": "INVALID_PHASE", "message": "当前没有待处理选择。"}})
        return {"decisionId": choice["decisionId"]}

    def choose(self, option_id):
        return self.execute("choice.select", {**self._choice_payload(), "optionId": option_id})

    def cancel(self):
        return self.execute("choice.cancel", self._choice_payload())

    # 主动撤退暂时禁用，保留原客户端入口供后续恢复。
    # def retreat(self):
    #     return self.execute("battle.retreat")

    def train(self, operation):
        return self.execute({"start": "training.start", "exit": "training.exit"}[operation])
