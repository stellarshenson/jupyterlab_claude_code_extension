# Acceptance Criteria - Statusline CLI

Companion CLI `jupyterlab_claude_code install-claude-statusline` installs the powerline statusline from its home project (https://github.com/stellarshenson/claude-code-statusline) into the user's Claude directory and wires `statusLine` in settings. The script is NOT vendored - it is downloaded from the repo at install time.

- [x] **Entry point** - `jupyterlab_claude_code` console script ships with the package (`[project.scripts]`); `install-claude-statusline` subcommand present in `--help`
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Confirmation** - the command states the download URL and target paths, then asks `Proceed? [y/N]`; anything but y/yes aborts with no side effects; `-y/--yes` skips the prompt
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Download from repo** - script fetched from the claude-code-statusline GitHub raw URL at run time, never bundled in the wheel
  - log: 2026-06-12 criterion added; vendored copy from the first iteration removed
  - log: 2026-06-12 implemented, pending release
- [x] **Install** - script written to `<claude-dir>/statusline-command.sh`, marked executable; `--claude-dir` overrides the default `~/.claude`
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Settings wiring** - `statusLine` block (`type: command`, `command: bash <path>`, `padding: 0`) merged into `settings.json`, all other settings preserved; file created when absent
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: invalid settings.json** - existing file that is not a JSON object -> error exit 1, file left untouched
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: non-script response** - download that does not start with `#!` (e.g. an HTML error page) -> error, nothing installed
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: existing statusline** - re-running overwrites the script and statusLine block (idempotent install)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
