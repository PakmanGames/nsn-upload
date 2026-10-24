/**
 * Shared contracts for the NSN import pipeline.
 *
 * Frozen once T0 merges: parallel tasks code against these types, so changes go through the coordinator.
 * Rows and columns are 1-based Excel coordinates everywhere, so provenance matches what users see in Excel.
 */
import type { MappingInput } from '../types';

/* ---------- Reader output (T1) ---------- */

export type CellKind = 'text' | 'number' | 'date' | 'boolean' | 'error' | 'empty';

export type Cell = {
	/** A1 reference without the sheet name, e.g. "D136". */
	ref: string;
	row: number;
	col: number;
	kind: CellKind;
	/**
	 * What the user sees, with CRLF and CR normalized to LF.
	 * Integers are rendered exactly, never in exponent form. Empty string for empty and error cells.
	 */
	text: string;
	/** Underlying value: string, number (dates as Excel serials), boolean, or an error code such as "#N/A". */
	raw: string | number | boolean | null;
	numFmt?: string;
	/** Formula source when present. Only the cached result is used; formulas are never evaluated. */
	formula?: string;
	/** On cells covered by a merge (not its top-left cell): the master cell ref. text and raw are copied from it. */
	mergedFrom?: string;
};

export type CellRange = { top: number; left: number; bottom: number; right: number };

export type SheetVisibility = 'visible' | 'hidden' | 'veryHidden';

export type SheetModel = {
	name: string;
	/** 0-based position in workbook order. */
	index: number;
	visibility: SheetVisibility;
	/** Bounding box of non-empty cells; styled empty cells never extend it. Null when the sheet has no values. */
	valueExtent: CellRange | null;
	/** Never undefined: coordinates without a stored cell return an empty Cell. */
	cell(row: number, col: number): Cell;
	merges: CellRange[];
	hiddenRows: ReadonlySet<number>;
	/** Includes zero-width columns, which system exports use to hide metadata columns. */
	hiddenCols: ReadonlySet<number>;
};

export type WorkbookModel = { fileName: string; sheets: SheetModel[] };

export type ReadLimits = {
	maxFileBytes: number;
	/** Sum of the uncompressed sizes in the zip's central directory: the zip-bomb guard. */
	maxUncompressedBytes: number;
	maxSheets: number;
	maxRowsPerSheet: number;
	maxCells: number;
};

export const DEFAULT_READ_LIMITS: ReadLimits = {
	maxFileBytes: 20 * 1024 * 1024,
	// A workbook at the 2,000,000-cell limit unzips to about 90 MB; zip bombs expand 100x or more.
	maxUncompressedBytes: 200 * 1024 * 1024,
	maxSheets: 50,
	maxRowsPerSheet: 100_000,
	maxCells: 2_000_000
};

export type ReadErrorCode =
	| 'not-xlsx'
	| 'too-large'
	| 'too-many-sheets'
	| 'too-many-rows'
	| 'too-many-cells'
	| 'encrypted'
	| 'corrupt';

/** Thrown by readWorkbook(); the UI shows the message and can branch on the code. */
export class WorkbookReadError extends Error {
	readonly code: ReadErrorCode;
	constructor(code: ReadErrorCode, message: string) {
		super(message);
		this.name = 'WorkbookReadError';
		this.code = code;
	}
}

/* ---------- Structure (T3) ---------- */

export type Field = 'part' | 'description' | 'nsn' | 'niin' | 'cage' | 'fsc';
export const FIELDS: readonly Field[] = ['part', 'description', 'nsn', 'niin', 'cage', 'fsc'];
/** A record needs at least one valid value in one of these. */
export const PRIMARY_FIELDS: readonly Field[] = ['part', 'nsn', 'niin'];

export type Confidence = 'high' | 'medium' | 'low';
export type SheetStatus = 'ready' | 'needs-review' | 'no-table' | 'hidden';

export type ColumnMapping = {
	col: number;
	/** Header text as found, joined across header rows with a space. */
	header: string;
	/** Null means the column is not imported. */
	field: Field | null;
	confidence: Confidence;
	/** Human-readable evidence, e.g. "header matches NSN", "127 of 129 values are valid NSNs". */
	reasons: string[];
	/** Other plausible fields for this column, best first. */
	alternatives: Field[];
	/** Share of non-empty data cells passing the mapped field's check. Null when unmapped or empty. */
	valuePassRate: number | null;
	/** True when the mapping came from Overrides.columns. */
	overridden: boolean;
};

export type SkippedRow = {
	row: number;
	reason: 'blank' | 'hidden' | 'repeated-header' | 'no-mapped-values';
};

export type TableCandidate = {
	/** `${sheet}@${firstHeaderRow}`. Stable across remaps so overrides keep applying. */
	id: string;
	sheet: string;
	headerRows: number[];
	/** First header row through last data row. */
	range: CellRange;
	/** Rows that become candidate records, ascending. */
	dataRows: number[];
	skippedRows: SkippedRow[];
	columns: ColumnMapping[];
	status: 'ready' | 'needs-review';
	confidence: Confidence;
	reasons: string[];
	source: 'deterministic' | 'ai';
};

/** Input to materializeTable(): a table shape proposed by detection, the user, or the AI. */
export type TableSpec = {
	headerRows: number[];
	range: CellRange;
	columns: Record<number, Field>;
};

export type SheetAnalysis = {
	name: string;
	index: number;
	status: SheetStatus;
	reasons: string[];
	/** At most one table per sheet in the 5-hour scope. */
	tables: TableCandidate[];
	/** Why an AI interpretation could help, or null when deterministic analysis is confident. */
	aiTrigger: string | null;
};

/* ---------- Values and provenance (T2, T4) ---------- */

export type Transform =
	| 'trim'
	| 'normalize-line-endings'
	| 'dash-as-empty'
	| 'strip-label'
	| 'strip-separators'
	| 'uppercase'
	| 'numeric-to-text'
	| 'restore-leading-zeros'
	| 'merge-fill'
	| 'split-multi-value'
	| 'derive-niin-from-nsn'
	| 'derive-nsn-from-fsc-niin';

export type Provenance = {
	file: string;
	sheet: string;
	row: number;
	col: number;
	/** A1 ref of the source cell; for merged cells, the merge master. */
	cell: string;
	/** Cell text before normalization. */
	original: string;
	transforms: Transform[];
	/** Derived values are computed from other fields and must be labeled as derived in the UI. */
	origin: 'source' | 'derived';
	/** For derived values, the A1 refs of the cells they were computed from. */
	derivedFrom?: string[];
};

export type FieldValue = { value: string; provenance: Provenance };

/* ---------- Issues ---------- */

export type IssueCode =
	| 'invalid-identifier'
	| 'missing-primary-identifier'
	| 'duplicate-in-table'
	| 'duplicate-across-sheets'
	| 'duplicate-in-storage'
	| 'conflict'
	| 'ambiguous-multi-value'
	| 'low-confidence-mapping'
	| 'split-from-multi-value'
	| 'fsc-niin-mismatch'
	| 'suspicious-value'
	| 'missing-optional';

export type Severity = 'error' | 'warning' | 'info';

export type Issue = {
	code: IssueCode;
	severity: Severity;
	field?: Field;
	message: string;
	/** Qualified refs built with qualifiedRef(), e.g. "Active Parts!E134". */
	cells: string[];
	/** Ids of other records involved (duplicates, conflicts, FSC mismatches). */
	relatedRecords?: string[];
};

/* ---------- Normalization (T2) ---------- */

export type NormalizedValue = { value: string; transforms: Transform[] };

/** More than one value means the cell holds several identifiers, e.g. newline-separated part numbers. */
export type NormalizeResult =
	| { kind: 'empty' }
	| { kind: 'ok'; values: NormalizedValue[]; warnings: Issue[] }
	| { kind: 'invalid'; issue: Issue };

/* ---------- Records (T4, finalized by T5) ---------- */

export type RecordStatus = 'valid' | 'warning' | 'invalid' | 'duplicate' | 'conflict' | 'pending';

export type CandidateRecord = {
	/** `${tableId}:r${row}`, plus `.${index}` for records split from a multi-value cell. */
	id: string;
	tableId: string;
	sheet: string;
	sourceRow: number;
	split?: { cell: string; index: number; total: number };
	fields: Partial<Record<Field, FieldValue>>;
	/** Values that failed validation. Shown for review, never imported. */
	rejected: Partial<Record<Field, { original: string; cell: string }>>;
	issues: Issue[];
	/** T4 sets valid / warning / invalid / pending; T5 may change it to duplicate, conflict, or pending. */
	status: RecordStatus;
	/** Whether import will include this record. Final value set by T5. */
	approved: boolean;
	/** Ids of duplicate records folded into this one by a merge. */
	mergedFrom?: string[];
};

/* ---------- Decisions shown in the review window (T5) ---------- */

export type DecisionKind =
	| 'include-table'
	| 'split-cell'
	| 'ambiguous-multi-value'
	| 'import-valid-portion'
	| 'merge-duplicates'
	| 'drop-duplicate'
	| 'resolve-conflict'
	| 'resolve-identifier-conflict'
	| 'resolve-storage-conflict';

export type DecisionOption = { id: string; label: string };

export type Decision = {
	/** Built with decisionId() so it stays stable across recomputes. */
	id: string;
	kind: DecisionKind;
	/** auto: a policy applied it. pending: held back from import until chosen. user: chosen by the user. */
	state: 'auto' | 'pending' | 'user';
	tableId?: string;
	recordIds: string[];
	/** Saved records involved (resolve-storage-conflict), so the UI can show saved and new values side by side. */
	existingIds?: string[];
	/** Qualified refs of the cells involved. */
	cells: string[];
	options: DecisionOption[];
	/** Option in effect; null while pending. */
	chosen: string | null;
	suggested: string;
	reason: string;
};

/**
 * Decision subjects, so tasks can build the same id independently:
 * include-table -> table id; split-cell, ambiguous-multi-value, import-valid-portion -> `${tableId}:r${row}`;
 * merge-duplicates, drop-duplicate, resolve-conflict -> record ids sorted and joined with "+";
 * resolve-identifier-conflict -> `${tableId}:r${row}`; resolve-storage-conflict -> `${recordId}+saved:${existingId}`.
 */
export function decisionId(kind: DecisionKind, subject: string): string {
	return `${kind}:${subject}`;
}

/** Option ids per kind. resolve-conflict also offers one `prefer:${recordId}` option per record. */
export const DECISION_OPTIONS = {
	'include-table': ['include', 'exclude'],
	'split-cell': ['split', 'keep-as-one'],
	'ambiguous-multi-value': ['pair-in-order', 'keep-as-one', 'exclude'],
	'import-valid-portion': ['import-valid-portion', 'exclude-row'],
	'merge-duplicates': ['merge', 'keep-separate'],
	'drop-duplicate': ['drop', 'keep'],
	'resolve-conflict': ['keep-all', 'exclude-all'],
	'resolve-identifier-conflict': ['prefer-nsn', 'prefer-niin-fsc', 'exclude-row'],
	'resolve-storage-conflict': ['keep-saved', 'replace-saved', 'keep-both']
} as const satisfies Record<DecisionKind, readonly string[]>;

/* ---------- Overrides: re-running analyze() with them never rereads the file ---------- */

export type Overrides = {
	/** Per table id: column -> field, or null to exclude the column. One column maps to one field by construction. */
	columns?: Record<string, Record<number, Field | null>>;
	/** Decision id -> chosen option id. */
	decisions?: Record<string, string>;
	/** AI tables that passed verification (T6). They replace deterministic tables on the same sheet. */
	aiTables?: TableCandidate[];
};

export type ImportSummary = {
	sheets: number;
	tablesIncluded: number;
	sourceRows: number;
	candidates: number;
	valid: number;
	warnings: number;
	invalid: number;
	duplicates: number;
	conflicts: number;
	splitRecords: number;
	pendingDecisions: number;
	toImport: number;
};

export type WorkbookAnalysis = {
	fileName: string;
	sheets: SheetAnalysis[];
	records: CandidateRecord[];
	decisions: Decision[];
	summary: ImportSummary;
};

/** A record already saved in the browser; the id lets an import replace it. */
export type StoredMapping = MappingInput & { id: string };

/** What an import does: add new records, and replace saved ones the user chose to overwrite. */
export type ImportPlan = {
	add: MappingInput[];
	replace: Array<{ id: string; input: MappingInput }>;
};

/* ---------- AI boundary (T6) ---------- */

export type InterpretationRequest = {
	fileName: string;
	sheets: Array<{
		name: string;
		/** A1 range of the value extent. */
		extent: string;
		merges: string[];
		/** Why deterministic analysis asked for help (SheetAnalysis.aiTrigger). */
		reason: string;
		/** Sampled non-empty visible cells as [A1 ref, text]. */
		cells: Array<[string, string]>;
	}>;
};

export type InterpretationTable = {
	sheetName: string;
	/** A1 range, e.g. "A2:F180". */
	range: string;
	headerRows: number[];
	/** headerText is what the model read in that column's header; verification rejects mismatches. */
	columns: Array<{ field: Field; col: number; headerText: string }>;
	/** 0 to 1. */
	confidence: number;
	reasons: string[];
};

export type WorkbookInterpretation = { tables: InterpretationTable[] };

export type VerificationResult = {
	tables: TableCandidate[];
	rejected: Array<{ sheetName: string; range: string; reason: string }>;
};

/** Small seam so the provider can be mocked in tests or replaced later. */
export interface WorkbookInterpreter {
	interpret(request: InterpretationRequest, signal?: AbortSignal): Promise<WorkbookInterpretation>;
}

export type { MappingInput };
