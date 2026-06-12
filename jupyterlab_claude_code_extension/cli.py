"""Command-line interface: ``jupyterlab_claude_code``.

Currently one subcommand, ``install-claude-statusline``: downloads the
powerline statusline script from its home project
(https://github.com/stellarshenson/claude-code-statusline) into the user's
``~/.claude`` directory - after an explicit confirmation - and points
``statusLine`` in ``settings.json`` at it.
"""

from __future__ import annotations

import argparse
import json
import stat
import sys
import urllib.request
from pathlib import Path

STATUSLINE_REPO = "https://github.com/stellarshenson/claude-code-statusline"
STATUSLINE_RAW_URL = (
    "https://raw.githubusercontent.com/stellarshenson/"
    "claude-code-statusline/main/statusline-command.sh"
)
STATUSLINE_FILENAME = "statusline-command.sh"


def fetch_statusline(url: str = STATUSLINE_RAW_URL) -> str:
    """Download the statusline script, returning its text.

    Raises ``ValueError`` when the response does not look like a shell
    script (e.g. an HTML error page) so we never install garbage.
    """
    with urllib.request.urlopen(url, timeout=30) as response:
        text = response.read().decode("utf-8")
    if not text.startswith("#!"):
        raise ValueError(f"{url} did not return a shell script")
    return text


def install_claude_statusline(claude_dir: Path, script_text: str) -> Path:
    """Write the statusline into ``claude_dir`` and wire settings.

    Writes ``statusline-command.sh`` (marked executable) and merges a
    ``statusLine`` block into ``claude_dir/settings.json``, preserving every
    other setting. Returns the installed script path. Raises ``ValueError``
    when an existing settings.json is not valid JSON - better to stop than
    to clobber a hand-edited file.
    """
    claude_dir.mkdir(parents=True, exist_ok=True)
    dest = claude_dir / STATUSLINE_FILENAME
    dest.write_text(script_text, encoding="utf-8")
    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    settings_path = claude_dir / "settings.json"
    settings: dict = {}
    if settings_path.is_file():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            raise ValueError(f"{settings_path} is not valid JSON: {err}") from err
        if not isinstance(settings, dict):
            raise ValueError(f"{settings_path} does not contain a JSON object")
    settings["statusLine"] = {
        "type": "command",
        "command": f"bash {dest}",
        "padding": 0,
    }
    settings_path.write_text(
        json.dumps(settings, indent=2) + "\n", encoding="utf-8"
    )
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="jupyterlab_claude_code",
        description="Companion CLI for jupyterlab_claude_code_extension.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    install = sub.add_parser(
        "install-claude-statusline",
        help="Download the powerline statusline from "
        f"{STATUSLINE_REPO} into ~/.claude and point statusLine in "
        "settings.json at it.",
    )
    install.add_argument(
        "--claude-dir",
        type=Path,
        default=Path.home() / ".claude",
        help="Claude directory to install into (default: ~/.claude)",
    )
    install.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt.",
    )
    args = parser.parse_args(argv)

    if args.command == "install-claude-statusline":
        print(f"This downloads {STATUSLINE_RAW_URL}")
        print(
            f"into {args.claude_dir / STATUSLINE_FILENAME} and updates "
            f"statusLine in {args.claude_dir / 'settings.json'}."
        )
        if not args.yes:
            answer = input("Proceed? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("Aborted.")
                return 0
        try:
            script_text = fetch_statusline()
            dest = install_claude_statusline(args.claude_dir, script_text)
        except (ValueError, OSError) as err:
            print(f"error: {err}", file=sys.stderr)
            return 1
        print(f"Installed {dest}")
        print(f"Updated {args.claude_dir / 'settings.json'} (statusLine)")
        print("Restart Claude Code to see the status line.")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
