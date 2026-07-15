# Recovery State

Cold-restart recovery board for `jupyterlab_claude_code_extension`. Newest BRACE section is the live one.

---

## BRACE - 2026-07-15 14:45 (approx)

### HORIZON: SESSION-ONLY

Opus 4.8 usage limit hit 98% (resets 5am); this CLI session is ending. The host stays up. No detached compute is running, so there is nothing to reattach - this is persistence only. The working tree is clean and every task is complete; the next session can start fresh with no pending action.

### What is running

- Nothing. `make publish` completed. Background filesystem scans were killed. No detached jobs, no paused processes.

### What is DOWN / needs restart

- Nothing.

### Valid results on disk (all committed + pushed)

- **1.2.44 released** - the fire-and-forget promise-rejection fix (console spill). Live on both registries:
  - npm: https://www.npmjs.com/package/jupyterlab_claude_code_extension/v/1.2.44 (verified 1.2.44)
  - PyPI: https://pypi.org/project/jupyterlab_claude_code_extension/1.2.44/ (verified HTTP 200)
  - Commits on `origin/main`: `bf51c44` (release content - `src/widget.ts` dialog `launch().catch()` guards + `_switchBranch` finally + two `commands.execute` catches; `CHANGELOG.md` 1.2.44; `.claude/JOURNAL.md` entry 76) and `458a9b4` (`make publish`'s own package-metadata bump). Tree clean, HEAD = `bf51c44`.
  - Journal entry 76 appended; `journal-tools check` OK (49 entries).
- **Architect adversary hardened** - `~/.claude/skills/adversarial-review/adversaries/architect.md` axis 7 now hunts async lifecycle hygiene (fire-and-forget `void promise`, unawaited async, `.then` without `.catch`, teardown/`finally` that rejects an un-awaited promise) alongside the swallowed-exception direction. Global file outside the repo; saved on disk, not part of any repo commit.
- **`folder` presentationMode warning - RESOLVED, no code change** - root cause was the 1.2.38 enum rename (`folder` -> `name`) leaving the schema stricter than the code's back-compat intent. User chose reset-only. The one settings file on the box, `~/.jupyter/lab/user-settings/jupyterlab_claude_code_extension/plugin.jupyterlab-settings`, already reads `"presentationMode": "name"` (mtime 14:29, post-dating the 14:18 warning). No stale `folder` anywhere. Warning is spent; will not recur.

### Invalid / quarantined

- None.

### Pending decisions / recordings

- None. All three asks this session (release 1.2.44, harden architect adversary, resolve the folder warning) are complete.
- Optional future idea (NOT started, not requested): downgrade transient network-suspension `Failed to fetch` in `_showError` to `console.debug` so host-sleep does not log at error level. Deferred - it changes logging policy for all callers; only do if the user asks.

### FIRST ACTION for the next session

- None required. The project is at a clean, fully-committed stopping point. Await the user's next instruction.
