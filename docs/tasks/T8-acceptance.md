# T8 - Acceptance tests, unseen-workbook coverage, E2E, docs

Owns: `tests/`, `playwright.config.ts`, `README.md`, `docs/ARCHITECTURE.md`, the `scripts` section of `package.json`, and the `test` block of `vite.config.ts`.
First change: set `test.include` in `vite.config.ts` (for example `src/**/*.test.ts` and `tests/acceptance/**/*.test.ts`) so Vitest never runs Playwright's `tests/e2e/*.spec.ts`.
Read first: `docs/PLAN.md` (rules, fixture expectations, messy cases), `docs/ARCHITECTURE.md`, `TASK_SPEC.md` (acceptance cases, testing expectations, deliverables), `src/lib/import/model.ts`.
You are also the integrator in wave 2: run everything, find failures, and route each one to the owning task with a minimal reproduction.

## Wave 1 (0:30-3:00): write the targets before the code exists

- `tests/fixtures/expectations.ts`: the PLAN.md fixture expectations as typed data.
- `tests/acceptance/fixtures.test.ts`: reads each real workbook from `example-excel-uploads/` through `readWorkbook` -> `analyze(model, [], {})` and asserts the expectations: sheet statuses, header rows, column mappings, source row and record counts, NSN valid/malformed counts and cells, splits, skipped rows, the 9 `fsc-niin-mismatch` records, the 2 PENCOM pending conflicts, and `toImport` before and after accepting all suggestions.
- `tests/acceptance/unseen.test.ts`: synthetic workbooks built in the test with ExcelJS (a different writer than the fixtures), covering cases that are not in the fixtures:
  - title plus merged header cells, header on row 4;
  - header with a line break (`Part\nNumber`) and a vendor prefix;
  - numeric NIIN `16582565` -> `016582565` with a warning;
  - FSC and NIIN columns, no NSN column -> derived NSN labeled derived;
  - two visible sheets with the same mapping, one compatible and one conflicting duplicate;
  - a hidden sheet with valid NSNs that must be ignored;
  - a multi-line description next to a multi-line part cell;
  - a sheet of notes that mentions "NSN" and "part number" in prose -> no table;
  - a duplicate against the `existing` storage records;
  - every `Provenance.cell` equals the A1 cell that holds the original text.
- Gate both files behind `ACCEPTANCE=1` (`describe.skipIf`) and add a `test:acceptance` script, so `main` stays green until wave 2.

## Wave 2 (3:00-4:15): integration

- Remove the gate once T1-T6 have merged; run the acceptance suite after every merge.
- For each failure: identify the owning module, write the smallest failing unit test that reproduces it, and hand it to that task's agent. Do not fix other tasks' modules yourself unless the coordinator asks.

## Wave 3 (4:15-5:00): E2E and docs

- Playwright (`pnpm exec playwright install chromium`), `tests/e2e/import.spec.ts` against `pnpm build && pnpm preview`, with `AI_PROVIDER=mock`:
  - upload each fixture, check the sheet badges and the summary chips match the expectations, import, and see the records in the mappings table;
  - PENCOM: "Accept all suggestions" changes "Import 0 records" to "Import 2 records";
  - AI toggle on a sheet with an `aiTrigger` shows the mock proposal with an AI badge.
- `README.md`: run instructions, `pnpm test`, `pnpm test:acceptance`, `pnpm test:e2e`, the env vars (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `AI_PROVIDER`), and a short "how it works".
- `docs/ARCHITECTURE.md`: turn it into the design note the spec asks for. Update every section to match what was actually built (table and header detection, confidence scoring, normalization and dedup, performance, AI boundary, tradeoffs and unsupported cases), using the handoff notes from T1-T7.

## Done when

`pnpm test`, `pnpm test:acceptance`, `pnpm test:e2e`, `pnpm check`, and `pnpm build` all pass on `main` by 4:45.
