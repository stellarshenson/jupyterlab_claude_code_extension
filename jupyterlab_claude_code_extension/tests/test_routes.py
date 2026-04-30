"""Tests for the sessions backend (routes.py + sessions.py)."""
from __future__ import annotations

import json
import os
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


async def test_remove_endpoint(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"encoded_path": "-home-user-projA"})
    response = await jp_fetch(
        "jupyterlab-claude-code-extension", "sessions", "remove",
        method="POST", body=body,
    )
    assert response.code == 200
    assert not (patched_claude_dir / "projects" / "-home-user-projA").exists()


async def test_remove_endpoint_rejects_traversal(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"encoded_path": "../etc"})
    with pytest.raises(Exception) as exc:
        await jp_fetch(
            "jupyterlab-claude-code-extension", "sessions", "remove",
            method="POST", body=body,
        )
    assert "400" in str(exc.value)
