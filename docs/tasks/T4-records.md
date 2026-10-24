# T4 - Candidate records with provenance

Owns: `src/lib/import/records/`.
Implements: `buildRecords(model, sheets, overrides): CandidateRecord[]`.
Read first: `docs/PLAN.md` (rules, messy cases), `docs/ARCHITECTURE.md` (Normalization and records), `TASK_SPEC.md` sections 3 and 5, `src/lib/import/model.ts`.
Build test inputs with `makeSheet()` and hand-written `SheetAnalysis` objects; you do not need T3. Until T2 merges, stub `normalizeField` in your tests with `vi.mock`.

## Requirements (P0)

- For every table in every sheet that has tables (ready or needs-review), and for every row in `dataRows`: run `normalizeField` for each mapped column.
- Record id `${tableId}:r${row}`; split records add `.${index}` (1-based).
- `FieldValue.provenance`: file, sheet, row, col, cell (master cell when `mergedFrom` is set, plus `merge-fill`), original text, transforms, `origin: 'source'`.
- Merged cells: use a covered cell's copied value only for vertical merges, where the master is in the same column. A cell covered by a merge whose master is in another column is treated as empty; otherwise a description merged across the CAGE column would produce a bogus CAGE.
- Invalid values go to `rejected[field]` with the issue added to `issues`. They never appear in `fields`.
- Splits: if exactly one of part / nsn / niin returned several values, create one record per value; other fields are copied (same provenance). Add an info `split-from-multi-value` issue and set `split`. Respect `overrides.decisions[decisionId('split-cell', `${tableId}:r${row}`)] === 'keep-as-one'` (the original text becomes one value).
- Ambiguous: if two or more identifier fields are multi-valued in one row, add `ambiguous-multi-value` and set status `pending`. Default records: pair values in order when the counts match, otherwise one record with the original texts. Respect the `ambiguous-multi-value` decision override (`pair-in-order`, `keep-as-one`, `exclude`).
- Derivations, labeled `origin: 'derived'` with `derivedFrom`:
  - valid NSN and no NIIN value -> NIIN = last 9 digits (`derive-niin-from-nsn`);
  - valid FSC + valid NIIN and no NSN -> NSN = FSC + NIIN (`derive-nsn-from-fsc-niin`).
- Consistency: NSN present with a NIIN or FSC that disagrees -> `conflict` issue (error) naming both cells.
- Cross-field hint: an invalid NSN whose original text equals the row's part number -> append "same value as part number in <cell>" to the message (WOW E134).
- Missing primary identifier (no valid part, nsn, or niin) -> `missing-primary-identifier` error.
- Missing optional: only when the description or CAGE column is mapped but the cell is empty -> `missing-optional` warning. If the column does not exist, add nothing per row (T3 adds a table-level reason).
- Tables with medium or low confidence on a mapped primary column -> `low-confidence-mapping` warning on each record.
- Initial status: `invalid` if any error and no valid primary identifier; `pending` for ambiguous rows; `warning` if any warning (including rejected optional values); else `valid`. Initial `approved = status === 'valid' || status === 'warning'`. T5 finalizes both.

## Tests (required)

- Provenance: every `FieldValue` has the right sheet, row, cell, original, and transforms.
- WOW-shaped rows: `D136`-style split -> 2 records, ids `...:r136.1` / `.2`; `keep-as-one` override -> 1 record.
- Malformed NSN with valid part -> part in `fields`, NSN in `rejected`, status `warning`.
- E134-style hint present.
- NIIN derived from NSN; NSN derived from FSC + NIIN; NSN/NIIN disagreement -> conflict.
- Row with only a description -> `missing-primary-identifier`.
- Two multi-valued identifier fields -> `ambiguous-multi-value`, status `pending`.
- Table without a Description column -> no per-row `missing-optional`.

## Done when

Tests pass, merged by about 3:00. Available in wave 2 for golden-test fixes.
