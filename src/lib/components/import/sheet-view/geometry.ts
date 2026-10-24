/**
 * Geometry of the spreadsheet view: where each row and column is drawn, which of them a viewport needs, and how
 * far to scroll to bring cells into view. Pure, so the virtualization and the scroll math are tested without a
 * browser.
 *
 * An axis lists the sheet rows (or columns) that are drawn, in order. Hidden ones are left out, so they collapse
 * to nothing as in Excel, and every position is a prefix sum of the drawn sizes. Lookups are binary searches, so
 * a 100,000-row sheet costs one array of offsets and O(log n) per scroll.
 */
import type { CellRange, SheetModel } from '$lib/import/model';

export const ROW_HEIGHT = 22;
export const MIN_COL_WIDTH = 64;
export const MAX_COL_WIDTH = 240;
/** Rows and columns drawn beyond each edge of the viewport, so a fast scroll does not show blank space. */
export const OVERSCAN_ROWS = 12;
export const OVERSCAN_COLS = 4;
/** Up to this many columns are all drawn: text spills over empty neighbors only when its own cell is drawn. */
export const ALL_COLUMNS_UP_TO = 40;

/** A cell's horizontal padding and border, with a pixel to spare. */
const CELL_PADDING = 14;
/** Room for the "+N lines" marker beside a multi-line cell's first line. */
const MARKER_WIDTH = 44;
/** Rows sampled to size columns; enough to see a column's typical value without walking a huge sheet. */
const SAMPLE_ROWS = 300;

export type Axis = {
	/** Sheet rows or columns that are drawn, ascending; hidden ones are left out. */
	indexes: Int32Array;
	/** offsets[i] is where indexes[i] starts; offsets[indexes.length] is the total size. */
	offsets: Float64Array;
};

/** Sheet indexes 1..count, skipping hidden ones, each `size(index)` pixels long. */
export function buildAxis(count: number, hidden: ReadonlySet<number>, size: (index: number) => number): Axis {
	const drawn: number[] = [];
	for (let index = 1; index <= count; index++) if (!hidden.has(index)) drawn.push(index);
	const offsets = new Float64Array(drawn.length + 1);
	drawn.forEach((index, i) => (offsets[i + 1] = offsets[i] + size(index)));
	return { indexes: Int32Array.from(drawn), offsets };
}

export const axisSize = (axis: Axis) => axis.offsets[axis.indexes.length];

/** Position of the first drawn index at or after `index`; axis length when there is none. */
export function positionOf(axis: Axis, index: number): number {
	let low = 0;
	let high = axis.indexes.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (axis.indexes[mid] < index) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** Pixel span of sheet indexes first..last. Hidden indexes add nothing, so a fully hidden span is empty. */
export function spanOf(axis: Axis, first: number, last: number): { start: number; end: number } {
	return { start: axis.offsets[positionOf(axis, first)], end: axis.offsets[positionOf(axis, last + 1)] };
}

/** Positions [from, to) that cover pixels scroll..scroll+size, widened by `overscan` positions on each side. */
export function windowOf(axis: Axis, scroll: number, size: number, overscan: number): [number, number] {
	const count = axis.indexes.length;
	// First position that ends after the viewport's start, i.e. the last offset <= scroll.
	let low = 0;
	let high = count;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (axis.offsets[mid + 1] <= scroll) low = mid + 1;
		else high = mid;
	}
	let to = low;
	while (to < count && axis.offsets[to] < scroll + size) to++;
	return [Math.max(0, low - overscan), Math.min(count, to + overscan)];
}

/** Whether hidden indexes sit just before position i, where Excel draws a double line. */
export function gapBefore(axis: Axis, i: number): boolean {
	return axis.indexes[i] - (i > 0 ? axis.indexes[i - 1] : 0) > 1;
}

export type Box = { top: number; left: number; bottom: number; right: number };

/** Pixel box of a cell range in the cells' own coordinates (headers excluded). Null when every row or column is hidden. */
export function boxOf(rows: Axis, cols: Axis, range: CellRange): Box | null {
	const y = spanOf(rows, range.top, range.bottom);
	const x = spanOf(cols, range.left, range.right);
	return y.end > y.start && x.end > x.start ? { top: y.start, left: x.start, bottom: y.end, right: x.end } : null;
}

/** The smallest box holding all of them. */
export function unionOf(boxes: Box[]): Box | null {
	if (boxes.length === 0) return null;
	return boxes.reduce((a, b) => ({
		top: Math.min(a.top, b.top),
		left: Math.min(a.left, b.left),
		bottom: Math.max(a.bottom, b.bottom),
		right: Math.max(a.right, b.right)
	}));
}

/**
 * A range grown to cover every merge it touches, as Excel selects a merged cell whole.
 * One pass: a merge reached only through another merge is not added, which no real sheet needs.
 */
export function withMerges(range: CellRange, merges: CellRange[]): CellRange {
	let grown = range;
	for (const merge of merges) {
		if (!intersects(merge, range)) continue;
		grown = {
			top: Math.min(grown.top, merge.top),
			left: Math.min(grown.left, merge.left),
			bottom: Math.max(grown.bottom, merge.bottom),
			right: Math.max(grown.right, merge.right)
		};
	}
	return grown;
}

export const intersects = (a: CellRange, b: CellRange) =>
	a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;

export const contains = (range: CellRange, row: number, col: number) =>
	row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;

/** The cells' viewport: scroll offsets and the size left once the sticky headers are taken out. */
export type View = { scrollTop: number; scrollLeft: number; width: number; height: number };

/**
 * nearest: the least scroll that shows the target, as a cursor moving off the edge does.
 * center: a jump from elsewhere puts the target in the middle, so what is around it shows too.
 */
export type RevealMode = 'nearest' | 'center';

/**
 * Scroll offsets that bring the box into view. An axis on which the box is already fully visible keeps its offset,
 * so a visible target never moves the grid; a box larger than the viewport is aligned to its start.
 */
export function reveal(view: View, box: Box, mode: RevealMode): { top: number; left: number } {
	return {
		top: revealAxis(view.scrollTop, view.height, box.top, box.bottom, mode),
		left: revealAxis(view.scrollLeft, view.width, box.left, box.right, mode)
	};
}

function revealAxis(scroll: number, size: number, start: number, end: number, mode: RevealMode): number {
	if (start >= scroll && end <= scroll + size) return scroll;
	if (end - start >= size) return Math.max(0, start);
	if (mode === 'center') return Math.max(0, Math.round((start + end - size) / 2));
	return start < scroll ? start : end - size;
}

/** Pixel width of one line of the grid's 13 px text. */
export type Measure = (text: string) => number;

/** A stand-in where no canvas can measure (tests, the server): about the average advance of 13 px text. */
export const estimateWidth: Measure = (text) => text.length * 7;

/** Width a cell needs for its first line, plus the "+N lines" marker when there are more. */
export function textWidth(text: string, measure: Measure = estimateWidth): number {
	const newline = text.indexOf('\n');
	const first = newline === -1 ? text : text.slice(0, newline);
	return Math.ceil(measure(first)) + CELL_PADDING + (newline === -1 ? 0 : MARKER_WIDTH);
}

/**
 * Column widths for columns 1..count (index 0 unused). The file's own widths are not in the model, so each column
 * is sized from its values: the widest sampled value up to twice the median, so a column of identifiers fits all of
 * them while a stray title or note does not widen the whole column. A table's header cell is a floor, so headers
 * stay readable. Merged cells are left out, since they span columns. Every width is clamped to
 * [MIN_COL_WIDTH, MAX_COL_WIDTH].
 */
export function columnWidths(
	sheet: SheetModel,
	count: number,
	{ measure = estimateWidth, headerRows = [] }: { measure?: Measure; headerRows?: number[] } = {}
): number[] {
	const widths = new Array<number>(count + 1).fill(MIN_COL_WIDTH);
	const extent = sheet.valueExtent;
	if (!extent) return widths;
	const merged = (row: number, col: number) => sheet.merges.some((merge) => contains(merge, row, col));
	const width = (row: number, col: number) => {
		const text = displayText(sheet.cell(row, col));
		return text && !merged(row, col) ? textWidth(text, measure) : 0;
	};
	const last = Math.min(extent.bottom, extent.top + SAMPLE_ROWS - 1);
	for (let col = extent.left; col <= Math.min(extent.right, count); col++) {
		const sample: number[] = [];
		for (let row = extent.top; row <= last; row++) {
			const needed = width(row, col);
			if (needed) sample.push(needed);
		}
		const median = sample.toSorted((a, b) => a - b)[Math.floor(sample.length / 2)] ?? 0;
		const fit = Math.max(0, ...sample.filter((needed) => needed <= median * 2));
		const header = Math.max(0, ...headerRows.map((row) => width(row, col)));
		widths[col] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, fit, header));
	}
	return widths;
}

/** What a cell shows: its display text, or the error code for an error cell (whose text is empty by contract). */
export function displayText(cell: { kind: string; text: string; raw: unknown }): string {
	return cell.kind === 'error' ? String(cell.raw ?? '#ERROR') : cell.text;
}

/**
 * The last column position a text cell's first line spills over, as Excel lets text run across empty cells to its
 * right. `position` is the cell's own column position; the spill stops before the first column that is not free
 * (holds a value, or is merged) and once `needed` pixels fit.
 */
export function spillEnd(
	cols: Axis,
	position: number,
	needed: number,
	isFree: (col: number) => boolean
): number {
	const start = cols.offsets[position];
	let end = position;
	while (
		end + 1 < cols.indexes.length &&
		cols.offsets[end + 1] - start < needed &&
		isFree(cols.indexes[end + 1])
	) {
		end++;
	}
	return end;
}
