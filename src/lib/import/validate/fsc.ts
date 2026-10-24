/**
 * Same NIIN under different FSCs (PLAN.md D4): every record involved is imported and flagged, because
 * either the FSC changed over time or one listing is wrong, and only the user can tell which.
 */
import { fieldCells, groupBy, isCandidate, rowLabel, type Entry } from './entry';

/** An NSN is FSC (4 digits) + NIIN (9 digits); derived NSNs count too. */
export function flagFscMismatches(entries: Entry[]): void {
	const withNsn = entries.filter((entry) => isCandidate(entry) && entry.record.fields.nsn);
	for (const [niin, group] of groupBy(withNsn, ({ record }) => record.fields.nsn!.value.slice(4))) {
		for (const entry of group) {
			const fsc = fscOf(entry);
			const related = group.filter((other) => fscOf(other) !== fsc);
			if (related.length === 0) continue;
			const listed = related.map((other) => `FSC ${fscOf(other)} in ${rowLabel(other.record)}`);
			entry.record.issues.push({
				code: 'fsc-niin-mismatch',
				severity: 'warning',
				field: 'nsn',
				message: `NIIN ${niin} also appears under ${listed.join(', ')}.`,
				cells: [entry, ...related].flatMap(({ record }) => fieldCells(record, 'nsn')),
				relatedRecords: related.map(({ record }) => record.id)
			});
		}
	}
}

const fscOf = ({ record }: Entry) => record.fields.nsn!.value.slice(0, 4);
