/**
 * The safety boundary for AI proposals: every range, row, and column the model names is checked
 * against the full workbook before anything is built from it.
 *
 * The model's output is treated as a guess about structure. Accepted proposals are re-scored by
 * `materializeTable()` from the real cells of the whole sheet, so the AI can move a table but never
 * vouch for its values.
 */
import {
	PRIMARY_FIELDS,
	type CellRange,
	type Field,
	type InterpretationRequest,
	type InterpretationTable,
	type SheetModel,
	type TableCandidate,
	type TableSpec,
	type VerificationResult,
	type WorkbookInterpretation,
	type WorkbookModel
} from '../model';
import { colLetter, parseA1, parseRange, rangeToA1 } from '../refs';
import { materializeTable } from '../structure';
import { AI_MIN_CONFIDENCE } from './schema';

export function verifyInterpretation(
	model: WorkbookModel,
	request: InterpretationRequest,
	interpretation: WorkbookInterpretation
): VerificationResult {
	const result: VerificationResult = { tables: [], rejected: [] };
	const claimedSheets = new Set<string>();
	// Best first: when the model proposes two tables for one sheet, the more confident valid one wins.
	const proposals = [...interpretation.tables].sort((a, b) => b.confidence - a.confidence);
	for (const proposal of proposals) {
		const reject = (reason: string) =>
			result.rejected.push({ sheetName: proposal.sheetName, range: proposal.range, reason });
		const checked = checkProposal(model, request, proposal);
		if (typeof checked === 'string') {
			reject(checked);
		} else if (claimedSheets.has(proposal.sheetName)) {
			reject(
				'Another AI proposal for this sheet was accepted; only one table per sheet is supported'
			);
		} else {
			claimedSheets.add(proposal.sheetName);
			result.tables.push(toCandidate(checked.sheet, checked.spec, proposal));
		}
	}
	return result;
}

/** A spec ready to materialize, or the reason the proposal is rejected. */
function checkProposal(
	model: WorkbookModel,
	request: InterpretationRequest,
	proposal: InterpretationTable
): { sheet: SheetModel; spec: TableSpec } | string {
	const name = proposal.sheetName;
	const sent = request.sheets.find((s) => s.name === name);
	if (!sent) return `Sheet "${name}" was not part of the AI request`;
	const sheet = model.sheets.find((s) => s.name === name);
	if (!sheet) return `Sheet "${name}" is not in the workbook`;
	if (sheet.visibility !== 'visible') return `Sheet "${name}" is hidden`;

	// Models often answer in Excel's absolute form ("$A$2:$F$180"), which refs.ts does not parse.
	const range = parseRange(proposal.range.replaceAll('$', ''));
	if (!range) return `Range "${proposal.range}" is not a valid A1 range`;
	const extent = sheet.valueExtent;
	if (!extent || !contains(extent, range))
		return `Range ${proposal.range} is outside the sheet's values (${extent ? rangeToA1(extent) : 'empty sheet'})`;

	const headerRows = [...new Set(proposal.headerRows)].sort((a, b) => a - b);
	if (headerRows.length === 0) return 'No header row given';
	for (const row of headerRows) {
		if (row < range.top || row > range.bottom)
			return `Header row ${row} is outside the range ${proposal.range}`;
		if (sheet.hiddenRows.has(row)) return `Header row ${row} is hidden`;
	}
	if (headerRows[headerRows.length - 1] === range.bottom)
		return `Range ${proposal.range} has no rows below the header`;

	if (proposal.columns.length === 0) return 'No columns mapped';
	// The model can only have seen columns that had cells in the request; anything else is invented.
	const sentCols = new Set(sent.cells.map(([ref]) => parseA1(ref)?.col));
	const fieldByCol = new Map<number, Field>();
	const colByField = new Map<Field, number>();
	for (const { field, col, headerText } of proposal.columns) {
		const column = `Column ${colLetter(col)}`;
		if (col < range.left || col > range.right)
			return `${column} (${field}) is outside the range ${proposal.range}`;
		if (sheet.hiddenCols.has(col)) return `${column} (${field}) is hidden`;
		if (!sentCols.has(col)) return `${column} (${field}) was not included in the AI request`;
		const otherField = fieldByCol.get(col);
		if (otherField) return `${column} is mapped to both ${otherField} and ${field}`;
		const otherCol = colByField.get(field);
		if (otherCol !== undefined)
			return `Field ${field} is mapped to both column ${colLetter(otherCol)} and column ${colLetter(col)}`;
		// Off-by-one headers are the typical model mistake; the header text it quotes exposes them.
		const actual = headerRows.map((row) => sheet.cell(row, col).text).join(' ');
		if (normalizeHeader(actual) !== normalizeHeader(headerText))
			return `${column} header is ${quote(actual)}, but the AI read ${quote(headerText)}`;
		fieldByCol.set(col, field);
		colByField.set(field, col);
	}
	if (!PRIMARY_FIELDS.some((field) => colByField.has(field)))
		return 'No part, NSN, or NIIN column mapped';

	return { sheet, spec: { headerRows, range, columns: Object.fromEntries(fieldByCol) } };
}

function toCandidate(
	sheet: SheetModel,
	spec: TableSpec,
	proposal: InterpretationTable
): TableCandidate {
	const table = materializeTable(sheet, spec, 'ai');
	const capped = table.status === 'ready' && proposal.confidence < AI_MIN_CONFIDENCE;
	return {
		...table,
		status: capped ? 'needs-review' : table.status,
		reasons: [
			...table.reasons,
			`Proposed by AI with confidence ${proposal.confidence.toFixed(2)}`,
			...proposal.reasons.map((reason) => `AI: ${reason}`),
			...(capped ? [`AI confidence is below ${AI_MIN_CONFIDENCE}, so the table needs review`] : [])
		]
	};
}

function contains(outer: CellRange, inner: CellRange): boolean {
	return (
		inner.top >= outer.top &&
		inner.left >= outer.left &&
		inner.bottom <= outer.bottom &&
		inner.right <= outer.right
	);
}

/** Case, punctuation, line breaks, and spacing are not evidence of a different header. */
function normalizeHeader(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function quote(text: string): string {
	return text.length > 60 ? `"${text.slice(0, 59)}…"` : `"${text}"`;
}
