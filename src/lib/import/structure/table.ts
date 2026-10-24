/**
 * Turns a table shape (header rows, range, column -> field) into a scored TableCandidate.
 *
 * Deterministic detection, user remaps, and verified AI proposals all end here, so their row skipping,
 * pass rates, confidence, and status are computed identically.
 */
import type { ColumnMapping, Confidence, Field, SheetModel, SkippedRow, TableCandidate, TableSpec } from '../model';
import { colLetter, rangeToA1 } from '../refs';
import {
	alternativesFor,
	columnName,
	describeEvidence,
	describeValueOnlyAlternative,
	evaluateColumns,
	FIELD_LABEL,
	isPrimary,
	readHeader,
	tierOf,
	type ColumnEvidence,
	type ColumnHeader
} from './columns';
import { matchHeader, normalizeHeader } from './header';

export type UserColumns = {
	/** Column -> field chosen by the user, or null when the user excluded the column. */
	set: ReadonlyMap<number, Field | null>;
	/** Column -> the user-mapped column that took its field. */
	replaced: ReadonlyMap<number, number>;
};

export type MaterializedTable = {
	table: TableCandidate;
	/** "Columns D and G both look like the Part column", one entry per contested primary field. */
	competition: string[];
};

const OPTIONAL_FIELDS: readonly Field[] = ['description', 'cage'];

/** `${sheet}@${firstHeaderRow}`; a headerless table uses the first row of its range. */
export function tableId(sheet: string, firstHeaderRow: number): string {
	return `${sheet}@${firstHeaderRow}`;
}

/** "3", "3-5", "3-5, 9, 12-14", capped so a reason stays one readable line. */
export function formatRows(rows: readonly number[], max = 6): string {
	const spans: string[] = [];
	for (let i = 0; i < rows.length; ) {
		let j = i;
		while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
		spans.push(i === j ? `${rows[i]}` : `${rows[i]}-${rows[j]}`);
		i = j + 1;
	}
	return spans.length > max ? `${spans.slice(0, max).join(', ')}, ...` : spans.join(', ');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "header on row 2", "header on rows 1-2 (two-row header)", or "no header row". */
export function headerRowsPhrase(headerRows: readonly number[]): string {
	if (headerRows.length === 0) return 'no header row';
	if (headerRows.length === 1) return `header on row ${headerRows[0]}`;
	const twoRow = headerRows.length === 2 && headerRows[1] === headerRows[0] + 1 ? ' (two-row header)' : '';
	return `header on rows ${formatRows(headerRows)}${twoRow}`;
}

/**
 * A later row repeats the header when, in most compared columns, its text equals the header text or names
 * the same field (so `Part No.` repeating a `P/N` header still counts).
 */
function repeatsHeader(sheet: SheetModel, row: number, compared: ReadonlyArray<{ col: number; key: string; field: Field | null }>): boolean {
	let hits = 0;
	for (const { col, key, field } of compared) {
		const cell = sheet.cell(row, col);
		if (cell.kind !== 'text' || cell.mergedFrom || cell.text.length > 120) continue;
		const text = normalizeHeader(cell.text);
		if (text === key || (field && matchHeader(cell.text).some((m) => m.field === field && m.strength === 'strong'))) hits++;
	}
	return hits * 2 > compared.length;
}

type RowKey = { col: number; key: string };

/** A repeat of a multi-row header is the same block of rows: each row matches its header row in most cells. */
function repeatsHeaderBlock(sheet: SheetModel, row: number, block: readonly RowKey[][], bottom: number): boolean {
	return block.every((keys, i) => {
		if (row + i > bottom || keys.length === 0) return false;
		const hits = keys.filter(({ col, key }) => normalizeHeader(sheet.cell(row + i, col).text) === key);
		return hits.length * 2 > keys.length;
	});
}

function classifyRows(
	sheet: SheetModel,
	spec: TableSpec,
	headers: ReadonlyMap<number, ColumnHeader>,
	mapped: ReadonlyMap<number, Field>
): { dataRows: number[]; skippedRows: SkippedRow[] } {
	const cols = [...headers.keys()];
	const visibleHeaders = cols.filter((c) => !sheet.hiddenCols.has(c) && headers.get(c)!.text);
	const mappedHeaders = visibleHeaders.filter((c) => mapped.has(c));
	const compared = (mappedHeaders.length > 0 ? mappedHeaders : visibleHeaders).map((col) => ({
		col,
		key: normalizeHeader(headers.get(col)!.text),
		field: mapped.get(col) ?? null
	}));
	const headerRows = [...spec.headerRows].sort((a, b) => a - b);
	const block: RowKey[][] =
		headerRows.length > 1
			? headerRows.map((h) =>
					cols
						.filter((col) => !sheet.hiddenCols.has(col) && !sheet.cell(h, col).mergedFrom)
						.map((col) => ({ col, key: normalizeHeader(sheet.cell(h, col).text) }))
						.filter(({ key }) => key)
				)
			: [];
	const mappedCols = [...mapped.keys()];
	// Covered merge cells copy their master, so only master cells count as values of their own.
	const hasValue = (row: number, col: number) => {
		const cell = sheet.cell(row, col);
		return cell.kind !== 'empty' && !cell.mergedFrom;
	};

	const dataRows: number[] = [];
	const skippedRows: SkippedRow[] = [];
	// A headerless region (an AI proposal for an unstructured sheet) has data from the top of its range.
	const start = spec.headerRows.length > 0 ? Math.max(...spec.headerRows) + 1 : spec.range.top;
	for (let row = start; row <= spec.range.bottom; row++) {
		if (sheet.hiddenRows.has(row)) skippedRows.push({ row, reason: 'hidden' });
		else if (!cols.some((c) => hasValue(row, c))) skippedRows.push({ row, reason: 'blank' });
		else if (block.length > 0 && repeatsHeaderBlock(sheet, row, block, spec.range.bottom)) {
			for (let i = 0; i < block.length; i++) skippedRows.push({ row: row + i, reason: 'repeated-header' });
			row += block.length - 1;
		} else if (compared.length > 0 && repeatsHeader(sheet, row, compared)) skippedRows.push({ row, reason: 'repeated-header' });
		else if (!mappedCols.some((c) => hasValue(row, c))) skippedRows.push({ row, reason: 'no-mapped-values' });
		else dataRows.push(row);
	}
	return { dataRows, skippedRows };
}

const SKIP_LABEL: Record<SkippedRow['reason'], [string, string]> = {
	blank: ['blank row', 'blank rows'],
	hidden: ['hidden row', 'hidden rows'],
	'repeated-header': ['repeated header row', 'repeated header rows'],
	'no-mapped-values': ['row with values only in unmapped columns', 'rows with values only in unmapped columns']
};

function skippedReason(skipped: readonly SkippedRow[]): string | null {
	if (skipped.length === 0) return null;
	const parts = (Object.keys(SKIP_LABEL) as SkippedRow['reason'][]).flatMap((reason) => {
		const rows = skipped.filter((s) => s.reason === reason).map((s) => s.row);
		return rows.length ? [`${plural(rows.length, ...SKIP_LABEL[reason])} (${formatRows(rows)})`] : [];
	});
	return `Skipped ${parts.join(', ')}`;
}

function unmappedReasons(column: ColumnEvidence, user: UserColumns, alternatives: Field[]): string[] {
	if (user.set.get(column.col) === null) return ['Excluded by user'];
	const replacedBy = user.replaced.get(column.col);
	if (replacedBy !== undefined) return [`Replaced by user mapping of column ${colLetter(replacedBy)}`];
	if (column.hidden) return ['Hidden column (hidden or zero width in Excel); never mapped automatically'];
	const reasons: string[] = [];
	for (const e of column.fields.values()) {
		if (e.header) reasons.push(...describeEvidence(column, e));
	}
	for (const field of column.valueOnlyAlternatives) reasons.push(describeValueOnlyAlternative(column, field));
	if (alternatives.some((f) => column.fields.get(f)?.confidence)) {
		reasons.push(`Also fits ${alternatives.map((f) => FIELD_LABEL[f]).join(', ')}, but another column was a better fit`);
	}
	if (reasons.length === 0) reasons.push(column.header ? `Header '${column.header}' does not name a target field` : 'No header text');
	return reasons;
}

/**
 * Materializes a table. `user` carries column overrides: those columns are high confidence by decision,
 * and columns that lost their field to them are reported as replaced.
 */
export function materialize(
	sheet: SheetModel,
	spec: TableSpec,
	source: TableCandidate['source'],
	user: UserColumns = { set: new Map(), replaced: new Map() }
): MaterializedTable {
	const headerRows = [...spec.headerRows].sort((a, b) => a - b);
	const { left, right } = spec.range;
	const headers = new Map<number, ColumnHeader>();
	for (let col = left; col <= right; col++) headers.set(col, readHeader(sheet, headerRows, col));
	const mapped = new Map<number, Field>();
	for (const [col, field] of Object.entries(spec.columns)) {
		if (headers.has(Number(col))) mapped.set(Number(col), field);
	}

	const { dataRows, skippedRows } = classifyRows(sheet, spec, headers, mapped);
	const evidence = evaluateColumns(sheet, headers, dataRows, { mapped });

	const columns: ColumnMapping[] = evidence.map((column) => {
		const field = mapped.get(column.col) ?? null;
		const alternatives = alternativesFor(column, field);
		if (!field) {
			// For an unmapped column, confidence is about leaving it out: low only when it plausibly fits a field.
			return {
				col: column.col,
				header: column.header,
				field,
				confidence: alternatives.length > 0 && !user.set.has(column.col) ? 'low' : 'high',
				reasons: unmappedReasons(column, user, alternatives),
				alternatives,
				valuePassRate: null,
				overridden: user.set.has(column.col)
			};
		}
		const e = column.fields.get(field)!;
		const byUser = user.set.get(column.col) === field;
		const reasons = describeEvidence(column, e);
		if (byUser) reasons.unshift('Set by user');
		else if (!e.confidence) reasons.push(`Values do not support ${FIELD_LABEL[field]}`);
		return {
			col: column.col,
			header: column.header,
			field,
			confidence: byUser ? 'high' : (e.confidence ?? 'low'),
			reasons,
			alternatives,
			valuePassRate: e.tally.checked ? (e.tally.pass + e.tally.repaired) / e.tally.checked : null,
			overridden: byUser
		};
	});

	// Two columns compete when an unmapped column fits a primary field as well as the column that got it.
	// User decisions end the contest: user-mapped, excluded, and replaced columns never compete.
	const competition: string[] = [];
	for (const mappedColumn of columns) {
		if (!mappedColumn.field || !isPrimary(mappedColumn.field) || mappedColumn.overridden) continue;
		const field = mappedColumn.field;
		const rivals = evidence.filter((c) => {
			const rival = c.fields.get(field)?.confidence;
			return (
				!mapped.has(c.col) &&
				!c.hidden &&
				!user.set.has(c.col) &&
				!user.replaced.has(c.col) &&
				rival &&
				tierOf(rival) >= tierOf(mappedColumn.confidence)
			);
		});
		if (rivals.length > 0) {
			const names = [mappedColumn.col, ...rivals.map((r) => r.col)].map(colLetter);
			competition.push(`Columns ${names.join(' and ')} both look like the ${FIELD_LABEL[field]} column`);
		}
	}

	const primaries = columns.filter((c) => c.field && isPrimary(c.field));
	const best = primaries.reduce<ColumnMapping | null>((b, c) => (!b || tierOf(c.confidence) > tierOf(b.confidence) ? c : b), null);
	const weakest = primaries.reduce<ColumnMapping | null>((w, c) => (!w || tierOf(c.confidence) < tierOf(w.confidence) ? c : w), null);
	const ready = best?.confidence === 'high' && weakest?.confidence !== 'low' && competition.length === 0;
	const confidence: Confidence = weakest?.confidence ?? 'low';

	const describe = (c: ColumnMapping) => `${FIELD_LABEL[c.field!]} ${columnName(c.col, c.header)}`;
	let statusReason: string;
	if (!best) statusReason = 'Needs review: no Part, NSN, or NIIN column is mapped';
	else if (ready) statusReason = `Ready: ${describe(best)} is high confidence`;
	else if (competition.length > 0) statusReason = `Needs review: ${competition.join('; ')}`;
	else if (best.confidence !== 'high') statusReason = `Needs review: the best identifier column, ${describe(best)}, is only ${best.confidence} confidence`;
	else statusReason = `Needs review: ${describe(weakest!)} is low confidence`;

	const mappedFields = new Set(mapped.values());
	const missing = OPTIONAL_FIELDS.filter((f) => !mappedFields.has(f)).map((field) => {
		const empty = evidence.find((c) => c.fields.get(field)?.header && c.fields.get(field)!.tally.checked === 0);
		return empty ? `${FIELD_LABEL[field]} ${columnName(empty.col, empty.header)} has no values` : `No ${FIELD_LABEL[field]} column found`;
	});

	const reasons = [
		`${capitalize(headerRowsPhrase(headerRows))}; table ${rangeToA1(spec.range)}`,
		plural(dataRows.length, 'data row'),
		skippedReason(skippedRows),
		columns.some((c) => c.field)
			? `Mapped ${columns.filter((c) => c.field).map((c) => `${FIELD_LABEL[c.field!]} = column ${colLetter(c.col)}`).join(', ')}`
			: null,
		...missing,
		statusReason
	].filter((r): r is string => r !== null);

	return {
		table: {
			id: tableId(sheet.name, headerRows[0] ?? spec.range.top),
			sheet: sheet.name,
			headerRows,
			range: spec.range,
			dataRows,
			skippedRows,
			columns,
			status: ready ? 'ready' : 'needs-review',
			confidence,
			reasons,
			source
		},
		competition
	};
}
