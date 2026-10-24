/**
 * Builds review-window decisions and applies the user's stored choices.
 *
 * Every decision id comes from decisionId(kind, subject), so a choice saved in Overrides.decisions
 * finds its decision again after analyze() re-runs with new overrides.
 */
import {
	DECISION_OPTIONS,
	decisionId,
	type Decision,
	type DecisionKind,
	type DecisionOption
} from '../model';

const OPTION_LABELS: { [K in DecisionKind]: Record<(typeof DECISION_OPTIONS)[K][number], string> } = {
	'include-table': { include: 'Include table', exclude: 'Exclude table' },
	'split-cell': { split: 'Split into separate records', 'keep-as-one': 'Keep as one value' },
	'ambiguous-multi-value': {
		'pair-in-order': 'Pair values in order',
		'keep-as-one': 'Keep as one record',
		exclude: 'Exclude row'
	},
	'import-valid-portion': {
		'import-valid-portion': 'Import the valid fields',
		'exclude-row': 'Exclude row'
	},
	'merge-duplicates': { merge: 'Merge into one record', 'keep-separate': 'Keep separate records' },
	'drop-duplicate': { drop: 'Skip duplicate', keep: 'Import anyway' },
	'resolve-conflict': { 'keep-all': 'Keep all records', 'exclude-all': 'Exclude all records' },
	'resolve-identifier-conflict': {
		'prefer-nsn': 'Keep the NSN',
		'prefer-niin-fsc': 'Keep the NIIN and FSC',
		'exclude-row': 'Exclude row'
	},
	'resolve-storage-conflict': {
		'keep-saved': 'Keep the saved record',
		'replace-saved': 'Replace the saved record',
		'keep-both': 'Keep both records'
	}
};

function fixedOptions(kind: DecisionKind): DecisionOption[] {
	const labels: Record<string, string> = OPTION_LABELS[kind];
	return DECISION_OPTIONS[kind].map((id) => ({ id, label: labels[id] }));
}

export type DecisionDraft = {
	kind: DecisionKind;
	subject: string;
	tableId?: string;
	recordIds: string[];
	existingIds?: string[];
	cells: string[];
	/** Offered before the kind's fixed options, e.g. one `prefer:<id>` per conflicting record. */
	extraOptions?: DecisionOption[];
	/** Fixed options that do not apply to this subject, e.g. pair-in-order when value counts differ. */
	omit?: readonly string[];
	suggested: string;
	/** Certain policies apply the suggestion at once; uncertain ones wait for the user. */
	auto: boolean;
	reason: string;
	/** Sheet index and row where the decision applies, for ordering the review list. */
	at: [sheetIndex: number, row: number];
};

/** Collects decisions while the validation steps run. */
export class DecisionLog {
	private readonly placed: Array<{ decision: Decision; at: [number, number] }> = [];

	constructor(private readonly choices: Readonly<Record<string, string>> = {}) {}

	/** The stored choice for a decision id, valid or not. */
	choice(id: string): string | undefined {
		return this.choices[id];
	}

	/**
	 * Records a decision and returns it with `chosen` already resolved, so the caller applies its effect.
	 * A stored choice that is not among the options (e.g. `prefer:<id>` for a record that left the group
	 * after a remap) is ignored, and the policy applies again.
	 */
	decide(draft: DecisionDraft): Decision {
		const fixed = fixedOptions(draft.kind).filter((option) => !draft.omit?.includes(option.id));
		const options = [...(draft.extraOptions ?? []), ...fixed];
		const id = decisionId(draft.kind, draft.subject);
		const stored = this.choices[id];
		const byUser = options.some((option) => option.id === stored);
		const decision: Decision = {
			id,
			kind: draft.kind,
			state: byUser ? 'user' : draft.auto ? 'auto' : 'pending',
			tableId: draft.tableId,
			recordIds: draft.recordIds,
			existingIds: draft.existingIds,
			cells: draft.cells,
			options,
			chosen: byUser ? stored : draft.auto ? draft.suggested : null,
			suggested: draft.suggested,
			reason: draft.reason
		};
		this.placed.push({ decision, at: draft.at });
		return decision;
	}

	/** Pending decisions first, then the rest; each group in workbook order (sort is stable). */
	sorted(): Decision[] {
		const rank = (decision: Decision) => (decision.state === 'pending' ? 0 : 1);
		return [...this.placed]
			.sort(
				(a, b) =>
					rank(a.decision) - rank(b.decision) || a.at[0] - b.at[0] || a.at[1] - b.at[1]
			)
			.map(({ decision }) => decision);
	}
}
