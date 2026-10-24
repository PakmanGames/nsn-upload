# NSN Smart Upload

A standalone **Settings -> NSNs** page whose Smart Upload imports real-world Excel workbooks: several sheets, titles above the table, repeated headers, metadata columns, two part numbers in one cell, and sheets that only mention NSNs.
Every sheet is classified, columns are mapped from headers and values, identifiers are normalized with full provenance, and a review window shows every decision before anything is saved.
Imported records stay in the browser's `localStorage`; there is no backend.

- Design note (how and why it works, tradeoffs, unsupported cases): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Exercise brief: [`TASK_SPEC.md`](TASK_SPEC.md)
- Example workbooks: [`example-excel-uploads/`](example-excel-uploads/)

## Run it

Requires Node 20.19+ or 22.12+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open the URL Vite prints, click **Smart Upload**, and choose an `.xlsx` file, for example one from `example-excel-uploads/`.

To run the production build locally:

```bash
pnpm build
pnpm preview
```

## AI assistance

The importer is deterministic and needs no key or network.
AI assistance is its fallback for sheets it cannot read confidently: a table that needs review, or NSN- or NIIN-shaped values without a recognized table.
It is on by default whenever the server has AI configured, and it only ever proposes structure (which rows and columns form a table), which is then verified against the workbook.

**What is sent, and to whom.**
Only the sheets the importer flagged, as a bounded sample of cells: at most 3 sheets, 60 rows and 30 columns per sheet, 120 characters per cell, and 3,000 cells in all.
The browser posts the sample to this app's own route `/api/interpret`, which forwards it to OpenRouter (or the mock, below); the provider key stays on the server.
Hidden sheets, hidden rows and columns, and metadata columns (UUIDs, checksums, timestamps) are never sent.
A workbook whose sheets all read without help sends no cells; the review window only asks the route once whether AI is available.
While the AI reads a sheet, the summary bar and that sheet's line say so, and the AI assistance section at the bottom of the review window says what is sent.

**Turning it off.**
Use the "AI assistance" switch in that section.
The choice is saved in this browser (`localStorage` key `nsn-upload-interview-task:ai-assistance`), and from then on the browser makes no AI request of any kind, not even the availability check, until the switch is turned back on.

**Without a key**, nothing goes to any provider: the route reports AI as unavailable, the switch shows off with that reason, and everything else works.
The saved choice is left as it was, so the same browser gets AI once the server has a key.

**Why on by default (decision D23 in [`docs/PLAN.md`](docs/PLAN.md)).**
`TASK_SPEC.md` asks that network transmission be disabled unless AI parsing is explicitly enabled.
The product owner accepted on-by-default as a deviation from a literal reading, because AI is the fallback for exactly the sheets the importer cannot read, and a user should not have to find a switch first.
The deviation is kept small: nothing is sent without a server key, only flagged sheets are sent and only as sampled cells, and the switch turns it off for good on this browser.

To configure it, copy the example env file; `.env` is gitignored:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | For live AI | OpenRouter API key. Read only by the server route `/api/interpret`; it never reaches the browser. Without it, the AI switch is disabled with the reason, and everything else works. |
| `OPENROUTER_MODEL` | No | OpenRouter model slug. Defaults to `anthropic/claude-opus-5.5`; the model must support structured outputs. |
| `AI_PROVIDER` | No | `mock` uses the built-in mock interpreter instead of OpenRouter: no key and no network. The E2E tests use it, and it is handy for demos. It takes precedence over `OPENROUTER_API_KEY`. |

To see the AI path without a key:

```bash
AI_PROVIDER=mock pnpm dev
```

Of the example workbooks, PENCOM's `Search Log` (a table that needs review) is sent and read; the others read without help and send nothing.
AI is also used for a sheet with NSN- or NIIN-shaped values but no confidently recognized table, such as NSNs under an unfamiliar header like `National Stock No.` (`docs/demo-workbooks/a-ai-unfamiliar-header.xlsx`).

## Tests and checks

| Command | What it runs |
| --- | --- |
| `pnpm test` | All Vitest suites: unit tests per pipeline stage and the acceptance suites. |
| `pnpm test:acceptance` | Only `tests/acceptance/`: the three example workbooks end to end through the real reader and pipeline, plus synthetic "unseen" workbooks written with ExcelJS. |
| `pnpm test:e2e` | Playwright in Chromium against a production build (`pnpm build`, then `pnpm preview` on port 4173) with `AI_PROVIDER=mock`. |
| `pnpm check` | Svelte and TypeScript type checks. |
| `pnpm build` | Production build. |

Before the first E2E run, install the browser once:

```bash
pnpm exec playwright install chromium
```

The expected numbers for the example workbooks live in [`tests/fixtures/expectations.ts`](tests/fixtures/expectations.ts) and are shared by the acceptance and E2E suites.

## How it works

```text
.xlsx -> reader -> structure -> records -> validate -> review window -> localStorage
         cells     tables,      normalize, duplicates, correct mappings,
                   headers,     split,     conflicts,  make decisions,
                   mappings     derive     decisions   import
```

1. **Read.** SheetJS turns the file into a plain workbook model: every sheet with its cells, merges, and hidden rows and columns.
   Formulas are never evaluated.
2. **Find tables.** Each visible sheet is checked for a header row, which may sit below titles.
   Header text only nominates a column; the values below decide whether it really holds part numbers, NSNs, NIINs, CAGE codes, or descriptions.
3. **Build records.** Each data row is normalized field by field.
   Several part numbers in one cell become one record each, a NIIN is derived from a valid NSN, and every value keeps its source cell and transformations.
4. **Validate.** Duplicates, conflicts across sheets, and matches against saved records are found by normalized identity.
   Certain cases are applied automatically with an undo; uncertain ones are held back with a suggested answer, and "Accept all suggestions" resolves them in one click.
5. **Review and import.** The review window shows sheet statuses, mappings, a filterable preview, and where every value came from.
   Only approved records are imported.

The pipeline is a pure function, `analyze(model, existing, overrides)` in `src/lib/import/`, so every correction re-runs it without reading the file again.
The design note covers each step in detail.

## Project map

```text
src/lib/import/               the import pipeline, one directory per stage
├── model.ts                  shared types and contracts
├── reader/                   .xlsx -> workbook model (the only code that imports SheetJS)
├── structure/                table and header detection, column mapping, sheet status
├── normalize/                per-field normalization and validation
├── records/                  candidate records with provenance
├── validate/                 duplicates, conflicts, decisions, summary, import plan
└── ai/                       optional AI request, verification, and mock
src/lib/components/import/    the review window
src/routes/api/interpret/     server route for the optional AI provider
tests/acceptance/             end-to-end pipeline tests on real and synthetic workbooks
tests/e2e/                    Playwright tests of the upload flow
```
