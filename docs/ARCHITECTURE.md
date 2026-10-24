# Architecture - NSN Smart Upload

Status: design baseline for the 5-hour build.
Task T8 turns this into the final design note required by `TASK_SPEC.md` (it updates any section that changed during the build).
Contracts live in `src/lib/import/model.ts` (created by T0, specified in [`tasks/T0-contracts.md`](tasks/T0-contracts.md)).

## Principles

1. Deterministic first. A conventional workbook never needs the network.
2. Automate what is certain, hold back what is not. Certain decisions are applied and logged with an undo; uncertain ones are excluded from import and queued with a suggested resolution.
3. Every value comes from a cell. Each imported value carries provenance (file, sheet, row, cell, original text, transforms). Derived values are labeled as derived.
4. The AI proposes structure, never values. It says where a table and its columns are; the deterministic engine reads and validates the cells.
5. Rows and columns are 1-based Excel coordinates everywhere, so what the UI shows matches what users see in Excel.

## Pipeline

```text
File
 -> reader/      readWorkbook()       bytes -> WorkbookModel           (SheetJS lives only here)
 -> structure/   analyzeStructure()   sheets -> tables + column mapping + sheet status + AI triggers
 -> records/     buildRecords()       rows -> CandidateRecords (normalize, split, derive, provenance)
 -> validate/    finalizeAnalysis()   duplicates, conflicts, decisions, approval, summary
 -> UI review window -> toMappingInputs() -> localStorage

 ai/  (optional, beside structure/) sampled sheets -> /api/interpret -> OpenRouter -> verify -> overrides.aiTables
```

`analyze(model, existing, overrides)` in `src/lib/import/analyze.ts` runs structure -> records -> validate.
The UI keeps the parsed `WorkbookModel` and an `Overrides` object (column remaps, decision choices, verified AI tables).
Any user change produces new overrides and re-runs `analyze()`; the file is never reread.

| Module | Path | Owner task |
| --- | --- | --- |
| Contracts, refs, test builders, orchestrator | `src/lib/import/model.ts`, `refs.ts`, `testing.ts`, `analyze.ts` | T0 (then frozen) |
| Reader | `src/lib/import/reader/` | T1 |
| Normalizers + identifier checks | `src/lib/import/normalize/`, `src/lib/import/identifiers.ts` | T2 |
| Table detection + column mapping | `src/lib/import/structure/` | T3 |
| Record building | `src/lib/import/records/` | T4 |
| Validation, dedup, decisions | `src/lib/import/validate/` | T5 |
| AI boundary + server route | `src/lib/import/ai/`, `src/routes/api/interpret/` | T6 |
| Review window UI | `src/lib/components/import/`, `src/lib/import/session.svelte.ts` | T7 |
| Acceptance, E2E, docs | `tests/`, `README.md`, this file | T8 |

## External dependencies

### SheetJS Community Edition 0.20.3 (`xlsx`) - workbook parsing

Why: ExcelJS 4.4.0 (the starter's parser) cannot open 2 of the 3 supplied fixtures.
PENCOM and WOW were written by the .NET Open XML SDK with prefixed namespaces (`<x:workbook>`, `<x:sheet>`), which is valid OOXML but not handled by ExcelJS.
SheetJS reads all three, exposing sheet visibility (including `veryHidden`), column widths and hidden flags, hidden rows, merges, cell types (`s`, `n`, `b`, `e`, `d`), number formats, formula text with cached results, and raw package parts.

How it is installed: from the vendor tarball, `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
The npm registry `xlsx` package is stuck at 0.18.5, which has a published prototype-pollution issue (fixed in 0.19.3) and a ReDoS issue (fixed in 0.20.2).
License: Apache-2.0.

How it is contained:

- Only `src/lib/import/reader/` imports `xlsx`. Every other module sees the library-neutral `WorkbookModel`. Swapping parsers means rewriting one directory.
- It is loaded with a dynamic `import()` inside `readWorkbook()`, so it stays out of the initial page bundle.
- It never evaluates formulas; only cached results are read.

Known pitfalls the reader must handle (each has a test in T1):

- Never use the formatted text `cell.w` for General-format numbers; SheetJS may render 13-digit integers in exponent form. Integers are rendered exactly from the raw value.
- Zero-width columns (`width: 0`, `hidden: false`) are hidden in practice (WOW columns A-C). Treat them as hidden.
- `!ref` includes styled empty cells (PENCOM reports `A1:Z1000` with about 15 real rows). Compute the value extent from non-empty cells instead.
- Literal strings stored as `t="str"` (formula-string type without a formula, used by PENCOM) arrive as normal strings.

Risks: the CDN tarball is a single-vendor download source.
The lockfile pins its integrity hash; if the CDN becomes unavailable, vendor the tarball into the repo.

### OpenRouter - optional LLM provider

Used only by the server route `src/routes/api/interpret/+server.ts` when `OPENROUTER_API_KEY` is set and the user turned on AI assistance.
The key never reaches the browser.
The model is configurable with `OPENROUTER_MODEL`.
`AI_PROVIDER=mock` swaps in the mock interpreter for E2E tests and demos without network access.

## Structure detection and mapping (T3)

- Header vocabulary is small and token-based: part (`part`, `p/n`, `pn`, `part number`, `part no`), description (`description`, `nomenclature`, `item name`), nsn, niin, cage (`cage`, `cage code`), fsc.
  Unknown extra words (vendor prefixes such as `PENCOM`, `G & B`) are allowed; modifier words (`found`, `status`, `date`, `url`, `notes`, `equivalent`, `family`, `matchability`, `do not modify`, `checksum`) downgrade a match to weak.
- Values decide. Each candidate column gets a value pass rate over its non-empty data cells: strict checks for NSN, NIIN, CAGE, FSC; a plausibility check for part numbers (length 1-40, contains a digit, not a UUID, URL, date, long base64, or sentence).
- Only NSN and NIIN may be mapped from values alone, because only they have strict validators. Part, description, CAGE, and FSC need a header match.
- Assignment is one-to-one: each column maps to at most one field and each field to at most one column per table.
- Column confidence: high = strong header and pass rate of at least 0.9; medium = strong header with pass rate 0.6-0.9, or weak header with at least 0.9, or value-only NSN/NIIN with at least 0.95; low = anything weaker that is still mapped.
- Table status: `ready` when a primary column (part, nsn, niin) is high and no mapped primary column is low; `needs-review` when the best primary column is medium or two columns compete for a primary field; otherwise no table.
- Inside a table: blank rows, hidden rows, and repeated header rows are skipped and listed; rows with values only in unmapped columns are skipped as `no-mapped-values`.
- `aiTrigger` is set when a sheet has identifier-shaped values but no ready table, or competing candidates.

## Normalization (T2) and records (T4)

| Field | Rule |
| --- | --- |
| NSN | Trim, strip whitespace and dash variants, exactly 13 digits. |
| NIIN | Same separators, exactly 9 digits. A numeric cell with fewer digits gets `restore-leading-zeros` plus a warning. |
| FSC | Exactly 4 digits; used only to derive an NSN. |
| CAGE | Trim, uppercase, exactly 5 alphanumerics. |
| Part | Trim only. Never strip hyphens, never split on spaces or punctuation. Numeric cells get `numeric-to-text` plus a warning; date cells are invalid (Excel destroyed the original). |
| Description | Trim; line breaks kept as LF. |

- A cell that is only `-` is empty. CRLF and CR become LF. Identifiers are never routed through `Number()`.
- A part, NSN, or NIIN cell with several newline-separated values is split into one record per value (`split-cell`, applied automatically). If two identifier fields in the same row are multi-valued, the row is `ambiguous-multi-value` and held back.
- NSN valid -> NIIN derived. FSC + NIIN without NSN -> NSN derived. If NSN, NIIN, and FSC are all present and disagree, the row is a conflict.

## Validation, duplicates, decisions (T5)

Identity key: part (uppercased, whitespace collapsed) + NSN (or NIIN when no NSN), with CAGE compared only when both records have one.
One part with several NSNs is several records, never a duplicate.
The same NIIN under different FSCs gets an `fsc-niin-mismatch` warning on every record involved; all are imported.

| Situation | Policy | State |
| --- | --- | --- |
| Hidden sheet, blank/styled/repeated-header rows | Skipped and listed | automatic, no decision |
| Ready table | Included | auto |
| Needs-review table (incl. AI tables that fail thresholds) | Held back, suggest exclude | pending |
| Newline-separated identifiers | Split | auto, undo = keep as one |
| Two multi-valued identifier fields in one row | Held back, suggest pair in order | pending |
| Malformed field but another valid primary identifier | Import valid portion, drop the malformed value | auto, undo = exclude row |
| Exact duplicate in one table | Drop later copies | auto |
| Same identity across sheets, compatible fields | Merge (union of fields, provenance per field) | auto |
| Same identity across sheets, conflicting fields | Held back, suggest the record with more filled fields | pending |
| Already in localStorage | Drop | auto, undo = keep |

The review window shows "Needs you" (pending) and "Applied automatically" (auto) lists.
"Accept all suggestions" resolves every pending decision in one click.
Pending subjects are excluded from import, so importing never blocks on them.

## AI boundary (T6)

- Trigger: `SheetAnalysis.aiTrigger` is non-null and AI assistance is on (off by default, persisted per browser).
- Request: only visible triggered sheets; hidden rows and columns, and columns that look like UUIDs, checksums, or timestamps, are removed. Limits: 3 sheets, 60 rows per sheet (first 40 non-empty rows plus 20 sampled), 30 columns, 120 characters per cell, 3000 cells total.
- Server route: validates the request body again, calls OpenRouter chat completions with `response_format: { type: "json_schema", strict: true }` and `provider: { require_parameters: true }`, then validates the response with Zod.
- The model returns tables as `{ sheetName, range, headerRows, columns: [{ field, col, headerText }], confidence, reasons }`. No cell values.
- Verification in the browser, against the full workbook: the sheet was in the request; the range is within the value extent; header rows are inside the range; columns are inside the range and not hidden or excluded; one field per column; `headerText` matches the real header cell (catches off-by-one). The table is then materialized by T3's `materializeTable()`, which computes the same pass rates and thresholds as the deterministic path.
- Applied automatically only if verification passes and the table reaches `ready` on its own values. Otherwise it is a pending include-table decision marked with an AI badge. Rejected proposals are listed with the reason.
- Cell contents are data, not instructions: the system prompt says so, the output schema has no free-text field that is acted on, and verification ignores anything the model says beyond structure.

## Performance and safety

- SheetJS is lazy-loaded. Analysis runs on the main thread with a progress state between read and analyze (a Web Worker is out of 5-hour scope; the pure pipeline makes moving it later mechanical).
- No quadratic scans: one pass per row for detection; duplicates grouped through `Map` keys.
- Limits: 20 MB file, 50 sheets, 100,000 rows per sheet, 2,000,000 non-empty cells. Exceeding one gives a specific error.
- `.xlsx` only. No formula evaluation, macros, or external links. Cell text is rendered through Svelte text interpolation, never `{@html}`.
- No network request during parsing or import; only the explicit AI path calls `/api/interpret`.

## Known gaps (accepted for the 5-hour scope)

- Multiple different tables side by side or stacked on one sheet: only the best table per sheet is imported; others are listed as reasons.
- Header split across two rows: supported only for the simple case of two adjacent header-like rows (P1).
- No automatic fill-down of blank cells (only explicit merges are filled).
- Footer and totals rows that put text in the part column can become candidate records; they show up in the preview with a plausibility warning.
- AI segmentation of complex multi-value regions is not implemented.
