"""Tests for the ``jupyterlab_claude_code`` companion CLI."""

import json
import os
from pathlib import Path

import pytest

from jupyterlab_claude_code_extension import cli

SCRIPT = "#!/bin/bash\necho statusline\n"


def test_install_writes_script_and_wires_settings(tmp_path: Path) -> None:
    claude_dir = tmp_path / ".claude"
    dest = cli.install_claude_statusline(claude_dir, SCRIPT)
    assert dest == claude_dir / "statusline-command.sh"
    assert dest.read_text() == SCRIPT
    assert os.access(dest, os.X_OK)
    settings = json.loads((claude_dir / "settings.json").read_text())
    assert settings["statusLine"] == {
        "type": "command",
        "command": f"bash {dest}",
        "padding": 0,
    }


def test_install_preserves_existing_settings(tmp_path: Path) -> None:
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.json").write_text(json.dumps({
        "model": "opus",
        "statusLine": {"type": "command", "command": "old"},
    }))
    cli.install_claude_statusline(claude_dir, SCRIPT)
    settings = json.loads((claude_dir / "settings.json").read_text())
    assert settings["model"] == "opus"
    assert settings["statusLine"]["command"].startswith("bash ")


def test_install_refuses_invalid_settings_json(tmp_path: Path) -> None:
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.json").write_text("{broken")
    with pytest.raises(ValueError):
        cli.install_claude_statusline(claude_dir, SCRIPT)
    # The hand-edited file is untouched.
    assert (claude_dir / "settings.json").read_text() == "{broken"


def test_fetch_rejects_non_script_response(monkeypatch) -> None:
    class FakeResponse:
        def read(self):
            return b"<html>404</html>"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(
        cli.urllib.request, "urlopen", lambda url, timeout: FakeResponse()
    )
    with pytest.raises(ValueError):
        cli.fetch_statusline()


def test_main_asks_for_confirmation_and_aborts_on_no(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    claude_dir = tmp_path / ".claude"
    monkeypatch.setattr("builtins.input", lambda prompt: "n")
    code = cli.main(["install-claude-statusline", "--claude-dir", str(claude_dir)])
    assert code == 0
    assert "Aborted." in capsys.readouterr().out
    assert not (claude_dir / "statusline-command.sh").exists()


def test_main_yes_skips_prompt_and_installs(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    claude_dir = tmp_path / ".claude"
    monkeypatch.setattr(cli, "fetch_statusline", lambda: SCRIPT)
    monkeypatch.setattr(
        "builtins.input",
        lambda prompt: pytest.fail("prompt shown despite --yes"),
    )
    code = cli.main(
        ["install-claude-statusline", "--claude-dir", str(claude_dir), "--yes"]
    )
    assert code == 0
    assert "Installed" in capsys.readouterr().out
    assert (claude_dir / "statusline-command.sh").read_text() == SCRIPT


def test_main_confirmed_install_downloads_and_installs(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    claude_dir = tmp_path / ".claude"
    monkeypatch.setattr(cli, "fetch_statusline", lambda: SCRIPT)
    monkeypatch.setattr("builtins.input", lambda prompt: "y")
    code = cli.main(["install-claude-statusline", "--claude-dir", str(claude_dir)])
    assert code == 0
    settings = json.loads((claude_dir / "settings.json").read_text())
    assert "statusLine" in settings


def test_main_reports_error_on_invalid_settings(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.json").write_text("not json")
    monkeypatch.setattr(cli, "fetch_statusline", lambda: SCRIPT)
    code = cli.main(
        ["install-claude-statusline", "--claude-dir", str(claude_dir), "--yes"]
    )
    assert code == 1
    assert "error:" in capsys.readouterr().err
