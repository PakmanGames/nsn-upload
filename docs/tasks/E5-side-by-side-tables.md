# E5 - Tables side by side on one sheet

Product owner decision (D27): follow-up to E3, so no table is missed in either direction.
**Start only after E3 merges. If the submission deadline arrives first, this brief is the design and is referenced from the design note.**
Read the Wave 2 rules and the UX bar in `docs/PLAN.md`, and E3's brief, first.

## The gap

E3 splits a sheet into row bands, one table per band, so stacked tables are found at any column offset.
Two tables that share rows (for example `A1:D40` and `F1:I40`, separated by a blank column) still form one band: detection picks the header that scores best, and the other table's columns are evaluated as part of it or left out.

## Design

1. Within each band, split the columns into segments at columns that are empty in every row of the band (hidden columns do not count as separators).
2. A segment is a candidate table when its own header-like row maps a primary column with high confidence (the same bar `nextTable` uses), so a notes column beside a table never becomes a table.
3. Detect each segment as E3 detects a band. Adjacent segments that fail the bar stay with their neighbor, as today.
4. Table ids keep `${sheet}@${headerRow}` when one table starts on that row; when several do, each gets `${sheet}@${headerRow}:${column letter}` (`Parts@1:F`). Existing ids, and therefore stored choices and tests, are unchanged.
5. Everything E3 built (one Sheets line, decision, Columns group, and rows per table) applies unchanged.

## Done when

- A synthetic sheet with tables at `A1:D40` and `F1:I40` imports both; a third case with a notes column at `F` beside one table imports one table.
- ShiftedTable, Statz, WOW, PENCOM, and the other new fixtures are unchanged.

## Owns

The band-splitting code E3 adds to `structure/detect.ts` and `structure/sheet.ts`, `tableId()`, and tests.
