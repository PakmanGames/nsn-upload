# T5 - Validation, duplicates, conflicts, decisions, summary

Owns: `src/lib/import/validate/`.
Implements: `finalizeAnalysis(model, sheets, records, existing, overrides)` and `toMappingInputs(analysis)`.
Read first: `docs/PLAN.md` (rules, decisions D4-D11, fixture expectations), `docs/ARCHITECTURE.md` (Validation, duplicates, decisions), `TASK_SPEC.md` section 4, `src/lib/import/model.ts`.
Test with hand-built `CandidateRecord[]` and `SheetAnalysis[]`; you do not need T1-T4.

## Requirements (P0)

Decisions are the automation layer. Every decision uses `decisionId()` and the option ids in `DECISION_OPTIONS`. A value in `overrides.decisions` turns its decision into `state: 'user'` with that option chosen.

1. Table inclusion (`include-table`, subject table id): ready -> auto `include`; needs-review -> pending, suggested `exclude`, reason quotes the table's reasons. Records of excluded or pending tables get `approved = false` and take no part in duplicate checks.
2. Splits (`split-cell`): one auto decision per split source row, chosen `split`, listing the new record ids.
3. Ambiguous rows (`ambiguous-multi-value`): pending, suggested `pair-in-order` when counts match, else `keep-as-one`. Records stay `pending` and unapproved until chosen.
4. Valid portion (`import-valid-portion`, subject `${tableId}:r${row}`): records with a rejected value and at least one valid primary identifier -> auto `import-valid-portion`. `exclude-row` sets `approved = false`.
5. Duplicates among approved records of included tables:
   - Identity key: part (uppercased, internal whitespace collapsed) + `|` + NSN (or `niin:` + NIIN when there is no NSN). CAGE splits a group only when both records have a CAGE and they differ.
   - One part with several NSNs never collides (different keys).
   - Same table, same key, identical fields -> `drop-duplicate` auto `drop` for later copies; status `duplicate`, issue `duplicate-in-table`.
   - Different sheets, same key, compatible fields (equal after trim/case/whitespace, or missing on one side) -> `merge-duplicates` auto `merge`: the earliest record (sheet order, then row) keeps a union of fields, each `FieldValue` keeping its own provenance; others become `duplicate` with `duplicate-across-sheets`; set `mergedFrom`.
   - Same key, conflicting description or CAGE -> `resolve-conflict` pending; options `prefer:<id>` for each record, `keep-all`, `exclude-all`; suggested `prefer:<id>` of the record with the most filled fields (tie: earliest). All involved records get status `conflict`, issue `conflict` naming the differing cells, and stay unapproved until chosen. `prefer:<id>` approves that record merged with compatible fields from the others.
   - Against `existing` (localStorage, normalized the same way) -> `drop-duplicate` auto `drop`, issue `duplicate-in-storage`; `keep` re-approves.
6. FSC mismatch: approved records sharing a NIIN with different FSCs each get an `fsc-niin-mismatch` warning listing the related records. No decision; all stay approved.
7. Final status and `approved` for every record; `summary` counts (`sourceRows` counts distinct source rows, `candidates` counts records, `toImport` counts approved).
8. Decisions sorted: pending first, then auto, each in sheet and row order.

`toMappingInputs(analysis)`: approved records only -> `MappingInput` (`part`, `description`, `nsn`, `niin`, `cage`; FSC is not stored).

## Tests (required)

- PENCOM-shaped: same part + NSN on two sheets, CAGE only on one, different descriptions -> one pending conflict, suggestion prefers the record with CAGE; choosing it gives one approved merged record whose CAGE provenance points to the first sheet.
- Compatible cross-sheet duplicate -> auto merge, one approved record, provenance from both sheets.
- Exact duplicate in one table -> second dropped; overriding with `keep` approves it.
- Storage duplicate dropped; part matched case-insensitively and with whitespace collapsed.
- One part with three NSNs sharing a NIIN (Statz R37-R39 shape) -> 3 approved records, each with `fsc-niin-mismatch`.
- Needs-review table -> pending include decision; its records unapproved; `include` override approves them.
- Overrides survive a re-run (same ids produce the same decisions).

## Done when

Tests pass, merged by about 3:00. Available in wave 2 for golden-test fixes.
