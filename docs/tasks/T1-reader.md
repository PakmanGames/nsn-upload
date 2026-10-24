# T1 - Workbook reader (SheetJS -> WorkbookModel)

Owns: `src/lib/import/reader/`. Only this directory may import `xlsx`.
Implements: `readWorkbook(data, fileName, limits?)` from `src/lib/import/reader/index.ts`.
Read first: `docs/PLAN.md` (rules), `docs/ARCHITECTURE.md` (External dependencies section), `src/lib/import/model.ts`.

## Why this matters

ExcelJS cannot open the PENCOM and WOW fixtures (prefixed OOXML namespaces from the .NET Open XML SDK).
Everything downstream trusts `Cell.text` and coordinates, so a reader mistake corrupts identifiers silently.

## Requirements (P0)

- Reject non-`.xlsx` names (`not-xlsx`) and oversize files (`too-large`) before parsing; check sheet, row, and cell limits and throw `WorkbookReadError` with a specific message.
- Load SheetJS with `await import('xlsx')` inside `readWorkbook` (keeps it out of the initial bundle).
- Read with `cellFormula`, `cellNF`, `cellText`, `cellStyles: true`, `cellDates: false`. Password-protected files map to `encrypted`; other parse failures to `corrupt`.
- Visibility from `Workbook.Sheets[i].Hidden`: 0 visible, 1 hidden, 2 veryHidden.
- Hidden rows from `!rows[i].hidden`; hidden columns from `!cols[i].hidden` or a width of 0 (WOW columns A-C are `width: 0, hidden: false`).
- Merges from `!merges`, converted to 1-based `CellRange`. Covered cells copy the master's `kind`, `text`, and `raw`, set `mergedFrom`, and count toward `valueExtent`. This matches `makeSheet()` in `testing.ts`, so hand-built and real sheets behave the same downstream.
- `valueExtent` is the bounding box of non-empty cells (including error cells), never `!ref` (PENCOM reports `A1:Z1000` for about 15 real rows).
- Iterate stored cells only, never the full `!ref` grid.
- Cell conversion:

| SheetJS cell | Cell.kind | Cell.text |
| --- | --- | --- |
| `t: 's'` (also rich text and `t="str"`) | text | `v` with CRLF/CR -> LF |
| `t: 'n'`, date number format (`SSF.is_date`) | date | formatted text `w` |
| `t: 'n'`, zero-padded custom format such as `000000000` | number | `w` (keeps the zeros the user sees) |
| `t: 'n'`, safe integer, other formats | number | exact integer string from `v`; never `w` (General can produce `5.30502E+12`) |
| `t: 'n'`, non-integer | number | `String(v)` |
| `t: 'b'` | boolean | `TRUE` / `FALSE` |
| `t: 'e'` | error | `''`, with `raw` set to the error text such as `#N/A` |
| no value (incl. formula without a cached value) | empty | `''`, with `formula` kept if present |

- Always set `formula` when `f` exists, and `numFmt` when the format is not General.

## Tests (required)

Real fixtures (read with `fs` from `example-excel-uploads/`):

- PENCOM: 6 sheets, all visible; `NSN Cross-Reference` extent `A1:L4`; `Part Number Intake` extent `A1:P7`; `A1:L1` merge on `NSN Cross-Reference`; `Dashboard!B6` has a formula and cached value `2`.
- WOW: `hiddenSheet` is `veryHidden`; `Active Parts` hidden columns `{1, 2, 3}`; `D136` text is `12669555\nRVX08212`; `C2` kind `date`; extent `A1:F180`.
- Statz: `A1` text `G & B P/N`; `B2` kind `number`, text `7646198`; extent `A1:G58` (rows 59-66 are styled empty).

Synthetic workbooks written in the test with SheetJS (`XLSX.utils.aoa_to_sheet`, `XLSX.write`):

- 13-digit numeric NSN `5305016582565` (General) -> text `5305016582565`.
- Numeric `16582565` with format `000000000` -> text `016582565`.
- CRLF inside a string -> LF.
- Error cell, boolean cell, hidden row, merged range, formula with cached value.
- Limit violations and a `.csv` name each produce the right `WorkbookReadError.code`.

## Done when

All tests pass; `pnpm check` and `pnpm build` pass; the reader handles all 3 fixtures.
Handoff note lists any SheetJS behavior that surprised you, for the design note.
