/**
 * Deterministic table detection: which row is the header, which columns map to which field, where data ends.
 *
 * Every header-like row near the top is tried; each is scored by the mapping its columns would get from
 * header text and a sample of the values below it. Title rows lose because they map nothing. A header may
 * continue on the row directly below it (`Part` over `Number`); then both rows are the header.
 */
import { isPlausiblePart } from '../identifiers';
import type { Cell, CellRange, Field, SheetModel, TableSpec } from '../model';
import { colLetter } from '../refs';
import {
	assignFields,
	DASH_ONLY,
	describeEvidence,
	evaluateColumns,
	FIELD_LABEL,
	isPrimary,
	readHeader,
	tierOf,
	type ColumnEvidence,
	type ColumnHeader,
	type FieldEvidence
} from './columns';
import { matchHeader, normalizeHeader } from './header';
import { detectHeaderless } from './headerless';
import { checkValue } from './values';

/** Non-empty rows from the top of the value extent in which a header is looked for. */
const HEADER_SEARCH_ROWS = 30;
/** Rows below a candidate header used to score it; the chosen table is then scored on all rows. */
const SAMPLE_ROWS = 200;
/** Columns analyzed per sheet; a stray value far to the right must not make detection scan millions of cells. */
export const MAX_COLUMNS = 256;
/** "Mostly short text": share of a row's cells that must read like header labels. */
const HEADER_TEXT_SHARE = 0.75;
const HEADER_TEXT_MAX_LENGTH = 60;
/** Words that finish a label started on the row above (`Part` / `Number`, `Item` / `Name`). */
const CONTINUATION_WORDS = new Set(['number', 'no', 'num', 'nbr', '#', 'name', 'code', 'id']);
const CONTINUATION_MAX_WORDS = 3;
const CONTINUATION_MAX_LENGTH = 30;
/** A bracketed hint such as `(13 digits)` annotates the label above it. */
const BRACKETED = /^[([].*[)\]]$/;
const STRICT_FIELDS: readonly Field[] = ['nsn', 'niin', 'fsc', 'cage'];

export type Detection = {
	/** Null when no header row maps a primary field. */
	spec: TableSpec | null;
	/** Why nothing was found, or notes about other header-like regions. */
	reasons: string[];
};

type Span = { left: number; right: number };

/** A header cell as later rows are compared against it to recognize repeats. */
type HeaderKey = { col: number; key: string; strongFields: ReadonlySet<Field> };

type Trial = {
	/** One header row, or two when the header continues on the row below. */
	rows: number[];
	span: Span;
	keys: HeaderKey[];
	columns: ColumnEvidence[];
	assigned: Map<number, FieldEvidence>;
	score: number;
	hasPrimary: boolean;
};

/** Visible, non-covered cells: a merged title counts once, not once per column it spans. */
function masterCells(sheet: SheetModel, row: number, span: Span) {
	const cells = [];
	for (let col = span.left; col <= span.right; col++) {
		if (sheet.hiddenCols.has(col)) continue;
		const cell = sheet.cell(row, col);
		if (cell.kind !== 'empty' && !cell.mergedFrom) cells.push(cell);
	}
	return cells;
}

const isIdentifier = (sheet: SheetModel, cell: Cell) =>
	checkValue('nsn', cell, sheet.name) === 'pass' || checkValue('niin', cell, sheet.name) === 'pass';

function isHeaderLike(sheet: SheetModel, row: number, span: Span): boolean {
	const cells = masterCells(sheet, row, span);
	if (cells.length === 1) {
		// A lone cell is a header only for a one-column list (`NSN`), never a merged title spanning columns.
		const [cell] = cells;
		const spansColumns = sheet.cell(row, cell.col + 1).mergedFrom === cell.ref;
		return !spansColumns && cell.kind === 'text' && matchHeader(cell.text).some((m) => m.strength === 'strong');
	}
	if (cells.length < 2) return false;
	// Labels are short text; digits without letters (`5305`, `2026-07-17`) are data, while `#` is a label.
	const labels = cells.filter(
		(cell) =>
			cell.kind === 'text' &&
			cell.text.trim().length <= HEADER_TEXT_MAX_LENGTH &&
			(/\p{L}/u.test(cell.text) || !/\d/.test(cell.text)) &&
			!isIdentifier(sheet, cell)
	);
	return labels.length >= 2 && labels.length >= cells.length * HEADER_TEXT_SHARE;
}

function headerKeys(sheet: SheetModel, row: number, span: Span): HeaderKey[] {
	return masterCells(sheet, row, span).map((cell) => ({
		col: cell.col,
		key: normalizeHeader(cell.text),
		strongFields: new Set(matchHeader(cell.text).filter((m) => m.strength === 'strong').map((m) => m.field))
	}));
}

/** Most header cells come back, by text or by naming the same field (`Part No.` under `P/N`). */
function repeatsHeader(sheet: SheetModel, row: number, keys: readonly HeaderKey[]): boolean {
	const named = keys.filter((k) => k.strongFields.size > 0);
	const compared = named.length > 0 ? named : keys;
	const hits = compared.filter(({ col, key, strongFields }) => {
		const text = sheet.cell(row, col).text;
		return normalizeHeader(text) === key || matchHeader(text).some((m) => m.strength === 'strong' && strongFields.has(m.field));
	});
	return hits.length * 2 > compared.length;
}

/** The same labels as an earlier header, cell for cell: the header repeated, never a rival to it. */
function sameLabels(sheet: SheetModel, row: number, keys: readonly HeaderKey[]): boolean {
	const hits = keys.filter(({ col, key }) => normalizeHeader(sheet.cell(row, col).text) === key);
	return hits.length * 2 > keys.length && hits.length >= Math.min(2, keys.length);
}

/**
 * Whether the row below a header candidate finishes its labels. Every cell must be short label text that
 * fails the strict NSN / NIIN / FSC / CAGE checks and is not a plausible part number (bracketed hints may hold
 * digits). Short text alone could be a first data row (`ABC`, `Screw`), so the row must also read as header:
 * a continuation word, a bracketed hint, or a join that names a field the upper label alone does not.
 */
function continuesHeader(sheet: SheetModel, row: number, extent: CellRange, span: Span): boolean {
	const next = row + 1;
	if (next > extent.bottom || sheet.hiddenRows.has(next)) return false;
	const cells = masterCells(sheet, next, span).filter((cell) => !DASH_ONLY.test(cell.text.trim()));
	if (cells.length === 0) return false;
	for (const cell of cells) {
		const text = cell.text.trim();
		if (cell.kind !== 'text' || text.length > CONTINUATION_MAX_LENGTH || text.split(/\s+/).length > CONTINUATION_MAX_WORDS) return false;
		if (STRICT_FIELDS.some((field) => ['pass', 'repaired'].includes(checkValue(field, cell, sheet.name)))) return false;
		if (!BRACKETED.test(text) && isPlausiblePart(text)) return false;
	}
	return cells.some((cell) => {
		const text = cell.text.trim();
		if (BRACKETED.test(text) || CONTINUATION_WORDS.has(normalizeHeader(text))) return true;
		const above = sheet.cell(row, cell.col).text;
		const strong = (t: string) => matchHeader(t).filter((m) => m.strength === 'strong').map((m) => m.field);
		const before = strong(above);
		return strong(`${above} ${text}`).some((field) => !before.includes(field));
	});
}

/**
 * A row that could head a different table: header-like, no NSN/NIIN values, at least two label cells that
 * strongly name a field, and not a repeat of the current header. The bar is high because stopping a table
 * early drops real rows.
 */
function startsOtherTable(sheet: SheetModel, row: number, span: Span, keys: readonly HeaderKey[]): boolean {
	if (sheet.hiddenRows.has(row) || !isHeaderLike(sheet, row, span)) return false;
	const cells = masterCells(sheet, row, span);
	if (cells.some((cell) => isIdentifier(sheet, cell))) return false;
	const labels = cells.filter((cell) => matchHeader(cell.text).some((m) => m.strength === 'strong'));
	return labels.length >= 2 && !repeatsHeader(sheet, row, keys);
}

function headerCandidates(sheet: SheetModel, extent: CellRange, span: Span): number[] {
	const rows: number[] = [];
	let nonEmpty = 0;
	for (let row = extent.top; row <= extent.bottom && nonEmpty < HEADER_SEARCH_ROWS; row++) {
		if (sheet.hiddenRows.has(row) || masterCells(sheet, row, span).length === 0) continue;
		nonEmpty++;
		if (isHeaderLike(sheet, row, span)) rows.push(row);
	}
	return rows;
}

/**
 * Columns beside the header that hold values in the sampled rows: someone filled them in without a label.
 * They join the table as columns without a header, so their values are listed rather than dropped silently.
 */
function withUnlabeledColumns(sheet: SheetModel, header: Span, sample: readonly number[], sheetSpan: Span): Span {
	const hasOwnValue = (col: number) =>
		sample.some((row) => {
			const cell = sheet.cell(row, col);
			return cell.kind !== 'empty' && !cell.mergedFrom;
		});
	let { left, right } = header;
	// Each loop stops at the outermost column with a value, since that column becomes the new edge.
	for (let col = sheetSpan.left; col < left; col++) if (hasOwnValue(col)) left = col;
	for (let col = sheetSpan.right; col > right; col--) if (hasOwnValue(col)) right = col;
	return { left, right };
}

function tryHeader(sheet: SheetModel, rows: number[], extent: CellRange, sheetSpan: Span): Trial {
	let left = sheetSpan.right;
	let right = sheetSpan.left;
	for (let col = sheetSpan.left; col <= sheetSpan.right; col++) {
		if (rows.every((row) => sheet.cell(row, col).kind === 'empty')) continue;
		left = Math.min(left, col);
		right = col;
	}
	const headerSpan = { left, right };
	const keys = headerKeys(sheet, rows[0], headerSpan);
	// The sample ends where another table starts, so a stacked table does not score against this header.
	const sample: number[] = [];
	for (let r = rows.at(-1)! + 1; r <= extent.bottom && sample.length < SAMPLE_ROWS; r++) {
		if (sheet.hiddenRows.has(r) || masterCells(sheet, r, headerSpan).length === 0) continue;
		if (startsOtherTable(sheet, r, headerSpan, keys)) break;
		sample.push(r);
	}
	const span = withUnlabeledColumns(sheet, headerSpan, sample, sheetSpan);
	const headers = new Map<number, ColumnHeader>();
	for (let col = span.left; col <= span.right; col++) headers.set(col, readHeader(sheet, rows, col));
	const columns = evaluateColumns(sheet, headers, sample, { skipHeaderEcho: true });
	const assigned = assignFields(columns);
	// Each mapped column adds its confidence tier, primary fields one more. Ties go to the earliest row.
	let score = 0;
	for (const e of assigned.values()) score += tierOf(e.confidence!) + (isPrimary(e.field) ? 1 : 0);
	return { rows, span, keys, columns, assigned, score, hasPrimary: [...assigned.values()].some((e) => isPrimary(e.field)) };
}

/**
 * Scores every header candidate once. A candidate that repeats an earlier one's labels is that header again
 * (Statz's row 34), so it never competes: otherwise one malformed value above it would hand it the table.
 */
function headerTrials(sheet: SheetModel, extent: CellRange, sheetSpan: Span): Trial[] {
	const candidates = headerCandidates(sheet, extent, sheetSpan);
	const trials: Trial[] = [];
	for (const row of candidates) {
		if (trials.some((t) => t.rows.includes(row) || sameLabels(sheet, row, t.keys))) continue;
		if (!continuesHeader(sheet, row, extent, sheetSpan)) {
			trials.push(tryHeader(sheet, [row], extent, sheetSpan));
			continue;
		}
		const joined = tryHeader(sheet, [row, row + 1], extent, sheetSpan);
		// When the lower row is a full header on its own, the upper row adds nothing: it is a title or a merged
		// group label ("Identifiers"), and the lower row's own candidate takes over.
		const lower = candidates.includes(row + 1) ? tryHeader(sheet, [row + 1], extent, sheetSpan) : null;
		if (!lower || joined.score > lower.score) trials.push(joined);
	}
	return trials;
}

/** First row below the table's header that starts another table with a high-confidence primary column. */
function nextTable(sheet: SheetModel, trial: Trial, extent: CellRange, sheetSpan: Span): Trial | null {
	for (let row = trial.rows.at(-1)! + 1; row <= extent.bottom; row++) {
		if (!startsOtherTable(sheet, row, trial.span, trial.keys)) continue;
		const next = tryHeader(sheet, [row], extent, sheetSpan);
		if ([...next.assigned.values()].some((e) => isPrimary(e.field) && e.confidence === 'high')) return next;
	}
	return null;
}

const rowsLabel = (rows: readonly number[]) => (rows.length > 1 ? `Rows ${rows[0]}-${rows.at(-1)}` : `Row ${rows[0]}`);

function nearMisses(trial: Trial): string[] {
	return trial.columns
		.filter((column) => !column.hidden)
		.flatMap((column) =>
			[...column.fields.values()]
				.filter((e) => e.header)
				.map((e) => `${rowsLabel(trial.rows)}, column ${colLetter(column.col)}: ${describeEvidence(column, e).join('; ')}`)
		);
}

export function detectTable(sheet: SheetModel): Detection {
	const extent = sheet.valueExtent;
	if (!extent) return { spec: null, reasons: ['Sheet has no values'] };
	const sheetSpan = { left: extent.left, right: Math.min(extent.right, extent.left + MAX_COLUMNS - 1) };
	const notes =
		sheetSpan.right < extent.right ? [`Only columns ${colLetter(sheetSpan.left)}-${colLetter(sheetSpan.right)} were analyzed`] : [];

	const trials = headerTrials(sheet, extent, sheetSpan);
	const best = trials.reduce<Trial | null>((b, t) => (!b || t.score > b.score ? t : b), null);
	// No header row, or the best one holds NSNs or NIINs and is really the first data row: let the values decide.
	const headerless = detectHeaderless(sheet, extent, sheetSpan, best?.rows[0]);
	if (headerless) return { spec: headerless.spec, reasons: [...notes, ...headerless.reasons] };
	if (!best) return { spec: null, reasons: [...notes, 'No header row found: no row near the top has at least two short text labels'] };
	if (!best.hasPrimary) {
		const misses = nearMisses(best);
		return {
			spec: null,
			reasons: [
				...notes,
				'No column holds part numbers, NSNs, or NIINs under a matching header',
				...(misses.length > 0 ? misses : [`${rowsLabel(best.rows)} looks like a header, but none of its columns names Part, NSN, or NIIN`])
			]
		};
	}

	const top = best.rows[0];
	for (const other of trials) {
		if (other.rows[0] < top && other.hasPrimary) {
			notes.push(`${rowsLabel(other.rows)} also looks like a header, but row ${top} fits the values better; rows above ${top} are not imported`);
		}
	}
	let bottom = extent.bottom;
	const next = nextTable(sheet, best, extent, sheetSpan);
	if (next) {
		bottom = next.rows[0] - 1;
		const fields = [...next.assigned.values()].map((e) => FIELD_LABEL[e.field]);
		notes.push(
			`Row ${next.rows[0]} starts another table (${fields.join(', ')}); only one table per sheet is imported, so rows ${next.rows[0]}-${extent.bottom} are not`
		);
	}

	const columns: Record<number, Field> = {};
	for (const [col, e] of best.assigned) columns[col] = e.field;
	return {
		spec: { headerRows: best.rows, range: { top, left: best.span.left, bottom, right: best.span.right }, columns },
		reasons: notes
	};
}
