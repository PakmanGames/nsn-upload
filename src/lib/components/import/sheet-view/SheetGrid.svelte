<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import type { Cell, CellRange, SheetModel } from '$lib/import/model';
	import { colLetter, toA1 } from '$lib/import/refs';
	import type { SheetFocus } from '$lib/import/session.svelte';
	import { FIELD_LABEL, SKIP_REASON } from '../labels';
	import {
		ALL_COLUMNS_UP_TO,
		OVERSCAN_COLS,
		OVERSCAN_ROWS,
		ROW_HEIGHT,
		axisSize,
		boxOf,
		buildAxis,
		columnWidths,
		contains,
		displayText,
		estimateWidth,
		gapBefore,
		positionOf,
		reveal,
		spanOf,
		spillEnd,
		textWidth,
		unionOf,
		windowOf,
		withMerges,
		type Box,
		type Measure,
		type RevealMode
	} from './geometry';
	import { tableAt, type SheetOverlay, type TableTone } from './overlay';

	type Props = {
		sheet: SheetModel;
		overlay: SheetOverlay;
		/** The focus when it is on this sheet. Its first range's top-left cell is the cursor. */
		focus: SheetFocus | null;
		/** The sheet's tab, which names the grid. */
		tabId: string;
		/** The user put the cursor on a cell, by click or keyboard. */
		onSelect: (row: number, col: number) => void;
		/** A click or Enter on a cell. */
		onActivate: (row: number, col: number) => void;
	};

	let { sheet, overlay, focus, tabId, onSelect, onActivate }: Props = $props();
	const uid = $props.id();

	/** Letter row, and the field chip row under it when a column is mapped. */
	const LETTER_HEIGHT = 22;
	const CHIP_HEIGHT = 20;

	const TONE_OUTLINE: Record<TableTone, string> = {
		included: 'border-blue-600',
		pending: 'border-amber-500',
		excluded: 'border-dashed border-slate-400'
	};
	const TONE_HEADER: Record<TableTone, string> = {
		included: 'bg-blue-50',
		pending: 'bg-amber-50',
		excluded: 'bg-slate-100'
	};
	const TONE_CHIP: Record<TableTone, string> = {
		included: 'bg-blue-50 text-blue-700 ring-blue-600/25',
		pending: 'bg-amber-50 text-amber-800 ring-amber-600/30',
		excluded: 'bg-slate-100 text-slate-500 ring-slate-500/20'
	};

	// Excel's grid never ends; this one stops some way past the values, and fills at least a large screen.
	const lastRow = $derived(Math.max((sheet.valueExtent?.bottom ?? 0) + 20, 100));
	const lastCol = $derived(Math.max((sheet.valueExtent?.right ?? 0) + 3, 26));
	/** Measures with the grid's own font, so columns fit their values and spills stop where the text does. */
	function canvasMeasure(weight: number): Measure {
		const context = browser ? document.createElement('canvas').getContext('2d') : null;
		if (!context) return estimateWidth;
		context.font = `${weight} 13px ${getComputedStyle(document.documentElement).fontFamily}`;
		return (text) => context.measureText(text).width;
	}
	const measure = canvasMeasure(400);
	// Header rows are drawn in medium weight (font-medium).
	const measureHeader = canvasMeasure(500);
	const widths = $derived(
		columnWidths(sheet, lastCol, {
			measure,
			measureHeader,
			headerRows: [...new Set(overlay.tables.flatMap((table) => [...table.headerRows]))]
		})
	);
	const rows = $derived(buildAxis(lastRow, sheet.hiddenRows, () => ROW_HEIGHT));
	const cols = $derived(buildAxis(lastCol, sheet.hiddenCols, (col) => widths[col]));
	const headHeight = $derived(LETTER_HEIGHT + (overlay.chips.size ? CHIP_HEIGHT : 0));
	const rowHeadWidth = $derived(Math.max(40, String(lastRow).length * 8 + 14));

	let scroller = $state<HTMLDivElement>();
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	// Until the scroller is measured, assume a tall one: drawing a few rows too many beats a blank first frame.
	let viewWidth = $state(1600);
	let viewHeight = $state(1200);

	// Split into numbers, so scrolling within the same rows and columns changes nothing downstream.
	const rowWindow = $derived(windowOf(rows, scrollTop, viewHeight - headHeight, OVERSCAN_ROWS));
	const rowFrom = $derived(rowWindow[0]);
	const rowTo = $derived(rowWindow[1]);
	const colWindow = $derived(
		cols.indexes.length <= ALL_COLUMNS_UP_TO
			? [0, cols.indexes.length]
			: windowOf(cols, scrollLeft, viewWidth - rowHeadWidth, OVERSCAN_COLS)
	);
	const colFrom = $derived(colWindow[0]);
	const colTo = $derived(colWindow[1]);
	const colPositions = $derived(Array.from({ length: colTo - colFrom }, (_, i) => colFrom + i));

	type Drawn = {
		/** The top-left cell: the master of a merge. */
		row: number;
		col: number;
		/** Axis positions, for aria-colindex and for the active cell's id. */
		colPos: number;
		left: number;
		width: number;
		height: number;
		first: string;
		full: string;
		more: number;
		align: 'left' | 'right' | 'center';
		/** Merged and spilling cells cover their neighbors' gridlines. */
		layered: boolean;
		/** A merge taller than a row has room for its whole text, wrapped, as notes blocks are written to be read. */
		wrap: boolean;
	};
	type DrawnRow = { row: number; pos: number; top: number; gap: boolean; cells: Drawn[] };

	/** A merge is drawn in the row of its top-left cell, or the next drawn row when that one is hidden. */
	const mergeRow = (merge: CellRange) => Math.min(positionOf(rows, merge.top), rows.indexes.length - 1);
	const masterAt = (row: number, col: number) => {
		const merge = sheet.merges.find((candidate) => contains(candidate, row, col));
		return merge ? { row: merge.top, col: merge.left } : { row, col };
	};

	const drawnRows = $derived.by((): DrawnRow[] => {
		if (rowTo <= rowFrom) return [];
		const first = rows.indexes[rowFrom];
		const last = rows.indexes[rowTo - 1];
		const merges = sheet.merges.filter((merge) => merge.bottom >= first && merge.top <= last);
		const positions = new Set<number>();
		for (let pos = rowFrom; pos < rowTo; pos++) positions.add(pos);
		// The row a merge is drawn in is drawn while any of the merge shows, even when it is scrolled out of view.
		for (const merge of merges) positions.add(mergeRow(merge));
		return [...positions].sort((a, b) => a - b).map((pos) => drawRow(pos, merges));
	});

	function drawRow(pos: number, merges: CellRange[]): DrawnRow {
		const row = rows.indexes[pos];
		const covering = merges.filter((merge) => row >= merge.top && row <= merge.bottom);
		const covered = (col: number) => covering.some((merge) => col >= merge.left && col <= merge.right);
		const cells: Drawn[] = [];
		for (let c = colFrom; c < colTo; c++) {
			const col = cols.indexes[c];
			if (covered(col)) continue;
			const cell = sheet.cell(row, col);
			const drawn = draw(cell, row, col, c, cols.offsets[c], widths[col], ROW_HEIGHT);
			// Text runs over empty cells to its right, as in Excel; numbers and multi-line cells stay in their cell, and
			// text never crosses a table's outline, which would cut through it.
			const needed = cell.kind === 'text' && !drawn.more ? textWidth(drawn.first, measure) : 0;
			if (needed > drawn.width) {
				const table = tableAt(overlay, row, col);
				const free = (next: number) =>
					!covered(next) && sheet.cell(row, next).kind === 'empty' && tableAt(overlay, row, next) === table;
				const end = spillEnd(cols, c, needed, free);
				drawn.width = cols.offsets[end + 1] - cols.offsets[c];
				drawn.layered = end > c;
			}
			cells.push(drawn);
		}
		for (const merge of merges) {
			if (mergeRow(merge) !== pos) continue;
			const x = spanOf(cols, merge.left, merge.right);
			const y = spanOf(rows, merge.top, merge.bottom);
			if (x.end <= x.start || y.end <= y.start) continue;
			const master = sheet.cell(merge.top, merge.left);
			const drawn = draw(master, merge.top, merge.left, positionOf(cols, merge.left), x.start, x.end - x.start, y.end - y.start);
			cells.push({ ...drawn, layered: true, wrap: drawn.height > ROW_HEIGHT && drawn.full.length > 0 });
		}
		return { row, pos, top: rows.offsets[pos], gap: gapBefore(rows, pos), cells };
	}

	function draw(cell: Cell, row: number, col: number, colPos: number, left: number, width: number, height: number): Drawn {
		const full = displayText(cell);
		const newline = full.indexOf('\n');
		const align = cell.kind === 'number' || cell.kind === 'date' ? 'right' : cell.kind === 'boolean' || cell.kind === 'error' ? 'center' : 'left';
		return {
			row,
			col,
			colPos,
			left,
			width,
			height,
			first: newline === -1 ? full : full.slice(0, newline),
			full,
			more: newline === -1 ? 0 : full.split('\n').length - 1,
			align,
			layered: false,
			wrap: false
		};
	}

	/** Focus ranges grown to whole merges: that is what Excel selects, and what the highlight outlines. */
	const selection = $derived(focus ? focus.ranges.map((range) => withMerges(range, sheet.merges)) : []);
	const selectionBoxes = $derived(selection.flatMap((range) => boxOf(rows, cols, range) ?? []));
	/** The cursor: the first drawn cell of the first range, as the top-left of its merge. */
	const active = $derived.by(() => {
		const first = selection[0];
		if (!first) return null;
		const row = rows.indexes[positionOf(rows, first.top)];
		const col = cols.indexes[positionOf(cols, first.left)];
		return row === undefined || col === undefined ? null : masterAt(row, col);
	});
	const outlines = $derived(
		overlay.tables.flatMap((table) => {
			const box = boxOf(rows, cols, table.range);
			return box ? [{ id: table.id, tone: table.tone, box }] : [];
		})
	);

	const cellId = (row: number, col: number) => `${uid}-${row}-${col}`;
	const selectedRow = (row: number) => selection.some((range) => row >= range.top && row <= range.bottom);
	const selectedCol = (col: number) => selection.some((range) => col >= range.left && col <= range.right);
	const isSelected = (row: number, col: number) => selection.some((range) => contains(range, row, col));
	const isActive = (row: number, col: number) => active?.row === row && active.col === col;

	/** Background and weight of a cell: the selection, then a table's header and skipped rows. */
	function cellTone(row: number, col: number): string {
		if (isSelected(row, col) && !isActive(row, col)) return 'bg-[#e3f1e8]';
		const table = tableAt(overlay, row, col);
		if (table?.headerRows.has(row)) return `${TONE_HEADER[table.tone]} font-medium text-slate-900`;
		if (table?.skipped.has(row)) return 'bg-slate-50 text-slate-400';
		return 'bg-white';
	}

	function cellTitle(cell: Drawn): string | undefined {
		const skipped = tableAt(overlay, cell.row, cell.col)?.skipped.get(cell.row);
		const parts = [cell.more || cell.wrap ? cell.full : '', skipped ? `Skipped: ${SKIP_REASON[skipped]}` : ''].filter(Boolean);
		return parts.length ? parts.join('\n\n') : undefined;
	}

	function rowSkip(row: number): string | undefined {
		const reason = overlay.tables.find((table) => table.skipped.has(row))?.skipped.get(row);
		return reason ? `Skipped: ${SKIP_REASON[reason]}` : undefined;
	}

	/** The active cell's id, only while it is drawn, so assistive technology never points at a missing element. */
	const activeId = $derived.by(() => {
		if (!active) return undefined;
		const pos = positionOf(rows, active.row);
		const drawn = drawnRows.find((line) => line.pos === pos)?.cells.some((cell) => cell.row === active.row && cell.col === active.col);
		return drawn ? cellId(active.row, active.col) : undefined;
	});
	const activeCell = $derived(active ? sheet.cell(active.row, active.col) : null);

	/** Scroll so the boxes show: all of them when they fit, else the first. */
	function revealBoxes(boxes: Box[], mode: RevealMode) {
		if (!scroller || boxes.length === 0) return;
		const view = {
			scrollTop: scroller.scrollTop,
			scrollLeft: scroller.scrollLeft,
			width: scroller.clientWidth - rowHeadWidth,
			height: scroller.clientHeight - headHeight
		};
		if (view.width <= 0 || view.height <= 0) return;
		const all = unionOf(boxes)!;
		const target = all.bottom - all.top <= view.height && all.right - all.left <= view.width ? all : boxes[0];
		const next = reveal(view, target, mode);
		if (next.top === view.scrollTop && next.left === view.scrollLeft) return;
		scroller.scrollTo({ top: next.top, left: next.left });
		// Draw the new rows in this frame rather than after the scroll event.
		scrollTop = scroller.scrollTop;
		scrollLeft = scroller.scrollLeft;
	}

	// A focus from the review jumps: the target is centered unless it is already in view.
	$effect(() => {
		const boxes = selectionBoxes;
		untrack(() => revealBoxes(boxes, 'center'));
	});

	/** Moves the cursor: scroll just enough first, so the focus that comes back is already in view and stays put. */
	function select(row: number, col: number) {
		const range = withMerges({ top: row, left: col, bottom: row, right: col }, sheet.merges);
		const box = boxOf(rows, cols, range);
		if (box) revealBoxes([box], 'nearest');
		onSelect(range.top, range.left);
	}

	function onclick(event: MouseEvent) {
		const target = (event.target as Element).closest<HTMLElement>('[data-row]');
		if (!target) return;
		const row = Number(target.dataset.row);
		const col = Number(target.dataset.col);
		select(row, col);
		onActivate(row, col);
	}

	/** The drawn index `steps` positions away from the cell's edge in that direction, past a merge the cell spans. */
	function stepFrom(axis: typeof rows, start: number, end: number, steps: number): number {
		const pos = steps > 0 ? positionOf(axis, end + 1) + steps - 1 : positionOf(axis, start) + steps;
		return axis.indexes[Math.max(0, Math.min(axis.indexes.length - 1, pos))];
	}

	function onkeydown(event: KeyboardEvent) {
		// Without a cursor, start from the top-left cell in view.
		const from = active ?? {
			row: rows.indexes[windowOf(rows, scrollTop, 1, 0)[0]],
			col: cols.indexes[windowOf(cols, scrollLeft, 1, 0)[0]]
		};
		const span = withMerges({ top: from.row, left: from.col, bottom: from.row, right: from.col }, sheet.merges);
		const page = Math.max(1, Math.floor((viewHeight - headHeight) / ROW_HEIGHT) - 1);
		const extent = sheet.valueExtent ?? { top: 1, left: 1, bottom: 1, right: 1 };
		const ctrl = event.ctrlKey || event.metaKey;
		let to: { row: number; col: number };
		switch (event.key) {
			case 'ArrowDown':
				to = { row: stepFrom(rows, span.top, span.bottom, 1), col: from.col };
				break;
			case 'ArrowUp':
				to = { row: stepFrom(rows, span.top, span.bottom, -1), col: from.col };
				break;
			case 'ArrowRight':
				to = { row: from.row, col: stepFrom(cols, span.left, span.right, 1) };
				break;
			case 'ArrowLeft':
				to = { row: from.row, col: stepFrom(cols, span.left, span.right, -1) };
				break;
			case 'PageDown':
				to = { row: stepFrom(rows, span.top, span.bottom, page), col: from.col };
				break;
			case 'PageUp':
				to = { row: stepFrom(rows, span.top, span.bottom, -page), col: from.col };
				break;
			case 'Home':
				to = { row: ctrl ? rows.indexes[0] : from.row, col: cols.indexes[0] };
				break;
			case 'End':
				to = { row: ctrl ? extent.bottom : from.row, col: extent.right };
				break;
			case 'Enter':
				if (active) onActivate(active.row, active.col);
				event.preventDefault();
				return;
			default:
				return;
		}
		event.preventDefault();
		const master = masterAt(to.row, to.col);
		select(master.row, master.col);
	}

	const chipLabel = (field: keyof typeof FIELD_LABEL) => (field === 'part' ? 'Part' : FIELD_LABEL[field]);
	const valueLines = $derived(activeCell ? displayText(activeCell).split('\n') : []);
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!--
		Name box and formula bar, as in Excel: the cursor's address and its whole value, read-only so the value can be
		selected and copied. Out of the tab order: the grid already announces the cell it is on.
	-->
	<div class="flex h-8 shrink-0 items-stretch border-b border-slate-200 bg-white text-[13px]">
		<input
			class="w-20 shrink-0 border-r border-slate-200 bg-transparent px-2 font-mono text-xs text-slate-700 outline-none"
			aria-label="Selected cell"
			readonly
			tabindex="-1"
			value={active ? toA1(active.row, active.col) : ''}
		/>
		<span class="flex items-center px-2.5 font-serif text-sm italic text-slate-400" aria-hidden="true">fx</span>
		<!-- One line, as in Excel's collapsed formula bar; line breaks show as ↵. -->
		<input
			class="min-w-0 flex-1 bg-transparent pr-3 text-slate-800 outline-none"
			aria-label="Cell value"
			readonly
			tabindex="-1"
			value={valueLines.join('  ↵  ')}
		/>
	</div>

	<div
		bind:this={scroller}
		bind:clientWidth={viewWidth}
		bind:clientHeight={viewHeight}
		class="relative isolate min-h-0 flex-1 overflow-auto overscroll-contain bg-white text-[13px] text-slate-800 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-blue-600)]"
		role="grid"
		tabindex="0"
		aria-labelledby={tabId}
		aria-rowcount={rows.indexes.length + 1}
		aria-colcount={cols.indexes.length + 1}
		aria-multiselectable="true"
		aria-activedescendant={activeId}
		onscroll={() => {
			scrollTop = scroller!.scrollTop;
			scrollLeft = scroller!.scrollLeft;
		}}
		{onkeydown}
		{onclick}
	>
		<div class="relative" style:width="{rowHeadWidth + axisSize(cols)}px" style:height="{headHeight + axisSize(rows)}px">
			<div role="row" aria-rowindex={1} class="sticky top-0 z-20" style:height="{headHeight}px">
				<div
					role="columnheader"
					aria-colindex={1}
					class="sticky left-0 z-10 h-full border-b border-r border-slate-300 bg-slate-100"
					style:width="{rowHeadWidth}px"
				>
					<span class="sr-only">Row</span>
				</div>
				{#each colPositions as c (c)}
					{@const col = cols.indexes[c]}
					{@const chips = overlay.chips.get(col) ?? []}
					{@const picked = selectedCol(col)}
					<div
						role="columnheader"
						aria-colindex={c + 2}
						class={[
							'absolute top-0 flex h-full flex-col items-center border-b border-r border-slate-300',
							picked ? 'bg-[#d3eadb] text-[#0b5a31]' : 'bg-slate-100 text-slate-600'
						]}
						style:left="{rowHeadWidth + cols.offsets[c]}px"
						style:width="{widths[col]}px"
					>
						<span class={['text-xs leading-[22px]', picked && 'font-semibold']}>{colLetter(col)}</span>
						{#if chips.length}
							<span class="flex max-w-full gap-0.5 px-1">
								{#each chips as chip (chip.field + chip.tone)}
									<span
										class={['truncate rounded px-1 text-[10px] font-semibold leading-4 ring-1 ring-inset', TONE_CHIP[chip.tone]]}
										title={`Column ${colLetter(col)} imports as ${FIELD_LABEL[chip.field]}`}
									>
										{chipLabel(chip.field)}
									</span>
								{/each}
							</span>
						{/if}
						{#if picked}<span class="absolute inset-x-0 -bottom-px h-0.5 bg-[#107c41]"></span>{/if}
						{#if gapBefore(cols, c)}
							<span class="absolute inset-y-0 -left-0.5 w-[3px] border-x border-slate-400" title="Hidden columns" aria-hidden="true"></span>
						{/if}
					</div>
				{/each}
			</div>

			{#each drawnRows as line (line.row)}
				{@const picked = selectedRow(line.row)}
				{@const skip = rowSkip(line.row)}
				<div role="row" aria-rowindex={line.pos + 2} class="absolute left-0 w-full" style:top="{headHeight + line.top}px" style:height="{ROW_HEIGHT}px">
					<div
						role="rowheader"
						class={[
							'sticky left-0 z-10 h-full border-b border-r border-slate-300 text-center text-xs leading-[21px] tabular-nums',
							picked ? 'bg-[#d3eadb] font-semibold text-[#0b5a31]' : skip ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'
						]}
						style:width="{rowHeadWidth}px"
						title={skip}
					>
						{line.row}
						{#if picked}<span class="absolute inset-y-0 -right-px w-0.5 bg-[#107c41]"></span>{/if}
						{#if line.gap}
							<span class="absolute inset-x-0 -top-0.5 h-[3px] border-y border-slate-400" title="Hidden rows" aria-hidden="true"></span>
						{/if}
					</div>
					{#each line.cells as cell (cell.col)}
						<div
							role="gridcell"
							id={cellId(cell.row, cell.col)}
							aria-colindex={cell.colPos + 2}
							aria-selected={isSelected(cell.row, cell.col)}
							data-row={cell.row}
							data-col={cell.col}
							class={[
								'absolute top-0 flex cursor-cell items-center gap-1 overflow-hidden border-b border-r border-[#e2e5e9] px-1.5 leading-[21px]',
								cell.layered && 'z-[1]',
								cell.align === 'right' && 'justify-end tabular-nums',
								cell.align === 'center' && 'justify-center',
								cellTone(cell.row, cell.col)
							]}
							style:left="{rowHeadWidth + cell.left}px"
							style:width="{cell.width}px"
							style:height="{cell.height}px"
							title={cellTitle(cell)}
						>
							{#if cell.wrap}
								<span class="min-w-0 self-start whitespace-pre-wrap break-words">{cell.full}</span>
							{:else if cell.first}
								<span class="min-w-0 truncate whitespace-pre">{cell.first}</span>
							{/if}
							{#if cell.more && !cell.wrap}
								<span class="ml-auto shrink-0 rounded bg-slate-100 px-1 text-[10px] leading-4 text-slate-500">+{cell.more} {cell.more === 1 ? 'line' : 'lines'}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/each}

			<!-- What the importer found, and the focus, drawn over the cells and under the sticky headers. -->
			{#each outlines as outline (outline.id)}
				<div
					class={['pointer-events-none absolute z-[5] border-2', TONE_OUTLINE[outline.tone]]}
					style:top="{headHeight + outline.box.top - 1}px"
					style:left="{rowHeadWidth + outline.box.left - 1}px"
					style:width="{outline.box.right - outline.box.left + 1}px"
					style:height="{outline.box.bottom - outline.box.top + 1}px"
					data-outline={outline.tone}
				></div>
			{/each}
			{#each selectionBoxes as box, i (i)}
				<div
					class="pointer-events-none absolute z-[6] border-2 border-[#107c41]"
					style:top="{headHeight + box.top - 1}px"
					style:left="{rowHeadWidth + box.left - 1}px"
					style:width="{box.right - box.left + 1}px"
					style:height="{box.bottom - box.top + 1}px"
				></div>
			{/each}
		</div>
	</div>
</div>
