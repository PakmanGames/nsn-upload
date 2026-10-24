# DS1 - Faster decisions: keep the NSN, apply to similar rows, a button that stays put

Review feedback on `Substring Headers in Diff Sheet (1).xlsx`, which shows "Needs your decision · 1 of 28":

1. The suggestion for an NSN that disagrees with its FSC is "Exclude row", but the importer should never lose data from the file. It should keep the NSN and work out the FSC and NIIN from it.
2. With many decisions, "Apply and continue" must be easy to click repeatedly.
3. A choice should be easy to apply to the other decisions with the same problem.

Product owner decisions: these rows stay decisions (not automatic), now suggesting "Keep the NSN" (D24); only NSN conflicts change, other suggestions stay as they are.
Read the Wave 2 rules in `docs/PLAN.md` first, including the UX bar.

## Today

- `resolve-identifier-conflict` is suggested `exclude-row` (`src/lib/import/validate/rows.ts:152`), so "Accept all suggestions" leaves those rows out.
  With `prefer-nsn`, the disagreeing NIIN/FSC cells move to `rejected` with a conflict warning and the NIIN is derived from the NSN (`resolveConflict` and `checkAndDerive` in `src/lib/import/records/table.ts`); no FSC is derived.
- The decision card's height changes from one decision to the next (explanation length, comparison table rows), so "Apply and continue" moves under the pointer.
- After Apply, focus moves to the next decision's heading (`DecisionStage.svelte`, around line 66), so pressing Enter again does nothing.
- The only bulk action is "Accept all suggestions" in the summary bar, which takes every suggestion of every kind.

On this file, 12 of the 28 decisions are identifier conflicts. E4 brings that down to 1 (row 49), so do not rely on this fixture for the bulk tests: build a synthetic workbook with several conflicts of the same shape (see `tests/acceptance/unseen.test.ts` and `helpers.ts`).

## Build

### 1. Keep the NSN, suggested (D24)

- Suggest `prefer-nsn` for `resolve-identifier-conflict`. The reason says the NSN is kept, that its NIIN and FSC are worked out from it, and that the disagreeing cells stay listed on the row. "Keep the NIIN and FSC" and "Exclude row" stay as options.
- With `prefer-nsn`, also derive the FSC from the NSN when the FSC cell was ruled against, labeled as derived like the NIIN. Contract: add `'derive-fsc-from-nsn'` to `Transform` in `model.ts`. This one line is the coordinator-approved exception to E1 owning `model.ts` this wave.
- Rejected values stay visible on the record (Rows, provenance drawer), so nothing from the file disappears silently.
- Update the F1 tests and acceptance tests that pin `exclude-row` as the suggestion, and say in the PR which ones changed.

### 2. Apply a choice to similar decisions

Similar means pending, same kind, same table, and the same shape:

| Kind | Same shape |
| --- | --- |
| `resolve-identifier-conflict` | Same disagreeing fields (FSC, NIIN, or both) |
| `split-cell`, `ambiguous-multi-value`, `import-valid-portion` | Same column |
| `resolve-conflict`, `merge-duplicates`, `drop-duplicate`, `resolve-storage-conflict` | Same differing fields |
| `include-table` | Any other pending table |

The chosen option must exist in every similar decision, so a record-specific choice (`prefer:<recordId>`) never spreads.

- When the current decision has similar pending decisions, show a checkbox under the options: "Also apply "Keep the NSN" to the 11 other rows where the NSN disagrees with the FSC", with a "Show rows" disclosure listing them. Unchecked by default. The label follows the selected option.
- Checked, "Apply and continue" applies the option to all of them in one re-analysis (new `ImportSession.chooseMany(ids, option)`, one `#apply`), then moves to the next decision not covered.
- Put the similarity rule in a new pure module, `src/lib/components/import/similar.ts`, with unit tests.
- "All decisions made" and "Review my choices" show a group as one line ("12 rows: Keep the NSN"). Reverting the line reverts the whole group (new `resetDecisions(ids)`), and each decision in it can still be changed on its own while reviewing.

### 3. An Apply button you can click repeatedly

- "Apply and continue" is at the same screen position for every decision: the options and action row do not move when the next decision has a longer explanation or a larger comparison table. For example, give the details area a fixed height that scrolls, or pin the action row. Measure it; do not eyeball it.
- Each click or Enter applies exactly one decision, or one group. Fast repeated clicks never skip a decision or apply a choice meant for one decision to the next.
- Keyboard: after Apply, focus stays on "Apply and continue", and a polite live region announces the next decision ("Decision 2 of 28: row 11, NSN disagrees with FSC"). This replaces UX1's focus-the-heading behavior; update `tests/e2e/review-window.spec.ts` accordingly.
- The suggestion stays preselected, so repeated Apply accepts the suggestions one by one.

## Done when

- A synthetic workbook with 12 FSC-vs-NSN conflicts and 2 NIIN-vs-NSN conflicts: the FSC ones suggest "Keep the NSN". Choosing it with "also apply to 11 others" resolves all 12 in one click; the 2 NIIN conflicts are not included (different shape). The rows import with the NSN, a derived NIIN and FSC, and the disagreeing cells listed as warnings.
- E2E: 10 fast clicks on "Apply and continue" apply exactly decisions 1-10 in order; the button's bounding box is identical across those decisions; Enter works the same with the keyboard.
- Reverting a group line in "Review my choices" brings all its decisions back to pending.
- `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm test:e2e` pass; check the card in a real browser at 1440 px and phone width.

## Owns

The identifier-conflict suggestion and reason in `src/lib/import/validate/rows.ts`, the `prefer-nsn` branch and FSC derivation in `src/lib/import/records/table.ts`, the `Transform` line in `model.ts`, `chooseMany` and `resetDecisions` in `session.svelte.ts`, the options, actions, focus, and done-list parts of `DecisionStage.svelte`, the new `similar.ts`, and `mock-analysis.ts` if its decisions need the new suggestion.
M1 rewrites the explanation text block of `DecisionStage.svelte`, E4 the split and conflict matching in `records/table.ts`, E1 the include suggestion in `rows.ts`; keep their changes when you rebase.
