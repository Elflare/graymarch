import argparse
import os
import socket
import threading
import time
import tomllib
import webbrowser
from pathlib import Path
import uvicorn
from .app import create_app
from .security import Security


def main():
    parser = argparse.ArgumentParser(description="Graymarch local browser game + HTTP agent bridge")
    parser.add_argument("--port", type=int)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    config = {}
    if args.config:
        with args.config.open("rb") as stream:
            config = tomllib.load(stream)
    server = config.get("server", {})
    host = server.get("host", "127.0.0.1")
    if host != "127.0.0.1":
        parser.error("Only 127.0.0.1 is supported; public binding is disabled")
    port = args.port if args.port is not None else server.get("port", 8765)
    if type(port) is not int or not 1 <= port <= 65535:
        parser.error("port must be between 1 and 65535")
    root = Path(__file__).resolve().parents[2]
    security = Security(port)
    app = create_app(root, port, float(server.get("request_timeout", 10)), config.get("full_info", {}).get("min_turn_interval", 0), security)
    # Bind before writing credentials or launching a browser, avoiding a port-race.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
        sock.listen(128)
    except OSError as exc:
        parser.error(f"Cannot bind local port {port}: {exc}")
    token_path = security.write_runtime(root)
    launch_url = f"{security.origin}/bootstrap#{security.nonce}"
    launcher = root / ".runtime" / "open-game.html"
    fd = os.open(launcher, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(f'<!doctype html><meta name="referrer" content="no-referrer"><a href="{launch_url}">Open Graymarch (expires in five minutes)</a>')
    os.chmod(launcher, 0o600)
    print(f"Graymarch: {security.origin}\nAgent token file: {token_path}\nManual pairing link file: {launcher}")
    if not args.no_browser:
        def open_game():
            time.sleep(0.7)
            webbrowser.open(launch_url)
        threading.Thread(target=open_game, daemon=True).start()
    uvicorn.Server(uvicorn.Config(app, host=host, port=port, access_log=False, log_level="warning", ws_max_size=4 * 1024 * 1024, loop="asyncio")).run(sockets=[sock])


if __name__ == "__main__":
    main()
