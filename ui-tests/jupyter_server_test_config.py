"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os
import stat
import tempfile

from jupyterlab.galata import configure_jupyter_server

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

configure_jupyter_server(c)

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
