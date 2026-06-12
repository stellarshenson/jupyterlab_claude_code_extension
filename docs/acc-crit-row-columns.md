# Acceptance Criteria - Row Columns

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
