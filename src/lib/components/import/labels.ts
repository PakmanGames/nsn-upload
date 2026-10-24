/** Display names and badge styles shared by the review window's panels. */
import type {
	CandidateRecord,
	Confidence,
	DecisionKind,
	Field,
	IssueCode,
	SheetStatus,
	SkippedRow,
	Transform
} from '$lib/import/model';

export const FIELD_LABEL: Record<Field, string> = {
	part: 'Part number',
	description: 'Description',
	nsn: 'NSN',
	niin: 'NIIN',
	cage: 'CAGE',
	fsc: 'FSC'
};

export const SHEET_STATUS: Record<SheetStatus, { label: string; style: string }> = {
	ready: { label: 'Ready', style: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
	'needs-review': { label: 'Needs review', style: 'bg-amber-50 text-amber-800 ring-amber-600/25' },
	'no-table': { label: 'No importable table', style: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
	hidden: { label: 'Hidden - ignored', style: 'bg-slate-100 text-slate-500 ring-slate-500/15' }
};

export type RecordFilter = 'all' | CandidateRecord['status'] | 'split';

export const RECORD_STATUS: Record<CandidateRecord['status'], { label: string; style: string }> = {
	valid: { label: 'Valid', style: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
	warning: { label: 'Warning', style: 'bg-amber-50 text-amber-800 ring-amber-600/25' },
	invalid: { label: 'Invalid', style: 'bg-red-50 text-red-700 ring-red-600/20' },
	duplicate: { label: 'Duplicate', style: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
	conflict: { label: 'Conflict', style: 'bg-orange-50 text-orange-800 ring-orange-600/25' },
	pending: { label: 'Pending', style: 'bg-blue-50 text-blue-700 ring-blue-600/20' }
};

/** Summary chips (R2): the record statuses, splits, and records of held-back tables. */
export type ChipTone = 'valid' | 'warning' | 'invalid' | 'duplicate' | 'conflict' | 'split' | 'held';

export const CHIP_STYLE: Record<ChipTone, string> = {
	valid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
	warning: 'bg-amber-50 text-amber-800 ring-amber-600/25',
	invalid: 'bg-red-50 text-red-700 ring-red-600/20',
	duplicate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
	conflict: 'bg-orange-50 text-orange-800 ring-orange-600/25',
	split: 'bg-blue-50 text-blue-700 ring-blue-600/20',
	held: 'bg-slate-100 text-slate-600 ring-slate-500/20'
};

export const CONFIDENCE_STYLE: Record<Confidence, string> = {
	high: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
	medium: 'bg-amber-50 text-amber-800 ring-amber-600/25',
	low: 'bg-slate-100 text-slate-600 ring-slate-500/20'
};

export const ISSUE_LABEL: Record<IssueCode, string> = {
	'invalid-identifier': 'Invalid value',
	'missing-primary-identifier': 'No identifier',
	'duplicate-in-table': 'Duplicate in table',
	'duplicate-across-sheets': 'Duplicate across sheets',
	'duplicate-in-storage': 'Already imported',
	conflict: 'Conflict',
	'ambiguous-multi-value': 'Ambiguous multi-value cell',
	'low-confidence-mapping': 'Low-confidence mapping',
	'split-from-multi-value': 'Split from multi-value cell',
	'fsc-niin-mismatch': 'Same item under different NSNs',
	'suspicious-value': 'Check value',
	'missing-optional': 'Missing optional value'
};

/** Group headings for the decisions panel. */
export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
	'include-table': 'Tables',
	'split-cell': 'Multi-value cells',
	'ambiguous-multi-value': 'Ambiguous rows',
	'import-valid-portion': 'Malformed values',
	'merge-duplicates': 'Duplicates across sheets',
	'drop-duplicate': 'Duplicates',
	'resolve-conflict': 'Conflicts',
	'resolve-identifier-conflict': 'Identifier conflicts',
	'resolve-storage-conflict': 'Conflicts with saved records'
};

export const TRANSFORM_LABEL: Record<Transform, string> = {
	trim: 'Trimmed whitespace',
	'normalize-line-endings': 'Normalized line endings',
	'dash-as-empty': 'Dash read as empty',
	'strip-label': 'Removed label',
	'strip-separators': 'Removed separators',
	uppercase: 'Uppercased',
	'numeric-to-text': 'Number read as text',
	'restore-leading-zeros': 'Restored leading zeros',
	'merge-fill': 'Filled from merged cell',
	'split-multi-value': 'Split multi-value cell',
	'derive-niin-from-nsn': 'NIIN derived from NSN',
	'derive-nsn-from-fsc-niin': 'NSN derived from FSC + NIIN'
};

export const SKIP_REASON: Record<SkippedRow['reason'], string> = {
	blank: 'blank',
	hidden: 'hidden',
	'repeated-header': 'repeated header',
	'no-mapped-values': 'values only in ignored columns',
	footer: 'totals or footer row',
	'below-table': 'below the table'
};

export const plural = (n: number, noun: string, many = `${noun}s`) => `${n.toLocaleString()} ${n === 1 ? noun : many}`;
