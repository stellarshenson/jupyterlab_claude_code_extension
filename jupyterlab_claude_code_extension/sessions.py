"""Pure-Python session enumeration for Claude Code projects.

Reads from ``~/.claude/projects/*/sessions-index.json`` (Claude's own
aggregated index per project), deduplicates to one row per project folder
(most recent JSONL wins), and decorates with favourite + remote-control flags.
"""
from __future__ import annotations

import json
import os
import shutil
from collections import Counter
from pathlib import Path
from typing import Any


PROJECTS_DIRNAME = "projects"
SESSIONS_DIRNAME = "sessions"
INDEX_FILENAME = "sessions-index.json"
FAVOURITES_FILENAME = "jupyterlab_claude_code_extension.json"


def claude_dir() -> Path:
    """Return the user's Claude config root."""
    return Path.home() / ".claude"


def claude_binary_available() -> str | None:
    """Return the resolved path of the ``claude`` binary or ``None``."""
    return shutil.which("claude")


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


def _looks_auto_named(name: str) -> bool:
    """Heuristic: Claude's auto-derived names are 3+ token lowercase
    kebab-case strings (e.g. ``sessions-panel-four-fixes``). User
    ``/rename``s in observed data are short or use other formats.
    """
    if not name:
        return False
    parts = name.split("-")
    if len(parts) < 3:
        return False
    return all(p and p.isalnum() and p.islower() for p in parts)


def session_state_by_cwd(claude_root: Path) -> dict[str, dict]:
    """Map ``cwd`` -> latest ``~/.claude/sessions/<pid>.json`` record fields.

    Each value carries:
      * ``name`` - the renamed session name (set by Claude's ``/rename``
        command) or ``None``. To distinguish a real ``/rename`` (stable
        name) from Claude's auto-derived topic name (which mutates across
        pid files for the same sessionId), we treat any sessionId with
        more than one distinct ``name`` value as auto-named and drop it.
      * ``live_pid`` - the PID if it is still alive, else ``None``
      * ``session_id`` - the sessionId in that record
      * ``updated_at`` - ms-epoch of last update

    When multiple ``<pid>.json`` files exist for the same cwd, the one with
    the highest ``updatedAt`` wins.
    """
    by_cwd: dict[str, dict] = {}
    sessions_dir = claude_root / SESSIONS_DIRNAME
    if not sessions_dir.is_dir():
        return by_cwd

    # Pass 1 - collect every distinct ``name`` per sessionId so we can flag
    # volatile (auto-derived) names.
    names_by_session: dict[str, set[str]] = {}
    raw: list[dict] = []
    for entry in sessions_dir.glob("*.json"):
        data = _load_json(entry)
        if not isinstance(data, dict):
            continue
        raw.append(data)
        sid = data.get("sessionId")
        nm = data.get("name")
        if isinstance(sid, str) and isinstance(nm, str) and nm.strip():
            names_by_session.setdefault(sid, set()).add(nm.strip())

    # Pass 2 - pick latest record per cwd, drop volatile names.
    for data in raw:
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
        name = data.get("name")
        is_volatile = (
            sid is not None and len(names_by_session.get(sid, set())) > 1
        )
        is_auto = is_volatile or (
            isinstance(name, str) and _looks_auto_named(name.strip())
        )
        by_cwd[cwd] = {
            "name": (
                name
                if isinstance(name, str) and name.strip() and not is_auto
                else None
            ),
            "live_pid": pid if live else None,
            "session_id": sid,
            "updated_at": updated_at,
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


def _resolve_latest(project_dir: Path, index: dict | None) -> dict | None:
    """Pick the latest entry for a project dir, trusting the filesystem.

    Claude's ``sessions-index.json`` can drift - an interrupted write or a
    crash can leave it referencing only an older sessionId while newer
    JSONLs sit on disk. To stay robust we scan ``*.jsonl`` ourselves, pick
    the file with the highest fs mtime, and enrich it with the matching
    index entry's metadata (summary, firstPrompt, ...) when available.
    Falls back to a minimal record otherwise.
    """
    jsonls = list(project_dir.glob("*.jsonl"))
    if not jsonls:
        return None
    latest_jsonl = max(jsonls, key=lambda p: p.stat().st_mtime)
    sid = latest_jsonl.stem
    fs_mtime = int(latest_jsonl.stat().st_mtime * 1000)

    indexed: dict | None = None
    if isinstance(index, dict):
        entries = index.get("entries") or []
        for e in entries:
            if isinstance(e, dict) and e.get("sessionId") == sid:
                indexed = e
                break

    if indexed is not None:
        latest = dict(indexed)
        latest["fileMtime"] = max(int(latest.get("fileMtime") or 0), fs_mtime)
        return latest

    return {
        "sessionId": sid,
        "fullPath": str(latest_jsonl),
        "fileMtime": fs_mtime,
        "summary": "",
        "firstPrompt": "",
        "messageCount": 0,
        "created": None,
        "modified": None,
        "gitBranch": None,
        "projectPath": _scan_jsonl_for_cwd(latest_jsonl),
    }


_JSONL_CWD_SCAN_LIMIT = 50


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
    ``remote_control``, ``favourite``.

    ``name_source`` is ``"rename"`` when the name came from an explicit
    ``/rename`` in Claude (via ``~/.claude/sessions/<pid>.json``), or
    ``"basename"`` when it fell back to the project folder name. The frontend
    uses this to keep user-set rename names intact during display-name
    disambiguation (which otherwise rolls colliding names back to path tails
    and masks the rename).
    """
    root = claude_root if claude_root is not None else claude_dir()
    projects_dir = root / PROJECTS_DIRNAME
    if not projects_dir.is_dir():
        return []

    favourites = set(load_favourites(root))
    states = session_state_by_cwd(root)

    rows: list[dict] = []
    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue
        index_path = project_dir / INDEX_FILENAME
        index = _load_json(index_path) if index_path.is_file() else None

        project_path: str | None = None
        if isinstance(index, dict):
            project_path = index.get("originalPath") if isinstance(index.get("originalPath"), str) else None

        latest = _resolve_latest(project_dir, index)
        if latest is None:
            continue

        if not project_path:
            project_path = latest.get("projectPath") if isinstance(latest.get("projectPath"), str) else _decode_dirname(project_dir.name)

        summary = latest.get("summary") or ""
        first_prompt = latest.get("firstPrompt") or ""

        state = states.get(project_path) or {}
        renamed = state.get("name")
        # Only an explicit /rename overrides the folder name. Claude's
        # auto-generated ``summary`` field (e.g. "Setup CLI Config, Badges")
        # is not used as a display name - it lives in the tooltip instead.
        if renamed:
            name = renamed
            name_source = "rename"
        else:
            name = os.path.basename(project_path) or project_dir.name
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
            "remote_control": state.get("live_pid") is not None,
            "favourite": project_path in favourites,
            "name_source": name_source,
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


def remove_session(claude_root: Path, encoded_path: str) -> bool:
    """Delete the project folder ``~/.claude/projects/<encoded_path>``.

    Returns True on success. Refuses to remove anything outside the projects dir
    (path traversal protection).
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
    shutil.rmtree(target)
    return True
