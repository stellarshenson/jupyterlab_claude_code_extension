# Acceptance Criteria - Row Columns

Panel session rows lay out their trailing indicators as aligned columns instead of inline jumble: dot | name | favourite star | time. The fixed-width time column is the right-edge alignment anchor across all rows.

- [x] **Star column** - favourite star renders in its own column BEFORE the time column (child order: dot, name, star, time)
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Time column** - time-ago label is a fixed-width (52px) right-aligned column so `now / 5m ago / 3d ago` values line up across rows
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Star visibility rule unchanged** - star shown only when the session is favourited and outside the Favourites section
  - log: 2026-06-12 criterion added (pre-existing behaviour, restated for the new layout)
- [x] **Paler live dot** - the green remote-control dot is softened (opacity 0.75 over `--jp-success-color1`), keeping the glow but reading less loud next to row text
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
- [x] **Edge: row without star or time** - rows missing the star (not favourited) or the time (no `file_mtime`) still align; name flexes, time column anchors when present
  - log: 2026-06-12 criterion added
  - log: 2026-06-12 implemented, pending release
