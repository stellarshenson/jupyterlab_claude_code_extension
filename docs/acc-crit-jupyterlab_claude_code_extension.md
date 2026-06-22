# Acceptance Criteria - jupyterlab_claude_code_extension

Acceptance criteria for the whole plugin - one section per feature or panel behaviour. `[ ]` todo, `[x]` done; each criterion's indented `log:` lines are its dated evolution, appended never overwritten.

## Contents

- [Row Columns](#row-columns)
- [Row Age Emphasis](#row-age-emphasis)
- [Panel Refresh](#panel-refresh)
- [Branch Session](#branch-session)
- [Branch Switching](#branch-switching)
- [Sessions Management Screen](#sessions-management-screen)
- [Open Branched Conversation](#open-branched-conversation)
- [Copy Session ID](#copy-session-id)
- [Statusline CLI](#statusline-cli)

## Row Columns

Panel session rows lay out their trailing indicators as aligned columns instead of inline jumble: dot | name | favourite star | time. The fixed-width time column is the right-edge alignment anchor across all rows.

- [x] **Star column** - favourite star renders in its own column BEFORE the time column (child order: dot, name, star, time)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Time column** - time-ago label is a fixed-width (3.5em) right-aligned column so `now / 5m ago / 3d ago` values line up across rows
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
  - log: 2026-06-12 width narrowed 52px -> 3.5em (~40px; too much dead space between star and time, em so it scales with the font)
  - log: 2026-06-12 fixed width -> min-width 3.5em + nowrap (two-digit day labels like `13d ago` wrapped and bled into the next row)
  - log: 2026-06-12 min-width -> fixed width 4em + nowrap (variable column width made the star column drift per row)
- [x] **Star visibility rule unchanged** - star shown only when the session is favourited and outside the Favourites section
  - log: 2026-06-12 criterion added (pre-existing behaviour, restated for the new layout)
- [x] **Paler live dot** - the green remote-control dot is softened (opacity 0.75 over `--jp-success-color1`), keeping the glow but reading less loud next to row text
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Stars aligned panel-wide** - favourite stars line up vertically across the entire panel: time column is fixed-width (4em), every row keeps the time slot (empty when no `file_mtime`), and every section list reserves the scrollbar gutter (`scrollbar-gutter: stable`) so a scrolling section does not shift its columns
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: row without star or time** - rows missing the star (not favourited) or the time (no `file_mtime`) still align; name flexes, the always-present time slot anchors the right edge
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
  - log: 2026-06-12 time slot now always rendered (empty when no mtime) so the star column never slides right

## Row Age Emphasis

Session row name colour reflects last activity: rows active within the last minute read bright (cyan-ish), rows idle for over a week dim slightly, everything between stays normal.

- [x] **Recent emphasis** - last activity < 60 s -> row gets `jp-mod-recentlyActive`, name coloured `--jp-brand-color1` (theme-aware cyan); same threshold as the time formatter's `now` bucket
  - log: 2026-06-12 implemented
- [x] **Stale dim** - last activity > 7 d -> row gets `jp-mod-stale`, whole row at 0.65 opacity, still readable and clickable
  - log: 2026-06-12 implemented
- [x] **Normal band** - between 60 s and 7 d -> no age class, default colours
  - log: 2026-06-12 implemented
- [x] **Refresh-driven** - states decay/promote on the next panel refresh (poll or manual), no per-row timers
  - log: 2026-06-12 implemented
- [x] **Theme legibility** - emphasis and dim legible in dark and light JupyterLab themes (theme variables only, no hardcoded colours)
  - log: 2026-06-12 implemented
- [x] **Independent signals** - live green dot (remote control) and age emphasis are independent; a row can show both
  - log: 2026-06-12 implemented
- [x] **All sections** - favourites, recent, all and search results inherit the same styling (single row renderer)
  - log: 2026-06-12 implemented
- [x] **Edge: missing mtime** - missing/zero `file_mtime` -> no age class, normal colour
  - log: 2026-06-12 implemented
- [x] **Now label colour** - the `now` time label is rendered in `--jp-brand-color1` via the `jp-mod-recentlyActive` class, same colour as the emphasised name (the `now` bucket and the class share the <60 s threshold)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release

## Panel Refresh

The panel auto-polls the backend every 30 s and reads on-disk truth (`cache: 'no-store'`). The manual refresh button forces an immediate full re-poll and signals it with a spinner in the panel body; the background poll stays silent so the panel never flickers on its own.

- [x] **Forced re-poll** - clicking the refresh button triggers an immediate full `_fetch` (no-store), independent of the 30 s poll timer
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `refresh()` calls `_fetch()` directly, jest contract green
- [x] **Panel-body spinner** - while a manual refresh is in flight a spinner shows in the panel body; it clears when the fetch resolves (success or error)
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - full-panel veil (`_loadingEl`) raised by `_setLoading(true)`, cleared in `refresh()`'s `finally`
- [x] **Background poll silent** - the periodic 30 s poll does NOT show the panel-body spinner; the body spinner is reserved for the explicit refresh (normally not required)
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `_startPolling` calls `_fetch()` directly, never `_setLoading`; jest asserts the poll body contains no `_setLoading`
- [x] **Minimum visible duration** - the spinner stays visible long enough to read (the existing ~500 ms floor on the refresh action), even though `_fetch` is filesystem-fast
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `minSpin` 500 ms floor retained, now also gates the body veil
- [x] **Veil hides correctly** - the veil starts hidden and is toggled via the `hidden` attribute; the CSS rule is gated on `:not([hidden])` so an author `display` never beats the UA `[hidden] { display: none }` and pins the veil permanently on
  - log: 2026-06-21 criterion added after adversarial review caught the un-gated rule (CRITICAL: veil stuck visible, blocking all clicks); fixed with `:not([hidden])`, regression-guarded in jest, round 2 SHIP
- [x] **Edge: refresh during background poll** - a manual refresh while a background poll is mid-flight still forces its own fetch and raises the veil; the veil lives on the root so a concurrent `_render` (body wipe) never removes it; last render wins, no lost update
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - veil appended to root not body; adversarial review confirmed `_render` cannot wipe it
- [x] **Edge: error during forced refresh** - if the forced fetch errors, the body veil clears and the error surfaces as it does today; the panel is not left spinning
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `_fetch().catch(...)` inside the `Promise.all`, `_setLoading(false)` in `finally`

## Branch Session

Context-menu action forks the row's current conversation into a new named session using claude's native fork (`claude --resume <current> --fork-session --session-id <new uuid> -n <name>`), opened in a new terminal. The fork's uuid is generated by the frontend; the name is owned by claude via `-n` (it writes the chosen name as a `custom-title` record on its first turn and re-stamps every turn).

- [x] **Menu items** - context menu offers a "Branch Session" submenu (branch icon) with two entries: "Normal" and "Skip Permissions" (shield icon), mirroring the + button's two launch modes; no ellipsis on the labels
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
  - log: 2026-06-12 two main-menu items collapsed into one submenu, ellipsis dropped
- [x] **Name popup** - selecting either item opens a name input dialog; cancel or empty name aborts with no side effects
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented via InputDialog.getText, pending release
- [x] **Fork launch** - confirm launches a terminal at the project path running `claude --resume <current> --fork-session --session-id <uuid> -n <name>`; skip-permissions mode appends `--dangerously-skip-permissions`
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
  - log: 2026-06-21 `-n <name>` added to the launch argv (v1.2.22)
- [x] **Becomes current** - the forked JSONL is the project's newest, so the recency resolution makes it the row's current conversation without an explicit switch
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented (by construction, no extra code), pending release
- [x] **Name ownership** - the chosen name is forced by `claude -n <name>`; claude writes it as a `custom-title` record on its first turn and re-stamps it every turn, so it sticks even though the fork inherits the parent's title; no post-hoc `set-title` append is involved
  - log: 2026-06-21 criterion added - supersedes the obsolete "Name stamping" via `sessions/set-title`; DEF-1
  - log: 2026-06-21 implemented - set-title poll + false warning removed, name owned by `claude -n`; jest 43 + pytest 79 green, adversarial review SHIP
- [x] **Branch badge** - rows with more than one conversation show a branch icon plus total count after the name (replaces the plain `(N)` bracket text)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: fork JSONL is lazy** - claude materialises `<forkId>.jsonl` only on the first user turn in the new session, not at launch; until then the panel cannot list the branch (it reads on-disk truth); a fast watcher polls for the file and refreshes the row the moment it appears (see Open Branched Conversation "Fast refresh after fork"), not on the slow poll; no warning is shown for the gap
  - log: 2026-06-22 updated - fork now triggers a bounded fast watcher so the branch surfaces in seconds once it exists, instead of waiting for the 30 s poll
  - log: 2026-06-21 criterion added - DEF-2; confirmed empirically (file absent through 20 s idle; claude rejects a pre-seeded id with "Session ID ... is already in use", so the file cannot be created ahead of time)
  - log: 2026-06-21 implemented - false warning removed; gap documented as a claude limitation (wontfix-external), mitigated by the forced refresh re-poll
- [x] **Edge: fork without session id** - backend rejects `fork_session_id` without `session_id` (400 `invalid_fork_session_id`)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release

### Branch Session - Notes

- Fork mechanism is claude's own `--fork-session` (battle-tested) rather than a JSONL copy; the name is owned by `claude -n`, so no on-disk title write by the extension is needed
- The fork's JSONL is created lazily by claude on the first turn; the extension cannot pre-create it (claude refuses a session id whose file already exists) nor force the first turn, so the branch becomes visible only after the user interacts - this is a claude limitation, not an extension bug (DEF-2)
- Main vs branch has no intrinsic marker in claude's data - "main" is whatever the recency resolution picks; the popup badges it `current`
- The obsolete `sessions/set-title` endpoint and its `_stampForkTitle` poll were removed once `-n` took over naming (DEF-1); they only ever existed as the pre-`-n` naming path and their 30 s timeout produced a false failure warning

### Branch Session - API

- `POST launch-terminal` body gains optional `fork_session_id` (requires `session_id`) and optional `name` -> argv `--resume <sid> --fork-session --session-id <fork id> -n <name>`; 400 `invalid_fork_session_id`, 400 `invalid_name` for a blank name

## Branch Switching

Context-menu submenu switches a project's current conversation to another branch (parallel session JSONL). Persistence = touch selected JSONL mtime; recency resolution, cleanup and `claude --resume` picker all agree, no extra state.

- [x] **Submenu** - row with >1 conversation JSONL shows "Switch and Manage Sessions (N)" in context menu, N = count of other conversations; hidden when the project has a single session
  - log: 2026-06-12 implemented as "Switch Conversation Branch" (v1.2.2)
  - log: 2026-06-12 renamed to "Switch and Manage Sessions (N)" for the manage/delete scope, pending
  - log: 2026-06-12 implemented, pending release
- [x] **List** - other conversations only, newest first, max 5 in submenu; label = custom title > index summary > short session id, plus relative time
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Names** - submenu and popup entries display conversation names, never the project path (all branches share it); name resolution per List label rule
  - log: 2026-06-12 implemented, pending release
- [x] **Id** - entries show the short session id in brackets after the name, e.g. `home (3f2a1b9c)`; suffix skipped when the label already is the short id fallback
  - log: 2026-06-12 implemented, pending release
- [x] **Manage entry** - "Manage Sessions... (N)" submenu item always present (any branch count), opens the popup; the popup is the management hub and must be reachable even with 2-5 conversations
  - log: 2026-06-12 implemented as "More... (N total)", shown only at >5 branches (v1.2.2)
  - log: 2026-06-12 reworked to always-present "Manage Sessions... (N)", pending
  - log: 2026-06-12 implemented, pending release
- [x] **More** - popup shows full branch list, browse + search over large lists, clicking an entry switches
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Switch** - selected JSONL becomes current; row session id / name / summary / recency update on refresh; click-to-resume opens it
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Count** - row name shows the total conversation count, only when N > 1; tooltip gets `Conversations: N` line
  - log: 2026-06-12 implemented as `name (N)` bracket text (v1.2.2)
  - log: 2026-06-12 display changed to branch icon + count badge (see Branch Session), pending release
- [x] **Edge: branch removed before click** - switch returns 404 `branch_not_found`, panel shows error, refreshes; no row points at missing file
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: current JSONL removed externally** - next most recent becomes current on next refresh
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: switch to already-current** - no-op success
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: cwd-inconsistent branch** - cannot become current (`_resolve_latest` skips it); response reports resolved session, panel warns
  - log: 2026-06-12 implemented (v1.2.2)
  - log: 2026-06-12 semantics narrowed to genuinely foreign cwds - subdirectory cwds now consistent (see Subdir cwd)
- [x] **Subdir cwd** - branch whose recorded cwd is a subdirectory of the project path is legitimate and can become current; the row's project path stays the project root, not the subdirectory
  - log: 2026-06-12 criterion added after real-world failure (tail cwd in `experiments/grounding` subfolder blocked switch)
  - log: 2026-06-12 implemented via `_project_path_for_cwd`, pending release
- [x] **Edge: sibling-prefix dir** - cwd `/x/foo-bar` does not match project `/x/foo`; the character after the project path must be a real `/`
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup opens management** - "Manage Sessions... (N)" opens the management popup; the popup's table layout, current-row accent, selection and delete behaviour live in [Sessions Management Screen](#sessions-management-screen)
  - log: 2026-06-12 implemented as the switch popup (v1.2.2)
  - log: 2026-06-21 popup management criteria moved to the Sessions Management Screen section (UX redesign)

### Branch Switching - Notes

- The 5 inline submenu items exist to minimise clicks when switching between often-used sessions - right-click -> pick, two interactions total; the popup is the fallback for everything beyond the recent 5 and for management
- Division of responsibility: "Clean Up Parallel Sessions (N)" stays the comprehensive one-shot removal (extras plus subagent directories, no selection); the switch popup is targeted - switch first, delete individual sessions second. The two code paths stay separate by design

### Branch Switching - API

- `GET sessions/branches?encoded_path=...` -> `{current, total, branches: [{session_id, file_mtime, label}]}`
- `POST sessions/switch` body `{encoded_path, session_id}` -> `{requested, current}`; 404 `branch_not_found`, 400 invalid input
- `POST sessions/delete-branches` body `{encoded_path, session_ids: [...]}` -> `{removed_count}`; 400 invalid input

## Sessions Management Screen

The "Manage Sessions" popup (opened from the row context menu) is a scrollable table of a project's conversations - switch, copy id, select and delete. The current conversation is pinned and accented; deleting selected conversations is immediate (no confirmation) because they move to trash and a stacked dialog renders detached.

- [x] **Dialog title** - the popup is a Lumino `Dialog` titled "Manage Sessions" with a single Cancel/Close button
  - log: 2026-06-21 criterion added - retitled from "Switch and Manage Sessions" (UX redesign)
- [x] **Table layout** - a search box, a header strip (select-all on the left, conversation count on the right), then a bordered scrollable list with aligned columns: select cell, name + short id, last-activity time, copy button
  - log: 2026-06-21 criterion added; supersedes the flat popup list (UX redesign)
- [x] **Current pinned + accented** - the current conversation is pinned at the top of the scroll area (`position: sticky`), accented with a `--jp-brand-color1` left bar, a `--jp-layout-color2` background and an uppercase brand "current" chip; its name reads at normal emphasis (not dimmed); it carries an empty select cell so the name column stays aligned, and it cannot be selected or deleted
  - log: 2026-06-21 criterion added - replaces the dimmed first-row badge that read as inactive (UX redesign)
- [x] **Switch** - clicking a non-current row while nothing is selected switches to that conversation and closes the popup
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Select** - a per-row checkbox (its own click zone) selects one or many; select-all toggles the visible (filtered) non-current rows; selection survives filtering; the footer shows "N selected"
  - log: 2026-06-21 implemented (carried from the switch popup), footer count added
- [x] **Selection mode** - while anything is selected, row clicks toggle selection instead of switching, until the selection is emptied
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Delete: no confirmation** - the footer "Delete (N)" button (error-coloured, disabled when nothing is selected) removes the selected conversations immediately, with NO confirmation dialog; their JSONLs plus subagent directories move to trash (honouring JupyterLab's setting); the table and the panel row count refresh in place
  - log: 2026-06-21 criterion added - the prior confirmation dialog stacked a second Lumino dialog on the popup and rendered detached; removed it (UX redesign); confirmation now lives only on Clean Up Parallel Sessions and Remove from Claude
- [x] **Confirmation policy** - confirmation dialogs are used ONLY for "Clean Up Parallel Sessions" and "Remove from Claude" (the bulk / whole-project destructive actions); per-conversation delete in this screen is not confirmed
  - log: 2026-06-21 criterion added (UX redesign)
- [x] **Delete feedback + recoverability** - replacing the confirmation with feedback (not a prompt): after a delete the footer shows a polite `aria-live` status "N moved to trash"; the Delete button's tooltip states deletions move to the trash (recoverable); a failed delete still surfaces an error toast (`_deleteBranches`)
  - log: 2026-06-21 criterion added after the UX adversarial review flagged immediate delete had no recoverability cue or feedback
- [x] **Accessibility** - each row checkbox has an `aria-label` ("Select <name>"); the list region is labelled "Conversations"; the select cell is a >=24px hit target that toggles the checkbox (WCAG 2.2); the delete status is announced via the polite live region
  - log: 2026-06-21 criterion added after the UX adversarial review (unlabeled checkboxes, sub-24px target, no announcement)
- [x] **Focus retained on delete** - after a delete the focused row is destroyed by re-render, so focus is moved to the select-all checkbox (a real control with a reliable keyboard ring), unless the user is still typing in the search box; keyboard focus stays inside the dialog
  - log: 2026-06-21 criterion added after the UX adversarial review (focus dropped to body)
  - log: 2026-06-21 target changed search -> select-all after the review (text-input refocus / unreliable :focus-visible on a scripted tabindex park)
- [x] **In-flight lock** - while a delete is running the whole popup body is scrimmed (pointer-events none, dimmed) and the select-all, search and row-checkbox handlers no-op, so a slow backend cannot be double-clicked or re-ticked into a race; the button reads "Deleting..." with aria-busy on the list region; the lock always clears (terminal catch) so the button never sticks disabled; the Dialog Cancel button stays usable
  - log: 2026-06-21 criterion added across the UX adversarial review rounds (double-click delete, mid-flight selection discard, stuck-disabled button)
- [x] **Copy id** - every row, including the pinned current one, carries a copy button that copies that conversation's session id without selecting or switching
  - log: 2026-06-21 implemented (see Copy Session ID)
- [x] **Filter** - the search box filters by name or session id; select-all and delete act on the filtered set; an empty hint shows when nothing matches
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Edge: no other conversations** - only the pinned current row shows, with a "No other conversations." hint; nothing to select or delete
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Edge: delete leaves only current** - after deleting all others, the table shows just the pinned current row; the panel row count drops to the plain name
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Edge: delete fails** - a failed delete notifies via an error toast; the list resyncs from the server (`_deleteBranches` always `_fetch`es in `finally`)
  - log: 2026-06-21 implemented (carried from the switch popup)
- [x] **Edge: delete already-removed branch** - file gone before delete -> treated as deleted, no error, list refreshes
  - log: 2026-06-12 implemented (v1.2.7), carried into the redesign
- [x] **Open per row** - every row (current + branches) carries an "Open" button that launches that conversation in its own terminal and closes the popup; behaviour detailed in [Open Branched Conversation](#open-branched-conversation)
  - log: 2026-06-22 criterion added, implemented pending release

## Open Branched Conversation

A context submenu and a per-row popup action open any of a project's conversations directly in its own terminal. Terminal reuse is conversation-aware - a click lands you in the clicked conversation, never a different one - and several branches can be open at once.

- [x] **Open submenu** - the context menu offers an "Open Branched Conversation (N)" submenu (terminal icon) listing the 5 most recent branches; it coexists with the "Switch and Manage Sessions" submenu (open does not replace switch)
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Open launches directly** - picking a branch launches a terminal running `claude --resume <id>` at the project path (honouring the skip-permissions toggle); no switch step
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Manage entry** - the open submenu ends with "Manage Sessions..." so the full list (and per-row open) is reachable from it
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Independent terminals** - opening branch B never disturbs branch A's terminal; multiple branches of one project can be open side by side
  - log: 2026-06-22 criterion added after user emphasised branches must open independently
- [x] **Conversation-aware reuse** - a row click / branch open reuses an open terminal ONLY when it is already running that exact conversation; a terminal running a known different conversation is never reused
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Switch-then-click fixed** - after switching the row to a different branch, clicking the row opens a NEW terminal on the switched branch instead of focusing the pre-switch terminal still running the original conversation (the reported defect)
  - log: 2026-06-22 criterion added after the bug report; see [defects-branch-session.md](defects-branch-session.md) DEF-3
- [x] **Strict vs lenient reuse** - row resume (current conversation) is lenient: a terminal whose conversation id is unknown (started without `--resume`) is reused, avoiding a `claude --resume` "already in use" error; Open Branched Conversation is strict: an unknown terminal is left alone and a new one launched, so the user lands in the specific branch
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Backend conversation id** - `terminal-cwd` reports the running claude's conversation id from its argv (`--session-id` for a fork, else `--resume`, else null for a fresh session)
  - log: 2026-06-22 criterion added, implemented pending release
- [x] **Fast refresh after fork** - once a fork is requested, the panel watches for the new branch JSONL at a fast cadence (2 s, bounded to ~3 minutes) and refreshes the moment it appears, instead of waiting for the 30 s poll; it only refreshes after the branch genuinely exists on disk
  - log: 2026-06-22 criterion added after user asked for quick UI update on branch creation
- [x] **Edge: same branch opened twice** - the second open focuses the existing terminal (exact-match reuse), not a duplicate
  - log: 2026-06-22 criterion added, implemented pending release
- [ ] **Edge: open a branch that is live in a fresh (no-resume) terminal** - strict open spawns `claude --resume <id>`, which claude rejects as "already in use"; the error surfaces as a toast (rare; accepted over silently focusing the wrong conversation)
  - log: 2026-06-22 criterion added; documented trade-off, not yet exercised by a test
- [x] **Edge: non-linux / no /proc** - the running conversation id is unavailable, so reuse falls back to lenient cwd matching as before; the fix is a Linux `/proc` capability
  - log: 2026-06-22 criterion added, implemented pending release
- [ ] **Edge: switch away from a fresh (no-resume) session, then click** - a panel-started new session has no `--resume` in its argv, so its conversation id is unknowable from `/proc`; lenient row reuse cannot tell it apart and may still refocus it after a switch; the fix fully covers every `--resume`-launched terminal (which is every resume/open the panel performs on an existing conversation), leaving only manually-fresh sessions as a narrowed blind spot
  - log: 2026-06-22 criterion added; documented blind spot raised by the adversarial review (finding 3), accepted - a no-resume terminal's conversation cannot be identified

### Open Branched Conversation - Notes

- Reuse is keyed two ways: the observed running id stored in the microcache (the OBSERVED id, never the wanted one, so a strict reuse trusts the process not a wish) and the `/proc` walk in `_findTerminalForCwd`
- In-flight launches coalesce per CONVERSATION (project + session id), deliberately NOT per call-mode (strict / skip-permissions): for a given conversation the end state is one focused terminal regardless of mode, and de-coalescing would risk two concurrent `claude --resume <same id>` launches colliding with "already in use"
- The adversarial review (Mode 1, two rounds) flagged storing the wanted id (fixed: store the observed id) and the strict "already in use" on the current row (fixed: opening the current conversation is lenient); round 2 confirmed both RESOLVED and returned SHIP; remaining low findings (lenient-on-current can focus an unrelated fresh terminal, coalescing mode, nested-claude BFS, watcher concurrency) are accepted with rationale here

### Open Branched Conversation - API

- `GET terminal-cwd/<name>` -> `{terminal_name, cwds: [...], has_claude, session_id}`; `session_id` is the running claude's conversation (null when none / fresh)
- `POST launch-terminal` body `{project_path, session_id?, fork_session_id?, name?, dangerously_skip_permissions?}` -> `{terminal_name}`; open-branch sends `session_id` = the chosen branch

## Copy Session ID

Copy a conversation's session id (the `<uuid>` of its JSONL) to the clipboard, both from a row's context menu (the row's current conversation) and from each row of the "Manage Sessions" popup (any parallel conversation). Uses Lumino's `Clipboard.copyToSystem`, matching the existing "Copy Path" action - a silent system copy, no notification.

- [x] **Context menu item** - the row context menu offers "Copy Session ID" (next to "Copy Path"); selecting it copies the row's current `session_id` to the clipboard
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `claude-code-sessions:copy-session-id` command, jest contract green
- [x] **Popup per-row copy** - each row in the "Manage Sessions" popup has a copy affordance that copies that row's `session_id` (so non-current branches are reachable too), without selecting or switching the row
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `_branchCopyButton` on the current row and every branch row, jest contract green
- [x] **Full id copied** - the full uuid is placed on the clipboard, not the truncated/short form shown in labels
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - copies `session_id` / `current`, not the short slice
- [x] **Silent copy** - uses `Clipboard.copyToSystem` like "Copy Path"; no confirmation notification, consistent with the existing copy affordance; works in any context (synthetic copy event, no `navigator.clipboard` dependency)
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented
- [x] **Edge: popup copy does not toggle selection** - clicking the copy affordance inside the popup copies only; it does not tick the row checkbox, switch the conversation, or close the popup
  - log: 2026-06-21 criterion added
  - log: 2026-06-21 implemented - `stopPropagation` on the button (fires before the row's bubble-phase handler) plus `type='button'`; adversarial review confirmed the guard holds

## Statusline CLI

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
