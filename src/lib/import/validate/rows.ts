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

/** Ready tables are included automatically; needs-review tables wait for the user, suggested exclude. */
export function decideTables(
	log: DecisionLog,
	sheets: SheetAnalysis[],
	recordIds: Map<string, string[]>
): Map<string, TableState> {
	const states = new Map<string, TableState>();
	for (const sheet of sheets) {
		for (const table of sheet.tables) {
			const ready = table.status === 'ready';
			const { chosen } = log.decide({
				kind: 'include-table',
				subject: table.id,
				tableId: table.id,
				recordIds: recordIds.get(table.id) ?? [],
				cells: [],
				suggested: ready ? 'include' : 'exclude',
				auto: ready,
				reason: tableReason(table),
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

/** One line: the mapping panel already shows the full evidence for every column. */
function tableReason(table: TableCandidate): string {
	const kind = table.source === 'ai' ? 'AI-proposed table' : 'Table';
	const what = `${kind} on ${table.sheet} (${rangeToA1(table.range)})`;
	const primary = table.columns.filter(
		(column): column is ColumnMapping & { field: Field } =>
			column.field !== null && PRIMARY_FIELDS.includes(column.field)
	);
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
				suggested: 'exclude-row',
				auto: false,
				reason: `${[...messages].join('; ')}. The file does not say which identifier is right, so excluding the row is suggested.`
			});
			// prefer-*: T4 kept the chosen identifiers and rejected the others, leaving a warning that the
			// choice settles. Had T4 not applied the choice, its error would remain and keep them out.
			if (chosen === null) conflicted.forEach((entry) => hold(entry, 'pending'));
			if (chosen === 'exclude-row') conflicted.forEach((entry) => hold(entry));
			if (chosen === 'prefer-nsn' || chosen === 'prefer-niin-fsc') {
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
