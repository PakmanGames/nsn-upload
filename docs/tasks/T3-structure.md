# T3 - Table detection, column mapping, sheet classification

Owns: `src/lib/import/structure/`.
Implements: `analyzeStructure(model, overrides)` and `materializeTable(sheet, spec, source)`.
Read first: `docs/PLAN.md` (rules, fixture expectations), `docs/ARCHITECTURE.md` (Structure detection and mapping), `TASK_SPEC.md` sections 1-2, `src/lib/import/model.ts`.
This is the critical path and carries most of the correctness grade. Prefer clear rules with good `reasons` over clever scoring.

## Requirements (P0)

Sheet level:

- Hidden and veryHidden sheets -> status `hidden`, no tables, reason "Hidden in workbook".
- Sheets without values -> `no-table`.
- Every sheet gets human-readable `reasons` (what was found or why nothing was).

Header row detection:

- Consider header-like rows near the top of `valueExtent` (for example, the first 30 non-empty rows): mostly short text, at least 2 non-empty cells.
- Merged cells: covered cells carry a copy of the master's value (`mergedFrom` set). When judging whether a row is header-like or a repeated header, and when counting non-empty cells, count master cells only. Otherwise a merged title such as PENCOM `A1:L1` looks like a 12-column header.
- Normalize header text: lowercase, NFKC, line breaks / underscores / punctuation to spaces except `/ # &`, collapse whitespace.
- Token vocabulary (keep it small; values do the real work): part `part`, `part number`, `part no`, `part #`, `p/n`, `pn`; description `description`, `nomenclature`, `item name`; nsn `nsn`, `national stock number`; niin `niin`, `national item identification number`; cage `cage`, `cage code`; fsc `fsc`, `federal supply class`.
- Strong match = vocabulary phrase present, no modifier words. Unknown extra words are allowed (vendor prefixes like `PENCOM Part Number`, `G & B P/N`). Weak match = vocabulary phrase plus a modifier (`found`, `status`, `date`, `url`, `source`, `notes`, `comments`, `equivalent`, `competitor`, `family`, `series`, `matchability`, `result`, `query`, `owner`, `priority`, `verified`, `checksum`, `modified`, `do not modify`, `id`).
- Pick the row whose resulting mapping scores best on header and values combined; title rows above it (including merged titles) are ignored.

Column mapping:

- Value pass rate over the column's non-empty, non-hidden data cells: NSN, NIIN, FSC, CAGE use `normalizeField` (or the `identifiers.ts` checks before T2 lands); part uses `isPlausiblePart`; description needs letters and must not look like an identifier.
- Only NSN and NIIN may be mapped from values alone. Part, description, CAGE, and FSC require a header match.
- Hidden columns (including zero-width ones) are never mapped automatically.
- One-to-one assignment: a column gets at most one field, a field at most one column (greedy by score is fine).
- Confidence and table status thresholds exactly as in ARCHITECTURE.md. Reasons must quote evidence, e.g. "header 'NSN' matches; 127 of 129 values are valid NSNs".
- `alternatives`: other fields the column plausibly fits (e.g. Statz `Dwg Number` -> `part`).
- When a mapped field has no column (e.g. no Description), add a table-level reason "No Description column found".

Table extent and rows:

- Data runs from the row after the header to the bottom of `valueExtent`.
- `skippedRows`: blank rows, hidden rows, repeated header rows (a row whose normalized texts match the header row in most mapped columns), and rows with values only in unmapped columns (`no-mapped-values`).
- At most one table per sheet; if a second header-like region exists, mention it in `reasons`.

Overrides:

- `overrides.columns[tableId]` replaces the mapping for those columns (`overridden: true`, confidence `high`, reason "Set by user"). If the user maps a field already used by another column, that other column is unmapped with reason "Replaced by user mapping of column X". Recompute `dataRows`, pass rates, and status.
- `overrides.aiTables`: an AI table replaces the deterministic tables on its sheet.

`materializeTable(sheet, spec, source)` computes everything above for a given header/range/columns. `analyzeStructure` should use it too, so deterministic, user, and AI tables are scored identically.

`aiTrigger` (string or null): set when a visible sheet has no `ready` table but contains identifier-shaped values (for example, at least 3 valid NSN/NIIN cells), or when two columns compete for a primary field.

## Tests (required)

Hand-built sheets with `makeSheet()` (start immediately), then the same assertions on real fixtures once T1 merges:

- Title row above header (PENCOM shape): header found on row 2.
- Repeated header plus blank rows inside the table (Statz rows 32-34): one logical table, rows skipped with reasons, 54 data rows on the real file.
- `(Do Not Modify) Part` UUID column next to `Part Number`: `Part Number` wins; hidden zero-width columns never mapped.
- `NSN Found` (Yes/No), `NSN Matchability (1-5)` (scores), `Manufacturer` (PENCOM), `Mfg.` (Y/N): none mapped to NSN or CAGE.
- `G & B P/N`, `PENCOM Part Number`, `Part\nNumber` (line break), `P/N`, `Part No.` -> part.
- Sheet classification on real PENCOM: `NSN Cross-Reference` and `Part Number Intake` ready; `Search Log` needs-review; `Dashboard`, `Opportunity Matrix`, `Sources & Notes` no-table.
- WOW: ready, Part = D, NSN = E, Description = F.
- Overrides: remapping a column recomputes status; mapping two columns to one field unmaps the older one with a reason.

## P1 if time remains

- Two-row headers (join adjacent header-like rows per column).
- Use `mergedFrom` for vertically merged data cells (T4 records `merge-fill`).

## Done when

Tests pass on hand-built sheets and on all 3 real fixtures; merged by about 3:00.
Stay available in wave 2: T8 will route golden-test failures in detection or mapping to you.
