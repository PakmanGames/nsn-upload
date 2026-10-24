# F1 - Two new pending decisions

Decided by the product owner after the first merges:

1. A row whose NSN contradicts its own NIIN or FSC cell becomes a pending decision (today it is silently excluded as a conflict).
2. A new record that matches a saved record but has a different description or CAGE becomes a pending decision (today the new record is dropped automatically).

Both follow the automation rule in `docs/ARCHITECTURE.md`: uncertain cases are held back from import, carry a suggested option, and "Accept all suggestions" resolves them in one click.

Order: **F1a first** (contract, about 15 minutes), then F1b, F1c, F1d, F1e in parallel.
Every part: `git fetch origin && git rebase origin/main`, stage only the listed paths, open a PR, do not merge.

## F1a - Contract change (T5's agent)

Edit `src/lib/import/model.ts`:

```ts
export type DecisionKind =
	| 'include-table'
	| 'split-cell'
	| 'ambiguous-multi-value'
	| 'import-valid-portion'
	| 'merge-duplicates'
	| 'drop-duplicate'
	| 'resolve-conflict'
	| 'resolve-identifier-conflict'
	| 'resolve-storage-conflict';
```

Add to `Decision`:

```ts
	/** Saved records involved (resolve-storage-conflict), so the UI can show saved and new values side by side. */
	existingIds?: string[];
```

Add to `DECISION_OPTIONS`:

```ts
	'resolve-identifier-conflict': ['prefer-nsn', 'prefer-niin-fsc', 'exclude-row'],
	'resolve-storage-conflict': ['keep-saved', 'replace-saved', 'keep-both']
```

Extend the `decisionId` comment: resolve-identifier-conflict -> `${tableId}:r${row}`; resolve-storage-conflict -> `${recordId}+saved:${existingId}`.

Add:

```ts
/** A record already saved in the browser; the id lets an import replace it. */
export type StoredMapping = MappingInput & { id: string };

/** What an import does: add new records, and replace saved ones the user chose to overwrite. */
export type ImportPlan = {
	add: MappingInput[];
	replace: Array<{ id: string; input: MappingInput }>;
};
```

Change signatures:

- `analyze(model, existing: StoredMapping[], overrides)` in `analyze.ts`.
- `finalizeAnalysis(model, sheets, records, existing: StoredMapping[], overrides)`.
- Replace `toMappingInputs(analysis)` with `toImportPlan(analysis): ImportPlan`. In F1a it returns `{ add: <what toMappingInputs returned>, replace: [] }`.

Update every caller on `main` mechanically, including tests in `tests/acceptance/` (exception to file ownership for this PR only).
`MappingRecord` in `src/lib/types.ts` already has an `id`, so it satisfies `StoredMapping`.

## F1b - Identifier conflicts in records (T4's agent)

Owns `src/lib/import/records/`.

- A row conflicts when its NSN is valid and a valid NIIN cell differs from the NSN's last 9 digits, or a valid FSC cell differs from its first 4.
- Read `overrides.decisions[decisionId('resolve-identifier-conflict', `${tableId}:r${row}`)]`:
  - none (default): keep today's `conflict` issue naming the cells; status `pending`, `approved: false`.
  - `prefer-nsn`: keep the NSN; the disagreeing NIIN/FSC cells go to `rejected` with a `conflict` warning ("NIIN in C5 disagrees with NSN in A5; kept the NSN"); derive the NIIN from the NSN.
  - `prefer-niin-fsc`: keep the NIIN and FSC cells; the NSN cell goes to `rejected` with a `conflict` warning; derive the NSN from FSC + NIIN when the FSC is valid, otherwise the record has a NIIN and no NSN.
  - `exclude-row`: build the default records; T5 unapproves them.
- Part, description, and CAGE are unaffected by the choice.
- Tests: each option, including `prefer-niin-fsc` without an FSC column.

## F1c - Both decisions in validation (T5's agent, after F1a)

Owns `src/lib/import/validate/`.

- `resolve-identifier-conflict`: one pending decision per row with T4's identifier `conflict` issue. Suggested `exclude-row`, so "Accept all suggestions" never imports a contradicted identifier. `prefer-*` -> approved, status `warning`. `exclude-row` -> unapproved. Replaces today's "finalize as conflict without a decision".
- `resolve-storage-conflict`: a candidate whose identity key matches a saved record, but whose description or CAGE differs after normalization. Pending, suggested `keep-saved`, `existingIds` = matching saved ids, reason names the differing fields. `keep-saved` -> unapproved, status `duplicate`. `replace-saved` -> approved; it goes to `ImportPlan.replace` with the first matching saved id. `keep-both` -> approved; it goes to `ImportPlan.add`.
- Exact or compatible matches against storage keep today's auto `drop-duplicate`.
- `toImportPlan` fills `replace` from approved records whose storage decision is `replace-saved`; everything else approved goes to `add`.
- Tests: every option of both decisions, and that a stale choice falls back to the policy.

## F1d - Review window (T7's agent)

Owns `src/lib/components/**`, `src/lib/import/session.svelte.ts`.

- Both kinds render through the generic decision control (always from `decision.options`).
- Identifier conflict: show the NSN, NIIN, and FSC cells side by side with their provenance.
- Storage conflict: show the saved record (look up `existingIds` in the current mappings) next to the new record, field by field, with the differing fields highlighted.
- Pass the current `MappingRecord[]` to `analyze()` as `existing`.
- Import with `toImportPlan(analysis)`: add new records as today, and replace saved records by id (keep `id` and `createdAt`, update the fields, set status `Ready`).

## F1e - Tests (T8's agent)

Owns `tests/`.

- Unseen workbook: a row with NSN `5305-01-658-2565` and NIIN `016698021`. Assert the pending decision, then each option's outcome.
- Storage: analyze the PENCOM fixture with a saved copy of the XRef record `6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P` / `5305016582565` whose description differs. Assert the pending storage conflict and each option's `ImportPlan`.
