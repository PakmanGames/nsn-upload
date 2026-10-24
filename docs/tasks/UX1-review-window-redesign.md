# UX1 - Review window redesign: summary first, details on demand

Decided by the product owner on 2026-10-24 after reviewing the prototype: build option B as prototyped, keep all nine elements (R1-R9), and open the Columns section by default only when something is uncertain.

Visual reference: [`docs/prototypes/review-window/index.html`](../prototypes/review-window/index.html) (open it in a browser; it switches between PENCOM, WOW, and Statz and between desktop and 390 px).
The prototype is the target for layout, hierarchy, and copy. Build it with the real components and data, not by copying its markup.

Owner: **T7** (`src/lib/components/**`, `src/lib/import/session.svelte.ts`).
For this PR only, T7 also updates the assertions in `tests/e2e/import.spec.ts` that the redesign changes, so `main` never has failing E2E tests between merges. T8 adds E2E coverage for the new behavior in a follow-up (see the end).

## Goal

A new user knows within seconds what will import and what needs them.
One layout: it shrinks to a sentence and a button for a clean file, and puts the decisions first when there are any.
Nothing is removed: every TASK_SPEC "show before import" item stays visible as a one-line summary, and every control that exists today stays reachable.

## Layout

```text
header (sticky)   icon · "Smart Upload" · file name · Choose another file · close
                  R1 sentence · R2 chips                     Accept all suggestions · Import N records (M need review)
body (one column, max width about 64rem, centered)
                  R3 decision stage           (only when decisions are pending, or "All N decisions made")
                  R9 "Worth a look" line      (only when there are warnings)
                  "Details" label · Expand all / Collapse all
                  R4 Sheets  · R5 Columns  · R6 Rows  · R7 Applied automatically  · R8 AI assistance
```

The three-column layout (sheets / mapping + preview / decisions) goes away.
Every value below comes from `WorkbookAnalysis`; nothing is specific to the example files.

## Elements (account for every ID in the PR description)

**R1 - One-sentence summary.**
From `summary` and `sheets`: "{ready tables} of {sheets} sheets have importable tables · {sourceRows} rows[ → {candidates} records] · {N decisions need you | nothing needs you}".
Correct singular and plural ("1 of 2 sheets has an importable table").
Show "→ records" only when the counts differ.

**R2 - Only non-zero chips.**
Keep today's chip set but render a chip only when its count is above 0.
Clicking a chip opens the Rows section, applies that status filter, and scrolls the section into view.

**R3 - One decision at a time.**
The first pending decision fills the decision stage: kind badge, title, explanation, the same comparison tables as today's decision cards (cross-sheet conflicts, identifier conflicts, storage conflicts), and the options from `decision.options` with the suggestion preselected.
Header line "Needs your decision · {position} of {total}" with progress dots.
Buttons: "Apply and continue" (records the choice and moves to the next pending decision), "Skip for now", "Previous".
"Accept all suggestions" stays in the header.
When none are pending: a green "All N decisions made" summary listing each choice, with "Review my choices", which reopens the stage with the current choices preselected.
After Apply, move focus to the next decision's heading.

**R4 - Sheets section.**
Collapsed by default. Summary line: "{n} ready · {n} needs review · {n} nothing to import · {n} hidden" (omit zero parts).
Body: ready and needs-review sheets with their status badge, include switch, and "Why this classification".
"No importable table" sheets fold into one line ("3 sheets with nothing to import"), and hidden sheets into another; each folded sheet still shows its reasons when expanded.

**R5 - Columns section.**
Summary line: the mapped fields per table ("NSN Cross-Reference: NSN, FSC, NIIN, Description, Part number, CAGE · Part Number Intake: ...").
Body: per table, its range and header row, the mapped columns with header, evidence, field picker, and confidence; unmapped columns fold into "{n} more columns not imported", and each keeps its field picker so it can still be mapped.
**Open by default only when** a mapped column of an included table is medium or low confidence, or a column was remapped by the user; otherwise collapsed.

**R6 - Rows section.**
Summary line: records, warnings, and splits ("180 records · 4 warnings · 2 split from D136").
Body: today's preview (search, sheet filter, pagination at 100, row click opens the provenance drawer), with status tabs only for non-zero statuses.
Records of tables that are held back (needs-review and not included, or excluded) are not in the main list: they fold into one line per table, "Search Log · 3 rows held back, not importing", expandable.

**R7 - Applied automatically.**
Collapsed section; title carries the count. Body: today's grouped list with undo, unchanged.

**R8 - AI assistance.**
Collapsed section whose summary line is today's status line.
Opens automatically when any sheet has an `aiTrigger`, or when AI results or rejected proposals exist.
Body: today's AI panel (switch, status, "How AI assistance works").

**R9 - "Worth a look" line.**
Shown under the summary only when there are warnings: "Worth a look before importing. These still import." followed by one line per warning kind with its count and a plain-language description, then "Show these rows" (opens Rows filtered to warnings).
Group by issue code. Copy for the example files:

- WOW: "2 rows had a malformed NSN · rows 134 and 166; the part number imports, the bad NSN does not", "1 part number has a note in brackets · row 43, kept as written", "1 record has no description · row 180".
- Statz: "9 records list the same item under different NSNs · at most one NSN per item is current".

**Also:** "Expand all" / "Collapse all" toggles the five sections. Open sections are remembered while the window is open.

## Unchanged

The pipeline, contracts, decisions, counts, and import plan.
The import button rule: it always says how many records import and how many need review.
Every existing control: remap or ignore a column, include a table, undo an automatic decision, provenance per row, AI switch.

## Accessibility and responsiveness

Sections are native `<details>`/`<summary>`; the decision options are a radio group with a legend.
The import button's count is announced (`aria-live="polite"`).
Works at 390 px wide with no horizontal page scroll; comparison tables wrap inside their card.

## Tests

- Unit-test the new derived logic as pure functions (for example in `labels.ts` or a new `summary.ts`): the R1 sentence with plurals, the R2 chip list, the R5 open-by-default rule, and the R9 warning grouping.
- Update the existing assertions in `tests/e2e/import.spec.ts` that the layout changes (panel names, chip lookups) in this PR, so `pnpm test:e2e` stays 4 of 4.
- `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm test:e2e` pass.

## Done when

All three example files and the AI mock workbook (`AI_PROVIDER=mock`) match the prototype at 1440 and 390 px, checked in a browser, with screenshots in the PR.
The PR description accounts for R1-R9 one by one.

## Follow-up for T8 (after T7's PR merges)

Add E2E coverage for the new behavior: the decision stage (Apply moves to the next decision, "Review my choices"), a chip opening Rows with its filter, held-back rows folded, the Columns open-by-default rule (open after a remap), and "Worth a look" for WOW and Statz.
