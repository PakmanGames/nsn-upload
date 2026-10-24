# E2 - Where a table ends, merged columns, and columns without a header

Review feedback: the merged-column file imports the right 24 NSNs, but "make sure it doesn't miss any edge cases or data".
It does show three gaps: rows below the table are read as data, a merged column is listed twice, and values outside the header are dropped silently.
Read the Wave 2 rules in `docs/PLAN.md` first.

## Fixture and today's behavior

`example-excel-uploads/Merged Column, FSC + NIIN NSN Tests (1).xlsx`, sheet `RFI Response`:

- Rows 1-4: title, subtitle, and an instruction paragraph, each merged across the sheet.
- Row 6 header: `A` FSC, `B6:C6` "NIIN" merged, then D-N (Critical Platform, quantities, prices, Notes).
- Rows 7-30: 24 parts. Every NIIN cell is merged across `B:C` (`B7:C7` ... `B30:C30`). Columns `O` and `P` hold supplier names and an email with no header.
- Rows 31-32 blank, then a "Supplier Information" form (`A33:A40`: Field, Supplier_Name, Cage_Code, ...) and a contract-terms paragraph in row 43.

Today: table `A6:N43`, FSC = A, NIIN = B, 33 data rows.

- 24 records import (FSC + NIIN, NSN derived), which is right.
- 9 invalid records come from rows 33-40 and 43 ("FSC "Supplier_Name" ... contains no digits"), so the summary shows "9 invalid".
- Column A FSC drops to medium confidence (24 of 33) because those rows count against it.
- Column C is listed again as "C "NIIN": No values in the data rows", although in Excel it is the same merged column as B.
- Columns O-P are outside the header span and are not mentioned anywhere.

## Build

### 1. A table ends at a blank gap followed by rows that do not fit it

After one or more blank rows, a block in which no row has a mapped value passing its field check (and no cell is a valid NSN or NIIN) is not part of the table.
The table's range ends before the gap, and the table reasons say so, e.g. "Rows 33-43, below the blank rows, do not fit the table's columns; not imported".
Safety rules, because cutting a table early loses real rows:

- Never cut at a row that has a passing identifier value anywhere in the table's columns.
- A misfit row inside the data run, with no blank gap before it, stays an invalid record as today.
- A repeated header after a gap (Statz row 34) is still a repeated header, not an end.

### 2. A merged header column is one column

When a header cell is merged across columns and the covered columns hold nothing of their own in the data rows (every cell is empty or covered by a merge from the master column), the covered columns are not separate table columns.
Drop them from `table.columns` and add a reason such as "Column C is part of the merged header B6:C6".
Provenance stays on the merge master, as today.
No contract change: `ColumnMapping` keeps a single `col`.

Cover these variants with synthetic workbooks (`tests/acceptance/helpers.ts`, `buildWorkbook` with `merges`):

| Variant | Expected |
| --- | --- |
| Header `B:C` merged, data merged `B:C` per row (this file) | One NIIN column B; C not listed |
| Header `B:C` merged, data only in C (B empty) | C maps to NIIN; nothing lost |
| Header "NSN" merged over `A:B`, FSC values in A, NIIN values in B | A = FSC, B = NIIN by their values; NSN derived |
| Header `B:C` merged, B and C hold different values in some rows | Both columns kept; the better one maps, the other is listed with a reason |
| Data merged down several rows (existing `merge-fill`) | Unchanged |

### 3. Values to the side of the header are not dropped silently

Columns that hold values in the table's data rows but have no header cell (O-P here) become part of the table as columns without a header, shown as "column O (no header)".
They map only through the value-only rule (NSN/NIIN, 95%), so an NSN column someone forgot to label still imports, and names or emails stay unmapped and visible under "more columns not imported".

## UX bar

Meet the UX bar in `docs/PLAN.md`. For this task in particular:

- The reasons for rows left below the table and for "column O (no header)" read as plain language a buyer understands.
- The rows left out stay visible as skipped (with their reason) in Rows and Sheets, so the user can see nothing was lost by mistake.

## Done when

- `Merged Column, FSC + NIIN NSN Tests (1).xlsx`: table ends at row 30; 24 records, 0 invalid, all importable; FSC and NIIN both high confidence; column C not listed; O and P listed as unmapped columns without a header; the reasons name rows 33-43.
- WOW, Statz, PENCOM, and the other new fixtures are unchanged, or each changed expectation is explained in the PR (for example a PENCOM side column now listed as unmapped).

## Tests

- Unit: the end-of-table rule, including the three safety rules above.
- Unit or acceptance: the five merge variants.
- Acceptance: `tests/acceptance/merged-column.test.ts`, expectations in a new `tests/fixtures/merged-column.ts`.

## Owns

`src/lib/import/structure/table.ts` (row classification and range), the span computation in `tryHeader` in `structure/detect.ts`, `readHeader` in `structure/columns.ts`, and the column label in `ColumnsPanel.svelte` if "(no header)" needs it.
Part plausibility ("Critical Platform" offered as a part alternative) is E4's; do not change `identifiers.ts`.
