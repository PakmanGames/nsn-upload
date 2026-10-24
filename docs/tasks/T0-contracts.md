# T0 - Contracts, stubs, dependencies, hygiene

Time box: 30 minutes. Everything else waits on this merge, so keep it mechanical: no pipeline logic beyond what is written here.
Read first: `docs/PLAN.md` (rules), `docs/ARCHITECTURE.md`.

## Deliverables

### 1. `src/lib/import/model.ts` (copy exactly, then run `pnpm check`)

```ts
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
	maxSheets: number;
	maxRowsPerSheet: number;
	maxCells: number;
};

export const DEFAULT_READ_LIMITS: ReadLimits = {
	maxFileBytes: 20 * 1024 * 1024,
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
	| 'resolve-conflict';

export type DecisionOption = { id: string; label: string };

export type Decision = {
	/** Built with decisionId() so it stays stable across recomputes. */
	id: string;
	kind: DecisionKind;
	/** auto: a policy applied it. pending: held back from import until chosen. user: chosen by the user. */
	state: 'auto' | 'pending' | 'user';
	tableId?: string;
	recordIds: string[];
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
 * merge-duplicates, drop-duplicate, resolve-conflict -> record ids sorted and joined with "+".
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
	'resolve-conflict': ['keep-all', 'exclude-all']
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
```

### 2. `src/lib/import/refs.ts` (with a small test file)

`colLetter(col)`, `toA1(row, col)`, `parseA1(ref)` -> `{ row, col } | null`, `rangeToA1(range)`, `parseRange(a1)` -> `CellRange | null`, `qualifiedRef(sheet, ref)` -> `` `${sheet}!${ref}` ``, `emptyCell(row, col)` -> a `Cell` with `kind: 'empty'`, `text: ''`, `raw: null`.

### 3. `src/lib/import/identifiers.ts` (T2 owns it after T0)

```ts
/**
 * Identifier checks shared by column mapping (T3) and normalization (T2).
 * Kept in one place so a column is scored with exactly the rules used to validate its values.
 */

/** Whitespace (incl. NBSP), zero-width characters, ASCII hyphen, Unicode dashes and the minus sign. */
const SEPARATORS = /[\s\u200B-\u200D\uFEFF\u2010-\u2015\u2212-]/g;

export function stripSeparators(text: string): string {
	return text.replace(SEPARATORS, '');
}

export const isNsnDigits = (value: string) => /^\d{13}$/.test(value);
export const isNiinDigits = (value: string) => /^\d{9}$/.test(value);
export const isFscDigits = (value: string) => /^\d{4}$/.test(value);
export const isCage = (value: string) => /^[A-Z0-9]{5}$/.test(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loose shape check for part numbers, which have no strict format. Used for column scoring and split decisions. */
export function isPlausiblePart(text: string): boolean {
	const value = text.trim();
	if (value.length === 0 || value.length > 40) return false;
	if (!/\d/.test(value)) return false;
	if (UUID.test(value) || /^https?:\/\//i.test(value) || value.includes('@')) return false;
	return value.split(/\s+/).length <= 4;
}
```

### 4. `src/lib/import/testing.ts`

`makeSheet(name, rows, options?)` and `makeWorkbook(fileName, sheets)` build `SheetModel` / `WorkbookModel` without SheetJS, so T3-T5 can test before T1 lands.

- `rows[0]` is Excel row 1, `rows[r][0]` is column A.
- Cell inputs: `string` -> `text` (CRLF and CR become LF), `number` -> `number` with exact integer text, `boolean` -> `"TRUE"`/`"FALSE"`, `null` / `undefined` / `''` -> empty, or a partial `Cell` with `kind` for dates, errors, `numFmt`, and formulas.
- Options: `index`, `visibility`, `hiddenRows`, `hiddenCols`, `merges` (covered cells copy the master's text/raw and set `mergedFrom`, same as the reader).
- `valueExtent` is computed from non-empty cells; `cell()` returns `emptyCell()` outside stored cells.

### 5. Stub entry points (owners replace the bodies; signatures are part of the contract)

Each stub body is `throw new Error('T<n>: not implemented')`.

```ts
// src/lib/import/reader/index.ts (T1)
export async function readWorkbook(data: ArrayBuffer, fileName: string, limits?: Partial<ReadLimits>): Promise<WorkbookModel>

// src/lib/import/normalize/index.ts (T2)
export function normalizeField(field: Field, cell: Cell, sheet: string): NormalizeResult

// src/lib/import/structure/index.ts (T3)
export function analyzeStructure(model: WorkbookModel, overrides: Overrides): SheetAnalysis[]
export function materializeTable(sheet: SheetModel, spec: TableSpec, source: TableCandidate['source']): TableCandidate

// src/lib/import/records/index.ts (T4)
export function buildRecords(model: WorkbookModel, sheets: SheetAnalysis[], overrides: Overrides): CandidateRecord[]

// src/lib/import/validate/index.ts (T5)
export function finalizeAnalysis(model: WorkbookModel, sheets: SheetAnalysis[], records: CandidateRecord[], existing: MappingInput[], overrides: Overrides): WorkbookAnalysis
export function toMappingInputs(analysis: WorkbookAnalysis): MappingInput[]

// src/lib/import/ai/index.ts (T6)
export function buildInterpretationRequest(model: WorkbookModel, sheets: SheetAnalysis[]): InterpretationRequest
export function verifyInterpretation(model: WorkbookModel, request: InterpretationRequest, interpretation: WorkbookInterpretation): VerificationResult
export function createHttpInterpreter(fetchImpl?: typeof fetch): WorkbookInterpreter
export async function getAiAvailability(fetchImpl?: typeof fetch): Promise<{ available: boolean; reason?: string }>
```

### 6. `src/lib/import/analyze.ts` (real code, not a stub)

```ts
import type { MappingInput, Overrides, WorkbookAnalysis, WorkbookModel } from './model';
import { analyzeStructure } from './structure';
import { buildRecords } from './records';
import { finalizeAnalysis } from './validate';

/** Pure and deterministic: the UI calls it again with new overrides instead of rereading the file. */
export function analyze(
	model: WorkbookModel,
	existing: MappingInput[],
	overrides: Overrides = {}
): WorkbookAnalysis {
	const sheets = analyzeStructure(model, overrides);
	const records = buildRecords(model, sheets, overrides);
	return finalizeAnalysis(model, sheets, records, existing, overrides);
}
```

### 7. Dependencies and hygiene

- `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz zod@^4`
- Move `exceljs` to `devDependencies` (tests use it to write synthetic workbooks with a second writer).
- `pnpm add -D @playwright/test` (T8 configures it).
- Delete `package-lock.json` (the project uses pnpm).
- `.gitignore`: add `.env`, `.env.*`, `!.env.example`, `test-results`, `playwright-report`.
- Fix the existing `pnpm check` failure at `src/lib/smart-upload.test.ts:54` (Buffer cast). Do not otherwise touch the old `smart-upload*` files; T7 removes them later.

## Done when

`pnpm test`, `pnpm check`, and `pnpm build` pass; the files above exist with the exact signatures; merged to `main`.
Then tell the coordinator so T1-T8 can branch.
