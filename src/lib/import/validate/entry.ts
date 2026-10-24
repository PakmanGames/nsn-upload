/**
 * Working state and record helpers shared by the validation steps.
 *
 * finalizeAnalysis copies every input record into an Entry, so the steps can add issues, fold merged
 * fields, and hold records back without mutating what the earlier pipeline stages returned.
 */
import {
	FIELDS,
	PRIMARY_FIELDS,
	type CandidateRecord,
	type Field,
	type Issue,
	type RecordStatus
} from '../model';
import { qualifiedRef } from '../refs';

/** Effective include-table choice: pending tables are held back like excluded ones but still shown. */
export type TableState = 'included' | 'pending' | 'excluded';

export type Entry = {
	record: CandidateRecord;
	/** Workbook position of the record's sheet; with the row it orders records and decisions. */
	sheetIndex: number;
	table: TableState;
	/** Set when a decision keeps the record out of the import. */
	held: boolean;
	/** Status set by a decision; otherwise the status follows from the record's contents. */
	status?: RecordStatus;
};

export const FIELD_LABELS: Record<Field, string> = {
	part: 'part number',
	description: 'description',
	nsn: 'NSN',
	niin: 'NIIN',
	cage: 'CAGE',
	fsc: 'FSC'
};

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
	if (items.length < 2) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const rowLabels = (entries: Entry[]) => joinList(entries.map(({ record }) => rowLabel(record)));

export const hasPrimary = (record: CandidateRecord) =>
	PRIMARY_FIELDS.some((field) => record.fields[field] !== undefined);

/** Status implied by the record alone, before any duplicate, conflict, or pending decision. */
export function contentStatus(record: CandidateRecord): RecordStatus {
	if (!hasPrimary(record)) return 'invalid';
	// An NSN that disagrees with the row's own NIIN or FSC: nothing says which value is right.
	if (record.issues.some((issue) => issue.code === 'conflict' && issue.severity === 'error')) {
		return 'conflict';
	}
	const flagged =
		malformed(record).length > 0 || record.issues.some((issue) => issue.severity !== 'info');
	return flagged ? 'warning' : 'valid';
}

/**
 * T4's NSN-vs-NIIN/FSC conflict. decideRows runs before the duplicate checks add their own `conflict`
 * issues, so every one it sees came from the row itself.
 */
export const isIdentifierConflict = (issue: Issue) => issue.code === 'conflict';

/** Rejected fields, except cells an identifier-conflict choice rejected; that decision covers them. */
export function malformed(record: CandidateRecord): Field[] {
	const covered = new Set(
		record.issues.filter(isIdentifierConflict).flatMap((issue) => issue.cells)
	);
	return FIELDS.filter((field) => {
		const rejected = record.rejected[field];
		return rejected !== undefined && !covered.has(qualifiedRef(record.sheet, rejected.cell));
	});
}

/** Still headed for import: in an included table, not held back, and importable on its own. */
export function isCandidate(entry: Entry): boolean {
	if (entry.table !== 'included' || entry.held) return false;
	const status = contentStatus(entry.record);
	return status === 'valid' || status === 'warning';
}

export function hold(entry: Entry, status?: RecordStatus): void {
	entry.held = true;
	if (status) entry.status = status;
}

/**
 * A conflict the user settled no longer makes the records it approves warnings; its issues stay as
 * notes. Replaces the issue objects, since the input records share them.
 */
export function settle(entry: Entry, settled: (issue: Issue) => boolean): void {
	entry.record.issues = entry.record.issues.map((issue) =>
		settled(issue) ? { ...issue, severity: 'info' } : issue
	);
}

/** Equality used for duplicates: ignores case, surrounding whitespace, and runs of inner whitespace. */
export const loose = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Identity of a mapping: part plus NSN, or plus NIIN when there is no NSN.
 * One part with several NSNs therefore has several identities and is never a duplicate of itself.
 */
export function identityKey(ids: { part?: string; nsn?: string; niin?: string }): string {
	const stock = ids.nsn ? ids.nsn : ids.niin ? `niin:${ids.niin}` : '';
	return `${ids.part ? loose(ids.part) : ''}|${stock}`;
}

export const recordKey = ({ fields }: CandidateRecord) =>
	identityKey({ part: fields.part?.value, nsn: fields.nsn?.value, niin: fields.niin?.value });

/** E.g. "part 10931023*92 and NSN 5305016582565", for messages. */
export function describeIdentity({ fields }: CandidateRecord): string {
	const parts = [fields.part && `part ${fields.part.value}`];
	parts.push(fields.nsn ? `NSN ${fields.nsn.value}` : fields.niin && `NIIN ${fields.niin.value}`);
	return parts.filter(Boolean).join(' and ');
}

/** E.g. "Active Parts row 136 (value 2 of 2)". */
export function rowLabel(record: CandidateRecord): string {
	const split = record.split ? ` (value ${record.split.index} of ${record.split.total})` : '';
	return `${record.sheet} row ${record.sourceRow}${split}`;
}

/** Qualified refs of the cells a field's value came from; derived values point at their inputs. */
export function fieldCells(record: CandidateRecord, field: Field): string[] {
	const provenance = record.fields[field]?.provenance;
	if (!provenance) return [];
	const refs =
		provenance.origin === 'derived' ? (provenance.derivedFrom ?? []) : [provenance.cell];
	return refs.map((ref) => qualifiedRef(provenance.sheet, ref));
}

export const identityCells = (record: CandidateRecord) => [
	...fieldCells(record, 'part'),
	...fieldCells(record, record.fields.nsn ? 'nsn' : 'niin')
];

export function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = groups.get(k);
		if (group) group.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}
