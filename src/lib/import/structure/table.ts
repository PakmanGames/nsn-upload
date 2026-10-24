/**
 * Turns a table shape (header rows, range, column -> field) into a scored TableCandidate.
 *
 * Deterministic detection, user remaps, and verified AI proposals all end here, so their row skipping,
 * pass rates, confidence, and status are computed identically.
 */
import type { Cell, ColumnMapping, Confidence, Field, SheetModel, SkippedRow, TableCandidate, TableSpec } from '../model';
import { colLetter, emptyCell, parseA1, rangeToA1 } from '../refs';
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
import { checkValue, type Verdict } from './values';

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

/**
 * `${sheet}@${first header row}`; a table without a header row uses the first row of its range, its first data
 * row. Neither depends on the column mapping, so the id survives remaps.
 */
export function tableId(sheet: string, spec: Pick<TableSpec, 'headerRows' | 'range'>): string {
	return `${sheet}@${spec.headerRows.length > 0 ? Math.min(...spec.headerRows) : spec.range.top}`;
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

/** Labels a sum rather than an item; matched against the whole normalized cell text. */
const FOOTER_LABELS = new Set(['total', 'totals', 'subtotal', 'sub total', 'grand total', 'sum']);
const IDENTIFIER_FIELDS: readonly Field[] = ['part', 'nsn', 'niin', 'cage', 'fsc'];

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

/** A totals line ("Total" in the part column, no identifier beside it) labels a sum; it is not a record. */
function isFooter(sheet: SheetModel, row: number, mapped: ReadonlyMap<number, Field>): boolean {
	let labeled = false;
	for (const [col, field] of mapped) {
		if (!IDENTIFIER_FIELDS.includes(field)) continue;
		const cell = sheet.cell(row, col);
		if (cell.kind === 'empty' || cell.mergedFrom) continue;
		if (cell.kind !== 'text' || !FOOTER_LABELS.has(normalizeHeader(cell.text))) return false;
		labeled = true;
	}
	return labeled;
}

/** A cell covered by a merge from another column shows that column's value, not one of its own. */
function ownCell(sheet: SheetModel, row: number, col: number): Cell {
	const cell = sheet.cell(row, col);
	return cell.mergedFrom === undefined || parseA1(cell.mergedFrom)?.col === col ? cell : emptyCell(row, col);
}

const PASSING: ReadonlySet<Verdict> = new Set(['pass', 'repaired']);

/** Where the table ends early: the blank gap below its last row, and the rows under the gap left out. */
type TableEnd = { bottom: number; gap: number[]; rows: number[] };

/**
 * The table ends at a blank gap when every row below it fits none of the table's columns, such as a form or a
 * paragraph of terms under the table. Ending a table early loses real rows, so the rule is narrow: it cuts only
 * at a blank gap (a misfit row inside the data run stays an invalid record), never above a row that has a
 * passing identifier, and never above a repeated header, which continues the table.
 */
function misfitTail(
	from: number,
	to: number,
	kindOf: (row: number) => SkippedRow['reason'] | 'data',
	fits: (row: number) => boolean
): TableEnd | null {
	// Bottom up, so an ordinary table stops at its last row after one check.
	let last = to;
	while (last >= from && (kindOf(last) === 'blank' || (kindOf(last) !== 'repeated-header' && !fits(last)))) last--;
	if (last < from) return null;
	let top = last + 1;
	while (top <= to && kindOf(top) !== 'blank') top++;
	const gap: number[] = [];
	const rows: number[] = [];
	for (let row = top; row <= to; row++) {
		if (kindOf(row) !== 'blank') rows.push(row);
		else if (rows.length === 0) gap.push(row);
	}
	return rows.length > 0 ? { bottom: top - 1, gap, rows } : null;
}

function classifyRows(
	sheet: SheetModel,
	spec: TableSpec,
	headers: ReadonlyMap<number, ColumnHeader>,
	mapped: ReadonlyMap<number, Field>
): { dataRows: number[]; skippedRows: SkippedRow[]; end: TableEnd | null } {
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

	const skippedAt = new Map(skippedRows.map(({ row, reason }) => [row, reason]));
	const isIdentifier = (cell: Cell) =>
		checkValue('nsn', cell, sheet.name) === 'pass' || checkValue('niin', cell, sheet.name) === 'pass';
	const fits = (row: number) =>
		[...mapped].some(([col, field]) => PASSING.has(checkValue(field, ownCell(sheet, row, col), sheet.name))) ||
		cols.some((col) => hasValue(row, col) && isIdentifier(sheet.cell(row, col)));
	const end = misfitTail(start, spec.range.bottom, (row) => skippedAt.get(row) ?? 'data', fits);
	if (end) {
		// Both lists are in row order, so the rows below the end come off the back. The non-blank ones stay
		// listed as skipped, so the user can see what was left out.
		while (dataRows.length > 0 && dataRows.at(-1)! > end.bottom) dataRows.pop();
		while (skippedRows.length > 0 && skippedRows.at(-1)!.row > end.bottom) skippedRows.pop();
		for (const row of end.rows) skippedRows.push({ row, reason: 'below-table' });
	}

	// Only trailing rows can be footers; a "Total" between blocks is left to the record checks.
	while (dataRows.length > 0 && isFooter(sheet, dataRows.at(-1)!, mapped)) {
		skippedRows.push({ row: dataRows.pop()!, reason: 'footer' });
	}
	skippedRows.sort((a, b) => a.row - b.row);
	return { dataRows, skippedRows, end };
}

/** What a row would need to belong to the table, in the user's words. */
const VALUE_NOUN: Record<Field, string> = {
	part: 'part number',
	description: 'description',
	nsn: 'NSN',
	niin: 'NIIN',
	cage: 'CAGE code',
	fsc: 'FSC'
};

/** "a", "a or b", "a, b, or c" (or "and"). */
function joinList(items: readonly string[], word: 'and' | 'or'): string {
	return items.length <= 2 ? items.join(` ${word} `) : `${items.slice(0, -1).join(', ')}, ${word} ${items.at(-1)}`;
}

/** "The table ends at row 30: rows 33-43, after the blank rows 31-32, have no FSC, NIIN, or NSN, so ...". */
function endReason({ bottom, gap, rows }: TableEnd, mapped: ReadonlyMap<number, Field>): string {
	// Mapped fields in column order, then NSN and NIIN, which count in any column.
	const byColumn = [...mapped].sort(([a], [b]) => a - b).map(([, field]) => field);
	const fields = [...new Set<Field>([...byColumn, 'nsn', 'niin'])];
	const none = joinList(fields.map((field) => VALUE_NOUN[field]), 'or');
	const blank = `the ${gap.length === 1 ? 'blank row' : 'blank rows'} ${formatRows(gap)}`;
	const first = rows[0];
	const last = rows.at(-1)!;
	return first === last
		? `The table ends at row ${bottom}: row ${first}, after ${blank}, has no ${none}, so it isn't imported`
		: `The table ends at row ${bottom}: rows ${first}-${last}, after ${blank}, have no ${none}, so they aren't imported`;
}

type TableColumns = {
	headers: Map<number, ColumnHeader>;
	/** Column -> the other columns it shares a merged header with, for its reasons. */
	merged: Map<number, string>;
	/** One reason per column left out because it is part of a merged header. */
	dropped: string[];
};

/**
 * The range's columns that belong to the table. A column without a header belongs only when it holds values in
 * the data rows. Under a header merged across columns, a column holding nothing of its own (`C` under `B6:C6`
 * when every NIIN is merged across `B:C` too) is the same column as its neighbor, and listing it would show
 * that column twice; when no column of the merge holds values, its first column stands for all of them.
 * Mapped and user-set columns always belong.
 */
function tableColumns(
	sheet: SheetModel,
	headers: ReadonlyMap<number, ColumnHeader>,
	dataRows: readonly number[],
	pinned: (col: number) => boolean
): TableColumns {
	const hasValues = (col: number) =>
		dataRows.some((row) => {
			const cell = sheet.cell(row, col);
			return cell.kind !== 'empty' && !cell.mergedFrom;
		});
	const belongs = new Set<number>();
	const merges = new Map<string, number[]>();
	for (const [col, header] of headers) {
		if ((header.text && !header.merge) || pinned(col) || hasValues(col)) belongs.add(col);
		if (header.text && header.merge) {
			const ref = rangeToA1(header.merge);
			merges.set(ref, [...(merges.get(ref) ?? []), col]);
		}
	}
	const merged = new Map<number, string>();
	const dropped: string[] = [];
	for (const cols of merges.values()) {
		if (!cols.some((col) => belongs.has(col))) belongs.add(cols[0]);
		const members = cols.filter((col) => belongs.has(col));
		const label = headers.get(cols[0])!.text;
		const columns = (list: number[]) => `${list.length === 1 ? 'column' : 'columns'} ${joinList(list.map(colLetter), 'and')}`;
		for (const col of cols) {
			if (belongs.has(col)) continue;
			dropped.push(`Column ${colLetter(col)} shares the merged "${label}" header with ${columns(members)} and has no values of its own, so they are one column`);
		}
		for (const col of members) {
			const others = members.filter((other) => other !== col);
			if (others.length > 0) merged.set(col, `Shares the merged "${label}" header with ${columns(others)}`);
		}
	}
	return { headers: new Map([...headers].filter(([col]) => belongs.has(col))), merged, dropped };
}

/** Rows below the table are explained by the end-of-table reason instead. */
type InTableReason = Exclude<SkippedRow['reason'], 'below-table'>;

const SKIP_LABEL: Record<InTableReason, [string, string]> = {
	blank: ['blank row', 'blank rows'],
	hidden: ['hidden row', 'hidden rows'],
	'repeated-header': ['repeated header row', 'repeated header rows'],
	'no-mapped-values': ['row with values only in unmapped columns', 'rows with values only in unmapped columns'],
	footer: ['footer row', 'footer rows']
};

function skippedReason(skipped: readonly SkippedRow[]): string | null {
	const parts = (Object.keys(SKIP_LABEL) as InTableReason[]).flatMap((reason) => {
		const rows = skipped.filter((s) => s.reason === reason).map((s) => s.row);
		return rows.length ? [`${plural(rows.length, ...SKIP_LABEL[reason])} (${formatRows(rows)})`] : [];
	});
	return parts.length > 0 ? `Skipped ${parts.join(', ')}` : null;
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
	if (reasons.length === 0) {
		reasons.push(
			column.header
				? `Header '${column.header}' does not name a target field`
				: "No header, and its values aren't NSNs or NIINs"
		);
	}
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
	const rangeHeaders = new Map<number, ColumnHeader>();
	for (let col = left; col <= right; col++) rangeHeaders.set(col, readHeader(sheet, headerRows, col));
	const mapped = new Map<number, Field>();
	for (const [col, field] of Object.entries(spec.columns)) {
		if (rangeHeaders.has(Number(col))) mapped.set(Number(col), field);
	}

	const { dataRows, skippedRows, end } = classifyRows(sheet, spec, rangeHeaders, mapped);
	const pinned = (col: number) => mapped.has(col) || user.set.has(col) || user.replaced.has(col);
	const { headers, merged, dropped } = tableColumns(sheet, rangeHeaders, dataRows, pinned);
	const cols = [...headers.keys()];
	const range = {
		top: spec.range.top,
		left: cols[0] ?? left,
		bottom: end?.bottom ?? spec.range.bottom,
		right: cols.at(-1) ?? right
	};
	const evidence = evaluateColumns(sheet, headers, dataRows, { mapped });
	const shared = (col: number) => (merged.has(col) ? [merged.get(col)!] : []);

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
				reasons: [...shared(column.col), ...unmappedReasons(column, user, alternatives)],
				alternatives,
				valuePassRate: null,
				overridden: user.set.has(column.col)
			};
		}
		const e = column.fields.get(field)!;
		const byUser = user.set.get(column.col) === field;
		const reasons = [...shared(column.col), ...describeEvidence(column, e)];
		if (byUser) reasons.unshift('Set by user');
		// Without a header naming the field, values that all pass can still fall short of the value-only rule (a column
		// of plausible part numbers, for one), so "do not support" would contradict the evidence listed above it.
		else if (!e.confidence) reasons.push(e.header ? `Values do not support ${FIELD_LABEL[field]}` : `Values alone cannot confirm ${FIELD_LABEL[field]}`);
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
		`${capitalize(headerRowsPhrase(headerRows))}; table ${rangeToA1(range)}`,
		plural(dataRows.length, 'data row'),
		skippedReason(skippedRows),
		end ? endReason(end, mapped) : null,
		...dropped,
		columns.some((c) => c.field)
			? `Mapped ${columns.filter((c) => c.field).map((c) => `${FIELD_LABEL[c.field!]} = column ${colLetter(c.col)}`).join(', ')}`
			: null,
		...missing,
		statusReason
	].filter((r): r is string => r !== null);

	return {
		table: {
			id: tableId(sheet.name, spec),
			sheet: sheet.name,
			headerRows,
			range,
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
