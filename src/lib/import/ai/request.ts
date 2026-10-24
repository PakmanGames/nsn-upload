/**
 * Builds the bounded sample of a workbook that may be sent to the LLM.
 *
 * Only sheets that deterministic analysis flagged go out, and only what a user can see in Excel:
 * hidden sheets, rows, and columns never leave the browser, and neither do system metadata
 * columns (UUIDs, checksums, timestamps), which say nothing about structure and may be sensitive.
 */
import type {
	Cell,
	CellRange,
	InterpretationRequest,
	SheetAnalysis,
	SheetModel,
	WorkbookModel
} from '../model';
import { rangeToA1 } from '../refs';
import { AI_LIMITS } from './schema';

type SampledCell = [ref: string, text: string];

export function buildInterpretationRequest(
	model: WorkbookModel,
	sheets: SheetAnalysis[]
): InterpretationRequest {
	const byName = new Map(model.sheets.map((sheet) => [sheet.name, sheet]));
	const targets = sheets
		.flatMap(({ name, aiTrigger: reason }) => {
			const sheet = byName.get(name);
			const extent = sheet?.visibility === 'visible' ? sheet.valueExtent : null;
			return sheet && extent && reason !== null ? [{ sheet, extent, reason }] : [];
		})
		.slice(0, AI_LIMITS.maxSheets);

	const request: InterpretationRequest = { fileName: model.fileName, sheets: [] };
	let budget: number = AI_LIMITS.maxCells;
	targets.forEach(({ sheet, extent, reason }, i) => {
		// Even split of what is left, so a wide first sheet cannot starve the others.
		const cells = sampleCells(sheet, extent, Math.floor(budget / (targets.length - i)));
		if (cells.length === 0) return;
		budget -= cells.length;
		request.sheets.push({
			name: sheet.name,
			extent: rangeToA1(extent),
			merges: sheet.merges
				.filter((merge) => intersects(merge, extent))
				.slice(0, AI_LIMITS.maxMergesPerSheet)
				.map(rangeToA1),
			reason: reason.slice(0, AI_LIMITS.maxReasonChars),
			cells
		});
	});
	return request;
}

function sampleCells(sheet: SheetModel, extent: CellRange, budget: number): SampledCell[] {
	const visibleRows: number[] = [];
	for (let row = extent.top; row <= extent.bottom; row++) {
		if (!sheet.hiddenRows.has(row)) visibleRows.push(row);
	}
	const cols = keptColumns(sheet, extent, visibleRows);
	const rowCells = (row: number) =>
		cols
			.map((col) => sheet.cell(row, col))
			.filter(isSendable)
			.map(toSampledCell);
	const nonEmptyRows = visibleRows.filter((row) =>
		cols.some((col) => isSendable(sheet.cell(row, col)))
	);
	const cellCount = (row: number) => cols.filter((col) => isSendable(sheet.cell(row, col))).length;
	return chooseRows(nonEmptyRows, cellCount, budget).flatMap(rowCells);
}

/** Visible columns with values, minus metadata columns, left to right, capped. */
function keptColumns(sheet: SheetModel, extent: CellRange, rows: number[]): number[] {
	const kept: number[] = [];
	for (let col = extent.left; col <= extent.right && kept.length < AI_LIMITS.maxColumns; col++) {
		if (sheet.hiddenCols.has(col)) continue;
		let filled = 0;
		let metadata = 0;
		for (const row of rows) {
			const cell = sheet.cell(row, col);
			if (!isSendable(cell)) continue;
			filled++;
			if (looksLikeMetadata(cell)) metadata++;
		}
		// A majority rule, so the header cell above a UUID column does not keep the column in.
		if (filled > 0 && metadata * 2 <= filled) kept.push(col);
	}
	return kept;
}

/**
 * The first rows (titles and headers) plus rows spread evenly over the rest (where the table ends).
 * Over budget, both parts shrink together at about 2:1 instead of cutting the tail,
 * so a wide sheet still shows its header and its end.
 */
function chooseRows(rows: number[], cellCount: (row: number) => number, budget: number): number[] {
	let head: number = AI_LIMITS.headRows;
	let sampled: number = AI_LIMITS.sampledRows;
	while (head > 0) {
		const chosen = [...rows.slice(0, head), ...evenlySpaced(rows.slice(head), sampled)];
		if (chosen.reduce((total, row) => total + cellCount(row), 0) <= budget) return chosen;
		if (sampled > 0 && sampled * 2 >= head) sampled--;
		else head--;
	}
	return [];
}

/** k items spread evenly over the list, always including the last one. */
function evenlySpaced<T>(items: T[], k: number): T[] {
	if (items.length <= k) return items;
	return Array.from({ length: k }, (_, i) => items[Math.round(((i + 1) * items.length) / k) - 1]);
}

/** Cells covered by a merge repeat their master's text; the master cell plus `merges` already say it. */
function isSendable(cell: Cell): boolean {
	return cell.text.trim() !== '' && cell.mergedFrom === undefined;
}

function toSampledCell(cell: Cell): SampledCell {
	const text =
		cell.text.length > AI_LIMITS.maxCellChars
			? `${cell.text.slice(0, AI_LIMITS.maxCellChars - 1)}…`
			: cell.text;
	return [cell.ref, text];
}

const UUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const HEX_DIGEST = /^[0-9a-f]{32,}$/i;
const BASE64 = /^[A-Za-z0-9+/]{24,}={0,2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4} \d{1,2}:\d{2}/;

/** UUIDs, checksums, and timestamps: what system exports put in record-keeping columns. */
function looksLikeMetadata(cell: Cell): boolean {
	if (cell.kind === 'date') return true;
	const text = cell.text.trim();
	if (UUID.test(text) || HEX_DIGEST.test(text) || DATE_TIME.test(text)) return true;
	// Long base64 needs a symbol or mixed case, so a long upper-case part number does not qualify.
	return BASE64.test(text) && (/[+/=]/.test(text) || (/[a-z]/.test(text) && /[A-Z]/.test(text)));
}

function intersects(a: CellRange, b: CellRange): boolean {
	return a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
}
