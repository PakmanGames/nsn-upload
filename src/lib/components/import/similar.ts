/**
 * Which pending decisions are "similar" to the one on the decision stage, so one choice can settle them all.
 *
 * Similar means pending, the same kind, the same table, and the same shape:
 *
 * | Kind | Same shape |
 * | --- | --- |
 * | resolve-identifier-conflict | the same fields disagree with the NSN (FSC, NIIN, or both) |
 * | split-cell, ambiguous-multi-value, import-valid-portion | the same column |
 * | resolve-conflict, merge-duplicates, drop-duplicate, resolve-storage-conflict | the same fields differ |
 * | include-table | any other pending table |
 *
 * A choice spreads only to decisions that offer the same option, so a record-specific choice such as
 * `prefer:<recordId>` never spreads. Pure, so the rule is tested without rendering.
 */
import { FIELDS, type CandidateRecord, type Decision, type DecisionKind, type Field } from '$lib/import/model';
import { qualifiedRef } from '$lib/import/refs';
import { FIELD_LABEL, plural } from './labels';

type Records = Map<string, CandidateRecord>;

/** Pending decisions other than `current` that `option` settles the same way, in the order given. */
export function similarDecisions(current: Decision, option: string, decisions: Decision[], records: Records): Decision[] {
	const key = groupKey(current, records);
	return decisions.filter(
		(decision) =>
			decision.id !== current.id &&
			decision.state === 'pending' &&
			decision.options.some(({ id }) => id === option) &&
			groupKey(decision, records) === key
	);
}

/**
 * The fields a decision is about, in a fixed order: the fields that disagree with the NSN, the column's field,
 * or the fields that differ. Empty for kinds without a shape (include-table) and for exact duplicates.
 */
export function shapeOf(decision: Decision, records: Records): Field[] {
	const own = decision.recordIds.flatMap((id) => records.get(id) ?? []);
	switch (decision.kind) {
		case 'resolve-identifier-conflict':
			return namedFields(decision, own).filter((field) => field !== 'nsn');
		case 'split-cell':
		case 'ambiguous-multi-value':
			// One table maps each column to one field, so the field stands for the column.
			return namedFields(decision, own);
		case 'import-valid-portion':
			// Only the rejected values count: a part number pasted into the NSN column (WOW E134) also names
			// the part cell it matches.
			return namedFields(decision, own, (record, field) => record.rejected[field]?.cell);
		case 'resolve-storage-conflict': {
			// The saved side is not among the records; the issues name each field that differs from it.
			const differing = new Set(
				own.flatMap((record) =>
					record.issues.flatMap((issue) => (issue.code === 'duplicate-in-storage' && issue.field ? [issue.field] : []))
				)
			);
			return FIELDS.filter((field) => differing.has(field));
		}
		case 'resolve-conflict':
		case 'merge-duplicates':
		case 'drop-duplicate':
			return FIELDS.filter((field) => {
				const values = own.flatMap((record) => record.fields[field]?.value ?? []);
				return new Set(values.map(loose)).size > 1;
			});
		case 'include-table':
			return [];
	}
}

/**
 * "11 other rows where the NSN disagrees with the FSC": `count` decisions shaped like `decision`, for the
 * "Also apply" label (with `other`) and for a group's line in the list of decisions made.
 */
export function describeGroup(decision: Decision, count: number, records: Records, other = false): string {
	const fields = shapeOf(decision, records);
	const names = joinAnd(fields.map(fieldName));
	const many = joinAnd(fields.map((field) => `${fieldName(field)}s`));
	const n = (noun: string) => (other ? plural(count, `other ${noun}`) : plural(count, noun));
	const nouns: Record<DecisionKind, string> = {
		'resolve-identifier-conflict': `${n('row')} where the NSN disagrees with the ${names}`,
		'split-cell': `${n('row')} with several ${many} in one cell`,
		'ambiguous-multi-value': `${n('row')} with several ${many} on separate lines`,
		'import-valid-portion': `${n('row')} with a malformed ${names}`,
		'resolve-conflict': `${n('conflict')} where the ${names} ${fields.length === 1 ? 'differs' : 'differ'}`,
		'merge-duplicates': n('duplicate'),
		'drop-duplicate': n('duplicate'),
		'resolve-storage-conflict': `${n('row')} already saved with a different ${names}`,
		'include-table': `${n('table')} that ${count === 1 ? 'needs' : 'need'} review`
	};
	return nouns[decision.kind];
}

/** Table identity: the decision's table, or every table its records come from when it spans sheets. */
function groupKey(decision: Decision, records: Records): string {
	if (decision.kind === 'include-table') return decision.kind;
	const tables = decision.tableId
		? [decision.tableId]
		: [...new Set(decision.recordIds.flatMap((id) => records.get(id)?.tableId ?? []))].sort();
	return JSON.stringify([decision.kind, tables, shapeOf(decision, records)]);
}

type CellOf = (record: CandidateRecord, field: Field) => string | undefined;

/**
 * The cell a field's value came from. A value ruled against still names its cell in `rejected`; a derived
 * value points at the cell it was worked out from, so it names none of its own.
 */
const sourceCell: CellOf = (record, field) => {
	const value = record.fields[field];
	return value?.provenance.origin === 'source' ? value.provenance.cell : record.rejected[field]?.cell;
};

/** Fields whose cell, as `cellOf` finds it, is one the decision names. */
function namedFields(decision: Decision, own: CandidateRecord[], cellOf: CellOf = sourceCell): Field[] {
	const cells = new Set(decision.cells);
	return FIELDS.filter((field) =>
		own.some((record) => {
			const cell = cellOf(record, field);
			return cell !== undefined && cells.has(qualifiedRef(record.sheet, cell));
		})
	);
}

const fieldName = (field: Field) => (field === 'part' || field === 'description' ? FIELD_LABEL[field].toLowerCase() : FIELD_LABEL[field]);

/** Same comparison the validation stage uses: case and whitespace do not make values differ. */
const loose = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const joinAnd = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
