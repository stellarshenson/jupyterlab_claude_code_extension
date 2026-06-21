# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.2.23] - 2026-06-21

### Added

- "Copy Session ID" right-click menu item that copies the row's current conversation id to the clipboard; the Manage Sessions popup also gains a per-row copy button so any parallel conversation's id can be copied without switching to it
- The refresh button now shows a spinner over the panel while it re-reads the session list; the background 30s auto-poll stays silent (no spinner)

### Fixed

- Branching a session no longer shows a false "name could not be applied - use /rename" warning: the name is owned by `claude -n` and applied on the session's first turn, so the obsolete post-launch title poll that warned while Claude had not yet written the fork's file was removed

## [1.2.22] - 2026-06-17

### Fixed

- Branch Session now keeps the name you give it: the fork launches with `claude -n <name>` so claude owns the display name and re-stamps it every turn, instead of the name reverting to the parent conversation's title

## [1.2.21] - 2026-06-17

### Changed

- "Clean Up Parallel Sessions" now asks for confirmation before removing: a dialog names the project and the count of parallel sessions to remove, with Cancel and a red Remove button; cleanup runs only on confirm
- Deleting individual sessions in the "Manage Sessions" popup now uses a confirmation dialog (naming the project and the count, Cancel and a red Delete button) instead of the inline two-step Delete button

## [1.2.20] - 2026-06-17

### Changed

- "Remove from Claude" now asks for confirmation before deleting: a dialog naming the project warns that the entire Claude project and all its conversations will be removed irreversibly, with Cancel and a red Remove button; removal proceeds only on confirm

## [1.2.19] - 2026-06-12

### Changed

- "Switch and Manage Sessions" submenu carries an arrow-switch icon (Octicons arrow-switch-16), matching the Branch Session submenu's icon treatment

## [1.2.17] - 2026-06-12

### Changed

- "Branch Session" is now a single context-menu submenu (branch icon) with "Normal" and "Skip Permissions" (shield icon) entries instead of two separate main-menu items; ellipsis dropped from the labels
- Time column tightened from 52px to a fixed 4em with nowrap (no more dead space between the favourite star and the time, no wrapped two-digit day labels bleeding into the next row)

### Fixed

- Favourite stars line up vertically across the entire panel: every row keeps the time slot (empty when a session has no recorded activity) and every section list reserves the scrollbar gutter, so a scrolling section no longer shifts its columns

## [1.2.12] - 2026-06-12

### Added

- Companion CLI `jupyterlab_claude_code install-claude-statusline`: downloads the powerline statusline from its home project (https://github.com/stellarshenson/claude-code-statusline) into `~/.claude` (or `--claude-dir`) after an explicit `Proceed? [y/N]` confirmation (`--yes` skips), marks it executable and merges the `statusLine` block into `settings.json` preserving all other settings; invalid existing settings JSON or a non-script download abort with nothing written
- README section documenting the statusline install one-liner

## [1.2.9] - 2026-06-12

### Added

- "Branch Session..." and "Branch Session (Skip Permissions)..." context-menu items: ask for a name, then fork the row's current conversation via claude's native `--fork-session` with a frontend-generated `--session-id`, opened in a new terminal; the chosen name is stamped as a `custom-title` record once the JSONL appears (new `POST sessions/set-title`, mtime preserved so titling never switches the current conversation) and the fork becomes the row's current conversation by recency
- Branch icon + total conversation count badge on rows with parallel conversations, replacing the plain `(N)` bracket text
- Design language reference `design-language.md` in the jupyterlab-extension skill, distilled from the share-files extension (spacing, JL colour variables, typography, radii, component patterns, jp-mod state classes)

### Changed

- Panel rows lay out as aligned columns: favourite star in its own column before a fixed-width right-aligned time column; the `now` label shares the recently-active brand colour; the live green dot softened to 0.75 opacity
- Branch popup restyled to the documented design language: 24px rows, 6px gaps, compact search input with brand focus border, aligned time column, compact delete button
- README repositioned: lead and "Why this extension" section present the extension as a full Claude Code launcher and manager for JupyterLab running the unmodified CLI harness, not just a session manager

### Fixed

- Switching to a same-project conversation no longer fails with "recorded folder does not match the project" when the branch's tail cwd is a subdirectory of the project: `_resolve_latest` now accepts subdirectory cwds via `_project_path_for_cwd` (slicing the project root back out for the row path) while still rejecting sibling-prefix dirs and foreign paths

## [1.2.7] - 2026-06-12

### Added

- Session deletion inside the switcher popup: checkbox per row (own click zone), select-all over the visible filtered rows, and a two-step `Delete (N)` -> `Confirm delete (N)` button; removed JSONLs and their subagent directories honour JupyterLab's move-to-trash setting, the popup refreshes in place and the panel row count drops
- The popup leads with the current conversation - badged `current`, unselectable and undeletable; while any checkbox is ticked, row clicks toggle selection instead of switching (no accidental switch mid-selection)
- Backend `POST sessions/delete-branches` endpoint; the current main session is never deleted and already-missing files are treated as deleted
- Row age emphasis: rows active within the last minute show the name in the theme's brand colour, rows idle for over a week dim slightly; acceptance criteria in `docs/acc-crit-row-age-emphasis.md`

### Changed

- The branch submenu is now titled "Switch and Manage Sessions (N)" and its "Manage Sessions... (N)" popup entry is always present - previously the popup was reachable only beyond 5 branches, leaving projects with 2-5 conversations without access to the full list

## [1.2.5] - 2026-06-12

### Changed

- Branch submenu and "More..." popup entries now show the conversation name plus the short session id in brackets, e.g. `home (3f2a1b9c)` - branches share the project path, so the name and id are what distinguish them; the suffix is skipped when the label already is the short-id fallback
- Acceptance criteria document converted to checklist format: `[ ]` / `[o]` / `[x]` states with an append-only `log:` line per criterion recording when it was addressed

## [1.2.4] - 2026-06-12

### Added

- Session rows show their last activity as a dim relative time next to the name: `now` within the last minute, then `<n>m ago` / `<n>h ago` / `<n>d ago`

### Changed

- The shared relative-time format (branch submenu, "More..." popup, tooltip) follows the same simple buckets: `just now` became `now` and dates older than 30 days read `<n>d ago` instead of a locale date

## [1.2.2] - 2026-06-12

### Added

- "Switch Conversation Branch" context-menu submenu: lists a project's other conversations (parallel session JSONLs) newest first, 5 most recent in the submenu, with a "More... (N total)" item opening a searchable popup over the full list; selecting one makes it the row's current conversation by touching its mtime, so recency resolution, parallel-session cleanup and claude's own --resume picker all agree
- Conversation count in brackets after the row name (e.g. `workspace (2)`) and a `Conversations: N` tooltip line, shown only when a project has more than one conversation
- Backend endpoints `GET sessions/branches` and `POST sessions/switch` (404 `branch_not_found` for a branch removed between menu display and click); branch labels prefer the custom title, then the index summary, then a short session id
- Acceptance criteria document `docs/acc-crit-branch-switching.md` covering the edge cases: removed branch, externally removed current conversation, switch to already-current, cwd-inconsistent branch
- Ten backend and eight frontend tests for the above

## [1.1.31] - 2026-06-12

### Fixed

- Session rows honour `/rename` again: current Claude Code persists the rename as a `custom-title` record in the session JSONL (the pid files' `name` stays null), so the backend now tail-scans the chosen JSONL for the last `customTitle` and prefers it over the pid-record name and the folder basename
- Three backend tests covering the new resolution (title honoured, title beats a stale pid name, tail scan of a large file)

## [1.1.29] - 2026-06-11

### Changed

- The two new-session header buttons are now a single plus button that opens a dropdown menu with "New Claude Session" and "New Claude Session (Skip Permissions)" (shield icon), styled like the row context menu
- Galata specs drive the dropdown: open it, assert both items, launch via the menu item and verify the terminal session

## [1.1.27] - 2026-06-10

### Added

- Two panel header buttons to start a brand-new Claude session in the file browser's current folder: a plus icon (normal) and a plus-with-shield icon launching with --dangerously-skip-permissions; both use the same no-shell launch path as resuming, just without --resume
- `launch-terminal` endpoint accepts an optional `session_id` - omitted means start a new session
- Galata UI tests: a fake `claude` binary on the test server's PATH so the panel registers in CI, specs covering the new header buttons and the click-to-terminal launch, and a `JLAB_TEST_PORT` override in the Playwright config for machines where 8888 is taken
- Backend tests for the launch endpoint (new session, resume with skip-permissions flag, blank session id rejected)

## [1.1.25] - 2026-06-10

### Added

- Cleanup of parallel sessions now runs inside a popup dialog with a progress bar: indeterminate while the request is in flight, filled with a "Removed N parallel session(s)." message on success, or a red "Cleanup failed" message on error; the Close button appears once the outcome is shown
- Five jest contract tests guarding the cleanup popup behaviour (progress element, footer toggle, success fill, error styling, post-success refresh)

## [1.1.23] - 2026-06-10

### Added

- Context menu item "Clean Up Parallel Sessions (N)" that keeps only the project's main session and removes the other session JSONLs plus their subagent directories, honouring JupyterLab's move-to-trash setting; hidden when a project has no extra sessions
- `extra_sessions` count per session row and `POST sessions/cleanup` backend endpoint

### Changed

- README feature list documents the cleanup item, the funnel-toggled search bar, and session-name labelling
