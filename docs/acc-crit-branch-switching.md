# Acceptance Criteria - Branch Switching

Context-menu submenu switches a project's current conversation to another branch (parallel session JSONL). Persistence = touch selected JSONL mtime; recency resolution, cleanup and `claude --resume` picker all agree, no extra state.

- **Submenu** - row with >1 conversation JSONL shows "Switch Conversation Branch" in context menu
- **List** - other conversations only, newest first, max 5 in submenu; label = custom title > index summary > short session id, plus relative time
- **More** - >5 branches adds "More... (N total)" submenu item; opens popup with full list, browse + search over large lists, clicking an entry switches
- **Switch** - selected JSONL becomes current; row session id / name / summary / recency update on refresh; click-to-resume opens it
- **Count** - row name shows `name (N)` total conversation count, only when N > 1; tooltip gets `Conversations: N` line
- **Edge: branch removed before click** - switch returns 404 `branch_not_found`, panel shows error, refreshes; no row points at missing file
- **Edge: current JSONL removed externally** - next most recent becomes current on next refresh
- **Edge: switch to already-current** - no-op success
- **Edge: cwd-inconsistent branch** - cannot become current (`_resolve_latest` skips it); response reports resolved session, panel warns

## API

- `GET sessions/branches?encoded_path=...` -> `{current, total, branches: [{session_id, file_mtime, label}]}`
- `POST sessions/switch` body `{encoded_path, session_id}` -> `{requested, current}`; 404 `branch_not_found`, 400 invalid input
