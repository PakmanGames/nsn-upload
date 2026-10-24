# E3 - Several tables on one sheet, at any column offset

Review feedback: a second table lower on the sheet, shifted to the right, is not read at all.
The product owner's idea: treat the second table like a separate sheet, so no data is missed however far it is shifted.
Read the Wave 2 rules in `docs/PLAN.md` first.

## Fixture and today's behavior

`example-excel-uploads/ShiftedTable.xlsx`, one sheet `Statz - List of active Geier an`.
It is the Statz fixture with its second half moved: rows 34-58 start at column E instead of A.

- Table 1: header row 1 `A:G` (G & B P/N, Dwg Number, Part Number, Status, Mfg., Type, COMMENTS), data rows 2-31. Column C is headed "Part Number" but holds NSNs.
- Rows 32-33 blank.
- Table 2: header row 34 `E:K` (G & B P/N, Dwg Number, NSN, Status, Mfg., Type, COMMENTS), data rows 35-58.

Today: table 1 imports 30 records (Part = A, NSN = C at medium).
Detection sees row 34 and stops: "Row 34 starts another table (NSN); only one table per sheet is imported, so rows 34-58 are not". 24 rows are lost.

## Design

Keep the real sheet: provenance must still say `Statz - List of active Geier an!G35`, and the user looks for that sheet in Excel.
Make each table a first-class unit instead, which gives the user exactly "a separate sheet" in the review window:

- `SheetAnalysis.tables` holds every table found on the sheet, in row order (update the "at most one table" comment in `model.ts`; no type change).
- Each table has its own id (`${sheet}@${headerRow}` stays unique, since tables found this way never share a header row), its own `include-table` decision, its own Columns group, and its own rows.
- The Sheets section lists each table as its own line under the sheet, e.g. "Statz - List of active Geier an · A1:G31 · 30 rows" and "· E34:K58 · 24 rows".

## Build

1. Split the sheet into row bands. A band ends where another table starts, using today's rule (`startsOtherTable` plus a high-confidence primary column in `nextTable`).
2. Detect each band on its own, with its own column span, so a table shifted N columns is found wherever it starts. Bands never share rows, so their column spans may overlap (A:G and E:K here).
3. A repeat of the same header (same labels in the same columns, Statz row 34) is still a repeated-header row of the same table, not a new table.
4. Cap the number of tables per sheet (for example 20) and say so in the reasons when the cap is hit.
5. Duplicates and conflicts between two tables on one sheet behave like duplicates across sheets; the wording names the table ("row 37 of the table at E34:K58") when a sheet has more than one.
6. The summary sentence and section summaries count tables, not sheets, where they differ (e.g. "2 tables on 1 sheet are ready"). `SheetsPanel.svelte` reads `sheet.tables[0]` today (lines 33 and 77); list every table.
7. AI stays one table per sheet (unchanged): it is only called for sheets without a ready table.

Side-by-side tables (two tables sharing rows, separated by blank columns) are out of scope for E3; list them as a known gap in the PR so the coordinator can record it.

## UX bar

Meet the UX bar in `docs/PLAN.md`. For this task in particular:

- The user finds the second table without knowing any internal term: the Sheets lines and the summary read naturally for one sheet with several tables.
- A table held back says why and how to include it, on its own line.

## Done when

- `ShiftedTable.xlsx`: two ready tables, `@1` (`A1:G31`, Part = A, NSN = C) and `@34` (`E34:K58`, Part = E, NSN = G); 54 records.
  The records are the Statz fixture's 54 records (same part and NSN pairs, same importable count, the same `fsc-niin-mismatch` groups now spanning both tables). Use `tests/fixtures/expectations.ts` `statz` as the oracle rather than retyping values.
- Statz itself is unchanged: row 34 there is still a repeated header of one table.
- WOW, PENCOM, and the other new fixtures are unchanged.

## Tests

- Unit: two stacked tables at the same columns, shifted right, shifted left, three tables, a stacked table without a high-confidence primary (not a new table), the cap.
- Acceptance: `tests/acceptance/shifted-table.test.ts`, expectations in a new `tests/fixtures/shifted-table.ts`.
- E2E: `tests/e2e/shifted-table.spec.ts`: both tables listed in Sheets, Columns shows two groups, the import button says 54.

## Owns

`detectTable` and `nextTable` in `src/lib/import/structure/detect.ts`, the deterministic branch of `analyzeSheet` in `structure/sheet.ts`, the `SheetAnalysis.tables` comment in `model.ts`, `SheetsPanel.svelte`, group headings in `ColumnsPanel.svelte`, `summary.ts`, and any single-table assumption you find in `validate/`.
E1 adds a manual-table branch to `analyzeSheet` and a headerless call in `detectTable`; keep both working when you rebase.
