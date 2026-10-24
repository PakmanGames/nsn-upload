/**
 * Plain wording for the Sheets and Columns sections: why a sheet has no table, what was skipped around a table,
 * and what each column's header and values say.
 *
 * Computed from the analysis and the sheet model with the structure stage's own functions (header matching,
 * column evaluation), never from its reason strings, which stay as the technical details.
 */
import { type ColumnMapping, type Field, type SheetAnalysis, type SheetModel, type SkippedRow, type TableCandidate } from '../model';
import { isNiinDigits, isNsnDigits, stripSeparators } from '../identifiers';
import { evaluateColumns, readHeader, type ColumnEvidence, type FieldEvidence } from '../structure/columns';
import { matchHeader } from '../structure/header';
import { formatRows } from '../structure/table';
import { capitalize, joinList, noun, show } from './text';

export type Lines = { headline: string; lines: string[] };

/* ---------- Sheets without a table ---------- */

/** Rows from the top searched for a header that mentions a field, as detection does. */
const HEADER_SEARCH_ROWS = 30;
/** Fewer identifier-like cells than this are a coincidence, as for the AI trigger. */
const MIN_IDENTIFIERS = 3;

const sheetFacts = new WeakMap<SheetModel, { identifiers: number; mentions: string[] }>();

/** Identifier-like cells in the sheet, and header-like cells near the top that name a part, NSN, or NIIN. */
function scanSheet(sheet: SheetModel): { identifiers: number; mentions: string[] } {
	const known = sheetFacts.get(sheet);
	if (known) return known;
	const facts = { identifiers: 0, mentions: [] as string[] };
	const extent = sheet.valueExtent;
	let searched = 0;
	for (let row = extent?.top ?? 1; extent && row <= extent.bottom; row++) {
		let empty = true;
		for (let col = extent.left; col <= extent.right; col++) {
			const cell = sheet.cell(row, col);
			if (cell.kind === 'empty' || cell.mergedFrom) continue;
			empty = false;
			const digits = stripSeparators(cell.text);
			if (isNsnDigits(digits) || isNiinDigits(digits)) facts.identifiers++;
			// Label-sized text only, as header matching treats anything longer as a sentence.
			const label = cell.text.trim();
			if (searched < HEADER_SEARCH_ROWS && cell.kind === 'text' && label.length <= 40 && label.split(/\s+/).length <= 5) {
				const names = matchHeader(cell.text).some((match) => match.field === 'part' || match.field === 'nsn' || match.field === 'niin');
				if (names && facts.mentions.length < 3) facts.mentions.push(cell.text.replace(/\s+/g, ' ').trim());
			}
		}
		if (!empty) searched++;
	}
	sheetFacts.set(sheet, facts);
	return facts;
}

/** Why a sheet has nothing to import: hidden, empty, no header over its identifiers, or no identifier column. */
export function explainSheetWithoutTable(sheet: SheetAnalysis, model: SheetModel | undefined): Lines {
	if (sheet.status === 'hidden') return { headline: 'Hidden in Excel', lines: ['Hidden sheets are left out.'] };
	if (!model?.valueExtent) return { headline: 'This sheet is empty', lines: ['There is nothing on it to import.'] };
	const { identifiers, mentions } = scanSheet(model);
	if (identifiers >= MIN_IDENTIFIERS && mentions.length === 0) {
		return {
			headline: "No header row: we couldn't tell which column is which",
			lines: [`${identifiers.toLocaleString()} cells look like NSNs or NIINs, but no row above them names the columns.`]
		};
	}
	if (mentions.length > 0) {
		return {
			headline: 'No column of part numbers, NSNs, or NIINs',
			lines: [`${joinList(mentions.map((text) => show(null, text)))} ${mentions.length === 1 ? 'mentions' : 'mention'} them, but the values below are something else.`]
		};
	}
	return { headline: 'Nothing here looks like a parts list', lines: ['No column holds part numbers, NSNs, or NIINs.'] };
}

/* ---------- Around a table ---------- */

const SKIPPED: Record<SkippedRow['reason'], [one: string, many: string]> = {
	blank: ['is blank', 'are blank'],
	hidden: ['is hidden in Excel', 'are hidden in Excel'],
	'repeated-header': ['repeats the header', 'repeat the header'],
	'no-mapped-values': ['only has values in columns that are not imported', 'only have values in columns that are not imported'],
	footer: ['is a totals row', 'are totals rows'],
	'below-table': ['sits below the table, after a blank gap', 'sit below the table, after a blank gap']
};

/** "rows 32-33 are blank and row 34 repeats the header, so they are left out". */
function skippedLine(table: TableCandidate): string | null {
	if (table.skippedRows.length === 0) return null;
	const parts = (Object.keys(SKIPPED) as SkippedRow['reason'][]).flatMap((reason) => {
		const rows = table.skippedRows.filter((skip) => skip.reason === reason).map((skip) => skip.row);
		if (rows.length === 0) return [];
		const many = rows.length > 1;
		return [`${many ? 'rows' : 'row'} ${formatRows(rows)} ${SKIPPED[reason][many ? 1 : 0]}`];
	});
	return `${capitalize(joinList(parts))}, so ${table.skippedRows.length === 1 ? 'it is' : 'they are'} left out.`;
}

/** What else to know about a table: rows left out inside it, rows of the sheet outside it, missing optional columns. */
export function tableNotes(table: TableCandidate, model: SheetModel | undefined): string[] {
	const notes: string[] = [];
	const skipped = skippedLine(table);
	if (skipped) notes.push(skipped);
	// Rows below the table that are not already listed as left out of it.
	const extent = model?.valueExtent;
	const last = Math.max(table.range.bottom, ...table.skippedRows.map((skip) => skip.row));
	if (extent && extent.bottom > last) {
		const rows = extent.bottom === last + 1 ? `Row ${extent.bottom}` : `Rows ${last + 1}-${extent.bottom}`;
		notes.push(`${rows} below the table ${extent.bottom === last + 1 ? 'is' : 'are'} not part of it and not imported.`);
	}
	const mapped = new Set(table.columns.map((column) => column.field));
	const missing = (['description', 'cage'] as const).filter((field) => !mapped.has(field));
	if (missing.length) notes.push(`There is no ${missing.map((field) => noun(field)).join(' or ')} column.`);
	return notes;
}

/* ---------- Columns ---------- */

const evidenceCache = new WeakMap<SheetModel, Map<string, Map<number, ColumnEvidence>>>();

/**
 * Header and value evidence for every column of a table, from the same evaluation the structure stage scores
 * columns with. Cached per sheet and table shape, so re-analyses that only change decisions reuse it.
 */
function columnEvidence(sheet: SheetModel, table: TableCandidate): Map<number, ColumnEvidence> {
	const mapped = new Map(table.columns.flatMap((column): Array<[number, Field]> => (column.field ? [[column.col, column.field]] : [])));
	const key = JSON.stringify([table.headerRows, table.range, [...mapped], table.dataRows.length]);
	const cache = evidenceCache.get(sheet) ?? new Map<string, Map<number, ColumnEvidence>>();
	evidenceCache.set(sheet, cache);
	const known = cache.get(key);
	if (known) return known;
	const headers = new Map(table.columns.map((column) => [column.col, readHeader(sheet, table.headerRows, column.col)]));
	const evidence = new Map(evaluateColumns(sheet, headers, table.dataRows, { mapped }).map((column) => [column.col, column]));
	cache.set(key, evidence);
	return evidence;
}

const FITS: Record<Field, string> = {
	part: 'look like part numbers',
	description: 'look like descriptions',
	nsn: 'are valid NSNs',
	niin: 'are valid NIINs',
	cage: 'are valid CAGE codes',
	fsc: 'are valid FSCs'
};

/** "127 of 129 values are valid NSNs", counted the way the column was scored. */
function valuesLine(evidence: FieldEvidence | undefined, field: Field): string | null {
	if (!evidence) return null;
	const { checked } = evidence.tally;
	if (checked === 0) return 'There are no values below the header.';
	return `${evidence.passed.toLocaleString()} of ${checked.toLocaleString()} values ${FITS[field]}.`;
}

function headerLine(header: string, field: Field): string {
	if (!header) return 'It has no header.';
	const match = matchHeader(header).find((candidate) => candidate.field === field);
	const quoted = show(null, header.replace(/\s+/g, ' '));
	if (!match) return `The header ${quoted} doesn't name ${noun(field, 2)}.`;
	if (match.strength === 'strong') return `The header ${quoted} names ${noun(field, 2)}.`;
	return `The header ${quoted} mentions ${noun(field, 2)}, but it ${match.weakBecause ?? 'is not a clear label'}.`;
}

/**
 * One line for the column card (`summary`), and the lines behind it for the column's (i) tooltip.
 * `sheet` is the source sheet; without it, the value counts are left out.
 */
export function explainColumn(column: ColumnMapping, table: TableCandidate, sheet: SheetModel | undefined): { summary: string; lines: string[] } {
	const evidence = sheet ? columnEvidence(sheet, table).get(column.col) : undefined;
	const header = column.header.replace(/\s+/g, ' ').trim();
	if (column.field) {
		const { field } = column;
		const lines = [headerLine(header, field), valuesLine(evidence?.fields.get(field), field)].filter((line): line is string => line !== null);
		if (column.overridden) return { summary: lines.at(-1) ?? 'Set by you.', lines: ['You chose this field for the column.', ...lines] };
		// A clear match is best summed up by its values; an unclear one by whatever made it unclear.
		const strong = header && matchHeader(header).some((match) => match.field === field && match.strength === 'strong');
		const summary = column.confidence === 'high' || strong ? (lines.at(-1) ?? lines[0]) : lines[0];
		return { summary, lines };
	}
	if (column.overridden) return { summary: 'You chose not to import this column.', lines: ['You chose not to import this column.'] };
	if (evidence?.hidden || sheet?.hiddenCols.has(column.col)) {
		const line = 'Hidden in Excel, so it is not imported.';
		return { summary: line, lines: [line] };
	}
	const named = header ? matchHeader(header).map((match) => match.field) : [];
	const lines: string[] = [];
	for (const field of named) {
		const values = valuesLine(evidence?.fields.get(field), field);
		lines.push(`The header mentions ${noun(field, 2)}${values ? `, but ${values.charAt(0).toLowerCase()}${values.slice(1)}` : '.'}`);
	}
	if (column.alternatives.includes('part') && !named.includes('part')) {
		const part = evidence?.fields.get('part');
		const count = part ? `${part.passed.toLocaleString()} of ${part.tally.checked.toLocaleString()} values` : 'Its values';
		lines.push(`${count} look like part numbers, but the header doesn't say so.`);
	}
	const others = column.alternatives.filter((field) => field !== 'part' && !named.includes(field));
	if (others.length) lines.push(`It could also hold ${joinList(others.map((field) => noun(field, 2)))}, but another column fits better.`);
	if (lines.length === 0) {
		lines.push(header ? "The header doesn't name a part number, NSN, NIIN, description, CAGE code, or FSC." : 'It has no header.');
	}
	return { summary: lines[0], lines };
}
