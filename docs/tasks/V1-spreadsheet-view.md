# V1 - The spreadsheet inside the review window

Review feedback: users keep switching between Excel and the importer to check what it found.
Show the workbook in the review window, next to the review.
The follow-up (V2, below) highlights the matching cells as the user hovers over the review; V1 must leave that a wiring job.
Read the Wave 2 rules in `docs/PLAN.md` first.

## What exists

`ImportSession.model` (`src/lib/import/session.svelte.ts`) already holds the parsed `WorkbookModel`: every sheet's `cell(row, col)` with display text, `merges`, `hiddenRows`, `hiddenCols`, and `valueExtent`.
`ImportSession.analysis` holds every table's range, header rows, column mappings, skipped rows, and every record's provenance.
No new parsing is needed.
Embedding Excel itself (Office viewer, SharePoint) is not an option: it needs a public URL, and the file never leaves the browser.
Cell formatting (fills, fonts, borders) is not in the model; V1 shows values, not formatting.

## Build

### Layout

- A "Spreadsheet" toggle button in the header, next to "Choose another file" (`ImportReviewWindow.svelte`, around line 275), with a grid icon and `aria-pressed`.
  The choice is remembered per viewer in `localStorage`, wrapped in try/catch.
- At 1280 px and wider: a split view, review on the left (keeps its current column, at least 560 px) and the spreadsheet on the right, with a draggable divider.
- Narrower: the spreadsheet replaces the review, with a "Back to review" button; the summary bar and Import button stay visible.
- The provenance drawer opens over the review column, not over the spreadsheet, when the split view is on.

### The grid

- Looks like Excel: column letters across the top, row numbers down the side, both sticky; light gridlines; 13 px text; a sheet tab strip at the bottom with every visible sheet (hidden sheets are not shown).
- Virtualized rows (and columns past about 40), fixed row height; a 100,000-row sheet scrolls smoothly and the view opens in well under 200 ms on the fixtures.
- Multi-line cells show the first line with a "+N lines" marker; the full text is in a tooltip on its own button or `title`, consistent with the app's (i) pattern.
- Merged cells render as one cell over their range when the master is in view; hidden rows and columns are collapsed with a thin double line, as Excel does.
- Number, date, and error cells show their display `text`.

### What the importer found, drawn on the grid

- Each table's range is outlined (blue when included, amber while it waits on a decision, grey when excluded).
- Header rows are tinted; each mapped column shows a small field chip under its letter ("NSN", "Part").
- Skipped rows (blank, repeated header, footer, no mapped values) are dimmed, with the reason on hover.
- Keep the overlay computed from the analysis once per analysis change, not per cell render.

### Focus: the hook V2 needs

Add one piece of shared state that says what to show, for example on the session:

```ts
/** Cells the spreadsheet should bring into view and highlight; null shows nothing extra. */
focus = $state.raw<{ sheet: string; ranges: CellRange[]; reason?: string } | null>(null);
```

The grid switches to the focused sheet, scrolls the first range into view (without moving the page when it is already visible), and draws a highlight in Excel's selection style.
In V1, wire two sources only:

1. Selecting a row in the Rows preview focuses that row's source cells.
2. Clicking a cell reference in the provenance drawer focuses that cell.

Clicking a cell in the grid shows its address and value in a small bar above the grid (like Excel's name box and formula bar); clicking a cell that belongs to a record opens that record's details.

## V2 (next, not in this task)

Hovering any review element that refers to cells sets `focus` (debounced): a column card highlights its column within the table's range, a sheet or table line its range, a decision its cells, a "Worth a look" line its rows, a row in the preview its row.
V1 is done right if V2 only adds `onmouseenter`/`onfocus` handlers.

## UX bar

Meet the UX bar in `docs/PLAN.md`. For this task in particular:

- The spreadsheet also helps when things go wrong: it opens on a sheet with no table, so the user can see why, and the "Set up table" flow (E1) can be checked against it.
- The toggle, split, and divider never cover the Import button or the decision stage.

## Done when

- The toggle opens the spreadsheet beside the review on all seven fixtures, and the tab strip switches sheets.
- On `ShiftedTable.xlsx` or WOW, selecting a row in Rows scrolls the grid to it and highlights it; a provenance cell link highlights that cell.
- WOW's `Active Parts` shows the table outline, the field chips on D/E/F, and the hidden metadata columns collapsed.
- Keyboard: the toggle, tabs, and grid cells are reachable; the grid has `role="grid"` with row and column headers announced.
- No layout shift in the review column when the split opens or closes; no horizontal page scroll at any width.

## Tests

- Unit: the overlay builder (analysis -> outlines, header tints, chips, dimmed rows) and the focus-to-scroll math.
- E2E: `tests/e2e/spreadsheet-view.spec.ts`: open the view, switch sheets, select a row in Rows and assert the highlighted cell, click a provenance link.

## Owns

A new `src/lib/components/import/sheet-view/` folder (grid, tabs, overlay builder), the layout and toggle in `ImportReviewWindow.svelte`, the `focus` state in `session.svelte.ts`, and one-line focus calls in `PreviewPanel.svelte` and `ProvenanceDrawer.svelte`.
E1 adds methods to `session.svelte.ts` and a setup control in `SheetsPanel.svelte`; keep both when you rebase.
