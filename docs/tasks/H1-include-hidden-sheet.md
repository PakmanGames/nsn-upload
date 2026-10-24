# H1 - "Include anyway" for hidden sheets

Product owner decision (D26, was OD4): hidden sheets stay ignored by default, and the user can bring one in, held back for confirmation, so data on a hidden sheet is never out of reach.
Read the Wave 2 rules and the UX bar in `docs/PLAN.md` first.
**Deadline: the submission is due within the hour. Open the PR within about 35 minutes with the smallest complete version.**

## Today

`analyzeSheet` (`src/lib/import/structure/sheet.ts`) returns `status: 'hidden'` with no tables for any sheet whose visibility is not `visible` (hidden and veryHidden). The Sheets section shows "Hidden - ignored" with no action.

## Build

1. Contract (approved exception to E1 owning `model.ts`): `Overrides.includedHiddenSheets?: string[]`.
2. `analyzeSheet`: a hidden sheet named in that list is analyzed like a visible one (detection, remaps, every rule).
3. Its tables wait on an `include-table` decision suggested **include**, with a reason such as "This sheet is hidden in Excel; you asked to include it". Nothing imports until that decision is applied ("Accept all suggestions" applies it).
4. The Sheets line for a hidden sheet gets "Include anyway"; once included, "Hide again" removes it from the list. New `ImportSession.setHiddenSheetIncluded(name, included)`.
5. Hidden sheets are never sent to the AI, included or not (TASK_SPEC: "Do not send hidden sheets").
6. Hidden rows and columns inside visible sheets are unchanged (D7).

## Done when

- A synthetic workbook with a visible parts sheet and a hidden one holding 3 parts: by default only the visible sheet imports; after "Include anyway" and accepting the suggestion, the 3 hidden-sheet records import with provenance naming the hidden sheet.
- WOW's `hiddenSheet` stays ignored by default; including it shows whatever detection finds there without errors.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm test:e2e` pass; one E2E covers "Include anyway".

## Owns

The `Overrides` line in `model.ts`, the hidden branch of `analyzeSheet` in `structure/sheet.ts`, the include suggestion for hidden-sheet tables in `validate/rows.ts`, the hidden line in `SheetsPanel.svelte`, the new session method, and tests.
E1, E3, and AI1 also edit `sheet.ts`, `rows.ts`, and `SheetsPanel.svelte`; keep to your part and keep theirs when you rebase.
