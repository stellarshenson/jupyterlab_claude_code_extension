"""Tornado API handlers for the Claude Code sessions extension."""
from __future__ import annotations

import json
import os
import sys

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from . import sessions as sessions_mod


URL_PREFIX = "jupyterlab-claude-code-extension"


_KNOWN_SHELLS = {"bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh"}


def _process_comm(pid: int) -> str | None:
    if sys.platform != "linux":
        return None
    try:
        with open(f"/proc/{pid}/comm", "r") as fh:
            return fh.read().strip()
    except OSError:
        return None


def _process_children(pid: int) -> list[int]:
    if sys.platform != "linux":
        return []
    try:
        with open(f"/proc/{pid}/task/{pid}/children", "r") as fh:
            return [int(x) for x in fh.read().split() if x.isdigit()]
    except OSError:
        return []


def _process_cwd_link(pid: int) -> str | None:
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return None


def _process_pwd_env(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/environ", "rb") as fh:
            for entry in fh.read().split(b"\x00"):
                if entry.startswith(b"PWD="):
                    return entry[4:].decode("utf-8", errors="replace")
    except OSError:
        return None
    return None


def _terminal_cwds(root_pid: int) -> list[str]:
    """Walk the pty's process tree and return ALL distinct cwds found.

    The frontend matches a project_path against ANY entry. This handles the
    common case where ``bash`` (the pty root) is still in the project folder
    even when ``claude`` or one of its background-task sub-shells has cd'd
    elsewhere (e.g. ``/tmp/claude-1000/...``).
    """
    seen: set[str] = set()
    out: list[str] = []
    queue: list[int] = [root_pid]
    while queue:
        pid = queue.pop(0)
        for source in (_process_cwd_link(pid), _process_pwd_env(pid)):
            if not source or not source.startswith("/"):
                continue
            if source.startswith(("/proc/", "/sys/", "/dev/")):
                continue
            try:
                resolved = os.path.realpath(source)
            except OSError:
                resolved = source
            if resolved not in seen and os.path.isdir(resolved):
                seen.add(resolved)
                out.append(resolved)
        for child in _process_children(pid):
            queue.append(child)
    return out


class StatusHandler(APIHandler):
    """Reports whether the extension should be active.

    Active iff the ``claude`` binary is on ``PATH``.
    """

    @tornado.web.authenticated
    def get(self) -> None:
        binary = sessions_mod.claude_binary_available()
        # ``server_root_dir`` is the root path Jupyter is serving notebooks
        # from. Fall back to the user's home directory if unset.
        root_dir = self.settings.get("server_root_dir") or os.path.expanduser("~")
        self.finish(json.dumps({
            "enabled": binary is not None,
            "claude_path": binary,
            "root_dir": str(root_dir),
        }))


class SessionsListHandler(APIHandler):
    """Returns the deduplicated session list."""

    @tornado.web.authenticated
    def get(self) -> None:
        rows = sessions_mod.list_sessions()
        self.finish(json.dumps({"sessions": rows}))


class SessionFavouriteHandler(APIHandler):
    """Toggle favourite flag for a project path.

    Body: ``{"project_path": "...", "favourite": true|false}``
    """

    @tornado.web.authenticated
    def post(self) -> None:
        try:
            body = json.loads(self.request.body or b"{}")
        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_json"}))
            return
        project_path = body.get("project_path")
        favourite = body.get("favourite")
        if not isinstance(project_path, str) or not isinstance(favourite, bool):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        favs = sessions_mod.toggle_favourite(
            sessions_mod.claude_dir(), project_path, favourite
        )
        self.finish(json.dumps({"favourites": favs}))


class SessionRemoveHandler(APIHandler):
    """Permanently delete a project's Claude history.

    Body: ``{"encoded_path": "-home-lab-foo"}``
    """

    @tornado.web.authenticated
    def post(self) -> None:
        try:
            body = json.loads(self.request.body or b"{}")
        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_json"}))
            return
        encoded_path = body.get("encoded_path")
        if not isinstance(encoded_path, str):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        ok = sessions_mod.remove_session(sessions_mod.claude_dir(), encoded_path)
        if not ok:
            self.set_status(400)
            self.finish(json.dumps({"error": "remove_failed"}))
            return
        self.finish(json.dumps({"removed": encoded_path}))


class TerminalCwdHandler(APIHandler):
    """Return the cwd of the deepest shell child of a JL terminal.

    Used by the frontend to match an existing terminal tab to a project
    folder without persisting any state in the browser.
    """

    @tornado.web.authenticated
    def get(self, terminal_name: str) -> None:
        terminal_manager = self.settings.get("terminal_manager")
        if terminal_manager is None:
            self.set_status(503)
            self.finish(json.dumps({"error": "terminal service not available"}))
            return
        terminal = terminal_manager.get_terminal(terminal_name)
        if terminal is None:
            self.set_status(404)
            self.finish(json.dumps({"error": "terminal not found"}))
            return
        ptyproc = getattr(terminal, "ptyproc", None)
        if ptyproc is None or not hasattr(ptyproc, "pid"):
            self.set_status(500)
            self.finish(json.dumps({"error": "terminal has no pty"}))
            return
        cwds = _terminal_cwds(ptyproc.pid)
        self.finish(json.dumps({"terminal_name": terminal_name, "cwds": cwds}))


def setup_route_handlers(web_app) -> None:
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, URL_PREFIX, "status"), StatusHandler),
        (url_path_join(base_url, URL_PREFIX, "sessions"), SessionsListHandler),
        (url_path_join(base_url, URL_PREFIX, "sessions", "favourite"), SessionFavouriteHandler),
        (url_path_join(base_url, URL_PREFIX, "sessions", "remove"), SessionRemoveHandler),
        (
            url_path_join(base_url, URL_PREFIX, "terminal-cwd", r"([^/]+)"),
            TerminalCwdHandler,
        ),
    ]

    web_app.add_handlers(host_pattern, handlers)
