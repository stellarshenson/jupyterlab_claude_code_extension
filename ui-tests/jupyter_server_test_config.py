"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import json
import os
import stat
import tempfile
import time

from jupyterlab.galata import configure_jupyter_server

# Isolated HOME so the panel reads a seeded ``~/.claude`` instead of the
# developer's real one (the backend resolves the projects root from
# ``Path.home()``). Set before anything reads HOME.
_home = tempfile.mkdtemp(prefix="fake-home-")
os.environ["HOME"] = _home

# Provide a fake ``claude`` binary on PATH so the sessions panel registers
# (CI runners do not have the real CLI) and the new-session launch flow can
# actually spawn a terminal. The script sleeps so the terminal stays open
# long enough for the test to observe it.
_fake_bin = tempfile.mkdtemp(prefix="fake-claude-")
_claude = os.path.join(_fake_bin, "claude")
with open(_claude, "w") as f:
    f.write("#!/bin/sh\necho fake claude running\nsleep 120\n")
os.chmod(_claude, os.stat(_claude).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
os.environ["PATH"] = _fake_bin + os.pathsep + os.environ.get("PATH", "")

# Seed a project with three parallel conversations so the branch UI (Open
# Branched Conversation / Switch / Manage Sessions) has something to act on.
# The cwd is a REAL directory so launch-terminal accepts it; the project dir
# name is the backend's own encoding of that path so resolution matches.
from jupyterlab_claude_code_extension import sessions as _sessions  # noqa: E402

_project_cwd = os.path.join(_home, "branchy")
os.makedirs(_project_cwd, exist_ok=True)
_pdir = os.path.join(_home, ".claude", "projects", _sessions._encode_path(_project_cwd))
os.makedirs(_pdir, exist_ok=True)
_now = time.time()
for _i in range(3):
    _jsonl = os.path.join(_pdir, f"branch-{_i}.jsonl")
    with open(_jsonl, "w") as _fh:
        _fh.write(json.dumps({"cwd": _project_cwd}) + "\n")
    # Ascending mtimes, all recent so the row lands in the (expanded) Recent
    # section; the newest is the project's current conversation.
    os.utime(_jsonl, (_now - 30 + _i, _now - 30 + _i))

configure_jupyter_server(c)

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
