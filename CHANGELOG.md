# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

<!-- <END NEW CHANGELOG ENTRY> -->

## [1.2.53] - 2026-07-23

### Added

- The filter box now has a clear button. As soon as you type, a small x appears at the right-hand end of the field; clicking it empties the filter and leaves the cursor in the box so you can type the next query straight away. The button shares the field's background so it reads as part of the input rather than a control sitting on top of it, and it stays hidden while the box is empty

## [1.2.51] - 2026-07-23

### Fixed

- Installing the extension now pulls in the `jupyterlab_colourful_tab_extension` companion automatically, so a fresh install works on its own. The tab-colouring added in 1.2.42 consumes that companion's colour token as a required shared singleton, so when it was absent the whole panel failed to load rather than just going without a tint; declaring it as a package dependency guarantees it is always present. This also restores the release build, which had been failing since 1.2.49

## [1.2.50] - 2026-07-17

### Added

- Coloured terminal tabs can now be turned off. A new "Coloured terminal tabs" setting controls whether a terminal running Claude has its tab tinted with the conversation's colour; it is on by default, so nothing changes unless you turn it off. Switching it off drops the tint from Claude terminals straight away rather than at the next reload, and only tabs running Claude are touched, so a tint you set by hand on another tab is left alone

## [1.2.49] - 2026-07-16

### Fixed

- A terminal tab no longer loses its colour after a while. The tab now takes the colour of the Claude conversation it is actually running, read from that conversation itself. Previously the colour was looked up through the project's entry in the panel, which tracks only the project's most recent conversation - so once a background worker started a newer one, an open terminal matched nothing and its tint was cleared. This was a regression introduced in 1.2.45 (DEF-11)

### Changed

- Colour selection moved into its own module so it can be properly tested. The tab-colour feature had no test coverage at all, which is how two colour bugs (DEF-10, DEF-11) shipped unnoticed; it is now covered

## [1.2.48] - 2026-07-16

### Changed

- Version alignment release - no functional change. The extension code is identical to 1.2.45. Versions 1.2.46 and 1.2.47 were local build increments only and were never published; this release brings the published version back in line with the local lineage

## [1.2.45] - 2026-07-15

### Fixed

- Clicking a project row whose Claude session is already open in a terminal you started yourself (with `claude -c` or plain `claude`) now focuses that terminal instead of opening a second one. Previously the panel recognised only the terminals it had launched, so a session you opened yourself was not reused and a duplicate was spawned. The panel now reads each running terminal's real session id from Claude's own session file, so a terminal is reused however it was started (DEF-9)

## [1.2.44] - 2026-07-15

### Fixed

- The panel no longer spills harmless "Uncaught (in promise)" errors into the browser console. Opening a Claude terminal, or opening and switching branches, dismisses a short-lived dialog whose teardown JupyterLab reports as an unhandled rejection - those teardowns are now caught. A few background actions (switching a branch, opening a terminal or the file browser at a session's folder) also route any failure through the panel's own error handler instead of surfacing as console spill

## [1.2.43] - 2026-07-15

### Fixed

- Terminal tabs for Claude sessions opened outside the panel now take their session colour too. Previously only sessions launched or resumed through the panel were tinted, so a terminal you opened yourself stayed uncoloured even though the panel already knew its colour. The colour is now applied to every open Claude terminal and kept in sync on each refresh (DEF-10)

## [1.2.42] - 2026-07-13

### Added

- Each Claude session's colour (set with `/color`, or auto-assigned) now tints its terminal tab in JupyterLab, so open sessions are easy to tell apart at a glance. The colour is read from the session and applied to the tab automatically. This needs the companion `jupyterlab_colourful_tab_extension` (1.0.19 or later), which provides the tab-colouring API

## [1.2.41] - 2026-07-03

### Fixed

- The green "remote control active" indicator no longer stays lit for a bridged session that has gone idle - it now requires the session to have been active within the last hour, not just to carry a bridge id. Claude leaves the bridge id set on a session after remote control ends and the process keeps running, so a session last active many days ago used to falsely show the indicator (DEF-8)

## [1.2.40] - 2026-07-01

### Fixed

- The divider line in the row context menu (under "Copy Session ID") no longer renders as two misaligned segments - the line under the icon column now sits at the same height as under the text and reads as one continuous rule

### Changed

- The "Add to Favorites" / "Remove from Favorites" context-menu item now shows a star icon, matching the other actioned items in the menu

## [1.2.39] - 2026-07-01

### Changed

- The panel now docks to the right sidebar by default (was left), so it no longer crowds the file browser. The "Sidebar position" setting still offers both sides, and any explicit choice you have already made is kept

## [1.2.38] - 2026-07-01

### Changed

- The presentation-mode setting's default option is now called `name` (was `folder`) - it has always shown the session name Claude records for a project, with the project folder name used as the initial name, so the option is now named for what it does. Existing settings that still say `folder` keep working and resolve to the same `name` mode

## [1.2.37] - 2026-07-01

### Fixed

- The green "remote control active" indicator no longer lights for a session that is merely running - it now marks only sessions genuinely under Claude's remote control. A plain interactive `claude` in a terminal registers a live process but is not remotely controllable, and used to falsely show the indicator (DEF-7)

## [1.2.36] - 2026-06-25

### Changed

- The favourite star beside starred rows is now a quiet, dimmed gray marker instead of a bright gold one - it no longer competes with the row text for attention

## [1.2.35] - 2026-06-24

### Changed

- Rebuilt the "Manage Sessions" popup in the Duoptimum Hub design language, driven by the active JupyterLab theme so a light/dark/custom theme flip restyles the whole screen: the conversation list is now a surface card with hairline-separated rows, the search box has an accent focus ring, "Open" is an outlined-accent button and "Copy" a quiet wireframe icon, and times read in a tabular figure column
- The "Delete" button is now an outline in every state - a neutral inactive outline when nothing is selected, a lit error outline once conversations are selected, and a soft error tint on hover (no longer a solid fill) - and the time and "current" labels are more legible (they no longer wash out against the row backgrounds in dark themes)

## [1.2.34] - 2026-06-23

### Fixed

- Creating a branch (Branch Session) now makes the new conversation the row's current one as soon as it exists, instead of leaving the row on the parent conversation you branched from - the branch is pinned at creation (the same durable mechanism a manual switch uses), so the actively-used parent no longer overtakes it by recency and drags the row back

## [1.2.33] - 2026-06-22

### Fixed

- Clicking a session row you switched to another conversation now lands you in that conversation, instead of focusing an open terminal still running a different one - terminal reuse requires a positive conversation-id match and never reuses a terminal whose conversation it cannot identify (such as a claude started with `-c`/`--continue` or a bare `claude`)
- Switching a conversation is now durable: the panel no longer reverts the row to the most-recently-active conversation after a refresh; the choice is held by a per-project pin, and starting a new session clears it

### Changed

- A new session now launches with an explicit session id (`claude --session-id <uuid>`), so its terminal is always identifiable when you click its row again
- The "Manage Sessions" popup marks the current conversation with plain "current" text (previously a boxed uppercase chip that over-emphasised it) and now exposes `aria-current` for assistive tech

## [1.2.26] - 2026-06-22

### Added

- "Open Branched Conversation" right-click submenu (the 5 most recent branches) and a per-row "Open" button in the Manage Sessions popup - open any of a project's conversations directly in its own terminal; several branches can be open side by side, opening one never disturbs another

### Fixed

- Clicking a row after switching it to another conversation now opens the switched conversation instead of refocusing the terminal still running the original one; terminal reuse is now conversation-aware (it reuses a terminal only when it is already running the conversation you clicked)

### Changed

- A newly created branch session now appears in the panel within seconds (a short-lived fast watcher polls for it once it is requested) instead of waiting for the periodic 30-second refresh

## [1.2.25] - 2026-06-22

### Changed

- The "Manage Sessions" popup is now a scrollable table with the current conversation pinned at the top and clearly accented (brand-coloured left bar and a bold "CURRENT" chip) instead of being dimmed
- Deleting sessions in the "Manage Sessions" popup is now a single click that moves them to trash and reports "N moved to trash" - no confirmation dialog; confirmation is kept only for project-level "Remove from Claude" and "Clean Up Parallel Sessions"

### Fixed

- The popup's delete no longer opens a second dialog that rendered detached from the popup; deletion now reads back the conversation list from disk so the table stays accurate

## [1.2.24] - 2026-06-21

### Changed

- Internal docs only: simplified the project's defect-tracking document format (Contents TOC over flat DEF-N sections, no Open/Fixed split); no functional or packaged change

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
