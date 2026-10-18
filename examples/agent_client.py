"""Compatibility entry point. Prefer ./gm or tools.agent for new callers."""
from pathlib import Path
import sys

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.agent import GameAPIError, GraymarchClient
from tools.agent.__main__ import main as cli_main

__all__ = ["GameAPIError", "GraymarchClient", "main"]


def main():
    # Preserve the original example's full JSON output.
    return cli_main([*sys.argv[1:], "--raw"])


if __name__ == "__main__":
    raise SystemExit(main())
