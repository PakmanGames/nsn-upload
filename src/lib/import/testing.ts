/**
 * Builders for SheetModel and WorkbookModel, so pipeline stages can be tested without SheetJS.
 *
 * They follow the reader's conventions: text uses LF line endings, integers get exact text (never exponent form),
 * merge-covered cells copy their master, and the value extent ignores empty cells.
 */
import type {
	Cell,
	CellKind,
	CellRange,
	SheetModel,
	SheetVisibility,
	WorkbookModel
} from './model';
import { emptyCell, parseRange, toA1 } from './refs';

/**
 * string -> text, number -> number, boolean -> "TRUE"/"FALSE"; null, undefined, and '' -> empty.
 * Pass a partial Cell for dates, errors, number formats, and formulas, e.g. `{ kind: 'error', raw: '#N/A' }`.
 */
export type CellInput =
	| string
	| number
	| boolean
	| null
	| undefined
	| (Partial<Cell> & Pick<Cell, 'kind'>);

export type SheetOptions = {
	/** Defaults to 0; makeWorkbook() renumbers sheets by position. */
	index?: number;
	visibility?: SheetVisibility;
	hiddenRows?: Iterable<number>;
	hiddenCols?: Iterable<number>;
	/** CellRange objects or A1 ranges such as "A2:A4". */
	merges?: Array<CellRange | string>;
};

/** `rows[0]` is Excel row 1 and `rows[r][0]` is column A. */
export function makeSheet(name: string, rows: CellInput[][], options: SheetOptions = {}): SheetModel {
	const cells = new Map<string, Cell>();
	rows.forEach((values, r) =>
		values.forEach((value, c) => {
			const cell = toCell(r + 1, c + 1, value);
			if (cell) cells.set(cell.ref, cell);
		})
	);

	const merges = (options.merges ?? []).map(toRange);
	for (const merge of merges) {
		const mergedFrom = toA1(merge.top, merge.left);
		// kind travels with text and raw, so a covered cell reads as the value it displays.
		const { kind, text, raw } = cells.get(mergedFrom) ?? emptyCell(merge.top, merge.left);
		for (let row = merge.top; row <= merge.bottom; row++) {
			for (let col = merge.left; col <= merge.right; col++) {
				const ref = toA1(row, col);
				if (ref !== mergedFrom) cells.set(ref, { ref, row, col, kind, text, raw, mergedFrom });
			}
		}
	}

	return {
		name,
		index: options.index ?? 0,
		visibility: options.visibility ?? 'visible',
		valueExtent: extentOf(cells.values()),
		cell: (row, col) => cells.get(toA1(row, col)) ?? emptyCell(row, col),
		merges,
		hiddenRows: new Set(options.hiddenRows ?? []),
		hiddenCols: new Set(options.hiddenCols ?? [])
	};
}

export function makeWorkbook(fileName: string, sheets: SheetModel[]): WorkbookModel {
	return { fileName, sheets: sheets.map((sheet, index) => ({ ...sheet, index })) };
}

function toCell(row: number, col: number, input: CellInput): Cell | null {
	if (input === null || input === undefined || input === '') return null;
	const partial: Partial<Cell> & Pick<Cell, 'kind'> =
		typeof input === 'object' ? input : { kind: kindOf(input), raw: input };
	const { kind } = partial;
	const raw = kind === 'empty' ? null : (partial.raw ?? partial.text ?? null);
	// The contract keeps text empty for empty and error cells; error codes live in raw.
	const text = kind === 'empty' || kind === 'error' ? '' : toLf(partial.text ?? displayText(raw));
	return { ...partial, ref: toA1(row, col), row, col, kind, text, raw };
}

function kindOf(value: string | number | boolean): CellKind {
	if (typeof value === 'string') return 'text';
	return typeof value === 'number' ? 'number' : 'boolean';
}

function displayText(raw: Cell['raw']): string {
	if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
	// BigInt prints every integer digit by digit, where String() switches to exponent form at 1e21.
	if (typeof raw === 'number') return Number.isInteger(raw) ? BigInt(raw).toString() : String(raw);
	return raw ?? '';
}

function toLf(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

function toRange(merge: CellRange | string): CellRange {
	if (typeof merge !== 'string') return merge;
	const range = parseRange(merge);
	if (!range) throw new Error(`Invalid merge range "${merge}"`);
	return range;
}

function extentOf(cells: Iterable<Cell>): CellRange | null {
	let extent: CellRange | null = null;
	for (const { row, col, kind } of cells) {
		if (kind === 'empty') continue;
		extent = extent
			? {
					top: Math.min(extent.top, row),
					left: Math.min(extent.left, col),
					bottom: Math.max(extent.bottom, row),
					right: Math.max(extent.right, col)
				}
			: { top: row, left: col, bottom: row, right: col };
	}
	return extent;
}
