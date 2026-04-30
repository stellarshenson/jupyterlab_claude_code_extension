# jupyterlab_claude_code_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_claude_code_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_claude_code_extension.svg)](https://www.npmjs.com/package/jupyterlab_claude_code_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab_claude_code_extension.svg)](https://pypi.org/project/jupyterlab_claude_code_extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab_claude_code_extension)](https://pepy.tech/project/jupyterlab_claude_code_extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Manage Claude Code CLI sessions from inside JupyterLab. A side panel lists your recent, all, and favourite Claude Code sessions, shows which ones are enabled for remote control, and lets you jump straight back into a session by opening Claude Code in a terminal at the session's directory.

## Features

- **Session panel** - dedicated JupyterLab side panel listing recent, all, and favourite Claude Code sessions
- **Remote control indicator** - inline marker showing which sessions are currently enabled for remote control
- **One-click resume** - click a session to open Claude Code in a terminal at that session's working directory and continue
- **Context menu management** - right-click a session to remove it from the list
- **JupyterLab 4 native integration** - uses the standard Lumino sidebar, commands, and context-menu surfaces

## Requirements

- JupyterLab >= 4.0.0
- Python >= 3.10

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
