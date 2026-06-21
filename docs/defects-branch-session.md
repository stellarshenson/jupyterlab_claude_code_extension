# Defects - Branch Session

`[ ]` open, `[x]` fixed. Dated notes under each track how it evolved.

## Contents

- [DEF-1: Branch name not applied at launch, false "use /rename" warning](#def-1-branch-name-not-applied-at-launch-false-use-rename-warning) - fixed
- [DEF-2: Branched session missing from panel until first turn](#def-2-branched-session-missing-from-panel-until-first-turn) - fixed

### DEF-1: Branch name not applied at launch, false "use /rename" warning

- [x] the panel warned `name "..." could not be applied - use /rename` after a branch launch, yet a manual `/rename` worked; cause: `claude -n` owns the name (written on the fork's first turn) but the obsolete `sessions/set-title` poll 404'd for 30s on the not-yet-written fork file and fired a false failure; fix: removed the set-title path (frontend poll + warning, backend handler + route, `set_branch_title`, tests); `src/widget.ts`
  - 2026-06-21 reported: "Branched session started, but the name 'home-accessories' could not be applied - use /rename in the session -> and the rename was actually successful"
  - 2026-06-21 fixed: name owned solely by `claude -n`; jest 43 + pytest 79 green, adversarial review SHIP; see [acc-crit Branch Session](acc-crit-jupyterlab_claude_code_extension.md#branch-session)

### DEF-2: Branched session missing from panel until first turn

- [x] a new branch stayed out of the panel (even after a manual refresh), appearing only minutes later; cause: claude writes a forked session's `<forkId>.jsonl` lazily on its first turn, not at launch (proven: absent through 20s idle; claude refuses a pre-seeded id with "already in use"), and the panel only lists files that exist on disk; wontfix-external (claude limitation), mitigated by the forced-refresh spinner feedback; `src/widget.ts`
  - 2026-06-21 reported: "branched session initially did not show in panel, not even after refresh; only after few minutes appeared (with branch icon) on the workspace session"
  - 2026-06-21 resolved: root-caused as a claude limitation; mitigated by the forced refresh re-poll, see [acc-crit Panel Refresh](acc-crit-jupyterlab_claude_code_extension.md#panel-refresh)
