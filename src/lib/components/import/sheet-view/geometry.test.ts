import { describe, expect, it } from 'vitest';
import { makeSheet } from '$lib/import/testing';
import {
	axisSize,
	boxOf,
	buildAxis,
	columnWidths,
	gapBefore,
	MAX_COL_WIDTH,
	MIN_COL_WIDTH,
	positionOf,
	reveal,
	ROW_HEIGHT,
	spanOf,
	spillEnd,
	textWidth,
	unionOf,
	windowOf,
	withMerges,
	type View
} from './geometry';

const rows = (count: number, hidden: number[] = []) => buildAxis(count, new Set(hidden), () => ROW_HEIGHT);

describe('axis', () => {
	it('leaves hidden indexes out, so they take no space', () => {
		// WOW hides columns A-C.
		const cols = buildAxis(6, new Set([1, 2, 3]), (col) => col * 10);
		expect([...cols.indexes]).toEqual([4, 5, 6]);
		expect([...cols.offsets]).toEqual([0, 40, 90, 150]);
		expect(axisSize(cols)).toBe(150);
	});

	it('finds positions and spans; a hidden span is empty and a hidden index resolves to the next drawn one', () => {
		const axis = rows(10, [4, 5]);
		expect(positionOf(axis, 3)).toBe(2);
		expect(positionOf(axis, 4)).toBe(3);
		expect(positionOf(axis, 11)).toBe(8);
		expect(spanOf(axis, 3, 6)).toEqual({ start: 2 * ROW_HEIGHT, end: 4 * ROW_HEIGHT });
		expect(spanOf(axis, 4, 5)).toEqual({ start: 3 * ROW_HEIGHT, end: 3 * ROW_HEIGHT });
	});

	it('marks where hidden indexes were, for Excel\'s double line', () => {
		const axis = rows(10, [1, 4, 5]);
		expect([0, 1, 2, 3].map((i) => gapBefore(axis, i))).toEqual([true, false, true, false]);
	});
});

describe('windowOf', () => {
	const big = rows(100_000);

	it('draws only the rows a viewport needs at 100,000 rows, plus overscan', () => {
		const height = 600;
		const scroll = 50_000 * ROW_HEIGHT + 7;
		const [from, to] = windowOf(big, scroll, height, 10);
		// Row 50,001 is at position 50,000; the viewport shows 28 rows (one partially), plus 10 on each side.
		expect(big.indexes[from]).toBe(50_001 - 10);
		expect(to - from).toBe(Math.ceil((height + 7) / ROW_HEIGHT) + 20);
	});

	it('clamps at both ends', () => {
		expect(windowOf(big, 0, 220, 5)).toEqual([0, 15]);
		expect(windowOf(big, axisSize(big) - 220, 220, 5)).toEqual([100_000 - 15, 100_000]);
		expect(windowOf(rows(3), 0, 500, 5)).toEqual([0, 3]);
	});
});

describe('boxes', () => {
	const r = rows(200);
	const c = buildAxis(6, new Set([2]), () => 100);

	it('measures a range, leaving hidden columns out, and is null when all of it is hidden', () => {
		expect(boxOf(r, c, { top: 3, left: 1, bottom: 4, right: 3 })).toEqual({ top: 44, left: 0, bottom: 88, right: 200 });
		expect(boxOf(r, c, { top: 3, left: 2, bottom: 4, right: 2 })).toBeNull();
	});

	it('unions boxes', () => {
		expect(unionOf([{ top: 5, left: 9, bottom: 6, right: 10 }, { top: 1, left: 20, bottom: 3, right: 30 }])).toEqual({ top: 1, left: 9, bottom: 6, right: 30 });
		expect(unionOf([])).toBeNull();
	});

	it('grows a range to the merges it touches', () => {
		const merges = [{ top: 4, left: 1, bottom: 6, right: 1 }, { top: 1, left: 1, bottom: 1, right: 12 }];
		expect(withMerges({ top: 5, left: 1, bottom: 5, right: 3 }, merges)).toEqual({ top: 4, left: 1, bottom: 6, right: 3 });
		expect(withMerges({ top: 2, left: 2, bottom: 2, right: 2 }, merges)).toEqual({ top: 2, left: 2, bottom: 2, right: 2 });
	});
});

describe('reveal', () => {
	const view: View = { scrollTop: 1000, scrollLeft: 0, width: 800, height: 400 };
	const box = (top: number, left = 10, height = 22, width = 100) => ({ top, left, bottom: top + height, right: left + width });

	it('does not move when the target is already visible', () => {
		expect(reveal(view, box(1000), 'center')).toEqual({ top: 1000, left: 0 });
		expect(reveal(view, box(1378), 'nearest')).toEqual({ top: 1000, left: 0 });
	});

	it('nearest: scrolls just enough, as a cursor moving off an edge does', () => {
		expect(reveal(view, box(1390), 'nearest')).toEqual({ top: 1012, left: 0 });
		expect(reveal(view, box(990), 'nearest')).toEqual({ top: 990, left: 0 });
	});

	it('center: puts a far target in the middle, never above the top', () => {
		expect(reveal(view, box(5000), 'center')).toEqual({ top: 5000 + 11 - 200, left: 0 });
		expect(reveal(view, box(44), 'center')).toEqual({ top: 0, left: 0 });
	});

	it('aligns a target larger than the viewport to its start', () => {
		expect(reveal(view, box(3000, 10, 900), 'center')).toEqual({ top: 3000, left: 0 });
	});

	it('scrolls each axis on its own', () => {
		expect(reveal(view, box(1100, 2000), 'center')).toEqual({ top: 1000, left: 2000 + 50 - 400 });
	});
});

describe('column widths', () => {
	it('sizes a column by its values, ignoring a long outlier and merged cells, within the limits', () => {
		const long = 'A heading far longer than any value in this column';
		const sheet = makeSheet(
			'S',
			[
				['Inventory of every active part we list with an NSN, July'],
				[long, 'NSN', 'x'],
				...Array.from({ length: 20 }, (_, i) => [`PN-${i}`, '5305-01-658-2565', 'y'.repeat(80)])
			],
			{ merges: ['A1:C1'] }
		);
		const widths = columnWidths(sheet, 4);
		expect(widths[1]).toBe(Math.max(MIN_COL_WIDTH, textWidth('PN-19')));
		expect(widths[2]).toBe(textWidth('5305-01-658-2565'));
		expect(widths[3]).toBe(MAX_COL_WIDTH);
		expect(widths[4]).toBe(MIN_COL_WIDTH);

		// As a table's header row, row 2 sets a floor; the measure is the caller's.
		const measure = (text: string) => text.length * 4;
		const headed = columnWidths(sheet, 4, { headerRows: [2], measure });
		expect(headed[1]).toBe(textWidth(long, measure));
		expect(headed[2]).toBe(textWidth('5305-01-658-2565', measure));
	});

	it('leaves room for the "+N lines" marker after a multi-line cell\'s first line', () => {
		expect(textWidth('12669555\nRVX08212')).toBeGreaterThan(textWidth('12669555') + 30);
	});
});

describe('spillEnd', () => {
	const cols = buildAxis(8, new Set(), () => 64);

	it('runs over free columns until the text fits', () => {
		expect(spillEnd(cols, 0, 150, () => true)).toBe(2);
		expect(spillEnd(cols, 0, 60, () => true)).toBe(0);
	});

	it('stops before a column holding a value, and at the last column', () => {
		expect(spillEnd(cols, 0, 1000, (col) => col !== 4)).toBe(2);
		expect(spillEnd(cols, 5, 1000, () => true)).toBe(7);
	});
});
