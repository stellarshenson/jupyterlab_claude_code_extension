# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

<!-- <END NEW CHANGELOG ENTRY> -->

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
