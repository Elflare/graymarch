import secrets
import time
from pathlib import Path
import os


class Security:
    def __init__(self, port=8765):
        self.origin = f"http://127.0.0.1:{port}"
        self.host = f"127.0.0.1:{port}"
        self.token = secrets.token_urlsafe(32)
        self.cookie = secrets.token_urlsafe(32)
        self.nonce = secrets.token_urlsafe(32)
        self.expires = time.monotonic() + 300

    def bootstrap(self, value):
        if self.nonce and time.monotonic() < self.expires and secrets.compare_digest(value, self.nonce):
            self.nonce = ""
            return True
        return False

    def agent(self, header):
        return secrets.compare_digest(header or "", "Bearer " + self.token)

    def owner(self, value):
        return secrets.compare_digest(value or "", self.cookie)

    def write_runtime(self, root: Path):
        folder = root / ".runtime"
        if folder.is_symlink():
            raise ValueError("Runtime directory must not be a symlink")
        folder.mkdir(mode=0o700, exist_ok=True)
        os.chmod(folder, 0o700)
        target = folder / "agent-token"
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(self.token + "\n")
        os.chmod(target, 0o600)
        return target
