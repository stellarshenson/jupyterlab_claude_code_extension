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
    """Walk the pty's process tree and return ALL distinct live cwds found.

    Only ``/proc/<pid>/cwd`` (the kernel's authoritative current directory)
    is consulted - never the ``PWD`` in ``/proc/<pid>/environ``, which is the
    frozen exec-time environment and, for the pty's root process, is just
    whatever ``PWD`` the Jupyter server itself was launched with (so every
    terminal would otherwise report the server's startup directory). Walking
    the whole tree still covers the case where ``bash`` (the pty root) sits
    in the project folder while ``claude`` or a background sub-shell has cd'd
    elsewhere (e.g. ``/tmp/claude-1000/...``). The frontend matches a
    project_path against ANY entry.
    """
    seen: set[str] = set()
    out: list[str] = []
    queue: list[int] = [root_pid]
    while queue:
        pid = queue.pop(0)
        source = _process_cwd_link(pid)
        if (
            source
            and source.startswith("/")
            and not source.startswith(("/proc/", "/sys/", "/dev/"))
        ):
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
        # from. Fall back to the user's home directory if unset. Expand a
        # leading ``~`` - some deployments (e.g. JupyterHub) leave the
        # setting as ``~/workspace``, and the frontend compares it against
        # absolute session paths, so an unexpanded ``~`` never matches.
        root_dir = os.path.expanduser(
            self.settings.get("server_root_dir") or "~"
        )
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


class SessionCleanupHandler(APIHandler):
    """Remove a project's parallel sessions, keeping only the main one.

    Body: ``{"encoded_path": "-home-lab-foo"}``

    Honours JupyterLab's ``ContentsManager.delete_to_trash`` setting the same
    way ``SessionRemoveHandler`` does.
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
        removed = sessions_mod.cleanup_parallel_sessions(
            sessions_mod.claude_dir(), encoded_path, to_trash=to_trash
        )
        if removed is None:
            self.set_status(400)
            self.finish(json.dumps({"error": "cleanup_failed"}))
            return
        self.finish(json.dumps({"removed_count": removed}))


class SessionBranchesHandler(APIHandler):
    """List a project's other conversation JSONLs ("branches").

    ``GET sessions/branches?encoded_path=-home-lab-foo`` returns
    ``{"current", "total", "branches": [{"session_id", "file_mtime",
    "label"}]}`` - newest first, current main excluded. The frontend
    shows the 5 most recent in the submenu and the rest via "More...".
    """

    @tornado.web.authenticated
    def get(self) -> None:
        encoded_path = self.get_query_argument("encoded_path", default="")
        result = sessions_mod.list_branches(sessions_mod.claude_dir(), encoded_path)
        if result is None:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_encoded_path"}))
            return
        self.finish(json.dumps(result))


class SessionSwitchHandler(APIHandler):
    """Switch a project's current conversation to another branch.

    Body: ``{"encoded_path": "-home-lab-foo", "session_id": "<uuid>"}``.
    Touches the branch JSONL's mtime so the recency resolution makes it the
    row's main session. 404 ``branch_not_found`` when the JSONL no longer
    exists (removed between menu display and click).
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
        session_id = body.get("session_id")
        if not isinstance(encoded_path, str) or not isinstance(session_id, str):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        result = sessions_mod.switch_branch(
            sessions_mod.claude_dir(), encoded_path, session_id
        )
        if result is None:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        if result.get("error") == "branch_not_found":
            self.set_status(404)
            self.finish(json.dumps(result))
            return
        self.finish(json.dumps(result))


class SessionDeleteBranchesHandler(APIHandler):
    """Delete selected branch sessions from a project folder.

    Body: ``{"encoded_path": "-home-lab-foo", "session_ids": ["<uuid>", ...]}``.
    The current main session is never deleted; missing JSONLs are treated as
    already deleted. Honours JupyterLab's ``ContentsManager.delete_to_trash``
    setting the same way ``SessionCleanupHandler`` does.
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
        session_ids = body.get("session_ids")
        if not isinstance(encoded_path, str) or not isinstance(session_ids, list):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        to_trash = bool(getattr(self.contents_manager, "delete_to_trash", True))
        removed = sessions_mod.delete_branches(
            sessions_mod.claude_dir(), encoded_path, session_ids, to_trash=to_trash
        )
        if removed is None:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        self.finish(json.dumps({"removed_count": removed}))


class SessionSetTitleHandler(APIHandler):
    """Stamp a conversation with a custom title.

    Body: ``{"encoded_path": "-home-lab-foo", "session_id": "<uuid>",
    "title": "name"}``. Appends the same ``custom-title`` record claude's
    ``/rename`` writes. 404 ``branch_not_found`` while the JSONL does not
    exist yet - the frontend retries until a freshly forked branch
    materialises on disk.
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
        session_id = body.get("session_id")
        title = body.get("title")
        if (
            not isinstance(encoded_path, str)
            or not isinstance(session_id, str)
            or not isinstance(title, str)
        ):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        result = sessions_mod.set_branch_title(
            sessions_mod.claude_dir(), encoded_path, session_id, title
        )
        if result is None:
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_body"}))
            return
        if result is False:
            self.set_status(404)
            self.finish(json.dumps({"error": "branch_not_found"}))
            return
        self.finish(json.dumps({"ok": True}))


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
    """Spawn a JL terminal whose pty's only process is ``claude``.

    With ``session_id`` in the body the session is resumed (``claude
    --resume <id>``); without it a brand-new claude session starts.

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
        fork_session_id = body.get("fork_session_id")
        name = body.get("name")
        dangerously_skip = bool(body.get("dangerously_skip_permissions"))
        if not isinstance(project_path, str) or not os.path.isdir(project_path):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_project_path"}))
            return
        # ``session_id`` is optional: absent/None means "start a new claude
        # session" instead of resuming an existing one.
        if session_id is not None and (
            not isinstance(session_id, str) or not session_id
        ):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_session_id"}))
            return
        # ``fork_session_id`` branches the resumed conversation into a new
        # session id chosen by the caller (claude --fork-session
        # --session-id <uuid>) - so the frontend knows the forked id up
        # front. The fork's display name is forced via ``-n <name>`` (see
        # ``name`` below). Only valid together with ``session_id``.
        if fork_session_id is not None and (
            not isinstance(fork_session_id, str)
            or not fork_session_id
            or "/" in fork_session_id
            or session_id is None
        ):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_fork_session_id"}))
            return
        # ``name`` is optional: when present claude is launched with
        # ``-n <name>``, so claude itself owns the session's display name and
        # re-stamps it as a ``custom-title`` record on every turn - the name
        # sticks even on a fork, where appending the title after the fact
        # loses to the parent title the fork inherits.
        if name is not None and (not isinstance(name, str) or not name.strip()):
            self.set_status(400)
            self.finish(json.dumps({"error": "invalid_name"}))
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
        argv = [claude, "--resume", session_id] if session_id else [claude]
        if fork_session_id:
            argv += ["--fork-session", "--session-id", fork_session_id]
        if dangerously_skip:
            argv.append("--dangerously-skip-permissions")
        if isinstance(name, str) and name.strip():
            argv += ["-n", name.strip()]
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
        (url_path_join(base_url, URL_PREFIX, "sessions", "cleanup"), SessionCleanupHandler),
        (url_path_join(base_url, URL_PREFIX, "sessions", "branches"), SessionBranchesHandler),
        (url_path_join(base_url, URL_PREFIX, "sessions", "switch"), SessionSwitchHandler),
        (
            url_path_join(base_url, URL_PREFIX, "sessions", "delete-branches"),
            SessionDeleteBranchesHandler,
        ),
        (
            url_path_join(base_url, URL_PREFIX, "sessions", "set-title"),
            SessionSetTitleHandler,
        ),
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
