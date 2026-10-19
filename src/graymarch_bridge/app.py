import asyncio
import json
from pathlib import Path
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from .security import Security
from .sessions import Session, BridgeError
from .persistence import SaveStore


def create_app(root=None, port=8765, timeout=10, min_turn_interval=0, security=None):
    if type(min_turn_interval) is not int or min_turn_interval < 0:
        raise ValueError("full_info.min_turn_interval must be a nonnegative integer")
    root = Path(root or Path(__file__).resolve().parents[2])
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    sec, session, saves = security or Security(port), Session(timeout), SaveStore(root)
    app.state.security, app.state.session = sec, session

    @app.exception_handler(BridgeError)
    async def bridge_error(request, exc):
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.middleware("http")
    async def guards(request, call_next):
        if request.headers.get("host") != sec.host:
            return JSONResponse({"error": {"code": "INVALID_HOST", "message": "Use the configured loopback address"}}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin != sec.origin:
            return JSONResponse({"error": {"code": "INVALID_ORIGIN", "message": "Cross-origin requests are forbidden"}}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"error": {"code": "CROSS_SITE", "message": "Cross-site requests are forbidden"}}, status_code=403)
        try:
            length = int(request.headers.get("content-length", "0") or 0)
        except ValueError:
            length = 4 * 1024 * 1024 + 1
        if length > 4 * 1024 * 1024:
            return JSONResponse({"error": {"code": "TOO_LARGE", "message": "Request exceeds size limit"}}, status_code=413)
        response = await call_next(request)
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
        return response

    def agent(request):
        if not sec.agent(request.headers.get("authorization")):
            raise BridgeError("UNAUTHORIZED", "A local agent bearer token is required", 401)

    def owner(request):
        if not sec.owner(request.cookies.get("graymarch_owner")):
            raise BridgeError("OWNER_REQUIRED", "Use the game page opened by the launcher", 401)
        if request.headers.get("origin") != sec.origin:
            raise BridgeError("INVALID_ORIGIN", "Owner operations require same-origin requests", 403)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/bootstrap")
    async def bootstrap():
        # Nonce stays in the URL fragment, never in HTTP request paths or logs.
        return HTMLResponse('''<!doctype html><meta name="referrer" content="no-referrer"><title>Graymarch pairing</title><p id="status">Pairing local game…</p><script>
const nonce=location.hash.slice(1);history.replaceState(null,'','/bootstrap');
fetch('/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce})}).then(r=>{if(!r.ok)throw Error('Pairing expired. Restart the launcher.');location.replace('/');}).catch(e=>document.getElementById('status').textContent=e.message);
</script>''')

    @app.post("/bootstrap")
    async def pair(request: Request):
        if request.headers.get("origin") != sec.origin:
            raise BridgeError("INVALID_ORIGIN", "Pairing requires the local page", 403)
        try:
            data = await request.json()
            valid = sec.bootstrap(data.get("nonce", ""))
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise BridgeError("PAIRING_EXPIRED", "Pairing link is invalid or expired; restart launcher", 403)
        response = JSONResponse({"paired": True})
        response.set_cookie("graymarch_owner", sec.cookie, httponly=True, samesite="strict", path="/")
        return response

    @app.websocket("/bridge")
    async def bridge(ws: WebSocket):
        if ws.headers.get("host") != sec.host or ws.headers.get("origin") != sec.origin or not sec.owner(ws.cookies.get("graymarch_owner")):
            await ws.close(code=1008)
            return
        await ws.accept()
        try:
            await session.bind(ws)
        except BridgeError:
            await ws.close(code=1008, reason="One game page is already bound")
            return
        try:
            while True:
                message = await ws.receive_json()
                if isinstance(message, dict):
                    session.receive(message)
        except (WebSocketDisconnect, ValueError, RuntimeError):
            pass
        finally:
            session.disconnected(ws)

    @app.get("/api/v1/status")
    async def status(request: Request):
        agent(request)
        return session.status()

    @app.get("/api/v1/observation")
    async def observation(request: Request):
        agent(request)
        params = dict(request.query_params)
        if params.get("format", "compact") not in ("compact", "sync") or any(k in params for k in ("snapshot", "scope", "full")):
            raise BridgeError("INVALID_REQUEST", "Use information for explicit full snapshots", 422)
        return await session.query("observe", params)

    @app.get("/api/v1/catalog")
    async def catalog(request: Request):
        agent(request)
        return await session.query("catalog", dict(request.query_params))

    @app.get("/api/v1/map")
    async def map_route(request: Request):
        agent(request)
        return await session.query("map", dict(request.query_params))

    @app.get("/api/v1/information")
    async def information(request: Request):
        agent(request)
        params = dict(request.query_params)
        async with session.info_lock:
            key = session.current_key()
            turn = session.identity.get("decisionTurn", 0)
            previous = session.last_full.get(key)
            snapshot = session.snapshots.get(params.get("snapshotId"))
            continuation = bool(snapshot and snapshot["key"] == key and snapshot["revision"] == session.identity.get("revision") and snapshot["scope"] == params.get("scope", "current"))
            if params.get("snapshotId") and not continuation:
                raise BridgeError("SNAPSHOT_EXPIRED", "Snapshot is unavailable or scope changed")
            if min_turn_interval and previous is not None and not continuation and turn - previous < min_turn_interval:
                compact = await session.query("observe", {"format": "compact"})
                raise BridgeError("FULL_INFO_RATE_LIMITED", "More gameplay decisions are required for another full snapshot", 429, {"retryAfterTurns": min_turn_interval - (turn - previous), "decisionTurn": turn, "nextAllowedDecisionTurn": previous + min_turn_interval, "observation": compact})
            result = await session.query("information", params)
            if not continuation:
                session.last_full[key] = turn
            if isinstance(result, dict) and result.get("snapshotId"):
                session.snapshots[result["snapshotId"]] = {"key": key, "revision": session.identity.get("revision"), "scope": params.get("scope", "current")}
            return result

    @app.post("/api/v1/actions")
    async def actions(request: Request):
        agent(request)
        try:
            data = await request.json()
        except ValueError:
            raise BridgeError("INVALID_REQUEST", "Expected JSON", 422)
        receipt = await session.action(data)
        return JSONResponse(receipt, status_code=202 if receipt.get("status") == "pending" else (409 if receipt.get("status") == "rejected" else 200))

    @app.get("/api/v1/commands/{identifier}")
    async def commands(identifier: str, request: Request):
        agent(request)
        entry = session.receipts.get(identifier)
        return entry["receipt"] if entry else {"commandId": identifier, "status": "unknown"}

    @app.post("/api/v1/preview")
    async def preview(request: Request):
        agent(request)
        return await session.query("preview", await request.json())

    @app.post("/api/owner/control")
    async def control(request: Request):
        owner(request)
        data = await request.json()
        mode = data.get("mode")
        if mode not in ("human", "agent"):
            raise BridgeError("INVALID_REQUEST", "mode must be human or agent", 422)
        # Pause intake immediately; an in-flight command is allowed to finish.
        session.mode = "human"
        result = await session.query("control", {"mode": mode})
        session.mode = mode
        return result

    @app.post("/api/owner/progress/load")
    async def load_progress(request: Request):
        owner(request)
        try:
            return {"meta": saves.read_meta()}
        except (ValueError, OSError) as exc:
            raise BridgeError("META_LOAD_FAILED", str(exc), 422)

    @app.post("/api/owner/progress")
    async def save_progress(request: Request):
        owner(request)
        try:
            data = await request.json()
            return saves.write_meta(data.get("meta") if isinstance(data, dict) else None)
        except (ValueError, OSError) as exc:
            raise BridgeError("META_SAVE_FAILED", str(exc), 422)

    @app.post("/api/owner/save")
    @app.post("/api/v1/saves/manual")
    async def save(request: Request):
        owner(request)
        if session.active_command:
            raise BridgeError("BUSY_COMMAND", "Wait for the pending command before saving")
        try:
            return saves.write(await session.query("export_save"))
        except (ValueError, OSError) as exc:
            raise BridgeError("SAVE_FAILED", str(exc), 422)

    @app.post("/api/owner/load")
    @app.post("/api/v1/saves/manual/load")
    async def load(request: Request):
        owner(request)
        if session.active_command:
            raise BridgeError("BUSY_COMMAND", "Wait for the pending command before loading")
        session.mode = "human"
        await session.query("control", {"mode": "human"})
        try:
            save = saves.read()
        except (ValueError, OSError) as exc:
            raise BridgeError("SAVE_INVALID", str(exc), 422)
        result = await session.query("import_save", {"save": save})
        session.update(result)
        session.receipts.clear()
        session.snapshots.clear()
        session.last_full.clear()
        return result

    web = root / "web"
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
