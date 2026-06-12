# jupyterlab_claude_code_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_claude_code_extension.svg)](https://www.npmjs.com/package/jupyterlab_claude_code_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab_claude_code_extension.svg)](https://pypi.org/project/jupyterlab_claude_code_extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab_claude_code_extension)](https://pepy.tech/project/jupyterlab_claude_code_extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Browse, resume, and manage your Claude Code sessions from a JupyterLab side panel. One click reactivates the right terminal, no duplicate tabs, with a live indicator showing which sessions are currently active.

![Claude Code Sessions panel](.resources/screenshot.png)

## Features

- **Three-section side panel** - Favorites, Recent, and All projects, each scrolling independently
- **Live indicator** - a green dot marks sessions that are currently running somewhere
- **One-click resume** - click a row to jump back into that session in a terminal. If a terminal for the project is already open, it's reused instead of duplicated
- **Favorites** - star projects you keep coming back to via the right-click menu
- **Remove** - drop a project's Claude history from the panel via the right-click menu; the history folder is moved to the trash (it honours JupyterLab's "move files to trash" setting), not deleted permanently
- **Clean up parallel sessions** - when a project has accumulated extra sessions beyond the main one, a right-click menu item (showing the count in brackets) removes them all, keeping only the main session; removed files honour the same trash setting
- **Switch conversation branch** - a right-click submenu lists a project's other conversations (5 most recent, with a searchable "More..." popup for longer lists) and switches the row's current one; rows with multiple conversations show the count in brackets after the name, e.g. `workspace (2)`
- **Search** - fuzzy filter toggled by the funnel button next to refresh
- **Presentation modes** - label rows by session name (so a `/rename` shows through), folder name, or path relative to the JupyterLab root
- **Hover tooltip** with project path, last activity, message count, branch, and session id
- **Auto-disabled** when the Claude Code CLI is not installed

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

> [!WARNING]
> `package.json` pins `webpack: 5.106.0` and `chalk: 4.1.2` in both `resolutions` and `overrides`. Do not remove these. webpack `>= 5.106.1` changed its module-federation share identifier format and crashes the unmaintained `license-webpack-plugin` (`split('=')[1].trim()`) that `@jupyterlab/builder` injects into every production build; the duplicate `chalk@2.4.2` pulled by `duplicate-package-checker-webpack-plugin` crashes on Node 24+ in the build-isolation install. Without the pins, `make publish` and CI fail on `python -m build`.

## Uninstall

```bash
pip uninstall jupyterlab_claude_code_extension
```
