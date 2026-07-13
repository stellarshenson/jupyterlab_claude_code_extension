# Defects - Claude Code Extension

`[ ]` open, `[x]` fixed. Dated notes under each track how it evolved; depth lives in `.claude/JOURNAL.md`.

## Contents

- [DEF-1: Branch name not applied at launch, false "use /rename" warning](#def-1-branch-name-not-applied-at-launch-false-use-rename-warning) - fixed
- [DEF-2: Branched session missing from panel until first turn](#def-2-branched-session-missing-from-panel-until-first-turn) - fixed
- [DEF-3: Switching a branch then clicking the row resumes the original conversation](#def-3-switching-a-branch-then-clicking-the-row-resumes-the-original-conversation) - fixed
- [DEF-4: Switched branch row focuses an unidentified terminal running another conversation](#def-4-switched-branch-row-focuses-an-unidentified-terminal-running-another-conversation) - fixed
- [DEF-5: Switched branch reverts to the most-active conversation on refresh](#def-5-switched-branch-reverts-to-the-most-active-conversation-on-refresh) - fixed
- [DEF-6: Created branch appears but is not made the row's current conversation](#def-6-created-branch-appears-but-is-not-made-the-rows-current-conversation) - fixed
- [DEF-7: Panel shows "remote control active" for a session that is not remote-controlled](#def-7-panel-shows-remote-control-active-for-a-session-that-is-not-remote-controlled) - fixed
- [DEF-8: "remote control active" stays lit for a bridged session gone stale](#def-8-remote-control-active-stays-lit-for-a-bridged-session-gone-stale) - fixed
- [DEF-9: opening an already-open session spawns a duplicate claude on the same conversation](#def-9-opening-an-already-open-session-spawns-a-duplicate-claude-on-the-same-conversation) - open

### DEF-1: Branch name not applied at launch, false "use /rename" warning

- [x] the panel warned `name "..." could not be applied - use /rename` after a branch launch, yet a manual `/rename` worked; cause: `claude -n` owns the name (written on the fork's first turn) but the obsolete `sessions/set-title` poll 404'd for 30s on the not-yet-written fork file and fired a false failure; fix: removed the set-title path (frontend poll + warning, backend handler + route, `set_branch_title`, tests); `src/widget.ts`
  - 2026-06-21 reported: "name 'home-accessories' could not be applied - use /rename -> and the rename was actually successful"
  - 2026-06-21 fixed: name owned solely by `claude -n`; see [acc-crit Branch Session](acc-crit-jupyterlab_claude_code_extension.md#branch-session)

### DEF-2: Branched session missing from panel until first turn

- [x] a new branch stayed out of the panel (even after a manual refresh), appearing only minutes later; cause: claude writes a forked session's `<forkId>.jsonl` lazily on its first turn, not at launch (proven: absent through 20s idle; claude refuses a pre-seeded id with "already in use"), and the panel lists only files on disk; wontfix-external (claude limitation), mitigated by the fast watcher + refresh spinner; `src/widget.ts`
  - 2026-06-21 reported: "branched session did not show in panel, not even after refresh; only after a few minutes appeared"
  - 2026-06-22 resolved: claude limitation; `_watchForBranch` (2s cadence) surfaces the row seconds after the JSONL lands; see [acc-crit Open Branched Conversation](acc-crit-jupyterlab_claude_code_extension.md#open-branched-conversation)

### DEF-3: Switching a branch then clicking the row resumes the original conversation

- [x] after switching the row to another conversation, clicking the row landed back in the ORIGINAL; cause: terminal reuse was keyed purely by project cwd, so the still-open `claude --resume <original>` terminal was refocused regardless of which branch was current (a running claude is pinned to one conversation); fix: `terminal-cwd` reports the running claude's conversation id (argv `--session-id`/`--resume`), and reuse refocuses only a same-conversation terminal; `jupyterlab_claude_code_extension/routes.py`, `src/widget.ts`
  - 2026-06-22 reported: "switched to another branch - and clicking, I get to the original session, not the branch"
  - 2026-06-22 fixed: conversation-aware reuse; "Open Branched Conversation" submenu + popup Open added; see [acc-crit Open Branched Conversation](acc-crit-jupyterlab_claude_code_extension.md#open-branched-conversation)
  - 2026-06-22 regressed (DEF-4): lenient reuse of an unidentified terminal - superseded by DEF-4's strict-on-identity rule

### DEF-4: Switched branch row focuses an unidentified terminal running another conversation

HIGH - lands the user in the wrong conversation.

- [x] after switching the row to another branch, clicking it focused a still-open terminal running a DIFFERENT conversation until that terminal was closed; cause: lenient reuse refocused any cwd-matching claude terminal whose conversation id was unknown (`session_id: null`) - a claude started `-c`/bare reports null and was taken as a match; fix: reuse only on a positive conversation-id match, and New Session launches `claude --session-id <uuid>` (new `new_session_id` param) so every extension terminal is identifiable; `src/widget.ts`, `jupyterlab_claude_code_extension/routes.py`
  - 2026-06-22 reported: "clicking 'workspace-fix' moves me to the 'workspace' tab; once 'workspace' closed, 'workspace-fix' opened"
  - 2026-06-22 fixed: positive-id-match reuse; hardened over a 5-round adversarial review; Galata 7/7; see [acc-crit Open Branched Conversation](acc-crit-jupyterlab_claude_code_extension.md#open-branched-conversation)

### DEF-5: Switched branch reverts to the most-active conversation on refresh

- [x] after switching, the panel reverted the row's current back to the original conversation after a refresh; cause: `switch_branch` persisted the choice only via the chosen JSONL's mtime and `_resolve_latest` ranks by newest mtime, so continued work in the original bumped its mtime above the switched branch; fix: `switch_branch` writes a durable per-project pin (`.jl-current` holding the chosen session id) honoured over recency when the JSONL exists and is cwd-consistent; a new session clears it, a corrupt pin is ignored; `jupyterlab_claude_code_extension/sessions.py`
  - 2026-06-22 reported: "after some time switches back to 'workspace' (from workspace-fix)"
  - 2026-06-22 fixed: durable `.jl-current` pin (written only for cwd-consistent branches); see [acc-crit Branch Switching](acc-crit-jupyterlab_claude_code_extension.md#branch-switching)

### DEF-6: Created branch appears but is not made the row's current conversation

- [x] a freshly created named branch, once its JSONL materialises, shows in the panel but the row's current stays the PARENT it forked from; cause: creation relied on recency, but the actively-written parent keeps overtaking the fork's mtime, so `_resolve_latest` re-picks the parent; fix: the fork launch writes the `.jl-current` pin to the fork id (`set_current_pin`, symmetric with `switch_branch`), honoured over recency the moment the fork JSONL lands; dangling and benign until then; `jupyterlab_claude_code_extension/routes.py`, `jupyterlab_claude_code_extension/sessions.py`
  - 2026-06-23 reported: "started a branched session from workspace ... over 2m passed - still no branch icon and not switched to"
  - 2026-06-23 fixed: `set_current_pin` at fork launch (reuses the DEF-5 pin); pre-first-turn invisibility stays (DEF-2, external); see [acc-crit Branch Session](acc-crit-jupyterlab_claude_code_extension.md#branch-session)

### DEF-7: Panel shows "remote control active" for a session that is not remote-controlled

- [x] the panel lights the green "remote control active" indicator for a plain interactive claude that is not under remote control (e.g. `/home/lab/workspace/delaval/cognitive-platform/ai-assistant`); cause: `remote_control` was computed as `state.get("live_pid") is not None` (`sessions.py`) - any live claude pid registered for the cwd - but claude 2.x writes `~/.claude/sessions/<pid>.json` for EVERY interactive session and signals the remote-control ("bridge") link with a non-null `bridgeSessionId`, which `session_state_by_cwd` ignored; fix: `session_state_by_cwd` reads `bridgeSessionId` and sets `remote_control` only when the record is both live AND bridged; `jupyterlab_claude_code_extension/sessions.py`
  - 2026-07-01 reported: "/home/lab/workspace/delaval/cognitive-platform/ai-assistant shows 'remote control active' - green light, while it is not"
  - 2026-07-01 root-caused: the winning record for the cwd, `~/.claude/sessions/14254.json`, has `bridgeSessionId: null` (a live `claude --resume`, status idle) yet lit the row; genuinely-bridged sessions carry `bridgeSessionId: session_...` (e.g. this session's `15779.json`), so pid-liveness overcounted remote control
  - 2026-07-01 fixed: `remote_control` requires a live pid AND a non-null `bridgeSessionId`; the DEF-7 case (live claude, bridge null) reads False; pytest 102 green

### DEF-8: "remote control active" stays lit for a bridged session gone stale

- [x] the panel lights the green "remote control active" indicator for a bridged session that is no longer under remote control (e.g. `/home/lab/workspace/private/jupyterlab/jupyterlab_advanced_image_viewer_extension`, last active 17 days ago); cause: claude leaves `bridgeSessionId` set in `~/.claude/sessions/<pid>.json` after the bridge disconnects while the interactive process keeps running, so the DEF-7 gate (live pid AND non-null `bridgeSessionId`) still passes a stale zombie; there is no idle heartbeat - the pid file is rewritten only on a busy/idle status transition, which fires on every turn whether local or remote - so `updatedAt` freshness is the only signal the bridge is being driven now; fix: `session_state_by_cwd` also requires the record to be fresh, active within `REMOTE_CONTROL_FRESH_MS` (1 hour); `jupyterlab_claude_code_extension/sessions.py`
  - 2026-07-03 reported: "jupyterlab_advanced_image_viewer_extension appears to have remote control even if it was not active"
  - 2026-07-03 root-caused: the winning record `~/.claude/sessions/25599.json` is alive but 404h stale with a leftover `bridgeSessionId`; `file mtime == updatedAt` for every session confirms no idle heartbeat, so bridged-ness alone is not liveness; the bridged flag persists across pids and days
  - 2026-07-03 fixed: `remote_control` requires live pid AND non-null `bridgeSessionId` AND `updatedAt` within 1h; reproduced the zombie-only state reads False, a genuinely fresh busy bridge reads True; pytest 102 green

### DEF-9: opening an already-open session spawns a duplicate claude on the same conversation

- [ ] **DEF-9: opening an already-open session spawns a duplicate claude, not a reuse** - clicking a row whose session is already live sometimes errors, sometimes opens a second tab; the plugin does NOT mint a clone id (resume issues `claude --resume <same-id>`, `routes.py:538`) - the duplicate is a SECOND claude process concurrently resuming the SAME conversation after terminal reuse missed the real lock-holder; cause: `_findTerminalForCwd` (`widget.ts:820`) scans only JL terminals and gates reuse on a positive argv-id match, so it cannot see a conversation held (a) headless as a remote-control claude (direct child of `jupyter-labhub`), (b) by a claude-daemon background worker (`claude daemon run` -> `bg-pty-host` -> `--fork-session`), or (c) in a terminal started bare / `-c` (no id in argv); on the miss it spawns `claude --resume <id>` which collides with the live lock-holder; amplifier: `_resolve_latest` can pick a daemon `--fork-session` JSONL as the row's representative, so the row points at a transient fork; `src/widget.ts`, `jupyterlab_claude_code_extension/routes.py`
  - 2026-07-13 reported: "when opening already opened session - sometimes I get error, and sometimes it opens second tab (`stars-ultranova-web`); error (`knowledge-graph-foundry`)"; then "claude creates separate conversations (clones) and maybe it is actually the plugin"
  - 2026-07-13 investigated: live process ancestry - stars `518b5b18` runs headless under `jupyter-labhub` (pid 175849, `claude --resume 518b5b18`) while its one terminal (pid 27439) runs a bare `claude`; kgf row points at `f0c974c6`, a claude-daemon `--fork-session` worker (pid 8924), while its terminal (pid 1869) runs `claude -c` on a different conversation `fc7e72c3`
  - 2026-07-13 root-caused: NOT plugin cloning - stars has a single `518b5b18.jsonl` despite repeated opens, and kgf's 2nd JSONL is claude's own daemon fork; the "separate conversations" are two claude processes concurrently resuming one id (claude 2.x permits it) after a reuse-miss; the plugin's role is spawning the duplicate `--resume`, never minting a new id
  - 2026-07-13 fix options (not implemented): (1) backend - when a terminal's claude carries no argv id, confirm its conversation from the claude pid's `~/.claude/sessions/<pid>.json` sessionId so bare / `-c` / TUI-resumed terminals become reusable; (2) frontend - before spawning, if the wanted id is live in a pid file that is not a focusable terminal (headless / daemon), refuse with an "active elsewhere" message instead of a doomed duplicate; (3) drop daemon `--fork-session` transients from `_resolve_latest` representative selection; deferred - the whole-package build is currently gated on `jupyterlab_colourful_tab_extension` 1.0.19 (colour feature) and this reuse path is adversarial-hardened (DEF-3/4/5/6), so a fix needs the build unblocked and Galata verification before shipping
