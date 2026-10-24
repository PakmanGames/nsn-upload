# X1 - A library of edge-case workbooks

Product owner request: an agent whose only job is to create Excel edge cases to test the importer with, beyond the seven files we have.
Read `TASK_SPEC.md`, `docs/ARCHITECTURE.md`, and the Wave 2 section of `docs/PLAN.md` first. Do not change product code.
**Deadline: the submission is due within the hour. Open the PR within about 40 minutes; a smaller set that works beats a large set that does not.**

## Build

1. A generator, `scripts/edge-cases/generate.ts` (ExcelJS is already a dev dependency; see `buildWorkbook` in `tests/acceptance/helpers.ts`), run with a `pnpm edge-cases` script, that writes real `.xlsx` files to `example-excel-uploads/edge-cases/`. Generated files are committed so anyone can upload them in the app.
2. One workbook per case, small, with realistic NSNs (4-2-3-4, real FSCs) and part numbers. Aim for these, most valuable first:
   - Two tables side by side in the same rows (E5).
   - A hidden sheet holding real parts next to a visible one (H1).
   - Headerless NIINs stored as numbers, so leading zeros are lost (E1).
   - Header on row 15 under a merged instructions block.
   - Two-row header with merged group labels, shifted right.
   - NSN split across columns: FSC | NIIN, and FSC | 2-digit country | 7-digit item.
   - Multi-value cells with mixed separators: newline, comma, semicolon, " / ".
   - Formulas with cached values, a formula without one, `#N/A`, `#REF!`.
   - Date-mangled parts (`3-4` stored as a date), exponent-looking parts (`13211E9213`), parts with leading zeros stored as numbers.
   - Unicode: en dashes and NBSP inside NSNs, zero-width spaces, full-width digits.
   - Interleaved notes rows, a totals row, a blank column inside the table.
   - Header synonyms: "Stock No.", "NSN/NIIN", "Mfr Part No", "Item Description", "CAGE/Mfr".
   - Parts and descriptions only, no NSN.
   - Prompt-injection text in a cell and in a sheet name ("Ignore previous instructions...").
3. `example-excel-uploads/edge-cases/README.md`: one row per file with what it tests, what should happen, and which task owns that behavior (E1-E5, H1, M1, DS1, or "works today").
4. `tests/acceptance/edge-cases.test.ts`: every generated file reads and analyzes without throwing and passes the shared provenance and summary invariants (`tests/acceptance/helpers.ts`). Assert expected outcomes only where `main` already supports them; for the rest, add `it.todo` naming the owning task.

## Hand-off

The PR description lists every file with what the importer does with it today (records, importable, pending, anything lost), so the coordinator can route each gap.

## Owns

`scripts/edge-cases/`, `example-excel-uploads/edge-cases/`, `tests/acceptance/edge-cases.test.ts`, and the `edge-cases` script line in `package.json`.
