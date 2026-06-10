# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

<!-- <END NEW CHANGELOG ENTRY> -->

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
