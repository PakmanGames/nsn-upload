# NSN Smart Upload - Build Plan and Status

Requirements: [`TASK_SPEC.md`](../TASK_SPEC.md).
Design note (how it works, for reviewers): [`ARCHITECTURE.md`](ARCHITECTURE.md).
Agent briefs: [`tasks/`](tasks/).
Parked questions for the product owner: [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md).

This file is the working plan: scope, task status, decisions, and the backlog.
For how the importer works, read ARCHITECTURE.md instead.

## Status

| Task | What | State |
| --- | --- | --- |
| T0 | Shared contracts, test builders, stubs, dependencies | Merged (#1) |
| T1 | Reader: SheetJS -> `WorkbookModel` | Merged (#4) |
| T2 | Field normalizers | Merged (#2) |
| T3 | Table detection, column mapping, sheet status | Merged (#7); fix for part values that start with a header word merged (#9) |
| T4 | Candidate records with provenance | Merged (#3) |
| T5 | Validation, duplicates, conflicts, decisions | Merged (#6) |
| T6 | AI boundary, OpenRouter route, verifier, mock | Merged (#5) |
| T7 | Review window UI | Merged (#11); F1d and polish (#17); AI panel disclosure (#19) |
| T8 | Acceptance suites, E2E, README | Merged: wave 1 (#8), wave 2 (#10), wave 3 E2E + README (#16, #18) |
| F1 | Two new pending decisions ([brief](tasks/F1-decision-followups.md)) | Complete: F1a (#12), F1b (#14), F1c (#15), F1d (#17), F1e (#13) |
| UX1 | Review window redesign, summary first ([brief](tasks/UX1-review-window-redesign.md), [prototype](prototypes/review-window/index.html)) | Merged (#22); E2E coverage (#29) |
| OD3 | Two-row header detection, plus two header/footer bugs found by T8's messy-case suite (#21) | Merged (#25) |
| Zip bomb | Reject workbooks that expand to more than 200 MB (D21) | Merged (#24) |
| Polish | Settled conflicts counted as valid (#26); Rows title count (#27); tooltips only on their own (i) button (#28) | Merged |
| Row checkbox | Uncheck a row in the Rows preview to leave it out of the import (#30) | Merged |

Wave 1 is merged; `main` passes 605 tests and 13 browser tests.
Wave 2, from the review on 2026-10-24, is below.

## Wave 2 - review feedback (2026-10-24)

The review asked for more edge cases, UI polish, and user experience work.
Edge cases and the spreadsheet view go first; polish and UX items follow as their own briefs.
Four new workbooks came with the feedback and are in `example-excel-uploads/`.

| Task | What | Fixture | State |
| --- | --- | --- | --- |
| E1 | Tables without a header row; set up a table by hand ([brief](tasks/E1-headerless-and-manual-tables.md)) | `Just NSNs (1).xlsx` | Not started |
| E2 | Where a table ends; merged columns; columns without a header ([brief](tasks/E2-table-edges-and-merged-columns.md)) | `Merged Column, FSC + NIIN NSN Tests (1).xlsx` | Not started |
| E3 | Several tables on one sheet, at any column offset ([brief](tasks/E3-several-tables-per-sheet.md)) | `ShiftedTable.xlsx` | Not started |
| E4 | Part column chosen by its values; one FSC for several NSNs; headers that only mention a field ([brief](tasks/E4-columns-by-values-and-multi-nsn-cells.md)) | `Substring Headers in Diff Sheet (1).xlsx` | Not started |
| V1 | The spreadsheet inside the review window, with a focus hook for hover highlighting ([brief](tasks/V1-spreadsheet-view.md)) | all | Not started |
| V2 | Hovering the review highlights the matching cells (outlined at the end of the V1 brief) | all | After V1 |

All five briefs start in parallel.

### Wave 2 rules (in addition to the rules below)

1. Each task owns the paths listed at the end of its brief. `model.ts` changes only in E1 (its brief has the exact contract).
2. Shared files, and who edits which part:

   | File | E1 | E2 | E3 | E4 | V1 |
   | --- | --- | --- | --- | --- | --- |
   | `structure/detect.ts` | one call in the no-header branch | `tryHeader` span | `detectTable`, `nextTable` | | |
   | `structure/sheet.ts` | manual-table branch | | deterministic branch | | |
   | `structure/columns.ts` | | `readHeader` | | value-only rules | |
   | `session.svelte.ts` | two methods | | | | `focus` state |
   | `SheetsPanel.svelte` | setup control | | one line per table | | |
   | `ColumnsPanel.svelte` | | "(no header)" label | group headings | | |

   Keep your edits inside your part, and when you rebase after another task merged, keep its behavior and rerun the whole suite.
3. Each new fixture gets its own expectations file (`tests/fixtures/<name>.ts`) and acceptance suite (`tests/acceptance/<name>.test.ts`). Do not add to `FIXTURES` in `expectations.ts`; the coordinator registers the new fixtures after the merges.
4. The WOW, Statz, and PENCOM expectations stay green. A change to them must be explained in the PR, not silently updated.
5. Merge order when several are ready at once: E4, E2, E3, E1; V1 at any time.

### Defaults the briefs assume (product owner can overrule)

- **Headerless sheets (E1):** detected automatically and offered as one pending decision suggested "include", plus a by-hand setup for any sheet without a table. "Manually add a column" is read as mapping a column by hand on a sheet where no table was found.
- **Second table on a sheet (E3):** each table becomes its own line in Sheets, with its own decision, columns, and rows ("like a separate sheet"), but provenance keeps the real sheet name. Side-by-side tables that share rows are left for later.
- **Spreadsheet view (V1):** values only, drawn from the parsed workbook; Excel formatting (fills, fonts) is not shown. The importer's findings are drawn on top.

Beyond Wave 2, what remains is in [Backlog](#backlog-future-ideas) and [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md).

## Scope (5-hour build)

| Priority | In scope | Grading area it serves |
| --- | --- | --- |
| P0 | All sheets classified, header below titles, repeated headers, blank and styled-empty rows | Correctness 30% |
| P0 | Small header vocabulary + value-based mapping, one-to-one assignment, confidence with reasons | Parsing design 20% |
| P0 | Field normalizers, NSN/NIIN derivation, newline splits, all spec issue codes, duplicates in table / across sheets / vs storage | Correctness, parsing design |
| P0 | Review window: sheets, mapping editor, preview with filters + search, provenance drawer, decisions panel, import | UX 15% |
| P0 | Golden tests on the 3 fixtures + synthetic "unseen" workbooks | Correctness, tests 10% |
| P0 | AI interface, triggers, bounded request, verifier, mock, live OpenRouter route | Performance and AI design 10% |
| P0 | F1: NSN/NIIN contradictions and storage conflicts as pending decisions | Correctness, UX |
| Later | See [Backlog](#backlog-future-ideas) | Documented as known gaps |

## Rules for every agent

1. Read `TASK_SPEC.md`, `docs/ARCHITECTURE.md`, and your brief before coding.
2. Edit only the paths your task owns. `src/lib/import/model.ts` changes only through a coordinator-approved contract PR (F1a is one).
3. Branch from `origin/main` (`git fetch origin` first) and rebase onto `origin/main` before opening or updating a PR. Never build on another task's branch.
4. Stage only paths you own (`git add <path>`, never `git add -A`). Never use `git stash`: the stash is shared across all worktrees.
5. `pnpm test`, `pnpm check`, and `pnpm build` must pass. Open a PR with your handoff as the description; the product owner reviews and squash-merges.
6. No hardcoded sheet names, file names, or fixture-specific rules.
7. Commit messages: `feat:` / `fix:` / `test:` / `docs:` / `chore:` prefix, imperative, at most 72 characters, no co-author trailers.
8. Hand off with: what is done, what is not, test count, and any contract change you need.
9. Notes for the design note go to the coordinator, who owns `docs/ARCHITECTURE.md` and this file.

## Decisions

| # | Decision | Decided by |
| --- | --- | --- |
| D1 | SheetJS CE 0.20.3 (vendor tarball) is the parser, imported only by `reader/`. ExcelJS could not open 2 of the 3 fixtures. | Product owner |
| D2 | The LLM is reached through OpenRouter from a SvelteKit server route; the key stays server-side; `AI_PROVIDER=mock` for tests. | Product owner |
| D3 | The AI returns structure only. A proposal is applied automatically only when it passes verification and reaches `ready` on the real cells; otherwise it is a pending decision. | Plan |
| D4 | Same NIIN under different FSCs: all records imported, each flagged `fsc-niin-mismatch`. | Plan |
| D5 | Low-confidence tables (for example PENCOM `Search Log`) are held back as pending, suggested exclude. | Plan |
| D6 | A malformed field next to another valid primary identifier: the valid portion imports automatically; the malformed value is dropped and listed. | Plan |
| D7 | Hidden rows and columns in visible sheets are skipped and counted. | Plan |
| D8 | Identity for duplicates: part (uppercased, whitespace collapsed) + NSN, or NIIN when there is no NSN; CAGE compared only when both records have one. Stored values stay original. | Plan |
| D9 | Annotated part numbers (`12273108 (EATON M144E)`) are kept verbatim with a warning. | Plan |
| D10 | Rows with values only in unmapped columns are skipped and counted, not shown as invalid. | Plan |
| D11 | Automation: certain decisions are applied and logged with an undo; uncertain ones are held back with a suggestion; "Accept all suggestions" resolves them in one click. | Product owner |
| D12 | A row whose NSN contradicts its own NIIN or FSC is a pending decision (prefer NSN, prefer NIIN/FSC, or exclude; suggested exclude). | Product owner (F1) |
| D13 | A new record matching a saved one with a different description or CAGE is a pending decision (keep saved, replace saved, or keep both; suggested keep saved). | Product owner (F1) |
| D14 | The review demo uses the current OpenRouter key from a gitignored `.env`; the key is rotated after the review. Without a key the AI toggle is disabled with the reason, and `AI_PROVIDER=mock` shows the AI path offline. | Product owner |
| D15 | The extras below are deferred to the backlog and described in the design note as future work. | Product owner |
| D16 | Data stops before a clearly different table's header instead of running to the bottom of the sheet; a table whose best primary column is weak is `needs-review`, not `no-table`, so the user can still fix it. | T3, accepted |
| D17 | Excel error cells (`#N/A`) are rejected values with an `invalid-identifier` issue, not empty cells. | T2, accepted |
| D18 | The planning docs (`PLAN.md`, `OPEN-DECISIONS.md`, `tasks/`) stay in the submitted repo next to the design note. | Product owner |
| D19 | A word containing digits makes a header match weak (`PN-4410` is a value), so a header like `Part Number 2` reaches at most medium confidence. | T3 (#9), accepted |
| D21 | Zip-bomb guard: reject a workbook whose declared uncompressed size is over 200 MB. A legitimate workbook at the 2,000,000-cell limit measured about 90 MB unzipped, the example files expand 4-12x, and zip bombs 100x or more. | Product owner |
| D22 | Two-row header detection (OD3) is built now: today a split label like "Part" above "Number" can import a junk record and lose columns. | Product owner |
| D20 | The review window becomes summary-first (UX1): one sentence and the pending decision first, everything else in collapsed sections with one-line summaries; all of R1-R9 kept; Columns opens by default only when a column is medium or low confidence or was remapped. Not a "simple mode" setting. | Product owner, after the prototype |

## Backlog (future ideas)

Deferred by D15; revisit if time allows. Each is listed as a known gap in ARCHITECTURE.md.

| Idea | Why it matters | Rough size | Owner if picked up |
| --- | --- | --- | --- |
| Multiple tables per sheet | Picked up as E3 (stacked tables). Side-by-side tables that share rows remain a gap. | | E3 |
| Web Worker parsing | Encouraged, not mandatory. 100k rows x 10 columns analyze in about 1.5 s on the main thread today. | ~1 h | T1 + T7 |
| Merge compatible new info into saved records | A re-upload that only adds a missing description or CAGE could update the saved record instead of being dropped. | ~30 min after F1 | T5 |
| AI segmentation of complex multi-value cells | TASK_SPEC lists it as an AI use case; not implemented. | ~1 h | T6 |
| Remap a `no-table` sheet by hand | Picked up as E1. | | E1 |

## Fixture expectations (encoded in `tests/fixtures/expectations.ts`, verified against the real files)

**WOW** (`Active Parts`): 179 source rows -> 180 candidate records (D136 splits into `12669555` and `RVX08212`).
`hiddenSheet` (veryHidden) ignored; columns A-C (UUID, checksum, modified date, width 0) not mapped; Part = D, NSN = E, Description = F.
129 non-empty NSN cells: 127 valid; 2 malformed (`E134` `12663107`, equal to part D134; `E166` `280-035-330-101F`), both imported as valid portion.
F180 has no description. All 180 records importable.

**Statz** (`Sheet1`): 54 records, all NSNs valid; R32-R33 blank and R34 repeated header skipped.
Part = A (`G & B P/N`); B `Dwg Number` not mapped (offered as an alternative); no Description or CAGE column (one table-level notice).
`fsc-niin-mismatch` on 9 records: rows 20/22, 25/26, 37/38/39, 44/45.
13 parts map to several NSNs; all retained. All 54 importable.

**PENCOM**: 6 visible sheets; `NSN Cross-Reference` and `Part Number Intake` headers on row 2; about 26,000 styled empty cells per sheet ignored.
Ready: `NSN Cross-Reference` (2 records), `Part Number Intake` (2 records, rows 5-7 skipped as no-mapped-values).
Needs review (held back): `Search Log`. No table: `Dashboard`, `Opportunity Matrix`, `Sources & Notes`.
2 pending conflicts across XRef and Intake (same part + NSN, descriptions `Screw, Machine` vs `6-32 x 1/4 pan-head SEMS machine screw`, `Screw, Assembly` vs `Assembly screw`); the suggestion prefers the XRef record (more fields, CAGE `0BWZ1`).
Before resolving, 0 records import; after "Accept all suggestions", 2 records import.

## Messy cases (seed list for tests)

| Case | Example | Handling |
| --- | --- | --- |
| Header traps | `(Do Not Modify) Part` (UUIDs), `NSN Found` (Yes), `NSN Matchability (1-5)`, `Mfg.` (Y/N), `Manufacturer` (PENCOM) | Values must pass; header text alone never wins. |
| Competing part columns | Statz `Dwg Number`, PENCOM `MIL/MS/NAS Equivalent` | Offered as alternatives or left unmapped. |
| Part punctuation | `10931023*92`, `BH011-HT REV 000`, `2132981-2  C`, `PPIM 21023`, `12542334-GRN` | Trim only. |
| Exponent-shaped part | `13211E9213` | Read as text; never `Number()`. |
| NIIN look-alike part | `201018858` in a part column | Stays a part; the column decides. |
| Numeric identifier cells | Statz B2 `7646198` stored as a number; numeric NIIN `16582565` | `numeric-to-text`; NIIN gets `restore-leading-zeros` plus a warning. |
| Date-mangled part | `3-4` stored as a date | Invalid: the original is unrecoverable. |
| Wrong-column paste | WOW E134 NSN equals D134 part | Malformed NSN; the message names the matching cell. |
| Multi-value cells | WOW D136; multi-line description | Identifier split; description kept whole. |
| NSN variants | `5305 01 658 2565`, en dash, NBSP, `NSN: ` prefix | Separators and label stripped and recorded; exactly 13 digits. |
| Derivation | FSC + NIIN, no NSN | NSN derived and labeled; disagreement with a present NSN is a pending decision (D12). |
| Merged data cells | Part merged down 3 NSN rows | `merge-fill` from the master, same column only. Plain blanks are never filled. |
| Placeholder / footer rows | PENCOM Intake rows 5-7 | Skipped and counted. |
| Error / formula cells | `#N/A`; formula without a cached value | Error cell: rejected value with an issue (D17). Formula without a cached value: empty. |
| LLM output | Invented column, off-by-one header, unknown sheet, `$A$2` refs | Rejected by the verifier with a reason (`$` stripped first). |
