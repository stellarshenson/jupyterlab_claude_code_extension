"""Pure-Python session enumeration for Claude Code projects.

Reads from ``~/.claude/projects/*/sessions-index.json`` (Claude's own
aggregated index per project), deduplicates to one row per project folder
(most recent JSONL wins), and decorates with favourite + remote-control flags.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any


PROJECTS_DIRNAME = "projects"
SESSIONS_DIRNAME = "sessions"
INDEX_FILENAME = "sessions-index.json"
FAVOURITES_FILENAME = "jupyterlab_claude_code_extension.json"
# A bridged session counts as remote-controlled only if it was active within
# this window. Claude leaves ``bridgeSessionId`` set in the pid file after the
# bridge disconnects and the interactive process keeps running, so a live pid
# with a bridge id is not enough (DEF-8). There is no idle heartbeat - the pid
# file is rewritten only on a busy/idle status transition, which fires on every
# turn whether local or remote - so ``updatedAt`` freshness is the only signal
# that the bridge is actually being driven now.
REMOTE_CONTROL_FRESH_MS = 3_600_000  # 1 hour
# Sidecar in a project dir holding the session id a "switch" pinned as the
# project's current conversation. A dotfile so claude's own ``*.jsonl`` glob
# ignores it. See ``switch_branch`` / ``_resolve_latest``.
CURRENT_PIN_FILENAME = ".jl-current"
# Ceiling on the ``claude agents --json`` call behind ``bg_agents`` (typically
# ~0.4s). A sessions poll must never hang on a wedged CLI - on timeout the
# panel degrades to "no background agents" rather than stalling.
BG_AGENTS_TIMEOUT_S = 5.0
# Display surfaces (the context menu's include_bg branches fetch) may serve a
# roster this old instead of spawning on the click path. Just over the panel's
# 30s sessions poll, which refreshes the cache - so a menu open between polls
# is spawn-free and its markers agree with the row chips (same snapshot).
BG_AGENTS_CACHE_MAX_AGE_S = 35.0


def claude_dir() -> Path:
    """Return the user's Claude config root."""
    return Path.home() / ".claude"


def claude_binary_available() -> str | None:
    """Return the resolved path of the ``claude`` binary or ``None``."""
    return shutil.which("claude")


def bg_agents() -> dict[str, str]:
    """Map conversation id -> short agent id for every LIVE background agent.

    A background agent owns its conversation only while its worker process
    lives: that is exactly when ``claude --resume <id>`` is refused ("currently
    running as a background agent"), and such a row must be opened with
    ``claude attach <short>`` instead (DEF-13). The short id is what ``attach``
    takes.

    ``claude agents --json`` is claude's own scripting surface, but it is NOT a
    live-worker roster - it is derived from the on-disk job records under
    ``~/.claude/jobs/``, so it keeps listing a job whose worker is long gone
    (``state: "blocked"``, i.e. waiting on the user rather than running).
    Membership alone
    therefore does not mean a resume would be refused: measured on a live
    machine, two of the three listed background jobs resumed with no refusal at
    all, and clicking such a row ran ``claude attach``, which RESURRECTS the
    worker under the job's stored respawn flags (DEF-14). Liveness is the real
    predicate, so an entry counts only when it reports a worker ``pid`` that
    still exists. Returns ``{}`` when claude is missing or the call fails,
    times out, or returns garbage - the panel then degrades to "no background
    agents", which is the safe direction: a plain ``--resume``.
    """
    binary = claude_binary_available()
    if not binary:
        return {}
    try:
        proc = subprocess.run(
            [binary, "agents", "--json"],
            capture_output=True,
            timeout=BG_AGENTS_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {}
    if proc.returncode != 0:
        return {}
    try:
        entries = json.loads(proc.stdout or b"[]")
    except ValueError:
        return {}
    if not isinstance(entries, list):
        return {}
    owned: dict[str, str] = {}
    for entry in entries:
        # Interactive sessions are listed too; only a background worker holds
        # its conversation against a resume.
        if not isinstance(entry, dict) or entry.get("kind") != "background":
            continue
        # ...and only while that worker is actually running. The listing joins
        # each job record against claude's live-session store and publishes
        # ``pid`` only for a worker it has verified alive AND start-time-matched
        # (so a recycled pid cannot pass); a job whose worker exited keeps its
        # entry but drops the field. That verified set is the same one claude's
        # own resume refusal consults, which is what makes the field - not
        # ``kind`` - the honest predicate. ``_pid_alive`` re-checks it only to
        # close the gap between claude's check and ours (DEF-14).
        pid = entry.get("pid")
        if not isinstance(pid, int) or not _pid_alive(pid):
            continue
        session_id = entry.get("sessionId")
        short = entry.get("id")
        if (
            isinstance(session_id, str)
            and session_id
            and isinstance(short, str)
            and short
        ):
            owned[session_id] = short
    return owned


# Last ``bg_agents()`` snapshot: (monotonic stamp, roster). The sessions poll
# refreshes it every 30s; the branches listing reads it so a context-menu
# open never pays the CLI spawn on the click path (see ``bg_agents_cached``).
_bg_agents_cache: tuple[float, dict[str, str]] | None = None


def _bg_agents_refresh() -> dict[str, str]:
    """Spawn ``bg_agents()`` and stamp the snapshot."""
    global _bg_agents_cache
    result = bg_agents()
    _bg_agents_cache = (time.monotonic(), result)
    return result


def bg_agents_cached() -> dict[str, str]:
    """``bg_agents()``, served from the last snapshot when young enough.

    A context menu must open in the sub-100ms band, but resolving branch
    markers spawns ``claude agents --json`` (~0.4s, 5s ceiling on a wedged
    CLI). The sessions poll refreshes the snapshot every 30s anyway, so a
    menu open between polls is served spawn-free AND its markers agree with
    the row chips - same snapshot. A stale or absent snapshot (poll stopped,
    server fresh) falls through to a real spawn.
    """
    snapshot = _bg_agents_cache
    if (
        snapshot is not None
        and time.monotonic() - snapshot[0] <= BG_AGENTS_CACHE_MAX_AGE_S
    ):
        return snapshot[1]
    return _bg_agents_refresh()


def _load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def _pid_alive(pid: int) -> bool:
    """Return True if PID exists.

    ``PermissionError`` from ``os.kill(pid, 0)`` means the process is alive
    but the caller cannot signal it (e.g. PID 1 on GitHub Actions runners
    when running as a non-root user) - that's still alive.
    """
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def session_state_by_cwd(claude_root: Path) -> dict[str, dict]:
    """Map ``cwd`` -> latest ``~/.claude/sessions/<pid>.json`` record fields.

    The pid file's ``name`` is the value Claude itself shows for the session -
    either an explicit ``/rename`` or Claude's own derived label. The panel
    honours it so a renamed session (e.g. ``/rename scandi``) reads ``scandi``
    rather than the folder basename.

    Each value carries:
      * ``live_pid`` - the PID if it is still alive, else ``None``
      * ``session_id`` - the sessionId in that record
      * ``updated_at`` - ms-epoch of last update
      * ``name`` - the session ``name`` from that record (may be ``None``)
      * ``remote_control`` - True iff the record is a live, bridged session
        (non-null ``bridgeSessionId``) that was active within the last
        ``REMOTE_CONTROL_FRESH_MS``; a plain live claude, or a bridged session
        gone stale, is not remote control

    When multiple ``<pid>.json`` files exist for the same cwd, the one with
    the highest ``updatedAt`` wins - so the most recently active session's
    name is the one shown.
    """
    by_cwd: dict[str, dict] = {}
    sessions_dir = claude_root / SESSIONS_DIRNAME
    if not sessions_dir.is_dir():
        return by_cwd

    now_ms = int(time.time() * 1000)
    for entry in sessions_dir.glob("*.json"):
        data = _load_json(entry)
        if not isinstance(data, dict):
            continue
        cwd = data.get("cwd")
        if not isinstance(cwd, str):
            continue
        updated_at = data.get("updatedAt") or data.get("startedAt") or 0
        prev = by_cwd.get(cwd)
        if prev is not None and prev["updated_at"] >= updated_at:
            continue
        pid = data.get("pid")
        live = isinstance(pid, int) and _pid_alive(pid)
        sid = data.get("sessionId") if isinstance(data.get("sessionId"), str) else None
        name = data.get("name") if isinstance(data.get("name"), str) else None
        # Claude writes a sessions/<pid>.json for EVERY interactive session; the
        # remote-control ("bridge") link is signalled by a non-null
        # ``bridgeSessionId``. A live pid alone does NOT mean remote control
        # (DEF-7). The bridge id also persists after the bridge disconnects
        # while the process keeps running, so require the bridged session to be
        # fresh too (DEF-8) - active within REMOTE_CONTROL_FRESH_MS.
        bridge = data.get("bridgeSessionId")
        fresh = (now_ms - updated_at) <= REMOTE_CONTROL_FRESH_MS
        remote_control = bool(live and isinstance(bridge, str) and bridge and fresh)
        by_cwd[cwd] = {
            "live_pid": pid if live else None,
            "session_id": sid,
            "updated_at": updated_at,
            "name": name,
            "remote_control": remote_control,
        }
    return by_cwd


def load_favourites(claude_root: Path) -> list[str]:
    """Return the list of favourite project paths (deduplicated, order-preserved)."""
    data = _load_json(claude_root / FAVOURITES_FILENAME)
    if not isinstance(data, dict):
        return []
    favs = data.get("favourites")
    if not isinstance(favs, list):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in favs:
        if isinstance(item, str) and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def save_favourites(claude_root: Path, favourites: list[str]) -> None:
    """Atomically write the favourites list."""
    claude_root.mkdir(parents=True, exist_ok=True)
    target = claude_root / FAVOURITES_FILENAME
    tmp = target.with_suffix(target.suffix + ".tmp")
    payload = json.dumps({"favourites": favourites}, indent=2)
    with tmp.open("w", encoding="utf-8") as fh:
        fh.write(payload)
    os.replace(tmp, target)


def _pick_latest_entry(entries: list[dict]) -> dict | None:
    if not entries:
        return None
    return max(
        entries,
        key=lambda e: e.get("fileMtime") or 0,
    )


def _jsonl_cwd(jsonl: Path) -> str | None:
    """Best-effort cwd for a session JSONL: the most recent ``cwd`` it records,
    falling back to the first one near the top of the file."""
    return _scan_jsonl_for_latest_cwd(jsonl) or _scan_jsonl_for_cwd(jsonl)


def _read_current_pin(project_dir: Path) -> str | None:
    """The session id a ``switch`` pinned as this project's current, or None.

    Stored in the ``.jl-current`` sidecar (one session id, no extension).
    Returns None when absent, empty, or malformed.
    """
    try:
        sid = (project_dir / CURRENT_PIN_FILENAME).read_text(
            encoding="utf-8"
        ).strip()
    except (OSError, ValueError):
        # OSError: missing file / unreadable. ValueError covers
        # UnicodeDecodeError - a corrupt or non-UTF-8 pin must be ignored, not
        # crash resolution; a NUL in the path would raise here too.
        return None
    # Session ids are UUID-shaped (hex + hyphen). Restrict to that charset so a
    # tampered/corrupt pin (slash, control bytes, "."/"..") cannot reach a path
    # join; combined with the decode guard above, an invalid pin is ignored and
    # recency resumes.
    if not sid or not all(c.isalnum() or c == "-" for c in sid):
        return None
    return sid


def _write_current_pin(project_dir: Path, session_id: str) -> None:
    """Pin ``session_id`` as the project's current conversation.

    Best-effort: a write failure just leaves resolution to fall back to
    recency (see ``_read_current_pin`` / ``_resolve_latest``).
    """
    try:
        (project_dir / CURRENT_PIN_FILENAME).write_text(
            session_id, encoding="utf-8"
        )
    except OSError:
        pass


def clear_current_pin(claude_root: Path, project_path: str) -> None:
    """Drop any switch pin for a project so recency resumes.

    Called when a new session is started: the new session supersedes a prior
    switch, and it naturally becomes the row's current by recency once its
    JSONL lands (it is the newest file). Clearing the pin - rather than pinning
    the not-yet-existent new id - avoids leaving a permanently dangling pin if
    the user abandons the session before it writes its first turn, and never
    feeds the new id through the pin file. Best-effort: a missing pin, missing
    dir, or odd path leaves nothing to clear.
    """
    try:
        (
            claude_root
            / PROJECTS_DIRNAME
            / _encode_path(project_path)
            / CURRENT_PIN_FILENAME
        ).unlink()
    except (OSError, ValueError):
        pass


def set_current_pin(claude_root: Path, project_path: str, session_id: str) -> None:
    """Pin ``session_id`` as a project's current conversation.

    Called when a branch is created (a fork): branching is an explicit "go to
    this new conversation" action, so the new branch should become the row's
    current the moment it exists. Unlike a brand-new session - which becomes
    current by recency on its own (it is the newest file) and so only needs the
    pin cleared - a fork is shadowed by the parent you branched from: that
    parent is the conversation you are actively in, so its JSONL keeps being
    appended and its mtime overtakes the fork's, dragging the row back to it.
    Only a durable pin makes the fork win over that recency (see
    ``_resolve_latest``). The pin is written at launch, before the fork's first
    turn writes its JSONL, so it is dangling until then; ``_resolve_latest``
    ignores a dangling pin and recency keeps the parent current in the meantime,
    then the row flips to the branch once the file materialises. An abandoned
    fork leaves a benign dangling pin (ignored; cleared by the next new session,
    overwritten by the next switch). Best-effort: an odd path or write failure
    leaves resolution to recency.
    """
    try:
        project_dir = claude_root / PROJECTS_DIRNAME / _encode_path(project_path)
    except (OSError, ValueError):
        return
    _write_current_pin(project_dir, session_id)


def _resolve_latest(project_dir: Path, index: dict | None) -> dict | None:
    """Pick the representative session for a project dir, trusting the filesystem.

    Claude's ``sessions-index.json`` can drift - an interrupted write or a
    crash can leave it referencing only an older sessionId while newer
    JSONLs sit on disk - so we scan ``*.jsonl`` ourselves rather than trust
    the index alone. Among the JSONLs we prefer the most recent one whose
    recorded ``cwd`` is *consistent with how Claude named this directory* -
    the project path itself or a subdirectory of it (see
    ``_project_path_for_cwd``). That matters after a folder
    rename: Claude re-homes the old session files under the new directory but
    their records still carry the old ``cwd``, so the newest file on disk can
    point at a path that no longer exists. Only when no JSONL is consistent do
    we fall back to the plain newest file. The chosen file's metadata
    (summary, firstPrompt, ...) is enriched from the matching index entry when
    available; ``projectPath`` is taken from the JSONL itself, since the
    index's ``originalPath`` is the value most likely to be stale post-rename.
    """
    jsonls = list(project_dir.glob("*.jsonl"))
    if not jsonls:
        return None
    jsonls.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    dirname = project_dir.name

    chosen: Path | None = None
    chosen_cwd: str | None = None

    # A "switch" pins the project's current conversation durably (see
    # ``switch_branch``). Honour the pin over recency so continuing to work in
    # another conversation does not silently drag the row back to it. The pin
    # wins only when its JSONL still exists and its recorded cwd is consistent
    # with this project dir; a dangling or cwd-foreign pin is ignored and the
    # recency scan below resumes.
    pinned = _read_current_pin(project_dir)
    if pinned:
        pin_jsonl = project_dir / f"{pinned}.jsonl"
        if pin_jsonl.is_file():
            cwd = _jsonl_cwd(pin_jsonl)
            project_path = _project_path_for_cwd(cwd, dirname) if cwd else None
            if project_path:
                chosen, chosen_cwd = pin_jsonl, project_path

    if chosen is None:
        for jsonl in jsonls:
            cwd = _jsonl_cwd(jsonl)
            project_path = _project_path_for_cwd(cwd, dirname) if cwd else None
            if project_path:
                chosen, chosen_cwd = jsonl, project_path
                break
    if chosen is None:
        # No JSONL records a cwd that encodes to this directory name. That
        # happens when the user renamed both a project folder on disk AND
        # the encoded ``~/.claude/projects/<...>`` dir to match, after the
        # JSONLs were written - the old cwd inside them no longer exists.
        # Fall back to a filesystem walk that finds a real directory whose
        # path encodes to the dir name; that's the new project path. Only
        # if even that fails do we accept the JSONL's stale cwd.
        fs_path = _find_path_matching_encoded(dirname)
        chosen = jsonls[0]
        chosen_cwd = fs_path or _jsonl_cwd(chosen)

    sid = chosen.stem
    fs_mtime = int(chosen.stat().st_mtime * 1000)
    custom_title = _scan_jsonl_for_custom_title(chosen)
    agent_color = _scan_jsonl_for_agent_color(chosen)

    indexed: dict | None = None
    if isinstance(index, dict):
        for e in index.get("entries") or []:
            if isinstance(e, dict) and e.get("sessionId") == sid:
                indexed = e
                break

    if indexed is not None:
        latest = dict(indexed)
        latest["fileMtime"] = max(int(latest.get("fileMtime") or 0), fs_mtime)
        if chosen_cwd:
            latest["projectPath"] = chosen_cwd
        latest["customTitle"] = custom_title
        latest["agentColor"] = agent_color
        return latest

    return {
        "sessionId": sid,
        "fullPath": str(chosen),
        "fileMtime": fs_mtime,
        "summary": "",
        "firstPrompt": "",
        "messageCount": 0,
        "created": None,
        "modified": None,
        "gitBranch": None,
        "projectPath": chosen_cwd,
        "customTitle": custom_title,
        "agentColor": agent_color,
    }


_JSONL_CWD_SCAN_LIMIT = 50
_JSONL_CWD_TAIL_BYTES = 131072  # 128 KiB - enough to hold the last cwd record


def _scan_jsonl_for_cwd(path: Path) -> str | None:
    """Read up to ``_JSONL_CWD_SCAN_LIMIT`` lines looking for a ``cwd`` field."""
    try:
        with path.open("r", encoding="utf-8") as fh:
            for i, line in enumerate(fh):
                if i >= _JSONL_CWD_SCAN_LIMIT:
                    break
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cwd = record.get("cwd") if isinstance(record, dict) else None
                if isinstance(cwd, str) and cwd:
                    return cwd
    except OSError:
        return None
    return None


def _scan_jsonl_for_latest_cwd(path: Path) -> str | None:
    """Return the most recent ``cwd`` field by reading the tail of ``path``.

    Reads the last ``_JSONL_CWD_TAIL_BYTES`` of the file, drops the (likely
    partial) first line, and returns the ``cwd`` of the last record that
    carries one. This is the path the session was actually running in last -
    which differs from the front of the file when the project folder was
    renamed and Claude re-homed the session under the new directory.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > _JSONL_CWD_TAIL_BYTES:
                fh.seek(-_JSONL_CWD_TAIL_BYTES, os.SEEK_END)
                fh.readline()  # discard the partial line at the seek point
            chunk = fh.read()
    except OSError:
        return None
    latest: str | None = None
    for raw_line in chunk.splitlines():
        try:
            record = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        cwd = record.get("cwd") if isinstance(record, dict) else None
        if isinstance(cwd, str) and cwd:
            latest = cwd
    return latest


def _scan_jsonl_for_custom_title(path: Path) -> str | None:
    """Return the last ``customTitle`` recorded in the tail of ``path``.

    ``/rename`` appends ``{"type": "custom-title", "customTitle": ...}``
    records to the session JSONL, and Claude re-appends the record on every
    resume - so the newest one sits near the end of the file. The pid files
    in ``~/.claude/sessions/`` do NOT carry the rename (their ``name`` stays
    ``null``); the JSONL is the only durable store, which is why a renamed
    session must be resolved here rather than from the session state.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > _JSONL_CWD_TAIL_BYTES:
                fh.seek(-_JSONL_CWD_TAIL_BYTES, os.SEEK_END)
                fh.readline()  # discard the partial line at the seek point
            chunk = fh.read()
    except OSError:
        return None
    latest: str | None = None
    for raw_line in chunk.splitlines():
        if b'"custom-title"' not in raw_line:
            continue
        try:
            record = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(record, dict) or record.get("type") != "custom-title":
            continue
        title = record.get("customTitle")
        if isinstance(title, str) and title.strip():
            latest = title
    return latest


def _scan_jsonl_for_agent_color(path: Path) -> str | None:
    """Return the last ``agentColor`` recorded in the tail of ``path``.

    ``/color`` writes ``{"type": "agent-color", "agentColor": ...}`` records to
    the session JSONL, and Claude re-appends the record near the end of the
    file on updates - auto-assigned multi-session colours land there too, so a
    session that never ran ``/color`` still carries one. The last such record
    is the session's current colour. Measured across sessions the newest record
    sits within ~14 KiB of EOF, well inside the shared tail window, so the
    colour is read without scanning the whole (often tens-of-MB) transcript.
    The name is returned verbatim (lowercased); the frontend maps known names
    to tab classes and ignores any it does not recognise.
    """
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > _JSONL_CWD_TAIL_BYTES:
                fh.seek(-_JSONL_CWD_TAIL_BYTES, os.SEEK_END)
                fh.readline()  # discard the partial line at the seek point
            chunk = fh.read()
    except OSError:
        return None
    latest: str | None = None
    for raw_line in chunk.splitlines():
        if b'"agent-color"' not in raw_line:
            continue
        try:
            record = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(record, dict) or record.get("type") != "agent-color":
            continue
        color = record.get("agentColor")
        if isinstance(color, str) and color.strip():
            latest = color.strip().lower()
    return latest


def _fallback_from_jsonl(project_dir: Path) -> dict | None:
    """When no sessions-index.json exists, derive a best-effort entry from JSONL files."""
    jsonls = list(project_dir.glob("*.jsonl"))
    if not jsonls:
        return None
    latest = max(jsonls, key=lambda p: p.stat().st_mtime)
    return {
        "sessionId": latest.stem,
        "fullPath": str(latest),
        "fileMtime": int(latest.stat().st_mtime * 1000),
        "summary": "",
        "firstPrompt": "",
        "messageCount": 0,
        "created": None,
        "modified": None,
        "gitBranch": None,
        "projectPath": _scan_jsonl_for_cwd(latest),
    }


def _encode_path(path: str) -> str:
    """Mirror Claude's encoding: replace ``/``, ``_`` and ``.`` with ``-``.

    Used as a tiebreaker when two project dirs resolve to the same cwd:
    the canonical row is the one whose encoded folder name matches.
    """
    out = []
    for ch in path:
        if ch in ("/", "_", "."):
            out.append("-")
        else:
            out.append(ch)
    return "".join(out)


def _project_path_for_cwd(cwd: str, dirname: str) -> str | None:
    """Return the project path when ``cwd`` is the project dir or inside it.

    ``_encode_path`` is char-by-char and length-preserving, so when the
    encoded cwd extends ``dirname`` the first ``len(dirname)`` characters of
    ``cwd`` ARE the project path - no lossy decode needed. The boundary
    character must be a real ``/`` so a sibling like ``/x/foo-bar`` does not
    match project ``/x/foo``. Subdirectory cwds are legitimate: claude
    records cwd per message, so working in a subfolder moves the tail cwd
    while the session still belongs to the project. Returns None when the
    cwd is foreign to the project.
    """
    enc = _encode_path(cwd)
    if enc == dirname:
        return cwd
    if enc.startswith(dirname) and len(cwd) > len(dirname) and cwd[len(dirname)] == "/":
        return cwd[: len(dirname)]
    return None


def _encode_segment(name: str) -> str:
    """Per-segment variant of ``_encode_path`` (no ``/`` to replace)."""
    return "".join("-" if ch in ("_", ".") else ch for ch in name)


_DECODE_MAX_DEPTH = 20


def _find_path_matching_encoded(
    encoded_dir_name: str, root: str = "/"
) -> str | None:
    """Walk the filesystem from ``root`` looking for a real directory whose
    absolute path encodes (per ``_encode_path``) to ``encoded_dir_name``.

    Used to recover a real cwd when the user has renamed a project folder
    on disk AND the corresponding ``~/.claude/projects/<encoded>`` directory
    to match - none of the JSONLs inside carry the new path because they
    pre-date the rename. The encoded name uses ``-`` as both the path
    separator and as the replacement for ``_``, ``.``, and literal ``-``,
    so a single segment can split many ways - we try the longest split
    first at each step and recurse, taking the first existing match.
    """
    parts = encoded_dir_name.lstrip("-").split("-")
    if not parts or not all(parts):
        return None
    return _walk_decode(Path(root), parts, 0)


def _walk_decode(current: Path, remaining: list[str], depth: int) -> str | None:
    if not remaining:
        return str(current)
    if depth >= _DECODE_MAX_DEPTH:
        return None
    try:
        children = list(current.iterdir())
    except (OSError, PermissionError):
        return None
    # Try longest match first: a child like ``jupyterlab_drag_and_drop_path``
    # consumes many remaining tokens at once, beating any partial prefix.
    for k in range(len(remaining), 0, -1):
        target = "-".join(remaining[:k])
        for child in children:
            if not child.is_dir():
                continue
            try:
                if _encode_segment(child.name) != target:
                    continue
            except OSError:
                continue
            result = _walk_decode(child, remaining[k:], depth + 1)
            if result is not None:
                return result
    return None


def _decode_dirname(name: str) -> str:
    """Best-effort decode of ``-home-lab-foo`` -> ``/home/lab/foo``.

    Lossy because Claude replaces both ``/`` and ``_`` with ``-`` - used only as
    a fallback when sessions-index.json is missing the ``originalPath`` field.
    """
    if not name.startswith("-"):
        return name
    return "/" + name[1:].replace("-", "/")


def list_sessions(claude_root: Path | None = None) -> list[dict]:
    """Return one row per project folder, deduplicated to the most recent JSONL.

    Each row carries: ``project_path``, ``encoded_path``, ``session_id``,
    ``name``, ``name_source``, ``summary``, ``first_prompt``, ``message_count``,
    ``created``, ``modified``, ``file_mtime``, ``git_branch``,
    ``remote_control``, ``favourite``, ``extra_sessions`` (count of parallel
    session JSONLs in the folder beyond the main one), ``color`` (the Claude
    session colour from ``/color`` or auto-assignment, e.g. ``"blue"``, or
    None), ``bg_id`` (short id of the live background agent owning the row's
    conversation, or None).

    ``name`` is the session name Claude records for the most recently active
    session in that folder (``name_source = "session"``) when one exists,
    otherwise the project folder basename (``name_source = "basename"``). This
    is what lets a ``/rename`` show through: the row reads the renamed label
    rather than the folder name. ``presentationMode`` in the frontend still
    decides between this label and the relative path.
    """
    root = claude_root if claude_root is not None else claude_dir()
    projects_dir = root / PROJECTS_DIRNAME
    if not projects_dir.is_dir():
        return []

    favourites = set(load_favourites(root))
    states = session_state_by_cwd(root)
    # One lookup per poll, shared by every row: a conversation held by a live
    # background agent cannot be resumed, only attached to (DEF-13). Always a
    # real spawn - this 30s poll IS what keeps the snapshot fresh for the
    # cache-served branches path (bg_agents_cached).
    bg_owned = _bg_agents_refresh()

    rows: list[dict] = []
    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue
        index_path = project_dir / INDEX_FILENAME
        index = _load_json(index_path) if index_path.is_file() else None

        latest = _resolve_latest(project_dir, index)
        if latest is None:
            continue
        extra_sessions = max(len(list(project_dir.glob("*.jsonl"))) - 1, 0)

        # ``_resolve_latest`` already picked the cwd that is consistent with
        # this directory's name when one exists, so trust its ``projectPath``
        # first. Only fall back to the index's ``originalPath`` (which can be
        # stale after a folder rename) or a lossy decode of the dir name.
        resolved_path = latest.get("projectPath")
        original_path = (
            index.get("originalPath")
            if isinstance(index, dict) and isinstance(index.get("originalPath"), str)
            else None
        )
        project_path: str | None = None
        for candidate in (resolved_path, original_path):
            if isinstance(candidate, str) and candidate:
                project_path = candidate
                if _encode_path(candidate) == project_dir.name:
                    break
        if not project_path:
            project_path = _decode_dirname(project_dir.name)

        summary = latest.get("summary") or ""
        first_prompt = latest.get("firstPrompt") or ""

        state = states.get(project_path) or {}
        # Honour the session's own name. `/rename` persists as a
        # ``custom-title`` record in the session JSONL, so the chosen JSONL's
        # title is authoritative for its row. The pid-record ``name`` (older
        # Claude versions wrote the rename there) is the fallback, then the
        # folder basename. Path-tail disambiguation handles basename
        # collisions across rows.
        basename = os.path.basename(project_path) or project_dir.name
        custom_title = latest.get("customTitle")
        session_name = (
            custom_title
            if isinstance(custom_title, str) and custom_title.strip()
            else state.get("name")
        )
        if isinstance(session_name, str) and session_name.strip():
            name = session_name
            name_source = "session"
        else:
            name = basename
            name_source = "basename"

        rows.append({
            "project_path": project_path,
            "encoded_path": project_dir.name,
            "session_id": latest.get("sessionId") or "",
            "name": name,
            "summary": summary,
            "first_prompt": first_prompt,
            "message_count": latest.get("messageCount") or 0,
            "created": latest.get("created"),
            "modified": latest.get("modified"),
            "file_mtime": latest.get("fileMtime") or 0,
            "git_branch": latest.get("gitBranch"),
            "remote_control": bool(state.get("remote_control")),
            "favourite": project_path in favourites,
            "name_source": name_source,
            "extra_sessions": extra_sessions,
            "color": latest.get("agentColor"),
            # Short background-agent id when a live bg worker owns this
            # conversation, else None. Set means "open by attaching, not
            # resuming" - a resume would be refused by claude (DEF-13).
            "bg_id": bg_owned.get(latest.get("sessionId") or ""),
        })

    # Deduplicate by project_path: two encoded folders can resolve to the
    # same cwd (e.g. a session was started in /home/lab but stored under a
    # different project dir because of how claude was invoked). Prefer the
    # row whose encoded_path matches the canonical encoding of project_path;
    # otherwise fall back to the highest file_mtime.
    by_path: dict[str, dict] = {}
    for r in rows:
        path = r["project_path"]
        prev = by_path.get(path)
        if prev is None:
            by_path[path] = r
            continue
        canonical = _encode_path(path)
        r_canonical = r["encoded_path"] == canonical
        prev_canonical = prev["encoded_path"] == canonical
        if r_canonical and not prev_canonical:
            by_path[path] = r
        elif r_canonical == prev_canonical and r["file_mtime"] > prev["file_mtime"]:
            by_path[path] = r

    deduped = list(by_path.values())
    deduped.sort(key=lambda r: r["file_mtime"], reverse=True)
    return deduped


def toggle_favourite(claude_root: Path, project_path: str, favourite: bool) -> list[str]:
    """Add or remove ``project_path`` from favourites. Returns the new list."""
    favs = load_favourites(claude_root)
    if favourite and project_path not in favs:
        favs.append(project_path)
    elif not favourite and project_path in favs:
        favs.remove(project_path)
    save_favourites(claude_root, favs)
    return favs


def remove_session(
    claude_root: Path, encoded_path: str, to_trash: bool = False
) -> bool:
    """Remove the project folder ``~/.claude/projects/<encoded_path>``.

    When ``to_trash`` is true the folder is sent to the desktop trash via
    ``send2trash`` (the same mechanism Jupyter's contents manager uses);
    if no trash is available - or the move fails for any reason - it falls
    back to permanent deletion. When ``to_trash`` is false the folder is
    deleted permanently outright. Returns True on success. Refuses to remove
    anything outside the projects dir (path traversal protection).
    """
    if not encoded_path or "/" in encoded_path or encoded_path in (".", ".."):
        return False
    target = claude_root / PROJECTS_DIRNAME / encoded_path
    target = target.resolve()
    base = (claude_root / PROJECTS_DIRNAME).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return False
    if not target.is_dir():
        return False
    if to_trash:
        try:
            from send2trash import send2trash

            send2trash(str(target))
            return True
        except Exception:
            # No trash backend, unsupported filesystem, permission error, ...
            # fall through to a permanent delete.
            pass
    shutil.rmtree(target)
    return True


def _dispose_path(target: Path, to_trash: bool) -> None:
    """Delete ``target`` (file or dir), via the desktop trash when asked.

    Same trash semantics as ``remove_session``: a failed trash move falls
    back to a permanent delete.
    """
    if to_trash:
        try:
            from send2trash import send2trash

            send2trash(str(target))
            return
        except Exception:
            pass
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()


def _safe_project_dir(claude_root: Path, encoded_path: str) -> Path | None:
    """Resolve ``~/.claude/projects/<encoded_path>`` rejecting traversal.

    Same validation as ``cleanup_parallel_sessions``: no ``/`` in the
    segment, no ``.``/``..``, and the resolved dir must stay under the
    projects root. Returns None when invalid or not a directory.
    """
    if not encoded_path or "/" in encoded_path or encoded_path in (".", ".."):
        return None
    project_dir = (claude_root / PROJECTS_DIRNAME / encoded_path).resolve()
    base = (claude_root / PROJECTS_DIRNAME).resolve()
    try:
        project_dir.relative_to(base)
    except ValueError:
        return None
    if not project_dir.is_dir():
        return None
    return project_dir


def list_branches(
    claude_root: Path, encoded_path: str, include_bg: bool = False
) -> dict | None:
    """List a project's other conversation JSONLs ("branches").

    Returns ``{"current": <main sid>, "total": <jsonl count>, "branches":
    [{"session_id", "file_mtime", "label", "bg_id"}, ...]}`` - the current
    main session excluded, newest first, ALL of them (the frontend shows the
    5 most recent in the submenu and the full list in the "More..." popup).

    ``bg_id`` (short id of the live background agent owning that branch, or
    None) is populated only when ``include_bg`` is set, and then from the
    poll-refreshed snapshot (``bg_agents_cached``) so the context-menu open
    stays spawn-free; the fork watcher polls this every 2s for up to 3
    minutes and never asks for it at all. It feeds a marker only - opening
    any branch is correct without it, the launch endpoint resolves the verb
    per conversation id (DEF-13).
    The label prefers the branch's own ``custom-title`` record, then the
    ``sessions-index.json`` summary, then the first 8 chars of the session
    id. Returns None on invalid path or when no main session resolves.
    """
    project_dir = _safe_project_dir(claude_root, encoded_path)
    if project_dir is None:
        return None
    index_path = project_dir / INDEX_FILENAME
    index = _load_json(index_path) if index_path.is_file() else None
    latest = _resolve_latest(project_dir, index)
    if latest is None:
        return None
    current = latest.get("sessionId")

    summaries: dict[str, str] = {}
    if isinstance(index, dict):
        for e in index.get("entries") or []:
            if isinstance(e, dict) and isinstance(e.get("sessionId"), str):
                summary = e.get("summary")
                if isinstance(summary, str) and summary.strip():
                    summaries[e["sessionId"]] = summary

    jsonls = [p for p in project_dir.glob("*.jsonl") if p.stem != current]
    jsonls.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    # Cache-served: the context-menu open must not pay a CLI spawn on the
    # click path, and the panel's 30s poll keeps the snapshot fresh.
    bg_owned = bg_agents_cached() if include_bg else {}
    branches = []
    for jsonl in jsonls:
        sid = jsonl.stem
        label = (
            _scan_jsonl_for_custom_title(jsonl)
            or summaries.get(sid)
            or sid[:8]
        )
        branches.append({
            "session_id": sid,
            "file_mtime": int(jsonl.stat().st_mtime * 1000),
            "label": label,
            "bg_id": bg_owned.get(sid),
        })
    return {
        "current": current,
        "total": len(jsonls) + 1,
        "branches": branches,
    }


def switch_branch(claude_root: Path, encoded_path: str, session_id: str) -> dict | None:
    """Make ``session_id`` the project's current conversation.

    Persists by writing a durable per-project pin (``.jl-current``) that
    ``_resolve_latest`` honours over recency, and by touching the JSONL's
    mtime so claude's own ``--resume`` picker stays roughly aligned. The pin
    makes the choice stick even after later activity in another conversation
    bumps its mtime higher (the recency-revert defect). Returns
    ``{"requested", "current"}`` where ``current`` is re-resolved after the
    write - it differs from ``requested`` when the branch's recorded cwd is
    inconsistent with the project dir (such a branch cannot become current,
    and a cwd-foreign pin is ignored).
    Returns ``{"error": "branch_not_found"}`` when the JSONL is gone (e.g.
    removed between menu display and click) and None on invalid input.
    """
    if (
        not isinstance(session_id, str)
        or not session_id
        or "/" in session_id
        or session_id in (".", "..")
    ):
        return None
    project_dir = _safe_project_dir(claude_root, encoded_path)
    if project_dir is None:
        return None
    jsonl = project_dir / f"{session_id}.jsonl"
    if not jsonl.is_file():
        return {"error": "branch_not_found"}
    # Touch mtime so claude's own ``--resume`` picker stays roughly aligned,
    # and write a durable pin so our resolution sticks even after subsequent
    # activity in another conversation bumps its mtime higher. Pin only when
    # the branch can actually become current - a cwd-foreign branch cannot
    # (``_resolve_latest`` would ignore the pin), so writing it would just
    # clobber a prior valid pin and silently fall back to recency.
    os.utime(jsonl, None)
    cwd = _jsonl_cwd(jsonl)
    if cwd and _project_path_for_cwd(cwd, project_dir.name):
        _write_current_pin(project_dir, session_id)
    index_path = project_dir / INDEX_FILENAME
    index = _load_json(index_path) if index_path.is_file() else None
    latest = _resolve_latest(project_dir, index)
    return {
        "requested": session_id,
        "current": latest.get("sessionId") if latest else None,
    }


def delete_branches(
    claude_root: Path,
    encoded_path: str,
    session_ids: list,
    to_trash: bool = False,
) -> int | None:
    """Delete selected branch sessions from a project folder.

    For every requested ``<sessionId>.jsonl`` the file and its sibling
    ``<sessionId>/`` subagent directory (when present) are removed - to the
    desktop trash when ``to_trash`` is true. The current main session
    (``_resolve_latest``) is never deleted even when requested; a missing
    JSONL is treated as already deleted (skipped silently). Returns the
    number of sessions actually removed, or None on invalid input.
    """
    if not isinstance(session_ids, list) or not session_ids:
        return None
    for sid in session_ids:
        if (
            not isinstance(sid, str)
            or not sid
            or "/" in sid
            or sid in (".", "..")
        ):
            return None
    project_dir = _safe_project_dir(claude_root, encoded_path)
    if project_dir is None:
        return None
    index_path = project_dir / INDEX_FILENAME
    index = _load_json(index_path) if index_path.is_file() else None
    latest = _resolve_latest(project_dir, index)
    keep = latest.get("sessionId") if latest else None
    removed = 0
    for sid in session_ids:
        if sid == keep:
            continue
        jsonl = project_dir / f"{sid}.jsonl"
        if not jsonl.is_file():
            continue
        _dispose_path(jsonl, to_trash)
        side_dir = project_dir / sid
        if side_dir.is_dir():
            _dispose_path(side_dir, to_trash)
        removed += 1
    return removed


def cleanup_parallel_sessions(
    claude_root: Path, encoded_path: str, to_trash: bool = False
) -> int | None:
    """Remove every session in a project folder except the main one.

    The main session is the same one ``list_sessions`` surfaces for the row
    (``_resolve_latest``). For every other ``<sessionId>.jsonl`` the file and
    its sibling ``<sessionId>/`` subagent directory (when present) are
    removed - to the desktop trash when ``to_trash`` is true. Anything else
    in the folder (``sessions-index.json``, ``memory/``, ...) is untouched.
    Returns the number of sessions removed, or None on failure (path
    traversal, missing folder, no resolvable main session).
    """
    if not encoded_path or "/" in encoded_path or encoded_path in (".", ".."):
        return None
    project_dir = (claude_root / PROJECTS_DIRNAME / encoded_path).resolve()
    base = (claude_root / PROJECTS_DIRNAME).resolve()
    try:
        project_dir.relative_to(base)
    except ValueError:
        return None
    if not project_dir.is_dir():
        return None
    index_path = project_dir / INDEX_FILENAME
    index = _load_json(index_path) if index_path.is_file() else None
    latest = _resolve_latest(project_dir, index)
    if latest is None:
        return None
    keep = latest.get("sessionId")
    removed = 0
    for jsonl in project_dir.glob("*.jsonl"):
        sid = jsonl.stem
        if sid == keep:
            continue
        _dispose_path(jsonl, to_trash)
        side_dir = project_dir / sid
        if side_dir.is_dir():
            _dispose_path(side_dir, to_trash)
        removed += 1
    return removed
