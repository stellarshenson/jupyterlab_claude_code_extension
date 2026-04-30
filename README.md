# jupyterlab_claude_code_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_claude_code_extension.svg)](https://www.npmjs.com/package/jupyterlab_claude_code_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab_claude_code_extension.svg)](https://pypi.org/project/jupyterlab_claude_code_extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab_claude_code_extension)](https://pepy.tech/project/jupyterlab_claude_code_extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Manage Claude Code CLI sessions from inside JupyterLab. A left-sidebar panel lists every project under `~/.claude/projects/` deduplicated to one row per folder, marks live remote-control sessions with a green dot, and lets you jump back into any session by opening (or reactivating) a terminal pwd'd to that project and auto-running `claude --resume <id>`.

![Claude Code Sessions panel](.resources/screenshot.png)

## Features

- **Three-section side panel** - Favourites, Recent (top 10 by activity), and All. Each section scrolls independently; Favourites disappears when empty
- **Live remote-control indicator** - green dot on rows whose `~/.claude/sessions/<pid>.json` is alive (verified via `os.kill(pid, 0)`)
- **One-click resume** - click a row to find an existing terminal pwd'd to that project (queried server-side from the pty's process tree) and reactivate its tab; only spawns a fresh terminal if none matches. Concurrent rapid clicks are coalesced
- **Smart name resolution** - shows the user-set `/rename` name when available; auto-detected names (volatile across the same `sessionId` or 3+ token lowercase-kebab) fall back to the folder basename. Toggle the behaviour via the `resolveSessionNames` setting
- **Path-segment disambiguation** - when two sessions share the same display name, the row reveals the minimum number of trailing path segments needed for each to be unique
- **Favourites** - star a session via the right-click menu; persisted server-side at `~/.claude/jupyterlab_claude_code_extension.json`
- **Layout restorer** - panel visibility persists across JupyterLab reloads
- **Auto-disabled** when the `claude` binary is not on `PATH`
- **Hover tooltip** with relative path (vs JL root), last activity, message count, branch, first prompt, session id

## Requirements

- JupyterLab >= 4.0.0
- Python >= 3.10
- `claude` CLI on `PATH`

## Install

Developers must install via the project `Makefile` (which orchestrates clean, build, and pip install of the resulting wheel):

```bash
make install
```

End-users can install the published package from PyPI:

```bash
pip install jupyterlab_claude_code_extension
```

## Uninstall

```bash
pip uninstall jupyterlab_claude_code_extension
```
