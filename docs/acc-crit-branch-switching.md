# Acceptance Criteria - Branch Switching

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
- [x] **Count** - row name shows `name (N)` total conversation count, only when N > 1; tooltip gets `Conversations: N` line
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: branch removed before click** - switch returns 404 `branch_not_found`, panel shows error, refreshes; no row points at missing file
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: current JSONL removed externally** - next most recent becomes current on next refresh
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: switch to already-current** - no-op success
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Edge: cwd-inconsistent branch** - cannot become current (`_resolve_latest` skips it); response reports resolved session, panel warns
  - log: 2026-06-12 implemented (v1.2.2)
- [x] **Popup current row** - current conversation shown as the first popup row, marked `current`, non-selectable and non-deletable; only the extras below it are manageable
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup delete: select** - popup rows are selectable, one or many, via checkbox per row in its own click zone; selection survives search filtering
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup selection mode** - once any checkbox is ticked, row clicks toggle selection instead of switching, until the selection is emptied; prevents accidental switch mid-selection
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup delete: select all** - select-all control toggles every selectable row; the current main is excluded, so select-all + Delete removes all parallel conversations
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup delete: button** - Delete button in the popup shows the selection count, e.g. `Delete (3)`; disabled when nothing selected
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup delete: confirm** - first click turns the button into `Confirm delete (N)`, second click executes; selection change or popup close resets the button
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Popup delete: action** - clicking Delete removes the selected branches' JSONLs plus their subagent directories, honouring JupyterLab's move-to-trash setting (same as cleanup); popup list and row count refresh in place
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: delete already-removed branch** - file gone before delete -> treated as deleted, no error, list refreshes
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: delete all listed branches** - popup empties, project keeps its current conversation, row count drops to plain name
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release

## Notes

- The 5 inline submenu items exist to minimise clicks when switching between often-used sessions - right-click -> pick, two interactions total; the popup is the fallback for everything beyond the recent 5 and for management
- Division of responsibility: "Clean Up Parallel Sessions (N)" stays the comprehensive one-shot removal (extras plus subagent directories, no selection); the switch popup is targeted - switch first, delete individual sessions second. The two code paths stay separate by design

## API

- `GET sessions/branches?encoded_path=...` -> `{current, total, branches: [{session_id, file_mtime, label}]}`
- `POST sessions/switch` body `{encoded_path, session_id}` -> `{requested, current}`; 404 `branch_not_found`, 400 invalid input
- `POST sessions/delete-branches` body `{encoded_path, session_ids: [...]}` -> `{removed_count}`; 400 invalid input
