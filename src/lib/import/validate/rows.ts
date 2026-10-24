/**
 * Table inclusion and the per-row decisions: newline splits, ambiguous multi-value rows, identifiers
 * that contradict each other, and rows imported without their malformed values.
 *
 * Splits and pairings are shaped by T4 (buildRecords reads the same decision ids from overrides);
 * these steps make each one visible and reversible, and hold back rows that wait for the user.
 */
import {
	PRIMARY_FIELDS,
	decisionId,
	type CandidateRecord,
	type ColumnMapping,
	type Confidence,
	type Field,
	type SheetAnalysis,
	type TableCandidate
} from '../model';
import { colLetter, qualifiedRef, rangeToA1 } from '../refs';
import type { DecisionLog } from './decisions';
import {
	FIELD_LABELS,
	fieldCells,
	groupBy,
	hasPrimary,
	hold,
	isIdentifierConflict,
	joinList,
	malformed,
	settle,
	type Entry,
	type TableState
} from './entry';

/**
 * Ready tables are included automatically. Needs-review tables wait for the user, suggested exclude (D5),
 * except a table without a header row whose values identify it: that one is suggested include.
 * A table the user set up by hand is included without a decision, because the user just chose it.
 * Tables on a hidden sheet the user included anyway always wait, suggested include (D26).
 */
export function decideTables(
	log: DecisionLog,
	sheets: SheetAnalysis[],
	recordIds: Map<string, string[]>,
	hiddenSheets: ReadonlySet<string> = new Set()
): Map<string, TableState> {
	const states = new Map<string, TableState>();
	for (const sheet of sheets) {
		const hidden = hiddenSheets.has(sheet.name);
		for (const table of sheet.tables) {
			if (table.source === 'user') {
				states.set(table.id, 'included');
				continue;
			}
			const ready = table.status === 'ready' && !hidden;
			const byValues = !ready && valuesIdentify(table);
			const { chosen } = log.decide({
				kind: 'include-table',
				subject: table.id,
				tableId: table.id,
				recordIds: recordIds.get(table.id) ?? [],
				cells: [],
				suggested: ready || byValues || hidden ? 'include' : 'exclude',
				auto: ready,
				reason: `${hidden ? 'This sheet is hidden in Excel; you asked to include it. ' : ''}${
					byValues ? valuesReason(table) : tableReason(table)
				}`,
				at: [sheet.index, table.range.top]
			});
			states.set(
				table.id,
				chosen === 'include' ? 'included' : chosen === 'exclude' ? 'excluded' : 'pending'
			);
		}
	}
	return states;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The pass rate a column needs to be mapped by its values alone (structure/columns.ts). */
const VALUES_DECIDE_RATE = 0.95;

const VALUE_NOUN: Partial<Record<Field, [one: string, many: string]>> = {
	part: ['a plausible part number', 'plausible part numbers'],
	nsn: ['a valid NSN', 'valid NSNs'],
	niin: ['a valid NIIN', 'valid NIINs']
};

function primaryColumns(table: TableCandidate): Array<ColumnMapping & { field: Field }> {
	return table.columns.filter(
		(column): column is ColumnMapping & { field: Field } =>
			column.field !== null && PRIMARY_FIELDS.includes(column.field)
	);
}

/**
 * A table without a header row was found by its values alone, so values that pass are all the evidence
 * there can be: it is held back like any needs-review table, but including it is the likely answer.
 */
function valuesIdentify(table: TableCandidate): boolean {
	const primary = primaryColumns(table);
	return (
		table.headerRows.length === 0 &&
		primary.length > 0 &&
		primary.every((column) => (column.valuePassRate ?? 0) >= VALUES_DECIDE_RATE)
	);
}

/** E.g. "Table on Sheet1 (A1:A99) has no header row, but every value in column A is a valid NSN, ...". */
function valuesReason(table: TableCandidate): string {
	const kind = table.source === 'ai' ? 'AI-proposed table' : 'Table';
	const evidence = primaryColumns(table).map(({ col, field, valuePassRate }) => {
		const [one, many] = VALUE_NOUN[field]!;
		return valuePassRate === 1
			? `every value in column ${colLetter(col)} is ${one}`
			: `${Math.floor(valuePassRate! * 100)}% of the values in column ${colLetter(col)} are ${many}`;
	});
	return `${kind} on ${table.sheet} (${rangeToA1(table.range)}) has no header row, but ${joinList(
		evidence
	)}, so including it is suggested.`;
}

/** One line: the mapping panel already shows the full evidence for every column. */
function tableReason(table: TableCandidate): string {
	const kind = table.source === 'ai' ? 'AI-proposed table' : 'Table';
	const what = `${kind} on ${table.sheet} (${rangeToA1(table.range)})`;
	const primary = primaryColumns(table);
	if (primary.length === 0) return `${what} has no primary column mapped.`;
	// Strict comparison keeps the leftmost column on a tie.
	const weakest = primary.reduce((a, b) =>
		CONFIDENCE_RANK[b.confidence] < CONFIDENCE_RANK[a.confidence] ? b : a
	);
	const header = weakest.header ? ` ("${weakest.header}")` : '';
	return `${what}: weakest primary column is ${FIELD_LABELS[weakest.field]} in ${colLetter(
		weakest.col
	)}${header}, ${weakest.confidence} confidence.`;
}

/** Row-level decisions for records of included tables. Entries arrive in workbook order. */
export function decideRows(log: DecisionLog, entries: Entry[]): void {
	const included = entries.filter((entry) => entry.table === 'included');
	const rows = groupBy(included, ({ record }) => `${record.tableId}:r${record.sourceRow}`);
	for (const [subject, row] of rows) {
		const first = row[0].record;
		const base = {
			subject,
			tableId: first.tableId,
			recordIds: row.map(({ record }) => record.id),
			at: [row[0].sheetIndex, first.sourceRow] as [number, number]
		};
		// The whole cell text survives in provenance or in `rejected`, whether or not T4 split the row.
		const multiLine = PRIMARY_FIELDS.filter((field) => lineCount(first, field) > 1);

		if (first.issues.some((issue) => issue.code === 'ambiguous-multi-value')) {
			const counts = multiLine.map((field) => lineCount(first, field));
			const paired = counts.length > 1 && counts.every((count) => count === counts[0]);
			const { chosen } = log.decide({
				...base,
				kind: 'ambiguous-multi-value',
				cells: multiLine.flatMap((field) => sourceCells(first, field)),
				// Pairing uneven lists would leave some values without a partner, so it is not offered.
				omit: paired ? [] : ['pair-in-order'],
				suggested: paired ? 'pair-in-order' : 'keep-as-one',
				auto: false,
				reason: `${listing(first, multiLine)}, so it is unclear which values belong together. ${
					paired
						? 'The counts match, so pairing them in order is suggested.'
						: 'The counts differ, so they cannot be paired in order.'
				}`
			});
			// A row still waiting, or excluded whole, has no valid portion to decide about yet.
			if (chosen === null) row.forEach((entry) => hold(entry, 'pending'));
			if (chosen === 'exclude') row.forEach((entry) => hold(entry));
			if (chosen === null || chosen === 'exclude') continue;
		} else if (
			multiLine.length > 0 &&
			(row.some(({ record }) => record.split) ||
				log.choice(decisionId('split-cell', subject)) !== undefined)
		) {
			// After keep-as-one no record is split any more, so fall back to the multi-line field.
			const field =
				multiLine.find((f) =>
					first.fields[f]?.provenance.transforms.includes('split-multi-value')
				) ?? multiLine[0];
			log.decide({
				...base,
				kind: 'split-cell',
				cells: sourceCells(first, field),
				suggested: 'split',
				auto: true,
				reason: `${listing(first, [field])}.`
			});
		}

		const conflicted = row.filter(({ record }) => record.issues.some(isIdentifierConflict));
		if (conflicted.length > 0) {
			const issues = conflicted.flatMap(({ record }) =>
				record.issues.filter(isIdentifierConflict)
			);
			const messages = new Set(issues.map((issue) => issue.message.replace(/\.$/, '')));
			const { chosen } = log.decide({
				...base,
				recordIds: conflicted.map(({ record }) => record.id),
				kind: 'resolve-identifier-conflict',
				cells: [...new Set(issues.flatMap((issue) => issue.cells))],
				// Keeping the NSN loses nothing from the file: the NIIN and FSC follow from it, and the cells
				// that disagree stay on the record (PLAN.md D24).
				suggested: 'prefer-nsn',
				auto: false,
				reason: `${[...messages].join('; ')}. Keeping the NSN is suggested: its NIIN and FSC are worked out from it, and the cells that disagree stay listed on the row.`
			});
			// prefer-*: T4 kept the chosen identifiers and rejected the others, leaving a conflict warning.
			// Had T4 not applied the choice, its error would remain and keep them out.
			if (chosen === null) conflicted.forEach((entry) => hold(entry, 'pending'));
			if (chosen === 'exclude-row') conflicted.forEach((entry) => hold(entry));
			// prefer-nsn keeps the warning, so file cells replaced by values worked out from the NSN stay visible
			// as warnings even when the suggestion is accepted in bulk; prefer-niin-fsc settles it into a note.
			if (chosen === 'prefer-niin-fsc') {
				conflicted.forEach((entry) =>
					settle(entry, (issue) => isIdentifierConflict(issue) && issue.severity === 'warning')
				);
			}
		}

		const partial = row.filter(
			({ record, held }) => !held && hasPrimary(record) && malformed(record).length > 0
		);
		if (partial.length > 0) {
			const sample = partial[0].record;
			const fields = malformed(sample);
			const problems = sample.issues.filter(
				(issue) => issue.severity !== 'info' && issue.field && fields.includes(issue.field)
			);
			const messages = problems.map((issue) => issue.message.replace(/\.$/, ''));
			const kept = PRIMARY_FIELDS.filter((field) => sample.fields[field]).map(
				(field) => FIELD_LABELS[field]
			);
			const { chosen } = log.decide({
				...base,
				recordIds: partial.map(({ record }) => record.id),
				kind: 'import-valid-portion',
				cells: [...new Set(problems.flatMap((issue) => issue.cells))],
				suggested: 'import-valid-portion',
				auto: true,
				reason: `${messages.join('; ')}. The row still has a valid ${joinList(
					kept
				)}, so it is imported without the rejected value.`
			});
			if (chosen === 'exclude-row') partial.forEach((entry) => hold(entry));
		}
	}
}

/**
 * Non-empty lines in the field's source cell; an identifier cell with several holds several values.
 * A multi-line NSN or NIIN kept as one value is rejected, so its text is in `rejected`. Derived values
 * are skipped: a NIIN derived from a multi-line NSN cell is not a second cell.
 */
function lineCount(record: CandidateRecord, field: Field): number {
	const provenance = record.fields[field]?.provenance;
	const text = provenance
		? provenance.origin === 'source'
			? provenance.original
			: ''
		: (record.rejected[field]?.original ?? '');
	return text.split('\n').filter((line) => line.trim() !== '').length;
}

/** Qualified ref of the field's source cell, whether its value was accepted or rejected. */
function sourceCells(record: CandidateRecord, field: Field): string[] {
	const rejected = record.rejected[field];
	if (record.fields[field] || !rejected) return fieldCells(record, field);
	return [qualifiedRef(record.sheet, rejected.cell)];
}

/** E.g. "Active Parts!D136 lists 2 part number values on separate lines". */
function listing(record: CandidateRecord, fields: Field[]): string {
	const parts = fields.map(
		(field) =>
			`${sourceCells(record, field).join(', ')} lists ${lineCount(record, field)} ${FIELD_LABELS[field]} values`
	);
	return `${joinList(parts)} on separate lines`;
}
