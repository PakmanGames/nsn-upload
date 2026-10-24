# E1 - Tables without a header row, and setting up a table by hand

Review feedback: a sheet that is nothing but valid NSNs imports nothing, and the user has no way to say "column A is NSN".
Read the Wave 2 rules in `docs/PLAN.md` first.

## Fixture and today's behavior

`example-excel-uploads/Just NSNs (1).xlsx`, one sheet `Sheet1`: `A1:A99` holds 99 NSNs written `1025-00-0425307`, no header, 42 distinct values (most repeat 2-6 times).

- Structure: `no-table`, "No header row found: no row near the top has at least two short text labels".
- The AI trigger fires (99 identifier cells), but the verifier rejects the proposal: "No header row given" (`src/lib/import/ai/verify.ts:74`).
- The review window shows "0 of 1 sheet has an importable table", "Columns: No table is included", and nothing the user can do about it.

## Build

### 1. Contract (first commit, this wave's only `model.ts` change)

```ts
// TableCandidate
/** `${sheet}@${first header row}`, or `${sheet}@${first data row}` for a table without a header row. */
id: string;
/** Empty for a table without a header row: its columns are mapped from their values only. */
headerRows: number[];
source: 'deterministic' | 'ai' | 'user';

// Overrides
/** Tables the user set up by hand on a sheet. They replace detection on that sheet, like AI tables. */
manualTables?: Array<TableSpec & { sheet: string }>;
```

Update `tableId()` and every caller for the headerless id.
No other Wave 2 task depends on this change, so it ships in this task's PR.

### 2. Detect a table without a header row

When detection finds no header row (or the first non-empty row already holds identifier values), look for columns whose values alone identify them.
The existing value-only rule applies unchanged: NSN or NIIN, at least 3 values, at least 95% valid, medium confidence (`src/lib/import/structure/columns.ts`, `confidenceFor`).
If at least one such column exists, propose a table with `headerRows: []`, starting at the first data row; other columns are evaluated the same way and stay unmapped unless they pass that rule.
Put the detection in a new `src/lib/import/structure/headerless.ts`, called from `detectTable`'s "no header found" branch, so E2 and E3 can edit `detect.ts` without collisions.

The table is `needs-review`, so it waits on an `include-table` decision.
For a headerless table whose mapped primary columns are all at least 95% valid, suggest **include** (today's needs-review tables suggest exclude, D5), with a reason such as "No header row; 99 of 99 values in column A are valid NSNs".
"Accept all suggestions" then imports it in one click.
The sheet's `aiTrigger` is null when a headerless table was found, since the values already decided it.

A header row that names nothing must stay `no-table` (the `Summary` sheet of `Substring Headers in Diff Sheet (1).xlsx`: counts and dollar amounts, no identifiers).

### 3. Set up a table by hand

Any visible sheet without an included table (`no-table`, or a held-back `needs-review` table) offers **Set up table** in the Sheets section.
The setup is inline, not a modal:

- Header row: "No header row" or a row number (default: the detected one, else "No header row").
- One line per column with values: the column letter, its header text if any, its first 3 values, and a field select (Ignore, Part, NSN, NIIN, FSC, CAGE, Description).
- "Use this table" stores the spec in `Overrides.manualTables` and re-analyzes; "Cancel" leaves nothing behind.

A manual table is materialized with the same rules as detection (`materializeTable`, `source: 'user'`), so confidence, validation, and every warning still apply.
It is included without an `include-table` decision: the user just chose it.
Once it exists, the normal Columns cards edit it, and the sheet line offers "Remove table set up by hand", which drops the override.
Add `setManualTable(sheet, spec)` and `removeManualTable(sheet)` to `ImportSession` (`src/lib/import/session.svelte.ts`).

### 4. AI proposals without a header row

The verifier accepts `headerRows: []` when every mapped column passes the same value-only rule.
Update the request text and schema descriptions in `src/lib/import/ai/` to say a table may have no header row; `headerText` is then empty.

## UX bar

Meet the UX bar in `docs/PLAN.md`. For this task in particular:

- Today the review window says "0 of 1 sheet has an importable table · 0 rows · nothing needs you", in green, while nothing will import. When nothing will import, the summary says why and offers the next step (accept the detected table, set one up by hand, or turn AI on), never "nothing needs you". The sentence is in `summary.ts`; keep to the nothing-to-import branch, since E3 and AI1 edit other lines there.
- "Set up table" is reachable from that summary, not only inside the collapsed Sheets section.
- The setup editor needs no explanation: the first values next to each column make the choice obvious, and a choice that cannot work (no identifier column mapped) says so before "Use this table".

## Done when

- `Just NSNs (1).xlsx`: one headerless table `Sheet1@1` (`A1:A99`), column A = NSN at medium confidence, one pending `include-table` suggested include.
  After "Accept all suggestions": the repeats are dropped by the existing duplicate policy, and one record per distinct NSN imports (expected 42; confirm the number from the file, do not tune code to it).
- The same sheet set up by hand ("No header row", A = NSN) imports the same records with no pending decision; removing the manual table returns to the detected state.
- WOW, Statz, PENCOM, and the other new fixtures are unchanged (`pnpm test` green without editing their expectations).

## Tests

- Unit: headerless detection (one column, two columns NSN + part-shaped text, a 2-value column that must not qualify, a sheet whose row 1 is a title above headerless NSNs).
- Unit: `manualTables` materialization, a manual table with a header row, removing it, a manual table on a sheet that also has an AI table (manual wins).
- Unit: verifier accepts a headerless proposal whose values pass, rejects one whose values fail.
- Acceptance: `tests/acceptance/just-nsns.test.ts` with expectations in a new `tests/fixtures/just-nsns.ts`.
- E2E: `tests/e2e/manual-table.spec.ts`: upload Just NSNs, accept the suggestion, see the import count; then reload, set the table up by hand, see the same count.

## Owns

`src/lib/import/model.ts` (the hunk above only), `src/lib/import/structure/headerless.ts` (new), the call in `detect.ts`'s no-header branch, the manual-table branch in `structure/sheet.ts`, the include suggestion in `validate/rows.ts`, `src/lib/import/ai/` (verify, request text, schema), `session.svelte.ts` (the two methods), a new `src/lib/components/import/TableSetup.svelte`, and its placement in `SheetsPanel.svelte`.
