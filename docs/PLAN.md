# NSN Smart Upload - 5-Hour Build Plan

Requirements: [`TASK_SPEC.md`](../TASK_SPEC.md).
Design: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Agent briefs: [`tasks/`](tasks/).

## Scope for 5 hours

Assumption: 5 hours of wall-clock time with up to 8 agents working in parallel.

| Priority | In scope | Grading area it serves |
| --- | --- | --- |
| P0 | All sheets classified (ready / needs review / no table / hidden), header below titles, repeated headers, blank and styled-empty rows | Correctness 30% |
| P0 | Token header vocabulary + value-based mapping, one-to-one assignment, confidence with reasons | Parsing design 20% |
| P0 | Field normalizers, NSN/NIIN derivation, newline splits, all spec issue codes, duplicates in table / across sheets / vs storage | Correctness, parsing design |
| P0 | Review window: sheet list, mapping editor, preview with status filters + search + pagination, provenance drawer, decisions panel, import | UX 15% |
| P0 | Golden tests on the 3 fixtures + synthetic "unseen" workbooks | Correctness, tests 10% |
| P0 | AI interface, triggers, bounded request, verifier, mock, OpenRouter server route | Performance and AI design 10% |
| P1 | Two-row headers, merged-cell fill in data, hidden-row toggle, zip size check, Playwright smoke test per fixture | |
| P2 (out) | Web Worker, multiple tables per sheet, AI multi-value segmentation, Excel Table object hints, NCB/FSC code lists | Documented as gaps |

## Timeline

| Wall clock | Wave | Work |
| --- | --- | --- |
| 0:00-0:30 | 0 | T0: contracts, stubs, dependencies, hygiene. T1-T8 start at the same time against the contract, using local scaffolding (rule 3). |
| 0:30-3:00 | 1 | T1-T8 in parallel. T1 and T2 merge first (around 2:00), then T3-T6, and T7 merges on its mock data. |
| 3:00-4:15 | 2 | Integration: T7 wires the real pipeline; T8 turns on golden tests and routes failures to the owning task. |
| 4:15-5:00 | 3 | T8: Playwright smoke, README, final design note. Freeze at 4:45. |

## Tasks

| Task | Brief | Owns | Needs | Est. |
| --- | --- | --- | --- | --- |
| T0 Contracts | [T0](tasks/T0-contracts.md) | `src/lib/import/{model,refs,testing,analyze}.ts`, stubs, `package.json`, `.gitignore` | - | 0.5h |
| T1 Reader | [T1](tasks/T1-reader.md) | `src/lib/import/reader/` | T0 | 1.5h |
| T2 Normalizers | [T2](tasks/T2-normalize.md) | `src/lib/import/normalize/`, `src/lib/import/identifiers.ts` | T0 | 1.5h |
| T3 Structure | [T3](tasks/T3-structure.md) | `src/lib/import/structure/` | T0 (T1 for fixture checks) | 2.5h, critical path |
| T4 Records | [T4](tasks/T4-records.md) | `src/lib/import/records/` | T0 (T2 at merge) | 2h |
| T5 Validation + decisions | [T5](tasks/T5-validate.md) | `src/lib/import/validate/` | T0 | 2.5h |
| T6 AI boundary | [T6](tasks/T6-ai.md) | `src/lib/import/ai/`, `src/routes/api/interpret/`, `.env.example` | T0 (T3 `materializeTable` at merge) | 2h |
| T7 Review UI | [T7](tasks/T7-ui.md) | `src/lib/components/**`, `src/lib/import/session.svelte.ts`, `src/lib/types.ts`, old `smart-upload*` files | T0 | 2.5h + 1h wiring |
| T8 Acceptance + docs | [T8](tasks/T8-acceptance.md) | `tests/`, `playwright.config.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json` scripts, `vite.config.ts` test block | T0 | across all waves |

## Rules for every agent

1. Read `TASK_SPEC.md`, `docs/ARCHITECTURE.md`, and your brief before coding.
2. Edit only the paths your task owns. `src/lib/import/model.ts` is frozen after T0; ask the coordinator for changes instead of editing it.
3. Branch `task/T<n>-<slug>` from `main`. If T0 has not merged yet, work against the contract in `tasks/T0-contracts.md`:
   - You may create uncommitted scaffolding at T0's paths so you can compile and test: `model.ts` and `identifiers.ts` copied verbatim from the T0 brief, throwaway `refs.ts` / `testing.ts` if you need them. You may install T0's dependencies locally. Never commit any T0 file (`src/lib/import/{model,refs,identifiers,testing,analyze}.ts`, the stub `index.ts` files, `.gitignore`), `package.json`, or `pnpm-lock.yaml`.
   - Put your code in other files in your directory and stage only paths you own (`git add <path>`, never `git add -A`).
   - When T0 merges: delete the scaffolding, `git restore package.json pnpm-lock.yaml`, rebase onto `main`, `pnpm install`, wire your code into your stub `index.ts`, and make `pnpm test` and `pnpm check` pass.
   - Rebase again before asking to merge.
4. `pnpm test`, `pnpm check`, and `pnpm build` must pass before merge.
5. No hardcoded sheet names, file names, or fixture-specific rules.
6. Commit messages: `feat:` / `fix:` / `test:` / `docs:` / `chore:` prefix, imperative, at most 72 characters, no co-author trailers.
7. When blocked on another task's code, code against the contract and stub, and note the dependency in your handoff.
8. Hand off with: what is done, what is not, test count, and any contract change you need.

## Resolved decisions

| # | Decision |
| --- | --- |
| D1 | SheetJS 0.20.3 (CDN tarball), only imported by `reader/`. See ARCHITECTURE.md, External dependencies. |
| D2 | LLM through OpenRouter from a SvelteKit server route; `OPENROUTER_API_KEY` stays server-side; `AI_PROVIDER=mock` for tests. |
| D3 | AI returns structure only. Auto-applied only when verified and `ready` on its own values; otherwise a pending decision. |
| D4 | Same NIIN under different FSCs: all imported, each flagged `fsc-niin-mismatch`. |
| D5 | Low-confidence tables (PENCOM `Search Log`) are held back as pending, suggested exclude. |
| D6 | Malformed field with another valid primary identifier: valid portion imported automatically, malformed value dropped and listed. |
| D7 | Hidden rows and columns in visible sheets are skipped and counted. |
| D8 | Identity: part (uppercased, whitespace collapsed) + NSN or NIIN, CAGE when both have one. Stored values stay original. |
| D9 | Annotated part numbers (`12273108 (EATON M144E)`) are kept verbatim with a warning. |
| D10 | Rows with values only in unmapped columns are skipped and counted, not shown as invalid. |
| D11 | Automation: certain decisions auto-applied and logged with undo; uncertain decisions held back with a suggestion; "Accept all suggestions" in one click. |

## Fixture expectations (T8 encodes them in `tests/fixtures/expectations.ts`)

**WOW** (`Active Parts`): 179 source rows -> 180 candidate records (D136 splits into `12669555` and `RVX08212`).
`hiddenSheet` (veryHidden) ignored; columns A-C (UUID, checksum, modified date, width 0) not mapped; Part = D, NSN = E, Description = F.
129 non-empty NSN cells: 127 valid; 2 malformed (`E134` `12663107`, equal to part D134; `E166` `280-035-330-101F`), both imported as valid portion.
F180 has no description. All 180 records importable.

**Statz** (`Sheet1`): 54 records, all NSNs valid; R32-R33 blank and R34 repeated header skipped.
Part = A (`G & B P/N`); B `Dwg Number` not mapped; no Description or CAGE column (table-level notice, not 54 row warnings).
`fsc-niin-mismatch` on 9 records: R20/R22, R25/R26, R37/R38/R39, R44/R45.
13 parts map to several NSNs; all retained. All 54 importable.

**PENCOM**: 6 visible sheets, headers on row 2 (row 3 for `Sources & Notes`), roughly 1000 styled empty rows per sheet ignored.
Ready: `NSN Cross-Reference` (2 records), `Part Number Intake` (2 records, R5-R7 skipped as no-mapped-values).
Needs review (held back): `Search Log`. No table: `Dashboard`, `Opportunity Matrix`, `Sources & Notes`.
2 pending conflicts across XRef and Intake (same part + NSN, descriptions `Screw, Machine` vs `6-32 x 1/4 pan-head SEMS machine screw`, `Screw, Assembly` vs `Assembly screw`); suggestion prefers the XRef record (more fields, CAGE `0BWZ1`).
Before resolving, 0 records import; after "Accept all suggestions", 2 records import.

## Messy cases (seed list for T2-T5 and T8 synthetic workbooks)

| Case | Example | Handling |
| --- | --- | --- |
| Header traps | `(Do Not Modify) Part` (UUIDs), `NSN Found` (Yes), `NSN Matchability (1-5)`, `Mfg.` (Y/N), `Manufacturer` (PENCOM) | Values must pass; header text alone never wins. |
| Competing part columns | Statz `Dwg Number`, PENCOM `MIL/MS/NAS Equivalent` | Offered as alternatives, not mapped. |
| Part punctuation | `10931023*92`, `BH011-HT REV 000`, `2132981-2  C`, `PPIM 21023`, `12542334-GRN` | Trim only. |
| Exponent-shaped part | `13211E9213` | Read as text; never `Number()`. |
| NIIN look-alike part | `201018858` in a part column | Stays a part; column decides. |
| Numeric identifier cells | Statz B2 `7646198` stored as a number; numeric NIIN `16582565` | `numeric-to-text`; NIIN gets `restore-leading-zeros` + warning. |
| Date-mangled part | `3-4` stored as a date | Invalid: original is unrecoverable. |
| Wrong-column paste | WOW E134 NSN equals D134 part | Malformed NSN; message names the matching cell. |
| Multi-value cells | WOW D136; multi-line description | Identifier split; description kept whole. |
| NSN variants | `5305 01 658 2565`, en dash, NBSP | Separators stripped and recorded; exactly 13 digits. |
| Derivation | FSC + NIIN, no NSN | NSN derived and labeled; disagreement with a present NSN is a conflict. |
| Merged data cells | Part merged down 3 NSN rows | `merge-fill` (P1). Plain blanks are never filled. |
| Placeholder / footer rows | PENCOM Intake R5-R7 | Skipped and counted. |
| Error / formula cells | `#N/A`, formula without cached value | Empty plus field warning. |
| LLM output | Invented column, off-by-one header, unknown sheet | Rejected by the verifier with a reason. |
