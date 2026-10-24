/**
 * Builds CandidateRecords from the data rows of one detected table.
 *
 * Every value carries provenance back to the cell that holds its original text, and invalid values go to
 * `rejected`, never to `fields`. Statuses and `approved` set here are initial: validate/ finalizes them once
 * duplicates, conflicts, and decisions across tables are known.
 */
import {
	decisionId,
	PRIMARY_FIELDS,
	type CandidateRecord,
	type Cell,
	type ColumnMapping,
	type Field,
	type FieldValue,
	type Issue,
	type NormalizedValue,
	type Overrides,
	type RecordStatus,
	type SheetModel,
	type TableCandidate,
	type Transform
} from '../model';
import { normalizeField } from '../normalize';
import { colLetter, emptyCell, parseA1, qualifiedRef, toA1 } from '../refs';

const LABEL: Record<Field, string> = {
	part: 'Part number',
	description: 'Description',
	nsn: 'NSN',
	niin: 'NIIN',
	cage: 'CAGE',
	fsc: 'FSC'
};

/** Optional fields whose empty cells deserve a warning. FSC is not one: it only exists to derive an NSN. */
const WARN_WHEN_EMPTY: readonly Field[] = ['description', 'cage'];

type MappedColumn = ColumnMapping & { field: Field };

type TableContext = {
	fileName: string;
	sheet: SheetModel;
	table: TableCandidate;
	overrides: Overrides;
	mapped: MappedColumn[];
	/** Primary-field columns mapped below high confidence; every record of the table is flagged. */
	uncertain: MappedColumn[];
};

/** A mapped cell in one row that normalized to one or more values. */
type Source = {
	field: Field;
	cell: Cell;
	/** A1 ref of the cell that holds the text: the merge master for merged cells. */
	ref: string;
	values: NormalizedValue[];
};

/** What one source row contributes to every record built from it. */
type Row = {
	row: number;
	sources: Source[];
	rejected: CandidateRecord['rejected'];
	issues: Issue[];
};

/** How a row with multi-value cells becomes records. */
type Layout =
	| { kind: 'single' }
	| { kind: 'split'; source: Source }
	| { kind: 'ambiguous'; multi: Source[]; chosen: string | undefined };

export function buildTableRecords(
	fileName: string,
	sheet: SheetModel,
	table: TableCandidate,
	overrides: Overrides
): CandidateRecord[] {
	const mapped = table.columns.filter((c): c is MappedColumn => c.field !== null);
	const uncertain = mapped.filter((c) => PRIMARY_FIELDS.includes(c.field) && c.confidence !== 'high');
	const ctx: TableContext = { fileName, sheet, table, overrides, mapped, uncertain };
	return table.dataRows.flatMap((row) => buildRowRecords(ctx, readRow(ctx, row)));
}

function readRow(ctx: TableContext, rowNumber: number): Row {
	const row: Row = { row: rowNumber, sources: [], rejected: {}, issues: [] };
	for (const { col, field } of ctx.mapped) {
		const cell = sourceCell(ctx.sheet, rowNumber, col);
		const ref = cell.mergedFrom ?? cell.ref;
		const result = normalizeField(field, cell, ctx.sheet.name);
		if (result.kind === 'ok') {
			row.sources.push({ field, cell, ref, values: result.values });
			row.issues.push(...result.warnings);
		} else if (result.kind === 'invalid') {
			row.rejected[field] = { original: cell.text, cell: ref };
			row.issues.push(result.issue);
		} else if (WARN_WHEN_EMPTY.includes(field)) {
			const at = qualifiedRef(ctx.sheet.name, cell.ref);
			row.issues.push({
				code: 'missing-optional',
				severity: 'warning',
				field,
				message: `${LABEL[field]} is empty in ${at}`,
				cells: [at]
			});
		}
	}
	hintPartPastedAsNsn(ctx, row);
	return row;
}

/**
 * Every cell covered by a merge carries the master's value, but only a vertical merge (master in the same
 * column) means the value belongs to this column. A description merged across the CAGE column must not
 * become a CAGE, so a cell whose master sits in another column reads as empty.
 */
function sourceCell(sheet: SheetModel, row: number, col: number): Cell {
	const cell = sheet.cell(row, col);
	if (cell.mergedFrom === undefined || parseA1(cell.mergedFrom)?.col === col) return cell;
	return emptyCell(row, col);
}

/** A part number pasted into the NSN column is a common slip; naming the matching cell makes it obvious. */
function hintPartPastedAsNsn(ctx: TableContext, row: Row): void {
	const nsn = row.rejected.nsn;
	const part = row.sources.find((s) => s.field === 'part');
	if (!nsn || !part?.values.some((v) => v.value === nsn.original.trim())) return;
	const at = qualifiedRef(ctx.sheet.name, part.cell.ref);
	row.issues = row.issues.map((issue) =>
		issue.field === 'nsn' && issue.code === 'invalid-identifier'
			? { ...issue, message: `${issue.message}; same value as part number in ${at}`, cells: [...issue.cells, at] }
			: issue
	);
}

/** Decides how a row with multi-value cells becomes records; cells kept as one are collapsed in `row` in place. */
function chooseLayout(ctx: TableContext, row: Row): Layout {
	const multi = row.sources.filter((s) => s.values.length > 1);
	if (multi.length === 0) return { kind: 'single' };
	const subject = `${ctx.table.id}:r${row.row}`;
	if (multi.length === 1) {
		if (ctx.overrides.decisions?.[decisionId('split-cell', subject)] !== 'keep-as-one') {
			return { kind: 'split', source: multi[0] };
		}
		keepAsOne(ctx, row, multi[0]);
		return { kind: 'single' };
	}
	const stored = ctx.overrides.decisions?.[decisionId('ambiguous-multi-value', subject)];
	const sameCounts = multi.every((s) => s.values.length === multi[0].values.length);
	// Pairing uneven lists would leave values without a partner, so validate/ does not offer it there;
	// a stored pair-in-order on such a row is ignored and the row stays undecided.
	const chosen = stored === 'pair-in-order' && !sameCounts ? undefined : stored;
	if (!sameCounts || chosen === 'keep-as-one') multi.forEach((source) => keepAsOne(ctx, row, source));
	return { kind: 'ambiguous', multi, chosen };
}

/**
 * Treats a multi-value cell as one value. A part keeps its original text; several NSNs or NIINs joined
 * together are not a valid identifier, so they become a rejected value instead.
 */
function keepAsOne(ctx: TableContext, row: Row, source: Source): void {
	const { cell, field } = source;
	if (field === 'part') {
		const value = cell.text.trim();
		row.sources[row.sources.indexOf(source)] = {
			...source,
			values: [{ value, transforms: value === cell.text ? [] : ['trim'] }]
		};
		return;
	}
	const at = qualifiedRef(ctx.sheet.name, cell.ref);
	row.sources = row.sources.filter((s) => s !== source);
	row.rejected[field] = { original: cell.text, cell: source.ref };
	row.issues.push({
		code: 'invalid-identifier',
		severity: 'error',
		field,
		message: `${LABEL[field]} in ${at} holds ${source.values.length} values on separate lines; kept as one value it is not a valid ${LABEL[field]}`,
		cells: [at]
	});
}

function buildRowRecords(ctx: TableContext, row: Row): CandidateRecord[] {
	const layout = chooseLayout(ctx, row);
	const total = Math.max(1, ...row.sources.map((s) => s.values.length));
	const baseId = `${ctx.table.id}:r${row.row}`;
	const records: CandidateRecord[] = [];
	for (let index = 0; index < total; index++) {
		const fields: CandidateRecord['fields'] = {};
		for (const source of row.sources) {
			// Single values repeat on every record; each multi-value cell left in the layout has `total` values.
			const value = source.values.length === 1 ? source.values[0] : source.values[index];
			fields[source.field] = fieldValue(ctx, row.row, source, value);
		}
		const rejected = { ...row.rejected };
		const issues = [...row.issues, ...layoutIssues(ctx, layout, index, total)];
		issues.push(...checkAndDerive(ctx, fields, rejected, row));
		issues.push(...mappingIssues(ctx, row.row, fields));
		const pending = layout.kind === 'ambiguous' && layout.chosen === undefined;
		const status = initialStatus(fields, issues, pending);
		const excluded = layout.kind === 'ambiguous' && layout.chosen === 'exclude';
		records.push({
			id: total === 1 ? baseId : `${baseId}.${index + 1}`,
			tableId: ctx.table.id,
			sheet: ctx.sheet.name,
			sourceRow: row.row,
			...(layout.kind === 'split' && { split: { cell: layout.source.ref, index: index + 1, total } }),
			fields,
			rejected,
			issues,
			status,
			approved: !excluded && (status === 'valid' || status === 'warning')
		});
	}
	return records;
}

function fieldValue(ctx: TableContext, row: number, source: Source, value: NormalizedValue): FieldValue {
	const merged = source.cell.mergedFrom !== undefined;
	return {
		value: value.value,
		provenance: {
			file: ctx.fileName,
			sheet: ctx.sheet.name,
			row,
			col: source.cell.col,
			cell: source.ref,
			original: source.cell.text,
			transforms: merged ? ['merge-fill', ...value.transforms] : value.transforms,
			origin: 'source'
		}
	};
}

function layoutIssues(ctx: TableContext, layout: Layout, index: number, total: number): Issue[] {
	const at = (source: Source) => qualifiedRef(ctx.sheet.name, source.cell.ref);
	if (layout.kind === 'split') {
		const { source } = layout;
		return [
			{
				code: 'split-from-multi-value',
				severity: 'info',
				field: source.field,
				message: `${LABEL[source.field]} in ${at(source)} holds ${total} values on separate lines; this record is value ${index + 1} of ${total}`,
				cells: [at(source)]
			}
		];
	}
	if (layout.kind === 'ambiguous') {
		const { multi } = layout;
		const names = multi.map((s) => `${LABEL[s.field]} in ${at(s)}`);
		const counts = multi.map((s) => s.values.length);
		const outcome = total > 1 ? `paired in order, value ${index + 1} of ${total}` : 'kept as one record';
		return [
			{
				code: 'ambiguous-multi-value',
				severity: 'warning',
				message: `${joinAnd(names)} hold ${joinAnd(counts.map(String))} values on separate lines; ${outcome}`,
				cells: multi.map(at)
			}
		];
	}
	return [];
}

/**
 * Cross-field rules: NSN = FSC + NIIN. Disagreeing source values are a conflict until a decision picks a
 * side; then a missing NIIN or NSN is derived and labeled. A value rejected while reading the row counts
 * as present, so nothing is derived over a malformed cell, but a value the decision ruled against is
 * replaced: that is the point of choosing the other side.
 */
function checkAndDerive(
	ctx: TableContext,
	fields: CandidateRecord['fields'],
	rejected: CandidateRecord['rejected'],
	row: Row
): Issue[] {
	const issues = resolveConflict(ctx, fields, rejected, row.row);
	const { nsn, niin, fsc } = fields;
	if (nsn && !niin && !row.rejected.niin) {
		fields.niin = derived(nsn.value.slice(4), 'derive-niin-from-nsn', [nsn]);
	}
	if (!nsn && !row.rejected.nsn && niin && fsc) {
		fields.nsn = derived(fsc.value + niin.value, 'derive-nsn-from-fsc-niin', [niin, fsc]);
	}
	return issues;
}

/**
 * Applies the row's resolve-identifier-conflict choice to an NSN that disagrees with the row's NIIN or FSC.
 * The losing cells move to `rejected` with a conflict warning. Undecided, `exclude-row`, and any choice
 * validate/ does not offer all build the same records: conflict errors, which hold the record as pending.
 */
function resolveConflict(
	ctx: TableContext,
	fields: CandidateRecord['fields'],
	rejected: CandidateRecord['rejected'],
	row: number
): Issue[] {
	const { nsn } = fields;
	if (!nsn) return [];
	const expected = { niin: nsn.value.slice(4), fsc: nsn.value.slice(0, 4) };
	const disagreeing = (['niin', 'fsc'] as const).filter((f) => fields[f] && fields[f].value !== expected[f]);
	if (disagreeing.length === 0) return [];
	const at = (v: FieldValue) => qualifiedRef(ctx.sheet.name, toA1(v.provenance.row, v.provenance.col));
	const choice = ctx.overrides.decisions?.[decisionId('resolve-identifier-conflict', `${ctx.table.id}:r${row}`)];
	if (choice === 'prefer-nsn') {
		return disagreeing.map((field) => {
			const other = reject(fields, rejected, field);
			return {
				code: 'conflict',
				severity: 'warning',
				field,
				message: `${LABEL[field]} in ${at(other)} disagrees with NSN in ${at(nsn)}; kept the NSN`,
				cells: [at(other), at(nsn)]
			};
		});
	}
	if (choice === 'prefer-niin-fsc') {
		reject(fields, rejected, 'nsn');
		const others = disagreeing.map((field) => fields[field]!);
		const names = disagreeing.map((field, i) => `${LABEL[field]} in ${at(others[i])}`);
		return [
			{
				code: 'conflict',
				severity: 'warning',
				field: 'nsn',
				message: `NSN in ${at(nsn)} disagrees with ${joinAnd(names)}; kept the ${joinAnd(disagreeing.map((f) => LABEL[f]))}`,
				cells: [at(nsn), ...others.map(at)]
			}
		];
	}
	return disagreeing.map((field) => conflict(ctx, nsn, fields[field]!, field));
}

/** Moves a value the conflict decision ruled against from `fields` to `rejected`. */
function reject(
	fields: CandidateRecord['fields'],
	rejected: CandidateRecord['rejected'],
	field: Field
): FieldValue {
	const value = fields[field]!;
	delete fields[field];
	rejected[field] = { original: value.provenance.original, cell: value.provenance.cell };
	return value;
}

/** The first source supplies the cell, column, and original text, so a derived value still points at a real cell. */
function derived(value: string, transform: Transform, from: FieldValue[]): FieldValue {
	return {
		value,
		provenance: {
			...from[0].provenance,
			transforms: [transform],
			origin: 'derived',
			derivedFrom: from.map((f) => f.provenance.cell)
		}
	};
}

function conflict(ctx: TableContext, nsn: FieldValue, other: FieldValue, field: 'niin' | 'fsc'): Issue {
	const at = (v: FieldValue) => qualifiedRef(ctx.sheet.name, toA1(v.provenance.row, v.provenance.col));
	return {
		code: 'conflict',
		severity: 'error',
		field,
		message: `NSN ${nsn.value} in ${at(nsn)} does not match ${LABEL[field]} ${other.value} in ${at(other)}`,
		cells: [at(nsn), at(other)]
	};
}

function mappingIssues(ctx: TableContext, row: number, fields: CandidateRecord['fields']): Issue[] {
	const at = (col: number) => qualifiedRef(ctx.sheet.name, toA1(row, col));
	const issues: Issue[] = ctx.uncertain.map((c) => ({
		code: 'low-confidence-mapping',
		severity: 'warning',
		field: c.field,
		message: `${LABEL[c.field]} column ${colLetter(c.col)} ("${c.header}") was mapped with ${c.confidence} confidence`,
		cells: [at(c.col)]
	}));
	if (!PRIMARY_FIELDS.some((f) => fields[f])) {
		issues.push({
			code: 'missing-primary-identifier',
			severity: 'error',
			message: `Row ${row} has no valid part number, NSN, or NIIN`,
			cells: ctx.mapped.filter((c) => PRIMARY_FIELDS.includes(c.field)).map((c) => at(c.col))
		});
	}
	return issues;
}

/**
 * Errors only invalidate a record that has no usable identifier left, so a malformed NSN beside a valid part
 * is a warning (its valid portion can import). An NSN that disagrees with its own NIIN or FSC is pending
 * until the user picks which identifier to trust, because nothing in the row says which one is right.
 */
function initialStatus(fields: CandidateRecord['fields'], issues: Issue[], pending: boolean): RecordStatus {
	if (!PRIMARY_FIELDS.some((f) => fields[f])) return 'invalid';
	if (pending || issues.some((i) => i.code === 'conflict' && i.severity === 'error')) return 'pending';
	return issues.some((i) => i.severity !== 'info') ? 'warning' : 'valid';
}

function joinAnd(items: string[]): string {
	return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
