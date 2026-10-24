/**
 * Validation, duplicates, conflicts, and decisions: the last pipeline stage before the review window.
 *
 * Certain decisions are applied and logged with an undo; uncertain ones hold their records back and
 * wait with a suggestion (PLAN.md D11). Pure and deterministic, so analyze() can re-run on every
 * override change and stored choices find the same decision ids again.
 */
import type {
	CandidateRecord,
	Decision,
	ImportPlan,
	ImportSummary,
	MappingInput,
	Overrides,
	SheetAnalysis,
	StoredMapping,
	WorkbookAnalysis,
	WorkbookModel
} from '../model';
import { DecisionLog } from './decisions';
import { decideDuplicates, decideStorage } from './duplicates';
import { contentStatus, groupBy, type Entry, type TableState } from './entry';
import { flagFscMismatches } from './fsc';
import { decideRows, decideTables } from './rows';

export function finalizeAnalysis(
	model: WorkbookModel,
	sheets: SheetAnalysis[],
	records: CandidateRecord[],
	existing: StoredMapping[],
	overrides: Overrides
): WorkbookAnalysis {
	const log = new DecisionLog(overrides.decisions);
	const sheetIndex = new Map(sheets.map((sheet) => [sheet.name, sheet.index]));
	const position = (record: CandidateRecord) => sheetIndex.get(record.sheet) ?? 0;
	// Workbook order makes "earliest record" the first of any group, and orders decisions the same way.
	const ordered = [...records].sort(
		(a, b) =>
			position(a) - position(b) ||
			a.sourceRow - b.sourceRow ||
			(a.split?.index ?? 0) - (b.split?.index ?? 0)
	);
	const idsByTable = new Map(
		[...groupBy(ordered, (record) => record.tableId)].map(([id, group]) => [
			id,
			group.map((record) => record.id)
		])
	);
	const tables = decideTables(log, sheets, idsByTable);

	// Copies, so the steps below never mutate the records buildRecords() returned.
	const entries: Entry[] = ordered.map((record) => ({
		record: { ...record, fields: { ...record.fields }, issues: [...record.issues] },
		sheetIndex: position(record),
		table: tables.get(record.tableId) ?? 'excluded',
		held: false
	}));

	// Order matters: each step only sees records the previous ones left headed for import.
	decideRows(log, entries);
	decideDuplicates(log, entries);
	decideStorage(log, entries, existing);
	flagFscMismatches(entries);

	// Applied last, so unchecking a row changes nothing but that row: a copy it outranked stays dropped.
	const excluded = new Set(overrides.excludedRecords);
	for (const entry of entries) {
		// A held-back table's records wait on its include decision, whatever their contents.
		const status =
			entry.status ?? (entry.table === 'pending' ? 'pending' : contentStatus(entry.record));
		entry.record.status = status;
		entry.record.approved =
			entry.table === 'included' &&
			!entry.held &&
			!excluded.has(entry.record.id) &&
			(status === 'valid' || status === 'warning');
	}

	const decisions = log.sorted();
	return {
		fileName: model.fileName,
		sheets,
		records: entries.map(({ record }) => record),
		decisions,
		summary: summarize(sheets, entries, tables, decisions)
	};
}

/**
 * Counts cover records of included and pending tables; an excluded table's records are not
 * candidates for this import, though they stay in `records` so the user can re-include the table.
 */
function summarize(
	sheets: SheetAnalysis[],
	entries: Entry[],
	tables: Map<string, TableState>,
	decisions: Decision[]
): ImportSummary {
	const scoped = entries.filter((entry) => entry.table !== 'excluded').map(({ record }) => record);
	const count = (status: CandidateRecord['status']) =>
		scoped.filter((record) => record.status === status).length;
	return {
		sheets: sheets.length,
		tablesIncluded: [...tables.values()].filter((state) => state === 'included').length,
		sourceRows: new Set(scoped.map((record) => `${record.tableId}:r${record.sourceRow}`)).size,
		candidates: scoped.length,
		valid: count('valid'),
		warnings: count('warning'),
		invalid: count('invalid'),
		duplicates: count('duplicate'),
		conflicts: count('conflict'),
		splitRecords: scoped.filter((record) => record.split).length,
		pendingDecisions: decisions.filter((decision) => decision.state === 'pending').length,
		toImport: entries.filter(({ record }) => record.approved).length
	};
}

const STORED_FIELDS = ['part', 'description', 'nsn', 'niin', 'cage'] as const;

/**
 * Approved records as storage inputs. A record whose storage conflict was settled with replace-saved
 * overwrites the first matching saved record; every other approved record is added.
 */
export function toImportPlan(analysis: WorkbookAnalysis): ImportPlan {
	const replaced = new Map(
		analysis.decisions
			.filter(
				({ kind, chosen }) => kind === 'resolve-storage-conflict' && chosen === 'replace-saved'
			)
			.map(({ recordIds, existingIds }) => [recordIds[0], existingIds?.[0]])
	);
	const plan: ImportPlan = { add: [], replace: [] };
	for (const record of analysis.records) {
		if (!record.approved) continue;
		const input = toInput(record);
		const id = replaced.get(record.id);
		if (id) plan.replace.push({ id, input });
		else plan.add.push(input);
	}
	return plan;
}

/**
 * FSC is not stored; it lives on in the NSN. A worked-out NSN or NIIN keeps its origin in `derived`
 * (D25), which is left off entirely when every value was read, so such inputs look as they always did.
 */
function toInput({ fields }: CandidateRecord): MappingInput {
	const input: MappingInput = {};
	for (const field of STORED_FIELDS) {
		const value = fields[field]?.value;
		if (value !== undefined) input[field] = value;
	}
	const derived = (['nsn', 'niin'] as const).filter(
		(field) => fields[field]?.provenance.origin === 'derived'
	);
	if (derived.length > 0) input.derived = derived;
	return input;
}
