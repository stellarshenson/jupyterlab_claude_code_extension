# Acceptance Criteria - Row Age Emphasis

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
