# Defects - Branch Session

`[ ]` open (a fix not yet verified is still open), `[x]` fixed and verified. `log:` lines are the dated evolution - reported, root cause, fix, verified - appended never overwritten.

## Contents

- [DEF-2: Branched session missing from panel until first turn](#def-2-branched-session-missing-from-panel-until-first-turn) - fixed
- [DEF-1: Branch name not applied at launch, false "use /rename" warning](#def-1-branch-name-not-applied-at-launch-false-use-rename-warning) - fixed

## Open

## Fixed

### DEF-2: Branched session missing from panel until first turn

- [x] **MEDIUM** - branching `workspace` to `home-accessories` left the new branch out of the panel, absent even after a manual refresh; it appeared (branch icon on the `workspace` row) only after a few minutes; root cause: claude materialises a forked session's `<forkId>.jsonl` lazily - only on the first user turn in the new session, not at launch (confirmed empirically: file absent through 20 s idle, claude refuses a pre-seeded id with "Session ID ... is already in use"); the panel reads on-disk truth and polls every 30 s, so it cannot list a file that does not yet exist; the "few minutes" was the delay until the first interaction; `src/widget.ts` `_startPolling`, `_fetch`
  - log: 2026-06-21 reported (operator: "branched session initially did not show in panel, not even after refresh; only after few minutes appeared (with branch icon) on the workspace session")
  - log: 2026-06-21 root cause - claude lazy fork-file creation; not a panel bug, the panel reflects on-disk state correctly; pre-seeding the JSONL is impossible (claude rejects an in-use session id)
  - log: 2026-06-21 resolved as wontfix-external - instant pre-first-turn visibility is a claude limitation, out of the extension's control; mitigated by the forced refresh re-poll + panel spinner so a manual refresh gives clear feedback that a full re-read ran; see [acc-crit: Panel Refresh](acc-crit-jupyterlab_claude_code_extension.md#panel-refresh)

### DEF-1: Branch name not applied at launch, false "use /rename" warning

- [x] **MEDIUM** - after a branch launch the panel warned `Branched session started, but the name "..." could not be applied - use /rename in the session`, yet a manual `/rename` succeeded; root cause: the name is owned by `claude -n <name>` (claude writes it as a `custom-title` record on its first turn and re-stamps every turn), but the obsolete `sessions/set-title` poll probed for `<forkId>.jsonl`, got 404 for 30 s while the lazily-created file was absent, then fired a failure warning - the name was never actually failing; `src/widget.ts` `_stampForkTitle`
  - log: 2026-06-21 reported (operator: "Branched session started, but the name 'home-accessories' could not be applied - use /rename in the session. -> and the rename was actually successful")
  - log: 2026-06-21 root cause - `_stampForkTitle` set-title poll is the pre-`-n` naming path, now redundant; its 30 s timeout warning is false because `claude -n` owns and re-stamps the name once the session takes its first turn
  - log: 2026-06-21 fixed - removed the obsolete `sessions/set-title` machinery (frontend poll, backend `SessionSetTitleHandler` + route, `set_branch_title`, jest+pytest tests) and the false warning; name owned solely by `claude -n`; jest 43 + pytest 79 green, adversarial review SHIP (round 1 caught an unrelated veil-CSS cascade bug in DEF-panel work, fixed, round 2 clean); see [acc-crit: Branch Session](acc-crit-jupyterlab_claude_code_extension.md#branch-session)
