/**
 * What the review window says about an analysis, as pure functions so the copy and the rules can be tested
 * without rendering: the one-sentence summary (R1), the status chips (R2), the section summaries and
 * open-by-default rules (R4-R6, R8), the "Worth a look" lines (R9), and decision titles (R3).
 *
 * Counts come from WorkbookAnalysis only. Records of held-back tables (needs review and not included, or
 * excluded) are left out of the chips and the "Worth a look" lines, because they do not import as things stand.
 */
import type {
	CandidateRecord,
	Decision,
	Field,
	Issue,
	SheetAnalysis,
	SheetStatus,
	TableCandidate,
	WorkbookAnalysis
} from '$lib/import/model';
import { rangeToA1 } from '$lib/import/refs';
import type { AiAvailability } from '$lib/import/ai';
import type { AiRun } from '$lib/import/session.svelte';
import { DECISION_KIND_LABEL, FIELD_LABEL, plural, type ChipTone, type RecordFilter } from './labels';

const joinAnd = (items: Array<string | number>) =>
	items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Tables whose records do not import now: a needs-review table not included yet, or any excluded table. */
export function heldBackTables(analysis: WorkbookAnalysis): Set<string> {
	return new Set(
		analysis.decisions
			.filter((decision) => decision.kind === 'include-table' && decision.tableId && decision.chosen !== 'include')
			.map((decision) => decision.tableId!)
	);
}

/** Records of tables that are not held back: the ones the chips, Rows, and "Worth a look" talk about. */
export function activeRecords(analysis: WorkbookAnalysis): CandidateRecord[] {
	const held = heldBackTables(analysis);
	return analysis.records.filter((record) => !held.has(record.tableId));
}

/* ---------- R1 ---------- */

export type SummaryParts = { sheets: string; rows: string; needs: string; pending: number };

export function summaryParts(analysis: WorkbookAnalysis): SummaryParts {
	const { summary, sheets } = analysis;
	const ready = sheets.filter((sheet) => sheet.status === 'ready').length;
	const total = sheets.length;
	const pending = summary.pendingDecisions;
	return {
		// The verb follows the nearer noun: "1 of 2 sheets has", "0 of 1 sheet has", "2 of 6 sheets have".
		sheets: `${ready} of ${plural(total, 'sheet')} ${ready === 1 || total === 1 ? 'has an importable table' : 'have importable tables'}`,
		rows:
			plural(summary.sourceRows, 'row') +
			(summary.candidates !== summary.sourceRows ? ` → ${plural(summary.candidates, 'record')}` : ''),
		needs: pending ? `${pending} ${pending === 1 ? 'decision needs' : 'decisions need'} you` : 'nothing needs you',
		pending
	};
}

export function summarySentence(analysis: WorkbookAnalysis): string {
	const { sheets, rows, needs } = summaryParts(analysis);
	return `${sheets} · ${rows} · ${needs}`;
}

/* ---------- R2 and R6 ---------- */

export type Chip = { tone: ChipTone; count: number; label: string; filter: RecordFilter };

/** "2 split from D136" when every split record comes from one cell, otherwise "5 split". */
function splitLabel(records: CandidateRecord[]): string {
	const cells = new Set(records.map((record) => `${record.sheet}!${record.split!.cell}`));
	return cells.size === 1 ? `${records.length} split from ${records[0].split!.cell}` : `${records.length} split`;
}

/** Status chips, only for counts above zero; each opens the Rows section with its filter. */
export function statusChips(analysis: WorkbookAnalysis): Chip[] {
	const active = activeRecords(analysis);
	const count = (status: CandidateRecord['status']) => active.filter((record) => record.status === status).length;
	const split = active.filter((record) => record.split);
	const held = analysis.records.length - active.length;
	const chips: Chip[] = [
		{ tone: 'valid', count: count('valid'), label: `${count('valid')} valid`, filter: 'valid' },
		{ tone: 'warning', count: count('warning'), label: plural(count('warning'), 'warning'), filter: 'warning' },
		{ tone: 'invalid', count: count('invalid'), label: `${count('invalid')} invalid`, filter: 'invalid' },
		{ tone: 'duplicate', count: count('duplicate'), label: plural(count('duplicate'), 'duplicate'), filter: 'duplicate' },
		{ tone: 'conflict', count: count('conflict'), label: `${count('conflict')} in conflict`, filter: 'conflict' },
		{ tone: 'split', count: split.length, label: split.length ? splitLabel(split) : '', filter: 'split' },
		{ tone: 'held', count: held, label: `${held} held back`, filter: 'all' }
	];
	return chips.filter((chip) => chip.count > 0);
}

/**
 * Rows section title: the same row count as the summary sentence, then the rows of held-back tables on their own.
 * The sentence counts `summary.sourceRows`, which leaves out excluded tables, so counting every record here
 * would read "Rows (7)" next to "4 rows" once a table is excluded.
 */
export function rowsTitle(analysis: WorkbookAnalysis): string {
	const held = heldBackGroups(analysis).reduce(
		(count, group) => count + new Set(group.records.map((record) => record.sourceRow)).size,
		0
	);
	return `Rows (${analysis.summary.sourceRows.toLocaleString()})${held ? ` · ${held.toLocaleString()} held back` : ''}`;
}

/** Rows section summary: the records that import or wait in place, then the notable counts. Held back is in the title. */
export function rowsSummary(analysis: WorkbookAnalysis): string {
	const chips = statusChips(analysis).filter((chip) => ['warning', 'conflict', 'split'].includes(chip.tone));
	return [plural(activeRecords(analysis).length, 'record'), ...chips.map((chip) => chip.label)].join(' · ');
}

/** Held-back tables with their records, for the folded lines under the Rows table. */
export function heldBackGroups(analysis: WorkbookAnalysis): Array<{ table: TableCandidate; records: CandidateRecord[] }> {
	const held = heldBackTables(analysis);
	return analysis.sheets.flatMap((sheet) =>
		sheet.tables
			.filter((table) => held.has(table.id))
			.map((table) => ({ table, records: analysis.records.filter((record) => record.tableId === table.id) }))
	);
}

/* ---------- R4 ---------- */

const SHEET_SUMMARY: Array<[SheetStatus, string]> = [
	['ready', 'ready'],
	['needs-review', 'needs review'],
	['no-table', 'nothing to import'],
	['hidden', 'hidden']
];

export function sheetsSummary(sheets: SheetAnalysis[]): string {
	return SHEET_SUMMARY.map(([status, label]) => [sheets.filter((sheet) => sheet.status === status).length, label] as const)
		.filter(([count]) => count > 0)
		.map(([count, label]) => `${count} ${label}`)
		.join(' · ');
}

/* ---------- R5 ---------- */

const mappedFields = (table: TableCandidate) =>
	table.columns.flatMap((column) => (column.field ? [FIELD_LABEL[column.field]] : []));

/** The mapped fields per table that imports, in column order; the table name only when there are several. */
export function columnsSummary(analysis: WorkbookAnalysis): string {
	const held = heldBackTables(analysis);
	const tables = analysis.sheets.flatMap((sheet) => sheet.tables).filter((table) => !held.has(table.id));
	if (tables.length === 0) return 'No table is included';
	if (tables.length === 1) return mappedFields(tables[0]).join(', ');
	return tables.map((table) => `${table.sheet}: ${mappedFields(table).join(', ')}`).join(' · ');
}

/** Open the Columns section only when a mapping deserves a look: an uncertain mapped column or a user remap. */
export function columnsOpenByDefault(analysis: WorkbookAnalysis): boolean {
	const held = heldBackTables(analysis);
	return analysis.sheets
		.flatMap((sheet) => sheet.tables)
		.some(
			(table) =>
				table.columns.some((column) => column.overridden) ||
				(!held.has(table.id) && table.columns.some((column) => column.field && column.confidence !== 'high'))
		);
}

/* ---------- R9 ---------- */

export type WorthALook = { title: string; detail: string };

/** Distinct source rows of the records, as "row 180", "rows 134 and 166", or "rows 2, 5, 9, 12 and 3 more". */
function rowList(records: CandidateRecord[]): string {
	const sheets = new Set(records.map((record) => record.sheet));
	const rows = [...new Set(records.map((record) => record.sourceRow))].sort((a, b) => a - b);
	if (sheets.size > 1) return `${plural(new Set(records.map((r) => `${r.sheet}:${r.sourceRow}`)).size, 'row')} on ${sheets.size} sheets`;
	if (rows.length === 1) return `row ${rows[0]}`;
	const shown = rows.slice(0, 4);
	return `rows ${rows.length > shown.length ? `${shown.join(', ')} and ${rows.length - shown.length} more` : joinAnd(shown)}`;
}

const distinctRows = (records: CandidateRecord[]) => new Set(records.map((r) => `${r.sheet}:${r.sourceRow}`)).size;
const fieldName = (field: Field) => (field === 'part' ? 'part number' : field === 'description' ? 'description' : FIELD_LABEL[field]);
const verb = (count: number, one: string, many: string) => (count === 1 ? one : many);

type Group = { order: number; records: CandidateRecord[]; issue: Issue };

/** The kind of a warning: its code, refined where one code covers different situations. */
function groupKey(record: CandidateRecord, issue: Issue): [key: string, order: number] {
	const field = issue.field ?? '';
	switch (issue.code) {
		case 'invalid-identifier':
			return [`malformed:${field}`, 0];
		case 'suspicious-value': {
			const value = issue.field ? record.fields[issue.field] : undefined;
			if (issue.field === 'part' && value && /\(.+\)/.test(value.value)) return ['note-in-brackets', 1];
			if (value?.provenance.transforms.includes('restore-leading-zeros')) return [`leading-zeros:${field}`, 2];
			if (value?.provenance.transforms.includes('numeric-to-text')) return [`stored-as-number:${field}`, 2];
			return ['unusual', 3];
		}
		case 'missing-optional':
			return [`missing:${field}`, 4];
		case 'fsc-niin-mismatch':
			return ['fsc-niin-mismatch', 5];
		default:
			return [issue.code, 6];
	}
}

function describe(key: string, { records, issue }: Group): WorthALook {
	const rows = distinctRows(records);
	const n = records.length;
	const field = issue.field ? fieldName(issue.field) : 'value';
	const [kind] = key.split(':');
	switch (kind) {
		case 'malformed': {
			// What still imports: the primary identifiers the rows kept, named when every row kept the same one.
			const kept = new Set(
				records.map((record) => (['part', 'nsn', 'niin'] as const).find((f) => f !== issue.field && record.fields[f]))
			);
			const keptField = kept.size === 1 ? [...kept][0] : undefined;
			const rest = keptField ? `the ${fieldName(keptField)} imports` : 'the rest of the row imports';
			return {
				title: `${plural(rows, 'row')} had a malformed ${field}`,
				detail: `${rowList(records)}; ${rest}, the bad ${field} does not`
			};
		}
		case 'note-in-brackets':
			return { title: `${plural(n, 'part number')} ${verb(n, 'has', 'have')} a note in brackets`, detail: `${rowList(records)}, kept as written` };
		case 'leading-zeros':
			return { title: `${plural(n, field)} ${verb(n, 'was', 'were')} stored as a number`, detail: `${rowList(records)}; leading zeros restored` };
		case 'stored-as-number':
			return { title: `${plural(n, field)} ${verb(n, 'was', 'were')} stored as a number`, detail: `${rowList(records)}; leading zeros may have been lost` };
		case 'unusual':
			return { title: `${plural(n, 'value')} ${verb(n, 'looks', 'look')} unusual`, detail: `${rowList(records)}, kept as written` };
		case 'missing':
			return { title: `${plural(n, 'record')} ${verb(n, 'has', 'have')} no ${field}`, detail: rowList(records) };
		case 'fsc-niin-mismatch':
			return {
				title: `${plural(n, 'record')} ${verb(n, 'lists', 'list')} the same item under different NSNs`,
				detail: 'at most one NSN per item is current'
			};
		case 'low-confidence-mapping':
			return { title: `${plural(n, 'record')} ${verb(n, 'comes', 'come')} from a column mapped with less than high confidence`, detail: 'check the Columns section' };
		case 'conflict':
			return { title: `${plural(n, 'record')} kept one of two disagreeing identifiers`, detail: rowList(records) };
		default:
			return { title: `${plural(n, 'record')}: ${issue.message}`, detail: rowList(records) };
	}
}

const CONFLICT_KINDS = new Set(['resolve-conflict', 'resolve-identifier-conflict', 'resolve-storage-conflict']);

/** One line per kind of warning on records that import with a warning, grouped by issue code. */
export function worthALook(analysis: WorkbookAnalysis): WorthALook[] {
	// A conflict the user already settled stays on the record as a note; repeating it here would only echo their choice.
	const settled = new Set(
		analysis.decisions
			.filter((decision) => decision.state === 'user' && CONFLICT_KINDS.has(decision.kind))
			.flatMap((decision) => decision.recordIds)
	);
	const groups = new Map<string, Group>();
	for (const record of activeRecords(analysis)) {
		// The line promises these rows still import, so a row the user unchecked or excluded is left out.
		if (record.status !== 'warning' || !record.approved) continue;
		const seen = new Set<string>();
		for (const issue of record.issues) {
			if (issue.severity === 'info' || (issue.code === 'conflict' && settled.has(record.id))) continue;
			const [key, order] = groupKey(record, issue);
			if (seen.has(key)) continue;
			seen.add(key);
			const group = groups.get(key) ?? { order, records: [], issue };
			group.records.push(record);
			groups.set(key, group);
		}
	}
	return [...groups.entries()].sort(([, a], [, b]) => a.order - b.order).map(([key, group]) => describe(key, group));
}

/* ---------- R8 ---------- */

export type AiState = {
	enabled: boolean;
	availability: AiAvailability | null;
	run: AiRun | null;
	/** Sheets an interpretation could help with. */
	triggered: string[];
};

/** The AI section's one-line summary: whether it is on, and what it did or could do. */
export function aiSummary({ enabled, availability, run, triggered }: AiState): string {
	if (enabled && availability === null) return 'Checking availability…';
	if (availability?.available === false) return `Unavailable · ${availability.reason ?? 'the AI service is not configured'}`;
	if (run?.status === 'running') return `On · interpreting ${joinAnd(run.sheets)}…`;
	if (run?.status === 'error') return 'On · the AI request failed';
	if (run?.status === 'done' && run.result) {
		const rejected = run.result.rejected.length ? `, rejected ${run.result.rejected.length}` : '';
		return `On · sent ${joinAnd(run.sheets)}; accepted ${plural(run.result.tables.length, 'table')}${rejected}`;
	}
	if (triggered.length) return `${enabled ? 'On' : 'Off'} · could help with ${joinAnd(triggered)}`;
	return enabled ? 'On · every sheet was read without help, so nothing was sent' : 'Off · every sheet was read without help';
}

/** Open AI assistance when it could help or has something to show. */
export function aiOpenByDefault(analysis: WorkbookAnalysis, hasResults: boolean): boolean {
	return hasResults || analysis.sheets.some((sheet) => sheet.aiTrigger && sheet.status !== 'hidden');
}

/* ---------- R3 ---------- */

export type DecisionHeading = { badge: string; tone: 'conflict' | 'review' | 'saved'; kind: string; title: string };

/** "5305016582565" -> "5305-01-658-2565", the way NSNs are usually written. */
export function formatNsn(nsn: string): string {
	return /^\d{13}$/.test(nsn) ? `${nsn.slice(0, 4)}-${nsn.slice(4, 6)}-${nsn.slice(6, 9)}-${nsn.slice(9)}` : nsn;
}

/** Badge, kind, and a title naming what the decision is about, from the records and tables it covers. */
export function decisionHeading(
	decision: Decision,
	records: Map<string, CandidateRecord>,
	sheets: SheetAnalysis[]
): DecisionHeading {
	const first = records.get(decision.recordIds[0]);
	const identity = () => {
		const part = first?.fields.part?.value;
		const nsn = first?.fields.nsn?.value;
		return [part, nsn && `NSN ${formatNsn(nsn)}`].filter(Boolean).join(' · ') || where();
	};
	const where = () => (first ? `${first.sheet} row ${first.sourceRow}` : DECISION_KIND_LABEL[decision.kind]);
	switch (decision.kind) {
		case 'resolve-conflict':
			return { badge: 'Conflict', tone: 'conflict', kind: 'Same part on two sheets', title: identity() };
		case 'resolve-storage-conflict':
			return { badge: 'Already saved', tone: 'saved', kind: 'Differs from a saved record', title: identity() };
		case 'resolve-identifier-conflict':
			return {
				badge: 'Conflict',
				tone: 'conflict',
				kind: 'NSN disagrees with its NIIN or FSC',
				title: [first?.fields.part?.value, where()].filter(Boolean).join(' · ')
			};
		case 'include-table': {
			const table = sheets.flatMap((sheet) => sheet.tables).find((candidate) => candidate.id === decision.tableId);
			return {
				badge: 'Needs review',
				tone: 'review',
				kind: 'Table needs review',
				title: table ? `${table.sheet} (${rangeToA1(table.range)}) · ${plural(table.dataRows.length, 'row')}` : DECISION_KIND_LABEL[decision.kind]
			};
		}
		case 'ambiguous-multi-value':
			return { badge: 'Ambiguous', tone: 'review', kind: 'Several values in one row', title: where() };
		default:
			return { badge: DECISION_KIND_LABEL[decision.kind], tone: 'review', kind: '', title: where() };
	}
}
