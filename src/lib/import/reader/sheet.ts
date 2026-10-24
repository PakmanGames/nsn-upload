/**
 * SheetJS worksheet -> contract `SheetModel`.
 *
 * Only stored cells are visited. `!ref` is ignored because it also covers styled empty cells: a sheet with about 15
 * real rows can report A1:Z1000.
 */
import type { WorkSheet } from 'xlsx';
import type { Cell, CellRange, SheetModel, SheetVisibility } from '../model';
import { emptyCell, toA1 } from '../refs';
import { toCell } from './cells';

export type SheetInfo = { name: string; index: number; visibility: SheetVisibility };

/**
 * `source` must be a dense-mode worksheet (`read(..., { dense: true })`).
 * `spend(count)` reports cells as they are stored, and before a merge is expanded, so the caller can stop an
 * oversized workbook early; a single merge can cover millions of cells.
 */
export function toSheetModel(
	source: WorkSheet,
	info: SheetInfo,
	isDateFormat: (format: string) => boolean,
	spend: (count: number) => void
): SheetModel {
	// rows[row][col] with 1-based Excel coordinates; both levels are sparse.
	const rows: Cell[][] = [];
	const put = (cell: Cell) => {
		(rows[cell.row] ??= [])[cell.col] = cell;
	};

	let stored = 0;
	// forEach skips holes, so only cells present in the file are visited.
	source['!data']?.forEach((cells, r) =>
		cells?.forEach((value, c) => {
			const cell = value && toCell(value, r + 1, c + 1, isDateFormat);
			if (!cell) return;
			put(cell);
			stored++;
		})
	);
	spend(stored);

	const merges: CellRange[] = (source['!merges'] ?? []).map(({ s, e }) => ({
		top: s.r + 1,
		left: s.c + 1,
		bottom: e.r + 1,
		right: e.c + 1
	}));
	for (const merge of merges) {
		spend((merge.bottom - merge.top + 1) * (merge.right - merge.left + 1) - 1);
		const mergedFrom = toA1(merge.top, merge.left);
		// Covered cells read as the value they display, same as makeSheet() in testing.ts.
		const { kind, text, raw } = rows[merge.top]?.[merge.left] ?? emptyCell(merge.top, merge.left);
		for (let row = merge.top; row <= merge.bottom; row++) {
			for (let col = merge.left; col <= merge.right; col++) {
				if (row === merge.top && col === merge.left) continue;
				put({ ref: toA1(row, col), row, col, kind, text, raw, mergedFrom });
			}
		}
	}

	const hiddenRows = new Set<number>();
	source['!rows']?.forEach((props, r) => {
		// A zero-height row is as invisible as a hidden one, like the zero-width columns below.
		if (props?.hidden || props?.hpt === 0) hiddenRows.add(r + 1);
	});
	const hiddenCols = new Set<number>();
	source['!cols']?.forEach((props, c) => {
		// System exports hide metadata columns with width 0 and hidden="0".
		if (props?.hidden || props?.width === 0) hiddenCols.add(c + 1);
	});

	return {
		...info,
		valueExtent: extentOf(rows),
		cell: (row, col) => rows[row]?.[col] ?? emptyCell(row, col),
		merges,
		hiddenRows,
		hiddenCols
	};
}

/** Bounding box of non-empty cells. Error cells count: they hold a value, just not a readable one. */
function extentOf(rows: Cell[][]): CellRange | null {
	let top = Infinity;
	let left = Infinity;
	let bottom = 0;
	let right = 0;
	rows.forEach((cells) =>
		cells.forEach(({ row, col, kind }) => {
			if (kind === 'empty') return;
			top = Math.min(top, row);
			left = Math.min(left, col);
			bottom = Math.max(bottom, row);
			right = Math.max(right, col);
		})
	);
	return bottom === 0 ? null : { top, left, bottom, right };
}
