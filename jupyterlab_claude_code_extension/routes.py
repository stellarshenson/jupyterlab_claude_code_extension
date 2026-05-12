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


# bash one-liner that waits until the JL WebSocket client has resized the pty
# from its initial default before clearing and `exec`ing the real argv. The
# previous threshold-based version (rows>=20 && cols>=80) was a no-op because
# terminado's default is 24x80, so `c=80 >= 80` passed on the first iteration
# and we never actually waited.
#
# Strategy: capture the initial size, install a SIGWINCH trap, and loop until
# either SIGWINCH fires OR the size has visibly changed. 5 s timeout fallback
# so we still launch if no client ever connects. After exec, bash is replaced
# by claude on the same pid - auto-close on exit and the `_tree_has_claude`
# reuse filter still work.
_INIT_WAITER = (
    "trap 'CHANGED=1' WINCH; "
    "read R0 C0 < <(stty size 2>/dev/null || echo '0 0'); "
    "for i in $(seq 1 50); do "
    'if [ -n "$CHANGED" ]; then break; fi; '
    "read r c < <(stty size 2>/dev/null || echo '0 0'); "
    'if [ "$r" != "$R0" ] || [ "$c" != "$C0" ]; then break; fi; '
    "sleep 0.1; "
    "done; "
    "clear; "
    'exec "$@"'
)


def _wrap_with_init(argv: list[str]) -> list[str]:
    """Prepend the terminal-init waiter so claude only starts once the JL
    terminal widget has connected and sized the pty to a usable window."""
    return ["/bin/bash", "-c", _INIT_WAITER, "claude-terminal-init", *argv]


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


def _tree_has_claude(root_pid: int) -> bool:
    """Return True iff any process in the pty's tree has ``comm == claude``.

    Used to filter the reuse path: a JL terminal whose cwd matches a project
    folder but doesn't actually have claude running in it (e.g. a plain
    ``bash`` opened at the project) must NOT be reused - the panel should
    spawn a new terminal with ``claude --resume`` instead.
    """
    queue: list[int] = [root_pid]
    while queue:
        pid = queue.pop(0)
        if _process_comm(pid) == "claude":
            return True
        queue.extend(_process_children(pid))
    return False


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
    """Remove a project's Claude history.

    Body: ``{"encoded_path": "-home-lab-foo"}``

    Honours JupyterLab's ``ContentsManager.delete_to_trash`` setting: when
    enabled the project folder is sent to the desktop trash, otherwise it is
    deleted permanently (a permanent delete is also the fallback if the trash
    move fails).
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
        to_trash = bool(getattr(self.contents_manager, "delete_to_trash", True))
        ok = sessions_mod.remove_session(
            sessions_mod.claude_dir(), encoded_path, to_trash=to_trash
        )
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
        has_claude = _tree_has_claude(ptyproc.pid)
        self.finish(json.dumps({
            "terminal_name": terminal_name,
            "cwds": cwds,
            "has_claude": has_claude,
        }))


class LaunchClaudeTerminalHandler(APIHandler):
    """Spawn a JL terminal whose pty's only process is ``claude --resume``.

    Bypasses ``terminal:create-new`` (which spawns the user's $SHELL) so the
    terminal tab shows claude immediately without any visible bash. Uses
    terminado's per-call ``shell_command`` option through
    ``jupyter_server_terminals``' ``TerminalManager.create``. A short bash
    waiter (``_INIT_WAITER``) ``exec``s into claude only after the WebSocket
    client has resized the pty to a usable window, so the TUI sees a real
    terminal size at launch instead of the pty's tiny default.
    """

    @tornado.web.authenticated
    async def post(self) -> None:
        try:
            body = json.loads(self.request.body or b"{}")
        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_json"}))
            return
        project_path = body.get("project_path")
        session_id = body.get("session_id")
        dangerously_skip = bool(body.get("dangerously_skip_permissions"))
        if not isinstance(project_path, str) or not os.path.isdir(project_path):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_project_path"}))
            return
        if not isinstance(session_id, str) or not session_id:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_session_id"}))
            return
        claude = sessions_mod.claude_binary_available()
        if not claude:
            self.set_status(503)
            self.finish(json.dumps({"error": "claude_not_found"}))
            return
        terminal_manager = self.settings.get("terminal_manager")
        if terminal_manager is None:
            self.set_status(503)
            self.finish(json.dumps({"error": "terminal_service_unavailable"}))
            return
        argv = [claude, "--resume", session_id]
        if dangerously_skip:
            argv.append("--dangerously-skip-permissions")
        model = terminal_manager.create(
            shell_command=_wrap_with_init(argv),
            cwd=project_path,
        )
        # ``model`` from jupyter_server_terminals is dict-like with at
        # least a ``name`` field; some versions return an object with a
        # ``.name`` attribute - handle both.
        name = (
            model.get("name") if isinstance(model, dict) else getattr(model, "name", None)
        )
        if not isinstance(name, str):
            self.set_status(500)
            self.finish(json.dumps({"error": "terminal_create_failed"}))
            return
        self.finish(json.dumps({"terminal_name": name}))


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
        (
            url_path_join(base_url, URL_PREFIX, "launch-terminal"),
            LaunchClaudeTerminalHandler,
        ),
    ]

    web_app.add_handlers(host_pattern, handlers)
