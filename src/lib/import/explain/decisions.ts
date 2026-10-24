/**
 * One template per DecisionKind. Each explains the situation the decision is about, never the options or the
 * suggestion: the decision card shows those itself, so the same text fits a pending, automatic, or chosen decision.
 */
import type { CandidateRecord, Decision, DecisionKind, Field, TableCandidate } from '../model';
import { colLetter, rangeToA1 } from '../refs';
import { loose, malformed } from '../validate/entry';
import { HIDDEN_SHEET_REASON } from '../validate/rows';
import { Draft, splitField, type Context } from './context';
import {
	ambiguousRow,
	columnDoubt,
	differences,
	differingFields,
	identifierConflict,
	multiLineCells,
	rejectedValue,
	weakestColumn,
	type Text
} from './shared';
import { bareRef, capitalize, count, joinList, noun, shortList } from './text';

type Template = (d: Draft, decision: Decision, records: CandidateRecord[], ctx: Context) => Text;

const spansSheets = (records: CandidateRecord[]) => new Set(records.map((record) => record.sheet)).size > 1;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "part numbers in D, NSNs in E and descriptions in F". */
function columnList(d: Draft, table: TableCandidate): string {
	return joinList(
		table.columns.flatMap((column) => {
			if (!column.field) return [];
			const letter = d.fact(`${capitalize(noun(column.field))} column`, colLetter(column.col));
			return [`${noun(column.field, 2)} in ${letter}`];
		})
	);
}

function includeTable(d: Draft, decision: Decision, _records: CandidateRecord[], ctx: Context): Text {
	const table = ctx.table(decision.tableId);
	if (!table) return { headline: 'A table on this sheet', body: 'The table this decision was about is no longer found.' };
	const range = d.fact('Table range', rangeToA1(table.range));
	const rows = plural(Number(d.fact('Rows', String(table.dataRows.length))), 'row');
	const ai = table.source === 'ai';
	const weakest = weakestColumn(table);
	const doubt = weakest && columnDoubt(d, weakest);

	if (table.status === 'ready') {
		const columns = columnList(d, table);
		// A ready table on a hidden sheet waits only because the sheet is hidden (D26), so that leads.
		const hidden = decision.reason.startsWith(HIDDEN_SHEET_REASON);
		return {
			headline: `A table of ${rows} in ${range}${hidden ? ', on a sheet hidden in Excel' : ''}`,
			body: `${hidden ? 'You asked to include this hidden sheet. ' : ''}${ai ? 'AI proposed this table, and the cells back it up: it has' : 'It has'} ${columns}.${doubt ? ` ${doubt.body}` : ''}`
		};
	}
	if (!weakest) {
		return {
			headline: 'No part number, NSN, or NIIN column',
			body: `Without one of them, the ${rows} in ${range} cannot be told apart.`
		};
	}
	const from = ai ? 'AI proposed this table from a sample of the sheet. ' : '';
	if (doubt) return { headline: doubt.headline, body: `${from}${doubt.body}` };

	// Every identifier column is a clear match, so either another column fits as well or the AI was unsure.
	const field = weakest.field;
	const rivals = table.columns.filter((column) => column.field === null && column.alternatives[0] === field);
	if (rivals.length > 0) {
		const letters = [weakest, ...rivals].map((column) => d.fact(`${capitalize(noun(field))} column`, colLetter(column.col)));
		return {
			headline: `Columns ${joinList(letters)} ${letters.length === 2 ? 'both' : 'all'} look like ${noun(field, 2)}`,
			body: `Their values all fit, so it is not clear which column holds the ${noun(field, 2)}.`
		};
	}
	if (ai) {
		return {
			headline: 'AI found this table but was not sure of it',
			body: 'AI proposed it from a sample of the sheet, and the cells back up its columns, but the AI rated its own answer as uncertain.'
		};
	}
	return { headline: 'This table needs a closer look', body: `The ${rows} in ${range} could not be read with full confidence.` };
}

function splitCell(d: Draft, decision: Decision, records: CandidateRecord[]): Text {
	const first = records[0];
	const cell = bareRef(decision.cells[0] ?? first.split?.cell ?? '');
	const source = multiLineCells(first).find((entry) => entry.cell === cell);
	const field: Field = source?.field ?? splitField(first) ?? 'part';
	const values = (source?.values ?? []).map((value) => d.value(capitalize(noun(field)), field, value, cell));
	const row = d.fact('Row', String(first.sourceRow));
	return {
		headline: `${cell} lists ${count(values.length, field)} on separate lines`,
		body: `They are ${shortList(values)}; the other values in row ${row} go with each one.`
	};
}

function importValidPortion(d: Draft, _decision: Decision, records: CandidateRecord[]): Text {
	const sample = records[0];
	const fields = malformed(sample);
	if (fields.length === 1) return rejectedValue(d, sample, fields[0]);
	const parts = fields.map((field) => {
		const { cell, original } = sample.rejected[field]!;
		return `the ${noun(field)} in ${cell} (${d.value(capitalize(noun(field)), field, original, cell)})`;
	});
	return {
		headline: `${d.record(sample).replace(/^row/, 'Row')} has ${fields.length} values that are not valid`,
		body: `${capitalize(joinList(parts))} are not valid.`
	};
}

function mergeDuplicates(d: Draft, _decision: Decision, records: CandidateRecord[]): Text {
	const sheet = spansSheets(records);
	const rows = joinList(records.map((record) => d.record(record, { sheet })));
	return {
		headline: `The same item is listed ${records.length === 2 ? 'twice' : `${records.length} times`}`,
		body: `${capitalize(rows)} ${records.length === 2 ? 'both' : 'all'} list ${d.identity(records[0])}, and their other values agree or are blank in one of them.`
	};
}

function dropDuplicate(d: Draft, _decision: Decision, records: CandidateRecord[]): Text {
	// A copy of a saved record names one record; a copy inside the file names the original and the copy.
	if (records.length === 1) {
		return {
			headline: 'Already in your saved mappings',
			body: `${capitalize(d.identity(records[0]))} is already saved, and nothing in this row disagrees with the saved record.`
		};
	}
	const [original, copy] = records;
	if (original.split && copy.split && original.split.cell === copy.split.cell && original.sourceRow === copy.sourceRow) {
		const field = splitField(copy) ?? 'nsn';
		const cell = copy.split.cell;
		const value = copy.fields[field];
		return {
			headline: `${cell} lists the same ${noun(field)} twice`,
			body: `${value ? d.value(capitalize(noun(field)), field, value.value, cell) : 'The value'} appears twice in ${cell}.`
		};
	}
	const sheet = spansSheets(records);
	return {
		headline: `${capitalize(d.record(copy, { sheet }))} repeats ${d.record(original, { sheet })}`,
		body: `Both list ${d.identity(copy)}, and every other value is the same.`
	};
}

function resolveConflict(d: Draft, _decision: Decision, records: CandidateRecord[]): Text {
	const sheet = spansSheets(records);
	const fields = differingFields(records).filter((field) => field !== 'part' && field !== 'nsn' && field !== 'niin');
	const disagree = `disagree on the ${joinList(fields.map((field) => noun(field)))}`;
	const headline =
		records.length > 2
			? `${records.length} rows ${disagree}`
			: sheet
				? `The two sheets ${disagree}`
				: `Rows ${joinList(records.map((record) => String(record.sourceRow)))} ${disagree}`;
	// Same sheet: a bare cell is enough. Across sheets, a cell alone would not say which sheet it is on.
	const place = (record: CandidateRecord, cell: string) => (sheet ? d.record(record, { sheet }) : cell);
	if (!sheet) records.forEach((record) => d.record(record));
	return {
		headline,
		body: `${records.length === 2 ? 'Both' : `All ${records.length}`} list ${d.sameIdentity(records[0])}, but ${differences(d, records, fields, place)}.`
	};
}

function resolveIdentifierConflict(d: Draft, _decision: Decision, records: CandidateRecord[], ctx: Context): Text {
	return identifierConflict(d, records, ctx);
}

function resolveStorageConflict(d: Draft, decision: Decision, records: CandidateRecord[], ctx: Context): Text {
	const record = records[0];
	const saved = ctx.saved(decision.existingIds);
	// The same comparison validation uses: a value missing on either side never differs.
	const fields = (['description', 'cage'] as const).filter((field) => {
		const value = record.fields[field]?.value;
		return value && saved.some((mapping) => mapping[field] && loose(mapping[field]!) !== loose(value));
	});
	// The card's heading shows the part number and NSN, so the text refers to them.
	const identity = capitalize(d.sameIdentity(record));
	const verb = record.fields.part && (record.fields.nsn || record.fields.niin) ? 'are' : 'is';
	const headline = `Your saved ${saved.length > 1 ? 'records have' : 'record has'} a different ${joinList(fields.map((field) => noun(field))) || 'value'}`;
	if (fields.length === 0) return { headline, body: `${identity} ${verb} already saved, with different details.` };
	const clauses = fields.map((field) => {
		const value = record.fields[field]!;
		const cell = value.provenance.cell;
		const savedValues = [...new Set(saved.flatMap((mapping) => mapping[field] ?? []))].map((other) =>
			d.value(`Saved ${noun(field)}`, field, other)
		);
		return { field, cell, value: d.value(capitalize(noun(field)), field, value.value, cell), saved: joinList(savedValues) };
	});
	if (clauses.length === 1) {
		const [{ field, cell, value, saved: was }] = clauses;
		return { headline, body: `${identity} ${verb} already saved with the ${noun(field)} ${was}, but ${cell} says ${value}.` };
	}
	const says = clauses.map(({ field, cell, value, saved: was }) => `${cell} says ${value} where the saved ${noun(field)} is ${was}`);
	return { headline, body: `${identity} ${verb} already saved, but ${joinList(says)}.` };
}

function ambiguous(d: Draft, _decision: Decision, records: CandidateRecord[]): Text {
	return ambiguousRow(d, records[0]);
}

export const DECISION_TEMPLATES: Record<DecisionKind, Template> = {
	'include-table': includeTable,
	'split-cell': splitCell,
	'ambiguous-multi-value': ambiguous,
	'import-valid-portion': importValidPortion,
	'merge-duplicates': mergeDuplicates,
	'drop-duplicate': dropDuplicate,
	'resolve-conflict': resolveConflict,
	'resolve-identifier-conflict': resolveIdentifierConflict,
	'resolve-storage-conflict': resolveStorageConflict
};
