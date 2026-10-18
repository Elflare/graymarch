import asyncio
import hashlib
import json
import uuid


class BridgeError(Exception):
    def __init__(self, code, message, status=409, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details

    def body(self):
        result = {"code": self.code, "message": self.message}
        if self.details is not None:
            result["details"] = self.details
        return {"error": result}


class Session:
    def __init__(self, timeout=10):
        self.socket = None
        self.identity = {}
        self.ready = False
        self.mode = "human"
        self.pending = {}
        self.receipts = {}
        self.active_command = None
        self.timeout = timeout
        self.tasks = set()
        self.last_full = {}
        self.snapshots = {}
        self.info_lock = asyncio.Lock()

    def update(self, data):
        data = data.get("state", data)
        for key in ("sessionId", "runId", "epoch", "revision", "decisionTurn", "phase"):
            if key in data:
                self.identity[key] = data[key]
        if "controlMode" in data:
            self.mode = data["controlMode"]

    def status(self):
        return {"protocolVersion": "1", "connected": self.socket is not None,
                "ready": self.ready, "controlMode": self.mode, **self.identity}

    async def bind(self, socket):
        if self.socket is not None:
            raise BridgeError("PAGE_ALREADY_BOUND", "One game page is already connected")
        self.socket = socket
        self.ready = False
        self.identity = {}
        self.mode = "human"

    def disconnected(self, socket):
        if self.socket is not socket:
            return
        self.socket = None
        self.ready = False
        for future in list(self.pending.values()):
            if not future.done():
                future.set_exception(BridgeError("RESULT_UNKNOWN", "Page disconnected; do not resend under a new command ID", 503))

    async def rpc(self, method, params=None):
        if self.socket is None or not self.ready:
            raise BridgeError("GAME_DISCONNECTED", "Open and pair the game page first", 503)
        identifier = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        try:
            await self.socket.send_json({"id": identifier, "method": method, "params": params or {}})
            return await future
        finally:
            self.pending.pop(identifier, None)

    def receive(self, data):
        if data.get("type") in ("ready", "state"):
            self.update(data)
            if data.get("type") == "ready":
                self.ready = True
            return
        future = self.pending.get(data.get("id"))
        if future is None or future.done():
            return
        if "error" in data:
            error = data["error"]
            future.set_exception(BridgeError(error.get("code", "GAME_ERROR"), error.get("message", "Game rejected request"), details=error.get("details")))
        else:
            result = data.get("result")
            if isinstance(result, dict):
                self.update(result.get("observation", result))
            future.set_result(result)

    async def query(self, method, params=None):
        try:
            return await asyncio.wait_for(self.rpc(method, params), self.timeout)
        except asyncio.TimeoutError:
            raise BridgeError("GAME_TIMEOUT", "Game page did not answer in time", 503)

    def current_key(self):
        return tuple(self.identity.get(k) for k in ("sessionId", "runId", "epoch"))

    async def action(self, params):
        required = {"sessionId", "runId", "epoch", "commandId", "expectedRevision", "type", "payload"}
        if not isinstance(params, dict) or not required.issubset(params) or not isinstance(params["commandId"], str) or not 1 <= len(params["commandId"]) <= 128 or not isinstance(params["payload"], dict):
            raise BridgeError("INVALID_REQUEST", "Action envelope is incomplete or invalid", 422)
        identifier = params["commandId"]
        digest = hashlib.sha256(json.dumps(params, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        previous = self.receipts.get(identifier)
        if previous:
            if previous["digest"] != digest:
                raise BridgeError("IDEMPOTENCY_CONFLICT", "commandId was already used for different content")
            return previous["receipt"]
        if not self.ready or self.socket is None:
            raise BridgeError("GAME_DISCONNECTED", "Game page is disconnected", 503)
        if tuple(params[k] for k in ("sessionId", "runId", "epoch")) != self.current_key():
            raise BridgeError("SESSION_EXPIRED", "Request belongs to another page or game generation")
        if self.mode != "agent":
            raise BridgeError("CONTROLLER_REQUIRED", "The owner must enable agent control in the game")
        if self.active_command:
            raise BridgeError("BUSY_COMMAND", "Another command is still pending", details={"commandId": self.active_command})
        if params["expectedRevision"] != self.identity.get("revision"):
            raise BridgeError("STALE_REVISION", "Read the current observation before submitting")
        self.active_command = identifier
        receipt = {"commandId": identifier, "status": "pending", "query": f"/api/v1/commands/{identifier}"}
        entry = {"digest": digest, "receipt": receipt}
        self.receipts[identifier] = entry

        async def finish():
            try:
                result = await self.rpc("act", params)
                entry["receipt"] = result if isinstance(result, dict) else {"result": result}
                entry["receipt"].setdefault("commandId", identifier)
                entry["receipt"].setdefault("status", "completed")
            except BridgeError as exc:
                entry["receipt"] = {"commandId": identifier, "status": "unknown" if exc.code == "RESULT_UNKNOWN" else "rejected", **exc.body()}
            except Exception:
                entry["receipt"] = {"commandId": identifier, "status": "unknown", "error": {"code": "RESULT_UNKNOWN", "message": "Connection failed while submitting"}}
            finally:
                if self.active_command == identifier:
                    self.active_command = None

        task = asyncio.create_task(finish())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        try:
            await asyncio.wait_for(asyncio.shield(task), self.timeout)
        except asyncio.TimeoutError:
            pass  # HTTP timeout never cancels an already submitted command.
        return entry["receipt"]
