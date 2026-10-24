/**
 * Same NIIN under different FSCs (PLAN.md D4): every record involved is imported and flagged, because
 * either the FSC changed over time or one listing is wrong, and only the user can tell which.
 */
import type { CandidateRecord } from '../model';
import { fieldCells, groupBy, isCandidate, joinList, type Entry } from './entry';

/** An NSN is FSC (4 digits) + NIIN (9 digits); derived NSNs count too. */
export function flagFscMismatches(entries: Entry[]): void {
	const withNsn = entries.filter((entry) => isCandidate(entry) && entry.record.fields.nsn);
	for (const [niin, group] of groupBy(withNsn, ({ record }) => record.fields.nsn!.value.slice(4))) {
		// FSCs in order of first appearance, each with the records listed under it.
		const fscs = groupBy(group, fscOf);
		if (fscs.size < 2) continue;
		for (const entry of group) {
			const related = group.filter((other) => fscOf(other) !== fscOf(entry));
			const listed = [...fscs]
				.map(([fsc, holders]) => {
					const places = new Set(holders.map(({ record }) => place(record, entry.record)));
					return `${fsc} (${joinList([...places])})`;
				})
				.join(', ');
			entry.record.issues.push({
				code: 'fsc-niin-mismatch',
				severity: 'warning',
				field: 'nsn',
				message: `NIIN ${niin} (one catalog item) appears with ${fscs.size} FSCs in this upload: ${listed}. An item has one FSC at a time, so at most one of these NSNs is current; the others are probably outdated or mistyped. All are imported; verify before use.`,
				cells: [entry, ...related].flatMap(({ record }) => fieldCells(record, 'nsn')),
				relatedRecords: related.map(({ record }) => record.id)
			});
		}
	}
}

const fscOf = ({ record }: Entry) => record.fields.nsn!.value.slice(0, 4);

/** Where `other` sits, seen from `self`: "this row", "row 37", or "Other Sheet row 37". */
function place(other: CandidateRecord, self: CandidateRecord): string {
	if (other.sheet !== self.sheet) return `${other.sheet} row ${other.sourceRow}`;
	return other.sourceRow === self.sourceRow ? 'this row' : `row ${other.sourceRow}`;
}
