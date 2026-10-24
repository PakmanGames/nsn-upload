/**
 * One template per IssueCode. An issue belongs to one record, and the provenance drawer and the Rows preview
 * show it under that record's sheet and row, so "this row" and bare cell refs are enough; other records are
 * named with their sheet only when it differs.
 */
import { PRIMARY_FIELDS, type CandidateRecord, type Field, type Issue, type IssueCode } from '../model';
import { isPlausiblePart } from '../identifiers';
import { toA1 } from '../refs';
import { splitField, type Context, type Draft } from './context';
import { ambiguousRow, columnDoubt, differences, identifierConflict, rejectedValue, type Text } from './shared';
import { aNoun, bareRef, capitalize, joinList, noun, ordinal } from './text';

type Template = (d: Draft, issue: Issue, record: CandidateRecord, ctx: Context) => Text;

/** How `other` is named from `self`'s point of view: "row 22", or "Sheet2 row 5" on another sheet. */
const place = (d: Draft, other: CandidateRecord, self: CandidateRecord) => d.record(other, { sheet: other.sheet !== self.sheet });

const invalidIdentifier: Template = (d, issue, record) => {
	const field = issue.field;
	if (field && record.rejected[field]) return rejectedValue(d, record, field);
	return { headline: 'A value here is not valid', body: 'This value is not used.' };
};

const missingPrimary: Template = (d, _issue, record, ctx) => {
	const table = ctx.table(record.tableId);
	const cells = (table?.columns ?? []).flatMap((column) =>
		column.field && PRIMARY_FIELDS.includes(column.field)
			? [{ field: column.field, cell: d.fact(`${capitalize(noun(column.field))} cell`, toA1(record.sourceRow, column.col)) }]
			: []
	);
	const empty = cells.filter(({ field }) => !record.rejected[field]).map(({ field, cell }) => `the ${noun(field)} cell ${cell}`);
	const bad = cells
		.filter(({ field }) => record.rejected[field])
		.map(({ field, cell }) => `the ${noun(field)} in ${cell} (${d.value(capitalize(noun(field)), field, record.rejected[field]!.original, cell)})`);
	const isAre = (items: string[]) => (items.length === 1 ? 'is' : 'are');
	const needs = 'A record needs a part number, NSN, or NIIN';
	return {
		headline: 'No part number, NSN, or NIIN in this row',
		body: bad.length
			? `${needs}. ${capitalize(joinList(bad))} ${isAre(bad)} not valid${empty.length ? `, and ${joinList(empty)} ${isAre(empty)} empty` : ''}.`
			: empty.length
				? `${needs}, and ${joinList(empty)} ${isAre(empty)} empty.`
				: `${needs}.`
	};
};

const duplicate: Template = (d, issue, record, ctx) => {
	const [other] = ctx.records(issue.relatedRecords ?? []);
	if (!other) return { headline: 'This row repeats another one', body: 'Another record lists the same item.' };
	const exact = ctx
		.decisionsOf(record)
		.some((decision) => decision.kind === 'drop-duplicate' && decision.recordIds.includes(other.id));
	if (exact && record.split && other.split?.cell === record.split.cell && other.sourceRow === record.sourceRow) {
		const field = splitField(record) ?? 'nsn';
		const value = record.fields[field];
		return {
			headline: `${record.split.cell} lists the same ${noun(field)} twice`,
			body: `This is the same ${noun(field)} as the ${ordinal(other.split.index)} one${
				value ? `, ${d.value(capitalize(noun(field)), field, value.value, record.split.cell)}` : ''
			}.`
		};
	}
	const label = place(d, other, record);
	if (exact) {
		return { headline: `Repeats ${label}`, body: `This row and ${label} both list ${d.identity(record)}, with every other value the same.` };
	}
	return {
		headline: `Same item as ${label}`,
		body: `${capitalize(label)} also lists ${d.identity(record)}, and the other values agree or are blank in one of them.`
	};
};

const inStorage: Template = (d, issue, record, ctx) => {
	const identity = capitalize(d.identity(record));
	const field = issue.field;
	const value = field && record.fields[field];
	if (!field || !value) {
		return {
			headline: 'Already in your saved mappings',
			body: `${identity} is already saved, and nothing in this row disagrees with the saved record.`
		};
	}
	const decision = ctx.decisionsOf(record).find((candidate) => candidate.kind === 'resolve-storage-conflict');
	const saved = [...new Set(ctx.saved(decision?.existingIds).flatMap((mapping) => mapping[field as 'description' | 'cage'] ?? []))];
	const cell = value.provenance.cell;
	const shown = d.value(capitalize(noun(field)), field, value.value, cell);
	return {
		headline: `Your saved record has a different ${noun(field)}`,
		body: saved.length
			? `${identity} is already saved with the ${noun(field)} ${joinList(saved.map((other) => d.value(`Saved ${noun(field)}`, field, other)))}, but ${cell} says ${shown}.`
			: `${identity} is already saved, with a different ${noun(field)} than ${shown} in ${cell}.`
	};
};

const conflict: Template = (d, issue, record, ctx) => {
	const others = ctx.records(issue.relatedRecords ?? []);
	// Without related records, the conflict is inside the row: its NSN disagrees with its own FSC or NIIN.
	if (others.length === 0 || !issue.field) {
		const only = issue.field === 'fsc' || issue.field === 'niin' ? issue.field : undefined;
		return identifierConflict(d, [record], ctx, only);
	}
	const field = issue.field;
	const elsewhere = others.some((other) => other.sheet !== record.sheet);
	const where = (other: CandidateRecord, cell: string) =>
		other === record ? (elsewhere ? 'this row' : cell) : other.sheet !== record.sheet ? place(d, other, record) : cell;
	const all = [record, ...others];
	return {
		headline:
			others.length > 1
				? `${others.length} other rows have a different ${noun(field)}`
				: elsewhere
					? `Another sheet has a different ${noun(field)}`
					: `${capitalize(place(d, others[0], record))} has a different ${noun(field)}`,
		body: `${all.length === 2 ? 'Both' : `All ${all.length}`} list ${d.identity(record)}, but ${differences(d, all, [field], where)}.`
	};
};

const ambiguous: Template = (d, _issue, record) => ambiguousRow(d, record);

const lowConfidence: Template = (d, issue, record, ctx) => {
	const column = ctx.table(record.tableId)?.columns.find((candidate) => candidate.field === issue.field);
	const doubt = column?.field ? columnDoubt(d, { ...column, field: column.field }) : null;
	return doubt ?? { headline: 'A column here is an uncertain match', body: 'The importer is not sure this column holds what it was mapped to.' };
};

const splitFromCell: Template = (d, issue, record) => {
	const split = record.split;
	const field = issue.field ?? splitField(record);
	if (!split || !field) return { headline: 'One of several values in a cell', body: 'This cell lists several values on separate lines.' };
	const value = record.fields[field];
	const nouns = noun(field, split.total);
	return {
		headline: `${capitalize(ordinal(split.index))} of ${split.total} ${nouns} in ${split.cell}`,
		body: `${split.cell} lists ${split.total} ${nouns} on separate lines, and each gets its own record${
			value ? `; this one is ${d.value(capitalize(noun(field)), field, value.value, split.cell)}` : ''
		}.`
	};
};

const fscMismatch: Template = (d, issue, record, ctx) => {
	const nsn = record.fields.nsn?.value ?? '';
	const niin = d.fact('NIIN', nsn.slice(4));
	const fsc = d.fact('FSC here', nsn.slice(0, 4));
	// Other FSCs in order of appearance, each with the rows that list the item under it.
	const byFsc = new Map<string, string[]>();
	for (const other of ctx.records(issue.relatedRecords ?? [])) {
		const otherFsc = other.fields.nsn?.value.slice(0, 4);
		if (!otherFsc || otherFsc === nsn.slice(0, 4)) continue;
		byFsc.set(otherFsc, [...(byFsc.get(otherFsc) ?? []), place(d, other, record)]);
	}
	const elsewhere = [...byFsc].map(([other, rows]) => `${d.fact('Other FSC', other)} in ${joinList([...new Set(rows)])}`);
	const fscs = byFsc.size + 1;
	return {
		headline: `This item is listed under ${fscs} different FSCs`,
		body: `NIIN ${niin} has FSC ${fsc} here, but ${joinList(elsewhere)}. An item has one FSC at a time, so ${
			fscs === 2 ? 'one of these NSNs is' : `${fscs - 1} of these NSNs are`
		} probably out of date or mistyped.`
	};
};

/** Why a part value is implausible, in the order the check rejects it. */
function implausible(value: string): string {
	if (!/\d/.test(value)) return 'has no digits';
	if (value.length > 40) return 'is longer than a part number usually is';
	return 'reads like a date, a link, or a note rather than a part number';
}

/**
 * The situations normalization warns about for a field, in the order it adds the warnings, so the n-th
 * suspicious-value issue on a field is explained by the n-th situation without reading its message.
 */
function suspicions(d: Draft, record: CandidateRecord, field: Field): Text[] {
	const value = record.fields[field];
	if (!value) return [];
	const { cell, transforms, original } = value.provenance;
	const shown = () => d.value(capitalize(noun(field)), field, value.value, cell);
	const found: Text[] = [];
	if (field === 'part') {
		if (transforms.includes('numeric-to-text')) {
			found.push({
				headline: 'Part number stored as a number',
				body: `Excel stored ${cell} as a number, so leading zeros in the part number may have been lost.`
			});
		}
		if (value.value.includes('\n')) {
			found.push({
				headline: `${cell} has several lines, read as one part number`,
				body: `Not every line of ${cell} looks like a part number, so the cell is kept as one value.`
			});
		} else if (!isPlausiblePart(value.value)) {
			found.push({ headline: "This doesn't look like a part number", body: `${cell} holds ${shown()}, which ${implausible(value.value)}.` });
		}
		if (/\(.*\)/.test(value.value)) {
			found.push({
				headline: 'Part number has a note in brackets',
				body: `${shown()} in ${cell} includes text in brackets; it is kept exactly as written.`
			});
		}
	}
	if ((field === 'niin' || field === 'cage') && transforms.includes('restore-leading-zeros')) {
		const number = d.fact('Number Excel stored', original.trim(), cell);
		found.push({
			headline: `Leading zeros added back to the ${noun(field)}`,
			body: `Excel stored ${cell} as the number ${number}, which drops leading zeros; the ${noun(field)} reads ${shown()}.`
		});
	}
	return found;
}

const suspicious: Template = (d, issue, record) => {
	const field = issue.field;
	const same = record.issues.filter((other) => other.code === 'suspicious-value' && other.field === field);
	const found = field ? suspicions(d, record, field) : [];
	const text = found[same.indexOf(issue)] ?? (same.length === 1 ? found[0] : undefined);
	if (text) return text;
	const cell = bareRef(issue.cells[0] ?? '');
	return { headline: 'This value looks unusual', body: cell ? `${d.fact('Cell', cell, cell)} is kept as written; check it.` : 'It is kept as written; check it.' };
};

const missingOptional: Template = (d, issue) => {
	const field = issue.field ?? 'description';
	const cell = bareRef(issue.cells[0] ?? '');
	if (cell) d.fact(`${capitalize(noun(field))} cell`, cell, cell);
	return { headline: `No ${noun(field)} in this row`, body: `${cell ? `${cell} is empty` : 'The cell is empty'}; ${aNoun(field)} is optional.` };
};

export const ISSUE_TEMPLATES: Record<IssueCode, Template> = {
	'invalid-identifier': invalidIdentifier,
	'missing-primary-identifier': missingPrimary,
	'duplicate-in-table': duplicate,
	'duplicate-across-sheets': duplicate,
	'duplicate-in-storage': inStorage,
	conflict,
	'ambiguous-multi-value': ambiguous,
	'low-confidence-mapping': lowConfidence,
	'split-from-multi-value': splitFromCell,
	'fsc-niin-mismatch': fscMismatch,
	'suspicious-value': suspicious,
	'missing-optional': missingOptional
};
