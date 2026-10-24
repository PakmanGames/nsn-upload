# L1 - Mark derived values in the saved list

Product owner decision (D25, was OD2): a value the importer worked out (a NIIN from an NSN, an NSN from FSC + NIIN) stays labeled as derived after import.
TASK_SPEC: "Any derived value must be labeled as derived rather than source-provided."
Read the Wave 2 rules and the UX bar in `docs/PLAN.md` first.
**Deadline: the submission is due within the hour. Open the PR within about 35 minutes with the smallest complete version.**

## Today

- The review window labels derived values ("derived from E2"), from `provenance.origin === 'derived'` on each `FieldValue`.
- `toInput()` in `src/lib/import/validate/index.ts` copies values into `MappingInput` and drops that origin.
- The saved list (`src/lib/components/NsnSettingsTab.svelte`, stored under `nsn-upload-interview-task:mappings`) shows derived values like file values. Every saved Statz record shows a NIIN although Statz has no NIIN column.

## Build

1. Contract in `src/lib/types.ts`: `MappingInput.derived?: Array<'nsn' | 'niin'>`, the stored fields that were worked out rather than read. Optional, so saved data and `demo-data.ts` keep working.
2. `toInput()` sets `derived` from the field provenance; `toImportPlan` carries it for both `add` and `replace`.
3. The saved list shows a small "derived" tag next to such a value, with a tooltip on its own (i) button or `title` ("Worked out from the NSN"). Editing that value by hand in the settings tab clears its flag.
4. Duplicate and storage-conflict matching (D8) ignores the flag.

## Done when

- Importing Statz saves 54 records whose NIIN is flagged derived and NSN is not; WOW records with an NSN column flag only the NIIN.
- Existing saved data without `derived` loads and displays unchanged.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm test:e2e` pass; one E2E checks the tag after importing Statz.

## Owns

`src/lib/types.ts`, `toInput` and `toImportPlan` in `validate/index.ts`, `NsnSettingsTab.svelte`, and their tests.
