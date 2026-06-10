"""Tests for the sessions backend (routes.py + sessions.py)."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from unittest import mock

import pytest

from jupyterlab_claude_code_extension import routes as routes_mod
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


def test_pid_file_name_is_honoured_as_the_row_label(
    fake_claude: Path,
) -> None:
    """The pid file's ``name`` is the value Claude shows for the session
    (set by ``/rename``); the panel honours it so a renamed session reads
    that name rather than the folder basename. ``name_source`` is
    ``"session"`` when the name came from a pid record."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "a", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "scandi",
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["name"] == "scandi"
    assert state["/home/user/projA"]["session_id"] == "a"
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["name"] == "scandi"
    assert rows["/home/user/projA"]["name_source"] == "session"
    # Folders with no pid record fall back to the basename.
    assert rows["/home/user/projB"]["name_source"] == "basename"
    assert rows["/home/user/projC"]["name_source"] == "basename"


def test_latest_pid_name_wins_after_rename(fake_claude: Path) -> None:
    """Mirrors the live "proposals -> scandi" case: many pid records for one
    cwd all say "proposals", a newer one (highest ``updatedAt``) says
    "scandi" - the latest name must win."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    for i, ts in enumerate((10, 20, 30)):
        (sessions_dir / f"{100 + i}.json").write_text(json.dumps({
            "pid": 100 + i, "sessionId": "s", "cwd": "/home/user/projA",
            "updatedAt": ts, "name": "projA",
        }))
    (sessions_dir / "200.json").write_text(json.dumps({
        "pid": 200, "sessionId": "s", "cwd": "/home/user/projA",
        "updatedAt": 999, "name": "scandi",  # newest -> wins
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["name"] == "scandi"
    assert rows["/home/user/projA"]["name_source"] == "session"


def test_blank_pid_name_falls_back_to_basename(fake_claude: Path) -> None:
    """A whitespace-only or empty ``name`` is ignored; the row uses the
    folder basename."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "a", "cwd": "/home/user/projA",
        "updatedAt": 1, "name": "   ",
    }))
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["name"] == "projA"
    assert rows["/home/user/projA"]["name_source"] == "basename"


def test_session_state_picks_latest_updated_at(fake_claude: Path) -> None:
    """When multiple pid files share a cwd, the record with the highest
    ``updatedAt`` wins (used for live_pid / session_id resolution)."""
    sessions_dir = fake_claude / "sessions"
    sessions_dir.mkdir()
    (sessions_dir / "100.json").write_text(json.dumps({
        "pid": 100, "sessionId": "older", "cwd": "/home/user/projA",
        "startedAt": 1000, "updatedAt": 2000,
    }))
    (sessions_dir / "200.json").write_text(json.dumps({
        "pid": 200, "sessionId": "newer", "cwd": "/home/user/projA",
        "startedAt": 1500, "updatedAt": 5000,
    }))
    state = sessions_mod.session_state_by_cwd(fake_claude)
    assert state["/home/user/projA"]["updated_at"] == 5000
    assert state["/home/user/projA"]["session_id"] == "newer"


async def test_status_endpoint_returns_root_dir(jp_fetch, patched_claude_dir) -> None:
    response = await jp_fetch("jupyterlab-claude-code-extension", "status")
    assert response.code == 200
    payload = json.loads(response.body)
    assert isinstance(payload.get("root_dir"), str)
    assert payload["root_dir"]
    # Must be an expanded absolute path - a leading "~" never matches the
    # absolute session paths the frontend compares it against.
    assert not payload["root_dir"].startswith("~")


def test_session_state_by_cwd_returns_live_pid_and_session_id(fake_claude: Path) -> None:
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


def test_list_sessions_reports_extra_sessions_count(fake_claude: Path) -> None:
    rows = {r["project_path"]: r for r in sessions_mod.list_sessions(fake_claude)}
    assert rows["/home/user/projA"]["extra_sessions"] == 0
    assert rows["/home/user/projB"]["extra_sessions"] == 1
    assert rows["/home/user/projC"]["extra_sessions"] == 0


def test_cleanup_parallel_sessions_keeps_only_main(fake_claude: Path) -> None:
    b = fake_claude / "projects" / "-home-user-projB"
    # Subagent dir for the old session must go with its jsonl; the keeper's
    # dir and unrelated folders must survive.
    (b / "bbbb-old").mkdir()
    (b / "bbbb-new").mkdir()
    (b / "memory").mkdir()
    removed = sessions_mod.cleanup_parallel_sessions(fake_claude, "-home-user-projB")
    assert removed == 1
    assert not (b / "bbbb-old.jsonl").exists()
    assert not (b / "bbbb-old").exists()
    assert (b / "bbbb-new.jsonl").exists()
    assert (b / "bbbb-new").is_dir()
    assert (b / "memory").is_dir()
    assert (b / "sessions-index.json").exists()


def test_cleanup_parallel_sessions_noop_when_single_session(fake_claude: Path) -> None:
    a = fake_claude / "projects" / "-home-user-projA"
    removed = sessions_mod.cleanup_parallel_sessions(fake_claude, "-home-user-projA")
    assert removed == 0
    assert (a / "aaaa-1111.jsonl").exists()


def test_cleanup_parallel_sessions_rejects_traversal(fake_claude: Path) -> None:
    assert sessions_mod.cleanup_parallel_sessions(fake_claude, "../../etc") is None
    assert sessions_mod.cleanup_parallel_sessions(fake_claude, "..") is None
    assert sessions_mod.cleanup_parallel_sessions(fake_claude, "") is None
    assert sessions_mod.cleanup_parallel_sessions(fake_claude, "no-such-dir") is None


def test_cleanup_parallel_sessions_to_trash_uses_send2trash(
    fake_claude: Path, monkeypatch
) -> None:
    import send2trash

    calls: list[str] = []
    monkeypatch.setattr(send2trash, "send2trash", calls.append)
    b = fake_claude / "projects" / "-home-user-projB"
    removed = sessions_mod.cleanup_parallel_sessions(
        fake_claude, "-home-user-projB", to_trash=True
    )
    assert removed == 1
    assert calls == [str(b / "bbbb-old.jsonl")]
    # send2trash was stubbed - the file is untouched, but the call happened.
    assert (b / "bbbb-old.jsonl").exists()


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
    # A leftover pid file from the OLD folder. Its cwd (/home/user/oldname)
    # no longer matches the resolved project_path (/home/user/newname), so
    # its name does not attach to this row - the basename is used instead.
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
    """If no JSONL's cwd encodes to the directory name AND no real directory
    on disk encodes to it either (e.g. the folder was deleted or moved
    elsewhere), fall back to the newest JSONL's recorded cwd rather than a
    lossy decode of the encoded directory name."""
    root = tmp_path / ".claude"
    proj = root / "projects" / "-home-user-deleted-proj"
    proj.mkdir(parents=True)
    _jsonl(proj / "s.jsonl", ["/home/user/some-other-place"])

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == "/home/user/some-other-place"
    assert rows[0]["name"] == "some-other-place"
    assert rows[0]["name_source"] == "basename"


def test_resolve_latest_recovers_real_path_after_manual_rename(
    tmp_path: Path,
) -> None:
    """When the user renames a project folder on disk AND the corresponding
    ``~/.claude/projects/<encoded>`` directory to match, the JSONLs inside
    still record the OLD cwd - none are consistent with the new dir name.
    ``_resolve_latest`` should then fall back to a filesystem walk and pick
    up the real (renamed) folder."""
    renamed = tmp_path / "private" / "myproj_extension"
    renamed.mkdir(parents=True)
    encoded = sessions_mod._encode_path(str(renamed))  # mirrors Claude's encoding

    root = tmp_path / ".claude"
    proj = root / "projects" / encoded
    proj.mkdir(parents=True)
    old_cwd = str(tmp_path / "private" / "myproj")  # doesn't exist anymore
    _jsonl(proj / "sess.jsonl", [old_cwd, old_cwd])

    rows = sessions_mod.list_sessions(root)
    assert len(rows) == 1
    assert rows[0]["project_path"] == str(renamed)
    assert rows[0]["name"] == "myproj_extension"
    assert rows[0]["session_id"] == "sess"


def test_find_path_matching_encoded_walks_filesystem(tmp_path: Path) -> None:
    """Direct unit check of the recovery helper: it should find a real
    directory whose absolute path encodes (per ``_encode_path``) to the
    given encoded name, even when the basename mixes ``_`` and ``-``."""
    target = tmp_path / "private" / "jupyterlab" / "my_proj-with_extension"
    target.mkdir(parents=True)
    encoded = sessions_mod._encode_path(str(target))
    assert sessions_mod._find_path_matching_encoded(encoded) == str(target)


def test_find_path_matching_encoded_returns_none_when_no_match(
    tmp_path: Path,
) -> None:
    """A name that doesn't correspond to any real directory on disk yields
    ``None`` so the caller can fall back to the JSONL-recorded cwd."""
    # Pure-fiction encoded name under tmp_path that no real dir matches.
    bogus = sessions_mod._encode_path(str(tmp_path / "no" / "such" / "thing"))
    assert sessions_mod._find_path_matching_encoded(bogus) is None


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
# Terminal cwd discovery
# ---------------------------------------------------------------------------


def test_terminal_cwds_only_reports_live_proc_cwd() -> None:
    """``_terminal_cwds`` reports a process's *live* cwd from
    ``/proc/<pid>/cwd`` only. It must not consult the ``PWD`` env in
    ``/proc/<pid>/environ`` (the frozen exec-time value) - that source is the
    reason every pty used to also report the Jupyter server's launch
    directory and so matched the wrong session on click."""
    assert not hasattr(routes_mod, "_process_pwd_env")
    if not os.path.isdir("/proc/self"):
        pytest.skip("needs Linux /proc")
    cwds = routes_mod._terminal_cwds(os.getpid())
    assert os.path.realpath(os.getcwd()) in cwds


def test_terminal_cwds_tracks_chdir(tmp_path: Path, monkeypatch) -> None:
    """The reported cwd follows ``chdir`` - the kernel symlink is live."""
    if not os.path.isdir("/proc/self"):
        pytest.skip("needs Linux /proc")
    target = tmp_path / "elsewhere"
    target.mkdir()
    monkeypatch.chdir(target)
    cwds = routes_mod._terminal_cwds(os.getpid())
    assert os.path.realpath(str(target)) in cwds


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


async def test_cleanup_endpoint(jp_fetch, patched_claude_dir, monkeypatch) -> None:
    # Same trash stubbing as test_remove_endpoint - the handler honours
    # ContentsManager.delete_to_trash (default on).
    import send2trash

    seen: list[str] = []
    monkeypatch.setattr(
        send2trash, "send2trash", lambda p: (seen.append(p), os.remove(p))
    )
    body = json.dumps({"encoded_path": "-home-user-projB"})
    response = await jp_fetch(
        "jupyterlab-claude-code-extension", "sessions", "cleanup",
        method="POST", body=body,
    )
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload["removed_count"] == 1
    assert seen  # routed through the trash path
    b = patched_claude_dir / "projects" / "-home-user-projB"
    assert not (b / "bbbb-old.jsonl").exists()
    assert (b / "bbbb-new.jsonl").exists()


async def test_cleanup_endpoint_rejects_traversal(jp_fetch, patched_claude_dir) -> None:
    body = json.dumps({"encoded_path": "../etc"})
    with pytest.raises(Exception) as exc:
        await jp_fetch(
            "jupyterlab-claude-code-extension", "sessions", "cleanup",
            method="POST", body=body,
        )
    assert "400" in str(exc.value)
