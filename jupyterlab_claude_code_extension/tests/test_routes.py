"""Tests for the sessions backend (routes.py + sessions.py)."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from unittest import mock

import pytest

from jupyterlab_claude_code_extension import sessions as sessions_mod


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_claude(tmp_path: Path) -> Path:
    """Create a minimal ``~/.claude/`` tree with three projects."""
    root = tmp_path / ".claude"
    projects = root / "projects"

    # Project A - has sessions-index.json with one entry
    a = projects / "-home-user-projA"
    a.mkdir(parents=True)
    (a / "sessions-index.json").write_text(json.dumps({
        "version": 1,
        "originalPath": "/home/user/projA",
        "entries": [{
            "sessionId": "aaaa-1111",
            "fullPath": str(a / "aaaa-1111.jsonl"),
            "fileMtime": 1_000_000,
            "summary": "Project A summary",
            "firstPrompt": "hello A",
            "messageCount": 5,
            "created": "2026-01-01T00:00:00Z",
            "modified": "2026-01-02T00:00:00Z",
            "gitBranch": "main",
            "projectPath": "/home/user/projA",
        }],
    }))
    (a / "aaaa-1111.jsonl").write_text("{}\n")

    # Project B - has TWO entries; the newer one must win
    b = projects / "-home-user-projB"
    b.mkdir(parents=True)
    (b / "sessions-index.json").write_text(json.dumps({
        "version": 1,
        "originalPath": "/home/user/projB",
        "entries": [
            {
                "sessionId": "bbbb-old",
                "fullPath": str(b / "bbbb-old.jsonl"),
                "fileMtime": 2_000_000,
                "summary": "older",
                "firstPrompt": "old",
                "messageCount": 1,
            },
            {
                "sessionId": "bbbb-new",
                "fullPath": str(b / "bbbb-new.jsonl"),
                "fileMtime": 3_000_000,
                "summary": "newer",
                "firstPrompt": "new",
                "messageCount": 9,
            },
        ],
    }))
    # The resolver picks the latest by fs mtime, so set them explicitly:
    # bbbb-new must be more recent than bbbb-old.
    (b / "bbbb-old.jsonl").write_text("{}\n")
    os.utime(b / "bbbb-old.jsonl", (2_000, 2_000))
    (b / "bbbb-new.jsonl").write_text("{}\n")
    os.utime(b / "bbbb-new.jsonl", (3_000, 3_000))

    # Project C - no sessions-index.json, raw .jsonl fallback
    c = projects / "-home-user-projC"
    c.mkdir(parents=True)
    (c / "cccc-2222.jsonl").write_text("{}\n")

    return root


# ---------------------------------------------------------------------------
# Pure-function tests (sessions.py)
# ---------------------------------------------------------------------------


def test_list_sessions_empty_when_no_projects_dir(tmp_path: Path) -> None:
    assert sessions_mod.list_sessions(tmp_path) == []


def test_list_sessions_basic(fake_claude: Path) -> None:
    rows = sessions_mod.list_sessions(fake_claude)
    paths = sorted(r["project_path"] for r in rows)
    assert paths == ["/home/user/projA", "/home/user/projB", "/home/user/projC"]


def test_list_sessions_picks_most_recent_jsonl(fake_claude: Path) -> None:
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projB"]["session_id"] == "bbbb-new"
    assert rows["/home/user/projB"]["file_mtime"] == 3_000_000
    # summary is preserved in the row payload (used in tooltip) but is no
    # longer the display name - that's now basename unless /rename'd.
    assert rows["/home/user/projB"]["summary"] == "newer"
    assert rows["/home/user/projB"]["name"] == "projB"


def test_list_sessions_falls_back_to_basename_when_no_summary(fake_claude: Path) -> None:
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    # Project C has no index, so summary is empty -> name = basename
    assert rows["/home/user/projC"]["name"] == "projC"
    assert rows["/home/user/projC"]["session_id"] == "cccc-2222"


def test_toggle_favourite_round_trip(fake_claude: Path) -> None:
    sessions_mod.toggle_favourite(fake_claude, "/home/user/projA", True)
    assert sessions_mod.load_favourites(fake_claude) == ["/home/user/projA"]

    sessions_mod.toggle_favourite(fake_claude, "/home/user/projB", True)
    assert sessions_mod.load_favourites(fake_claude) == ["/home/user/projA", "/home/user/projB"]

    sessions_mod.toggle_favourite(fake_claude, "/home/user/projA", False)
    assert sessions_mod.load_favourites(fake_claude) == ["/home/user/projB"]


def test_list_sessions_marks_favourites(fake_claude: Path) -> None:
    sessions_mod.toggle_favourite(fake_claude, "/home/user/projA", True)
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["favourite"] is True
    assert rows["/home/user/projB"]["favourite"] is False


def test_remote_control_flag_uses_live_pids(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    # PID 1 is always alive on POSIX (init); use it as a proxy for "live"
    (sessions_dir / "1.json").write_text(json.dumps({
        "pid": 1, "sessionId": "x", "cwd": "/home/user/projA", "startedAt": 0,
    }))
    # A guaranteed-dead PID (very high)
    (sessions_dir / "9999999.json").write_text(json.dumps({
        "pid": 9_999_999, "sessionId": "y", "cwd": "/home/user/projB", "startedAt": 0,
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["remote_control"] is True
    assert rows["/home/user/projB"]["remote_control"] is False


def test_rename_from_pid_session_file(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "s", "cwd": "/home/user/projA",
        "startedAt": 1000, "updatedAt": 2000, "name": "Renamed projA",
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    # Rename overrides the index summary
    assert rows["/home/user/projA"]["name"] == "Renamed projA"


def test_rename_picks_latest_updated_at(fake_claude: Path) -> None:
    """When multiple pid files share the same (consistent /rename) name,
    metadata still comes from the record with the highest ``updatedAt``."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "s", "cwd": "/home/user/projA",
        "startedAt": 1000, "updatedAt": 2000, "name": "Renamed",
    }))
    (sessions_dir / "200.json").write_text(json.dumps({
        "pid": 200, "sessionId": "s", "cwd": "/home/user/projA",
        "startedAt": 1500, "updatedAt": 5000, "name": "Renamed",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "Renamed"
    assert state["/home/user/projA"]["updated_at"] == 5000


def test_backend_returns_bare_names(fake_claude: Path) -> None:
    """Disambiguation moved to the frontend; backend returns bare names."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "a", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "shared",
    }))
    (sessions_dir / "200.json").write_text(json.dumps({
        "pid": 200, "sessionId": "b", "cwd": "/home/user/projB",
        "updatedAt": 1, "name": "shared",
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    # No "(suffix)" added at the backend
    assert rows["/home/user/projA"]["name"] == "shared"
    assert rows["/home/user/projB"]["name"] == "shared"


def test_name_source_is_rename_when_pid_file_carries_name(
    fake_claude: Path,
) -> None:
    """When a pid.json file supplies the row's name via a stable /rename,
    the row carries ``name_source == 'rename'`` so the frontend can keep
    that label intact during display-name disambiguation."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "a", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "court-cases",
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["name"] == "court-cases"
    assert rows["/home/user/projA"]["name_source"] == "rename"
    # Project B and C have no pid.json with a /rename - they fall back to
    # the folder basename and should be marked as basename-sourced.
    assert rows["/home/user/projB"]["name_source"] == "basename"
    assert rows["/home/user/projC"]["name_source"] == "basename"


def test_auto_name_detected_and_dropped(fake_claude: Path) -> None:
    """Two pid files for the same sessionId with different ``name`` values
    should be treated as auto-derived (volatile) and ``state.name`` dropped
    so the row falls back to basename."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "S1", "cwd": "/home/user/projA",
        "updatedAt": 100, "name": "topic-one",
    }))
    (sessions_dir / "200.json").write_text(json.dumps({
        "pid": 200, "sessionId": "S1", "cwd": "/home/user/projA",
        "updatedAt": 200, "name": "topic-two",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] is None
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    # Falls through to basename
    assert rows["/home/user/projA"]["name"] == "projA"


def test_rename_with_consistent_name_kept(fake_claude: Path) -> None:
    """Multiple pid files for the same sessionId all sharing the same
    ``name`` indicates a real ``/rename`` and should be retained."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    for pid, ts in ((100, 100), (200, 200), (300, 300)):
        (sessions_dir / f"{pid}.json").write_text(json.dumps({
            "pid": pid, "sessionId": "S2", "cwd": "/home/user/projA",
            "updatedAt": ts, "name": "renamed",
        }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "renamed"


def test_kebab_case_three_token_name_treated_as_auto(fake_claude: Path) -> None:
    """Single pid file with a 3+ token lowercase-kebab name is auto."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "S", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "extract-shared-engine",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] is None


def test_two_token_name_kept_as_rename(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "S", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "court-cases",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "court-cases"


def test_underscore_name_kept_as_rename(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "S", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "jupyterlab_export_markdown_extension",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "jupyterlab_export_markdown_extension"


def test_capitalized_kebab_name_kept_as_rename(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "S", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "My-Cool-Project",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "My-Cool-Project"


async def test_status_endpoint_returns_root_dir(jp_fetch, patched_claude_dir) -> None:
    response = await jp_fetch("jupyterlab-claude-code-extension", "status")
    assert response.code == 200
    payload = json.loads(response.body)
    assert isinstance(payload.get("root_dir"), str)
    assert payload["root_dir"]


def test_session_state_by_cwd_returns_name_and_live_pid(fake_claude: Path) -> None:
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "1.json").write_text(json.dumps({
        "pid": 1, "sessionId": "live-sid", "cwd": "/some/cwd",
        "updatedAt": 100, "name": "Hello",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/some/cwd"]["name"] == "Hello"
    assert state["/some/cwd"]["live_pid"] == 1
    assert state["/some/cwd"]["session_id"] == "live-sid"


def test_remove_session_deletes_folder(fake_claude: Path) -> None:
    target = fake_claude / "projects" / "-home-user-projA"
    assert target.is_dir()
    ok = sessions_mod.remove_session(fake_claude, "-home-user-projA")
    assert ok is True
    assert not target.exists()


def test_remove_session_rejects_traversal(fake_claude: Path) -> None:
    assert sessions_mod.remove_session(fake_claude, "../../etc") is False
    assert sessions_mod.remove_session(fake_claude, "..") is False
    assert sessions_mod.remove_session(fake_claude, "") is False


def test_remove_session_to_trash_uses_send2trash(fake_claude: Path, monkeypatch) -> None:
    import send2trash

    calls: list[str] = []
    monkeypatch.setattr(send2trash, "send2trash", calls.append)
    target = fake_claude / "projects" / "-home-user-projA"
    ok = sessions_mod.remove_session(fake_claude, "-home-user-projA", to_trash=True)
    assert ok is True
    assert calls == [str(target.resolve())]
    # send2trash was stubbed - the folder is untouched, but the call happened.
    assert target.is_dir()


def test_remove_session_to_trash_falls_back_to_permanent_delete(
    fake_claude: Path, monkeypatch
) -> None:
    import send2trash

    def boom(_path: str) -> None:
        raise OSError("no trash backend on this platform")

    monkeypatch.setattr(send2trash, "send2trash", boom)
    target = fake_claude / "projects" / "-home-user-projA"
    ok = sessions_mod.remove_session(fake_claude, "-home-user-projA", to_trash=True)
    assert ok is True
    assert not target.exists()


def test_resolve_latest_prefers_jsonl_tail_cwd_over_stale_head(tmp_path: Path) -> None:
    """A session re-homed after its project folder was renamed keeps the old
    cwd in its early records. ``list_sessions`` must report the *current*
    folder (the JSONL tail), not the stale one (the JSONL head) - otherwise a
    stale ``~/.claude/sessions/<pid>.json`` keyed on the old cwd masks the
    real path and name (issue: a renamed project showed an old name and a
    path that no longer exists)."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-newname"
    proj.mkdir(parents=True)
    lines = [
        json.dumps({"cwd": "/home/user/oldname", "type": "user"}),
        json.dumps({"type": "assistant"}),
        json.dumps({"cwd": "/home/user/oldname", "type": "assistant"}),
        # ... folder renamed, session resumed under the new path ...
        json.dumps({"cwd": "/home/user/newname", "type": "user"}),
        json.dumps({"cwd": "/home/user/newname", "type": "assistant"}),
    ]
    (proj / "sess-1.jsonl").write_text("\n".join(lines) + "\n")
    # A leftover pid file from the old folder, carrying a /rename name.
    sessions_dir = root / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "9.json").write_text(json.dumps({
        "pid": 9, "sessionId": "sess-1", "cwd": "/home/user/oldname",
        "updatedAt": 1, "name": "court-cases",
    }))

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/newname"
    assert rows[0]["name"] == "newname"
    assert rows[0]["name_source"] == "basename"
    assert rows[0]["session_id"] == "sess-1"


# ---------------------------------------------------------------------------
# Name / project-path resolution
# ---------------------------------------------------------------------------


def _jsonl(path: Path, cwds: list[str | None]) -> None:
    """Write a tiny session JSONL: one record per entry, with ``cwd`` set when
    the entry is not ``None``."""
    lines = []
    for c in cwds:
        rec: dict = {"type": "user"}
        if c is not None:
            rec["cwd"] = c
        lines.append(json.dumps(rec))
    path.write_text("\n".join(lines) + "\n")


def test_resolve_latest_prefers_dir_consistent_jsonl_over_newer_stale_one(
    tmp_path: Path,
) -> None:
    """When several JSONLs sit in a project dir, the resolver must pick the
    most recent one whose recorded cwd is consistent with the directory name -
    not simply the newest file (which may be a pre-rename leftover)."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-newname"
    proj.mkdir(parents=True)
    _jsonl(proj / "stale.jsonl", ["/home/user/oldname", "/home/user/oldname"])
    os.utime(proj / "stale.jsonl", (3000, 3000))  # newer on disk
    _jsonl(proj / "current.jsonl", ["/home/user/newname", "/home/user/newname"])
    os.utime(proj / "current.jsonl", (2000, 2000))  # older on disk

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/newname"
    assert rows[0]["name"] == "newname"
    assert rows[0]["session_id"] == "current"


def test_resolve_latest_falls_back_to_newest_jsonl_cwd_when_none_match_dir(
    tmp_path: Path,
) -> None:
    """If no JSONL's cwd encodes to the directory name (e.g. the folder was
    deleted or moved elsewhere), fall back to the newest JSONL's recorded cwd
    rather than a lossy decode of the encoded directory name."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-deleted-proj"
    proj.mkdir(parents=True)
    _jsonl(proj / "s.jsonl", ["/home/user/some-other-place"])

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/some-other-place"
    assert rows[0]["name"] == "some-other-place"
    assert rows[0]["name_source"] == "basename"


def test_index_original_path_overridden_when_inconsistent_with_dir(
    tmp_path: Path,
) -> None:
    """A stale ``originalPath`` in ``sessions-index.json`` must not win over a
    JSONL-recorded cwd that actually matches how Claude named the directory;
    the entry's metadata (summary, ...) is still carried through."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-renamed"
    proj.mkdir(parents=True)
    (proj / "sessions-index.json").write_text(json.dumps({
        "version": 1,
        "originalPath": "/home/user/oldname",  # stale after the rename
        "entries": [{
            "sessionId": "sess-x",
            "fileMtime": 5_000_000,
            "summary": "carried summary",
            "firstPrompt": "carried prompt",
            "messageCount": 7,
        }],
    }))
    _jsonl(proj / "sess-x.jsonl", ["/home/user/oldname", "/home/user/renamed"])

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/renamed"
    assert rows[0]["name"] == "renamed"
    assert rows[0]["summary"] == "carried summary"
    assert rows[0]["session_id"] == "sess-x"


def test_index_original_path_kept_when_consistent_with_dir(tmp_path: Path) -> None:
    """When ``originalPath`` agrees with the directory name it is used as-is,
    even if the JSONL records no cwd of its own."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-projX"
    proj.mkdir(parents=True)
    (proj / "sessions-index.json").write_text(json.dumps({
        "version": 1,
        "originalPath": "/home/user/projX",
        "entries": [{"sessionId": "a", "fileMtime": 1, "summary": "s"}],
    }))
    _jsonl(proj / "a.jsonl", [None])  # no cwd anywhere

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/projX"
    assert rows[0]["name"] == "projX"


def test_resolve_latest_recognises_underscore_in_cwd(tmp_path: Path) -> None:
    """Claude encodes ``_`` to ``-`` in directory names, so a cwd containing an
    underscore that encodes to the directory name counts as consistent (and is
    reported with the underscore intact)."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-my-proj"
    proj.mkdir(parents=True)
    # /home/user/my_proj  ->  -home-user-my-proj  (matches the dir name)
    _jsonl(proj / "u.jsonl", ["/home/user/my_proj", "/home/user/my_proj"])

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/my_proj"
    assert rows[0]["name"] == "my_proj"


def test_rename_retrieved_when_pid_file_keyed_on_current_path(tmp_path: Path) -> None:
    """A ``/rename`` is surfaced when a ``~/.claude/sessions/<pid>.json`` for
    the session carries the *current* cwd - the path the resolver settles on."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-litigation-timeline"
    proj.mkdir(parents=True)
    _jsonl(
        proj / "sess-1.jsonl",
        ["/home/user/2025-12_pozb", "/home/user/litigation-timeline"],
    )
    sessions_dir = root / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "7.json").write_text(json.dumps({
        "pid": 7, "sessionId": "sess-1",
        "cwd": "/home/user/litigation-timeline",
        "updatedAt": 10, "name": "court-cases",
    }))

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/litigation-timeline"
    assert rows[0]["name"] == "court-cases"
    assert rows[0]["name_source"] == "rename"


def test_scan_jsonl_for_latest_cwd_reads_tail_of_large_file(tmp_path: Path) -> None:
    """The tail scan must work on files larger than its read window: padding
    records carry the old cwd, the final records carry the new one."""
    big = tmp_path / "big.jsonl"
    window = sessions_mod._JSONL_CWD_TAIL_BYTES
    pad_line = json.dumps({"type": "assistant", "cwd": "/old/path", "pad": "x" * 256})
    n_pad = (window // (len(pad_line) + 1)) + 64  # comfortably exceed the window
    with big.open("w", encoding="utf-8") as fh:
        for _ in range(n_pad):
            fh.write(pad_line + "\n")
        fh.write(json.dumps({"type": "user", "cwd": "/new/path"}) + "\n")
        fh.write(json.dumps({"type": "assistant", "cwd": "/new/path"}) + "\n")
    assert big.stat().st_size > window
    assert sessions_mod._scan_jsonl_for_latest_cwd(big) == "/new/path"


# ---------------------------------------------------------------------------
# Tornado handler tests
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_claude_dir(fake_claude: Path):
    with mock.patch.object(sessions_mod, "claude_dir", return_value=fake_claude):
        yield fake_claude


async def test_status_endpoint_reports_binary(jp_fetch, patched_claude_dir) -> None:
    response = await jp_fetch("jupyterlab-claude-code-extension", "status")
    assert response.code == 200
    payload = json.loads(response.body)
    assert "enabled" in payload
    assert "claude_path" in payload


async def test_sessions_endpoint_returns_rows(jp_fetch, patched_claude_dir) -> None:
    response = await jp_fetch("jupyterlab-claude-code-extension", "sessions")
    assert response.code == 200
    payload = json.loads(response.body)
    assert isinstance(payload["sessions"], list)
    assert {r["project_path"] for r in payload["sessions"]} == {
        "/home/user/projA", "/home/user/projB", "/home/user/projC",
    }


async def test_favourite_endpoint_persists(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"project_path": "/home/user/projA", "favourite": True})
    response = await jp_fetch(
        "jupyterlab-claude-code-extension", "sessions", "favourite",
        method="POST", body=body,
    )
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["favourites"] == ["/home/user/projA"]


async def test_favourite_rejects_bad_body(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"project_path": "/x"})  # missing 'favourite'
    with pytest.raises(Exception) as exc:
        await jp_fetch(
            "jupyterlab-claude-code-extension", "sessions", "favourite",
            method="POST", body=body,
        )
    assert "400" in str(exc.value)


async def test_remove_endpoint(jp_fetch, patched_claude_dir, monkeypatch) -> None:
    # The handler honours ContentsManager.delete_to_trash (default on); stub
    # send2trash so the test doesn't move anything into the real desktop trash.
    import send2trash

    seen: list[str] = []
    monkeypatch.setattr(send2trash, "send2trash", lambda p: (seen.append(p), shutil.rmtree(p)))
    body = json.dumps({"encoded_path": "-home-user-projA"})
    response = await jp_fetch(
        "jupyterlab-claude-code-extension", "sessions", "remove",
        method="POST", body=body,
    )
    assert response.code == 200
    assert seen  # routed through the trash path
    assert not (patched_claude_dir / "projects" / "-home-user-projA").exists()


async def test_remove_endpoint_rejects_traversal(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"encoded_path": "../etc"})
    with pytest.raises(Exception) as exc:
        await jp_fetch(
            "jupyterlab-claude-code-extension", "sessions", "remove",
            method="POST", body=body,
        )
    assert "400" in str(exc.value)
