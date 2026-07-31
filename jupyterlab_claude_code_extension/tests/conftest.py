"""Shared pytest fixtures for the backend tests."""
from __future__ import annotations

import pytest

from jupyterlab_claude_code_extension import sessions as sessions_mod


@pytest.fixture(autouse=True)
def no_bg_agents(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default every test to "no background agents are running".

    ``list_sessions`` / ``list_branches`` ask ``claude agents --json`` which
    conversations a live background agent owns (DEF-13). Left unstubbed, every
    test touching them would spawn the real CLI and read the developer's own
    machine - slow, and a different answer locally than in CI where claude is
    absent. Tests that care about the background-agent path override this by
    patching ``sessions_mod.bg_agents`` themselves, and the tests of
    ``bg_agents`` itself hold the original object via an import.

    The roster snapshot (``_bg_agents_cache``) is cleared so no test reads a
    stamp another test's ``list_sessions`` refresh left behind.
    """
    monkeypatch.setattr(sessions_mod, "bg_agents", lambda *a, **k: {})
    monkeypatch.setattr(sessions_mod, "_bg_agents_cache", None)
