# T7 - Import review window

Owns: `src/lib/components/**`, `src/lib/import/session.svelte.ts`, `src/lib/types.ts`, and removal of the old `src/lib/smart-upload.ts`, `src/lib/smart-upload.test.ts`, `src/lib/components/SmartUploadModal.svelte`.
Read first: `docs/PLAN.md` (rules, D11), `docs/ARCHITECTURE.md` (Validation, duplicates, decisions; AI boundary), `TASK_SPEC.md` sections 1, 2, 6, `src/lib/import/model.ts`, the existing `NsnSettingsTab.svelte` for style.
Match the existing look: Svelte 5 runes, Tailwind, `@lucide/svelte` icons, slate/blue palette.

## Wave 1: build against mock data

Create `src/lib/components/import/mock-analysis.ts`: a typed `WorkbookAnalysis` covering every sheet status, record status, issue code, and decision kind and state (use the PENCOM, WOW, and Statz expectations in PLAN.md as realistic content).
Do not call the real pipeline yet; T0's stubs throw.

`session.svelte.ts` (UI state, no pipeline logic): file, `WorkbookModel`, `Overrides`, `WorkbookAnalysis`, phase (`idle | reading | analyzing | ready | importing | done | error`), AI state.
Every user change updates `overrides` and re-runs `analyze()`; the file is never reread.

Review window: full-screen dialog opened by the existing Smart Upload button, replacing `SmartUploadModal`.

- Upload: drag and drop or browse, `.xlsx` only; phase states with a spinner; `WorkbookReadError` messages shown verbatim.
- Header: file name, summary chips (candidates, valid, warnings, invalid, duplicates, conflicts, split, pending), primary button "Import N records" with "(M need review)".
- Sheets panel: every sheet with a status badge (Ready, Needs review, No importable table, Hidden - ignored), an include toggle for each table, and reasons on expand.
- Table panel: the inferred range and header row(s); one mapping control per column (field dropdown including "Ignore", confidence badge, reasons tooltip, alternatives first). Picking a field already used elsewhere shows which column was unmapped.
- Preview: status filter tabs (All, Valid, Warnings, Invalid, Duplicates, Conflicts, Split, Pending), search across values and cell refs, pagination (100 rows per page). Derived values carry a "derived" tag; split rows show "1 of 2 from D136".
- Provenance drawer on row click: for each field the cell, original text, normalized value, transforms, origin; rejected values with their issue; all issues.
- Decisions panel: "Needs you" (pending, with the suggested option preselected in the control) and "Applied automatically" (grouped by kind, each with an undo or change control). An "Accept all suggestions" button.
- AI: toggle "AI assistance" (off by default, saved in `localStorage`, disabled with the reason when `getAiAvailability()` says unavailable). When on, sheets with `aiTrigger` are sent automatically; show progress and results with an "AI" badge, and rejected proposals with their reasons.
- After import: result summary, close returns to the mappings table showing the new records.

Accessibility: dialog focus trap, Escape to close when idle, labeled controls, visible focus.
Never render cell text with `{@html}`.

## Wave 2: wire the real pipeline (after T1-T6 merge)

- `readWorkbook` -> `analyze(model, mappings, overrides)`, passing the current `MappingRecord[]`; import with `toImportPlan(analysis)` once F1a lands (it replaces `toMappingInputs`), adding new records and replacing saved ones by id. See `docs/tasks/F1-decision-followups.md` (F1d).
- AI: `buildInterpretationRequest` -> `createHttpInterpreter().interpret` -> `verifyInterpretation` -> `overrides.aiTables`.
- Update `NsnSettingsTab.svelte` import handling; delete the old smart-upload files and the unused types in `src/lib/types.ts` (`UploadRow`, `UploadAnalysis`, `ImportResult`), keeping `MappingInput` and `MappingRecord`.
- Drop the "Download sample workbook" link (it used ExcelJS at runtime).

## Done when

The window works on the mock in wave 1 (screenshots in the handoff), then on all 3 fixtures in wave 2 with the counts in PLAN.md.
`pnpm check` and `pnpm build` pass with no Svelte warnings.
