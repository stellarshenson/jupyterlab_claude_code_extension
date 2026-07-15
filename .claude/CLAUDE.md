<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file imports workspace-level configuration from `/home/lab/workspace/.claude/CLAUDE.md`.
All workspace rules apply. Project-specific rules below strengthen or extend them.

The workspace `/home/lab/workspace/.claude/` directory contains additional instruction files
referenced by CLAUDE.md. Consult workspace CLAUDE.md and the .claude directory to discover
all applicable standards.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Project Context

`jupyterlab_claude_code_extension` is a JupyterLab 4 extension that adds a Claude Code session
management panel to the JupyterLab UI. It exposes recent, all, and favourite Claude Code sessions,
indicates whether a session is enabled for remote control, allows session removal via context menu,
and opens Claude Code in a terminal at the session's directory when clicked.

**Technology Stack**:

- TypeScript + Lumino frontend (`src/`) packaged as an `npm` labextension
- Python `jupyter_server` extension (`jupyterlab_claude_code_extension/`) providing the backend API
- `hatchling` + `hatch-nodejs-version` + `hatch-jupyter-builder` for build orchestration
- `jlpm` (JupyterLab's pinned yarn) for JavaScript dependency management
- `pytest` for server tests, `jest` for frontend unit tests, `Playwright` + Galata for UI integration tests

**Runtime requirements**:

- Python `>= 3.10`
- JupyterLab `>= 4.0.0`
- `jupyter_server >= 2.4.0, < 3`

## Required Workspace Skills

The following skills MUST be referenced and applied to relevant work in this project. They live
under `/home/lab/workspace/.claude/skills/` and are also auto-discovered globally by Claude Code:

- **`jupyterlab-extension`** at `/home/lab/workspace/.claude/skills/jupyterlab-extension/` -
  JupyterLab extension development guidelines, testing strategy, jupyter-releaser CI/CD workflows,
  TypeScript compatibility caveats, syntax-highlighting integration, and local development
  patterns. MUST be consulted for any change to `src/`, `schema/`, `style/`, `package.json`,
  `pyproject.toml`, `.github/workflows/`, or anything affecting build / install / release flow

- **`playwright`** at `/home/lab/workspace/.claude/skills/playwright/` - Playwright MCP browser
  automation for inspecting web UIs, serving and viewing local files, testing SVGs/HTML, and
  connecting to authenticated services like JupyterHub. MUST be used when validating UI changes,
  capturing README screenshots, reproducing UI bugs, or running ad-hoc visual regression checks

## Makefile Version Pin

The local `Makefile` is sourced from a canonical workspace template:

- Canonical path: `/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile`
- Current pinned version: **1.34** (project-local `.nodeenv` on `--node=lts`, guarded `install_dependencies`; `build` formats lockfiles with `jlpm prettier` not `npx prettier`, and `check_dependencies` self-heals an empty `node_modules` via `jlpm install`). Note: `webpack` is pinned to `5.106.0` via both `resolutions` and `overrides` in `package.json`. webpack `>= 5.106.1` changed its module-federation share identifier from `name@version = request` to `name@version|request`, which crashes the unmaintained `license-webpack-plugin` (it parses with `split('=')[1].trim()`) that `@jupyterlab/builder` injects into every production build. This is a webpack-version issue, not a Node-version issue. `chalk` is also pinned to `4.1.2` (same two fields) to dedupe a duplicate `chalk@2.4.2` that `duplicate-package-checker-webpack-plugin` drags in and that crashes the build-isolation production build on Node 24+. See the `jupyterlab-extension` skill for the full root cause of both pins

**MANDATORY**: At the start of any session that touches build, install, release, or CI workflow
work, check the canonical Makefile's version header (line 1: `# Makefile for Jupyterlab extensions
version X.YZ`) against the local Makefile's version. If the canonical version is newer, update
the local Makefile to match before doing any other build-related work, and reflect the new
version in this section.

Quick check:

```bash
diff <(head -1 Makefile) <(head -1 /home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile)
```

If the headers differ, replace the local Makefile with the canonical one (preserving any
project-specific targets if they exist - currently there are none).

## Package Manifest Tracking

Both `package.json` AND `package-lock.json` MUST always be committed together:

- `package-lock.json` is **never** added to `.gitignore`
- The `Makefile` `build` target runs `npx prettier --write package-lock.json package.json` to
  keep both files formatted - any commit touching dependencies must stage both files
- When bumping a dependency or running `jlpm install`, always `git add package.json package-lock.json`

## Install Discipline

All package installation in this project MUST go through `make install`:

- `make install` orchestrates the correct sequence: `clean` -> `increment_version` -> `build`
  (`npm install`, `jlpm install`, `prettier`, `python -m build`) -> `pip install dist/*.whl --force-reinstall`
- Direct `pip install`, `jlpm install`, `npm install`, `yarn install` are **forbidden** for routine
  install work in this project - they bypass the version increment, the prettier pass, and the
  wheel-based reinstall that the Makefile guarantees
- `make install_dependencies` is the only hook for first-time tooling setup (nodeenv, twine, yarn, rimraf)
- Run `make help` to see all available targets

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the canonical tool for this file: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Direct edits to `JOURNAL.md` are a last resort - prefer the plugin so modus secundis format, continuous numbering and append-only order are enforced automatically

## Strengthened Rules

- **No emojis** anywhere in this project (workspace rule strictly enforced - extension UI text, README, code comments, journal entries)
- **No em-dashes, no arrow symbols** in any markdown - use `-` and `->` per workspace typography rules
- **`make install` is the only blessed install path** (see Install Discipline above)
- **Skills `jupyterlab-extension` and `playwright` are mandatory references** for source / UI / CI work (see Required Workspace Skills above)
- **Makefile version pin** must be re-checked every session touching build flow (see Makefile Version Pin above)
