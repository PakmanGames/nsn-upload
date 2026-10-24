/**
 * Duplicate and conflict detection among the records still headed for import, then against the
 * mappings already in storage.
 *
 * Records are grouped by identity key through a Map, so the cost is linear in records plus the size
 * of each identity group, which is small in practice.
 */
import { FIELDS, type Field, type MappingInput } from '../model';
import { stripSeparators } from '../identifiers';
import type { DecisionLog } from './decisions';
import {
	FIELD_LABELS,
	capitalize,
	describeIdentity,
	fieldCells,
	groupBy,
	hold,
	identityCells,
	identityKey,
	isCandidate,
	joinList,
	loose,
	recordKey,
	rowLabel,
	rowLabels,
	type Entry
} from './entry';

/** In-file duplicates. Entries arrive in workbook order, so the first of a group is the earliest. */
export function decideDuplicates(log: DecisionLog, entries: Entry[]): void {
	const groups = groupBy(entries.filter(isCandidate), (entry) => recordKey(entry.record));
	for (const group of groups.values()) {
		for (const component of splitByCage(group)) {
			if (component.length > 1) settle(log, component);
		}
	}
}

/**
 * Different CAGE codes mean different manufacturers, so they split a group, but only when both
 * records have one. A record without CAGE matches any CAGE and keeps the group together; if the group
 * then holds two CAGE codes, they surface as a conflict.
 */
function splitByCage(group: Entry[]): Entry[][] {
	if (group.some(({ record }) => !record.fields.cage)) return [group];
	return [...groupBy(group, ({ record }) => loose(record.fields.cage!.value)).values()];
}

function settle(log: DecisionLog, component: Entry[]): void {
	// Exact copies inside one table are dropped first; whatever is left is merged or in conflict.
	const remaining: Entry[] = [];
	for (const entry of component) {
		const original = remaining.find(
			(other) => other.record.tableId === entry.record.tableId && identical(other, entry)
		);
		if (original) dropCopy(log, original, entry);
		else remaining.push(entry);
	}
	if (remaining.length < 2) return;
	const differing = differingFields(remaining);
	if (differing.length === 0) merge(log, remaining);
	else resolveConflict(log, remaining, differing);
}

function dropCopy(log: DecisionLog, original: Entry, copy: Entry): void {
	const { chosen } = log.decide({
		kind: 'drop-duplicate',
		subject: subjectOf([original, copy]),
		tableId: copy.record.tableId,
		recordIds: [original.record.id, copy.record.id],
		cells: [...identityCells(original.record), ...identityCells(copy.record)],
		suggested: 'drop',
		auto: true,
		reason: `${rowLabel(copy.record)} repeats ${rowLabel(original.record)} with the same values.`,
		at: at(copy)
	});
	copy.record.issues.push({
		code: 'duplicate-in-table',
		severity: 'warning',
		message: `Same values as ${rowLabel(original.record)} in this table.`,
		cells: identityCells(original.record),
		relatedRecords: [original.record.id]
	});
	if (chosen === 'drop') hold(copy, 'duplicate');
}

/** Same identity, every field equal or missing on one side: fold the later records into the first. */
function merge(log: DecisionLog, entries: Entry[]): void {
	const [primary, ...others] = entries;
	const { chosen } = log.decide({
		kind: 'merge-duplicates',
		subject: subjectOf(entries),
		tableId: sharedTable(entries),
		recordIds: entries.map(({ record }) => record.id),
		cells: entries.flatMap(({ record }) => identityCells(record)),
		suggested: 'merge',
		auto: true,
		reason: `${rowLabels(entries)} describe the same ${describeIdentity(
			primary.record
		)}, and their other fields agree or are missing on one side.`,
		at: at(primary)
	});
	for (const other of others) {
		other.record.issues.push({
			code:
				other.record.tableId === primary.record.tableId
					? 'duplicate-in-table'
					: 'duplicate-across-sheets',
			severity: 'warning',
			message: `Same ${describeIdentity(other.record)} as ${rowLabel(primary.record)}.`,
			cells: identityCells(primary.record),
			relatedRecords: [primary.record.id]
		});
	}
	if (chosen === 'merge') fold(primary, others);
}

/** Same identity but different descriptions or CAGE codes: neither source wins without the user. */
function resolveConflict(log: DecisionLog, entries: Entry[], differing: Field[]): void {
	// Strict comparison keeps the earliest record on a tie.
	const best = entries.reduce((a, b) => (filledCount(b) > filledCount(a) ? b : a));
	const { chosen } = log.decide({
		kind: 'resolve-conflict',
		subject: subjectOf(entries),
		tableId: sharedTable(entries),
		recordIds: entries.map(({ record }) => record.id),
		cells: differing.flatMap((field) => entries.flatMap(({ record }) => fieldCells(record, field))),
		extraOptions: entries.map(({ record }) => ({
			id: `prefer:${record.id}`,
			label: `Use ${rowLabel(record)}`
		})),
		suggested: `prefer:${best.record.id}`,
		auto: false,
		reason: `${rowLabels(entries)} describe the same ${describeIdentity(
			best.record
		)} but disagree on ${joinList(differing.map((field) => FIELD_LABELS[field]))}. ${rowLabel(
			best.record
		)} has the most filled fields, so it is suggested.`,
		at: at(entries[0])
	});

	for (const field of differing) {
		const holders = entries.filter(({ record }) => record.fields[field]);
		const values = holders.map(
			({ record }) => `"${record.fields[field]!.value}" (${rowLabel(record)})`
		);
		for (const entry of entries) {
			entry.record.issues.push({
				code: 'conflict',
				severity: chosen === null ? 'error' : 'warning',
				field,
				message: `${capitalize(FIELD_LABELS[field])} differs: ${values.join(' vs ')}.`,
				cells: holders.flatMap(({ record }) => fieldCells(record, field)),
				relatedRecords: entries.filter((other) => other !== entry).map(({ record }) => record.id)
			});
		}
	}

	const preferred = entries.find(({ record }) => chosen === `prefer:${record.id}`);
	if (preferred) {
		fold(preferred, entries.filter((entry) => entry !== preferred));
	} else if (chosen === null || chosen === 'exclude-all') {
		entries.forEach((entry) => hold(entry, 'conflict'));
	}
}

/**
 * Gives `target` every field it lacks on which the others agree, each value keeping the provenance
 * of the cell it came from; the others become duplicates folded into it.
 */
function fold(target: Entry, others: Entry[]): void {
	const fields = target.record.fields;
	for (const field of FIELDS) {
		if (fields[field]) continue;
		const values = others.flatMap(({ record }) => record.fields[field] ?? []);
		if (values.length > 0 && values.every((v) => loose(v.value) === loose(values[0].value))) {
			fields[field] = values[0];
		}
	}
	target.record.mergedFrom = [
		...(target.record.mergedFrom ?? []),
		...others.map(({ record }) => record.id)
	];
	others.forEach((other) => hold(other, 'duplicate'));
}

/** Records already saved in the browser are skipped unless the user keeps them. */
export function decideStorage(log: DecisionLog, entries: Entry[], existing: MappingInput[]): void {
	const saved = groupBy(existing, (input) =>
		identityKey({
			part: input.part,
			nsn: input.nsn && stripSeparators(input.nsn),
			niin: input.niin && stripSeparators(input.niin)
		})
	);
	for (const entry of entries) {
		if (!isCandidate(entry)) continue;
		const cage = entry.record.fields.cage?.value;
		const match = saved
			.get(recordKey(entry.record))
			?.some((input) => !cage || !input.cage || loose(input.cage) === loose(cage));
		if (!match) continue;
		const { chosen } = log.decide({
			kind: 'drop-duplicate',
			subject: entry.record.id,
			tableId: entry.record.tableId,
			recordIds: [entry.record.id],
			cells: identityCells(entry.record),
			suggested: 'drop',
			auto: true,
			reason: `${rowLabel(entry.record)} is already in your saved mappings (${describeIdentity(
				entry.record
			)}).`,
			at: at(entry)
		});
		entry.record.issues.push({
			code: 'duplicate-in-storage',
			severity: 'warning',
			message: `Already in your saved mappings (${describeIdentity(entry.record)}).`,
			cells: identityCells(entry.record)
		});
		if (chosen === 'drop') hold(entry, 'duplicate');
	}
}

/** Fields on which at least two of the records hold different values. */
function differingFields(entries: Entry[]): Field[] {
	return FIELDS.filter((field) => {
		const values = entries.flatMap(({ record }) => record.fields[field] ?? []);
		return new Set(values.map((v) => loose(v.value))).size > 1;
	});
}

/** Same fields filled, with equal values. */
const identical = (a: Entry, b: Entry) =>
	differingFields([a, b]).length === 0 &&
	FIELDS.every((field) => !a.record.fields[field] === !b.record.fields[field]);

const filledCount = ({ record }: Entry) =>
	FIELDS.filter((field) => record.fields[field] !== undefined).length;

const subjectOf = (entries: Entry[]) =>
	entries
		.map(({ record }) => record.id)
		.sort()
		.join('+');

function sharedTable(entries: Entry[]): string | undefined {
	const tableId = entries[0].record.tableId;
	return entries.every(({ record }) => record.tableId === tableId) ? tableId : undefined;
}

const at = ({ sheetIndex, record }: Entry): [number, number] => [sheetIndex, record.sourceRow];
