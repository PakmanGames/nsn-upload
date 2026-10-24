# E4 - Choosing columns by their values, and one FSC for several NSNs

Review feedback on `Substring Headers in Diff Sheet (1).xlsx`:

1. An NSN cell lists several NSNs, but the FSC column matches only one of them; that should not be a conflict.
2. The part number column is headed "Material #", and other headers contain "NSN", "FSC", or "CAGE" without holding those values; the importer must pick the right column from the data below the header.

Read the Wave 2 rules in `docs/PLAN.md` first.

## Fixture and today's behavior

Sheet `T6 Consumable Parts Matching`, header row 1, data rows 2-140:
A "Material #" (part numbers), B "Matched NSN(s)" (one or more NSNs per cell, newline-separated), C "Description", D "Est. Qty/Year", E "FSC (derived)", F "FLIS Unit Price" (`$44.03`), G-N "MATCH: NSN/PN Supplier", "MATCH: NSN/PN Email", "MATCH: CAGE Supplier", ... "MATCH: Keyword/FSC Email" (company names and emails).
Sheet `Summary` has supplier counts and dollar amounts and no identifiers; it is correctly `no-table`.

Today: 182 candidates, 124 import, 2 invalid, **28 pending decisions**.

- **Material # is not mapped.** No header names Part, and a part column is never mapped from values alone because the part check is loose: F "FLIS Unit Price" (`$44.03`) also scores "134 of 134 values look like plausible part numbers" (and in the merged-column file, "Critical Platform" with `AIRCRAFT, GALAXY C-5` does too).
  Consequences: no record has a part number; rows 134-135 (part only, no NSN) are invalid; and rows 123-140 share NSNs with rows 107-122 under different part numbers, so the importer raises 16 `resolve-conflict` decisions that would not exist with parts mapped (identity is part + NSN, D8).
- **One FSC, several NSNs.** `B10` = `1680-01-581-8020` and `5342-01-547-4725`, `E10` = `5342`. The cell splits into two records; each is checked against the row's FSC, the 1680 record conflicts, and the row-level `resolve-identifier-conflict` decision holds back both.
  12 such decisions; only row 49 (a single NSN `6850-01-494-9650` against FSC `8030`) is a genuine contradiction.
- **Keyword headers.** "MATCH: NSN/PN Supplier" and the like stay unmapped today, because 0% of their values pass.
  The reason reads like a match, though ("Header 'MATCH: NSN/PN Supplier' matches NSN; 0 of 68 values are valid NSNs"), and nothing tests that a header like this, with some valid values, cannot outrank the real column.

## Build

### 1. A part number column chosen by its values

- Tighten what counts as part-number-shaped when there is no header evidence: money (`$44.03`), decimals, plain small integers, multi-word text with commas (`AIRCRAFT, GALAXY C-5`), emails, and sentences do not count.
  Keep `isPlausiblePart` behavior for columns whose header names Part, or move the stricter rule into a separate value-only check; values under a Part header must not start failing.
- Map Part from values alone, at medium confidence, when no column's header names Part and exactly one column is clearly part-shaped (at least 90% of at least 3 values, values mostly distinct); a tie maps nothing and offers both as alternatives.
- Add a weak header hint for identifier-style labels such as "Material #", "Material Number", "Material No" (weak, so medium at best, D19).
- The column's reasons say why, e.g. "No header names Part; 139 of 139 values look like part numbers".

### 2. A single FSC or NIIN cell next to several NSNs

When an identifier cell splits into several NSNs and the row's FSC (or NIIN) cell matches at least one of them, that FSC or NIIN belongs to the matching record(s) only.
The other split records do not carry it; their FSC and NIIN come from their own NSN, as for any NSN.
No conflict and no decision; an info note on the other records says where the FSC went ("FSC 5342 in E10 matches the other NSN in B10").
When none of the split NSNs match, today's conflict and decision stay.
Single-value cells are unchanged, so row 49 stays a pending decision.

### 3. Headers that mention a field

- Reason wording for a header that mentions a field the values do not support: "Header mentions NSN, but 0 of 68 values are valid NSNs".
- Tests that a column headed "MATCH: NSN/PN Supplier" with a few valid NSNs never outranks a real NSN column, and that field words match whole tokens only.

## Done when

- `Substring Headers in Diff Sheet (1).xlsx`: Part = A at medium confidence, NSN = B, Description = C, FSC = E; G-N and F unmapped.
  Rows 134-135 import as part-only records; the 16 `resolve-conflict` decisions are gone; the only pending identifier decision is row 49.
  Report the resulting counts in the PR (records, importable, pending), and pin them in the acceptance test.
- `Merged Column, FSC + NIIN NSN Tests (1).xlsx`: "Critical Platform" is no longer offered as a part alternative.
- WOW, Statz, PENCOM, and the other new fixtures are unchanged; Statz B "Dwg Number" and PENCOM "MIL/MS/NAS Equivalent" stay unmapped.

## Tests

- Unit: the value-only part rules (prices, decimals, platform names, emails, a tie between two part-shaped columns, a categorical column like `A`/`O`).
- Unit: split NSNs against one FSC: matches the first, matches a later one, matches none, a NIIN cell instead of an FSC cell, a single NSN that disagrees.
- Acceptance: `tests/acceptance/substring-headers.test.ts`, expectations in a new `tests/fixtures/substring-headers.ts`.

## Owns

`src/lib/import/identifiers.ts`, `structure/values.ts`, `structure/header.ts`, the value-only rules in `structure/columns.ts` (`confidenceFor`, `evaluateColumns`), and the split and conflict code in `src/lib/import/records/table.ts`.
E2 edits `readHeader` in `columns.ts`; keep both changes when you rebase.
