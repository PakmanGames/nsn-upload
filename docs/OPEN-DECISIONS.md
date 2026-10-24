# Open Decisions

Parked by the product owner on 2026-10-24 to focus on core features and merging the open PRs.
Revisit these before the final submission.
Each entry gives the TASK_SPEC requirement, the evidence, the options, and a recommendation.

Related: decided items are in [`PLAN.md`](PLAN.md) (Decisions), deferred ideas in its Backlog, and current gaps in [`ARCHITECTURE.md`](ARCHITECTURE.md) (section 11).

## OD1 - Responsiveness on large workbooks (Web Worker)

**TASK_SPEC:** "Keep the interface responsive while analyzing a large workbook" and "Provide visible progress for workbooks large enough to cause a noticeable delay". A worker is "encouraged but not mandatory if responsiveness can be demonstrated another way".

**Evidence** (`readWorkbook` + `analyze` in Node on synthetic 8-column sheets, measured 2026-10-24; a browser is somewhat slower):

| Rows | File | Read | Analyze | Total |
| --- | --- | --- | --- | --- |
| 10,000 | 1.1 MB | 0.12 s | 0.20 s | 0.3 s |
| 50,000 | 5.5 MB | 0.54 s | 0.82 s | 1.4 s |
| 100,000 | about 11 MB | | | about 2.7 s (estimated) |

Above 100,000 rows the reader stops with a clear error ("Sheet "Parts" has data down to row 100,003; the limit is 100,000 rows per sheet").
The main thread is blocked for the whole time, and every remap or decision re-runs `analyze()` (0.8 s at 50,000 rows).
Progress is a phase label ("Reading", "Analyzing"), not a percentage.

**Options:**

1. Move reading and analysis into a Web Worker that keeps the `WorkbookModel`; the review window posts overrides and receives the analysis. About 1-1.5 h (T1 + T7). The pipeline is pure, so the move is mechanical.
2. Keep the main thread and document the measured times as a known limitation.

**Recommendation:** option 1. It is a stated requirement, not a stretch goal, and the freeze is measurable.

## OD2 - Labeling derived values after import

**TASK_SPEC:** "Any derived value must be labeled as derived rather than source-provided", and an NSN "should be deduced" from FSC + NIIN.

**Evidence:** the review window labels derived values ("derived from E2"). After import, the mappings table shows them like source values: Statz has no NIIN column, yet every imported Statz record shows a NIIN.

**Options:**

1. Store derived values with a marker (for example `derived?: Array<'nsn' | 'niin'>` on `MappingRecord`, carried by `ImportPlan`) and show a "derived" tag in the mappings table. Small contract change, then about 30-45 min (T5 + T7).
2. Do not store derived values. This conflicts with the requirement that a deduced NSN becomes part of the record.

**Recommendation:** option 1.

## OD3 - Two-row header detection

**TASK_SPEC:** header matching should tolerate "a header distributed across two adjacent rows".

**Evidence:** `materializeTable` already joins several header rows, and AI proposals can use that; deterministic detection only proposes single-row headers. Deferred earlier as D15.

**Options:**

1. Let detection propose two adjacent header-like rows as one header. About 45 min (T3), plus an unseen-workbook test (T8).
2. Keep it in the backlog as a documented gap.

**Recommendation:** option 1. It is the most visible deferred item against the spec, and unseen review workbooks may include it.

## OD4 - Including a hidden sheet on request

**TASK_SPEC:** "Ignore hidden and very-hidden worksheets by default", which implies the user could opt in.

**Evidence:** hidden sheets are listed as "Hidden - ignored" with no way to include them.

**Options:**

1. An "Include anyway" control that analyzes the hidden sheet like a visible one, held back as needs-review. About 30 min (T3 + T5 + T7).
2. Document it as intentional: hidden sheets are usually system metadata (WOW's `hiddenSheet`).

**Recommendation:** option 2 unless time remains.

## Spec fixes (no decision needed)

Routed to the owning task and tracked here so they were not lost.

| Fix | TASK_SPEC | Owner | State |
| --- | --- | --- | --- |
| Rewrite the README: run commands, `.env` with `OPENROUTER_API_KEY`, `AI_PROVIDER=mock`, `pnpm test:acceptance`, link to the design note | Deliverable 4 | T8 | Done (#16) |
| Check AI availability only when the user turns AI on, not when the review window opens | "Network transmission must be disabled unless AI parsing is explicitly enabled" | T7 | Done (#17) |
| Header chip: "179 rows -> 180 records" instead of "180 candidates", so it reads against the spec's "179 candidate data rows" | Acceptance case (WOW) | T7, T8 | Done (#17, #18) |
| Playwright E2E per example file | Testing expectations | T8 | Done (#16, #18) |

## Decided since parking

- **Review window redesign:** decided on 2026-10-24 after the prototype; recorded as D20 in `PLAN.md` and briefed as UX1.
