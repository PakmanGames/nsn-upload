/**
 * Sheet classification: hidden (unless included anyway), no table, or the sheet's tables with user remaps and AI proposals applied.
 */
import type { Field, Overrides, SheetAnalysis, SheetModel, TableCandidate, TableSpec } from '../model';
import { rangeToA1 } from '../refs';
import { detectTables, MAX_COLUMNS } from './detect';
import { headerRowsPhrase, materialize, tableId, type MaterializedTable, type UserColumns } from './table';
import { checkValue } from './values';

/** NSN/NIIN-shaped cells that make a sheet without a ready table worth an AI look. */
const AI_TRIGGER_MIN_IDENTIFIERS = 3;

/**
 * Applies the user's column choices to a spec. A user-mapped field is taken away from whichever column
 * had it; when two user choices claim one field, the right-most column keeps it.
 */
export function applyUserColumns(spec: TableSpec, choices: Record<number, Field | null> | undefined): { spec: TableSpec; user: UserColumns } {
	const columns: Record<number, Field> = { ...spec.columns };
	const set = new Map<number, Field | null>();
	const replaced = new Map<number, number>();
	for (const [key, field] of Object.entries(choices ?? {})) {
		set.set(Number(key), field);
		delete columns[Number(key)];
	}
	for (const [col, field] of set) {
		if (!field) continue;
		for (const [other, existing] of Object.entries(columns)) {
			if (existing !== field) continue;
			delete columns[Number(other)];
			replaced.set(Number(other), col);
		}
		columns[col] = field;
	}
	return { spec: { ...spec, columns }, user: { set, replaced } };
}

function specOf(table: TableCandidate): TableSpec {
	const columns: Record<number, Field> = {};
	for (const c of table.columns) if (c.field) columns[c.col] = c.field;
	return { headerRows: table.headerRows, range: table.range, columns };
}

function countIdentifierCells(sheet: SheetModel): number {
	const extent = sheet.valueExtent!;
	const right = Math.min(extent.right, extent.left + MAX_COLUMNS - 1);
	let count = 0;
	for (let row = extent.top; row <= extent.bottom; row++) {
		if (sheet.hiddenRows.has(row)) continue;
		for (let col = extent.left; col <= right; col++) {
			if (sheet.hiddenCols.has(col)) continue;
			const cell = sheet.cell(row, col);
			if (cell.kind === 'empty' || cell.mergedFrom) continue;
			if (checkValue('nsn', cell, sheet.name) === 'pass' || checkValue('niin', cell, sheet.name) === 'pass') count++;
		}
	}
	return count;
}

function identifierTrigger(sheet: SheetModel, what: string): string | null {
	const count = countIdentifierCells(sheet);
	return count >= AI_TRIGGER_MIN_IDENTIFIERS ? `${count} cells look like NSNs or NIINs, but ${what}` : null;
}

function tableSummary(table: TableCandidate): string[] {
	const rows = table.dataRows;
	const span = rows.length > 1 ? ` (rows ${rows[0]}-${rows.at(-1)})` : rows.length ? ` (row ${rows[0]})` : '';
	return [
		`Table ${rangeToA1(table.range)} ${table.headerRows.length ? `with ${headerRowsPhrase(table.headerRows)}` : 'without a header row'}: ${rows.length} data rows${span}`,
		table.reasons.at(-1)!
	];
}

/** An AI table replaces detection on its sheet; a user remap of it is materialized like any other table. */
function aiSheet(sheet: SheetModel, tables: TableCandidate[], overrides: Overrides): Pick<SheetAnalysis, 'reasons' | 'tables'> {
	const [proposal, ...unused] = tables;
	const choices = overrides.columns?.[proposal.id];
	let table = proposal;
	if (choices && Object.keys(choices).length > 0) {
		const { spec, user } = applyUserColumns(specOf(proposal), choices);
		table = materialize(sheet, spec, 'ai', user).table;
		table.reasons.unshift('Proposed by AI; columns changed by user');
	}
	const reasons = ['Table proposed by AI and verified against the workbook', ...tableSummary(table)];
	if (unused.length > 0) reasons.push(`${unused.length} more AI table(s) on this sheet not used: one table per sheet`);
	return { reasons, tables: [table] };
}

/**
 * Tables the user set up by hand replace detection and AI on their sheet. They are scored like any other
 * table, and the user's later column changes apply to them as to a detected table.
 */
function manualSheet(sheet: SheetModel, specs: TableSpec[], overrides: Overrides): Pick<SheetAnalysis, 'status' | 'reasons' | 'tables'> {
	const tables = specs.map((manual) => {
		const { spec, user } = applyUserColumns(manual, overrides.columns?.[tableId(sheet.name, manual)]);
		return materialize(sheet, spec, 'user', user).table;
	});
	return { status: tables[0].status, reasons: ['Table set up by you', ...tables.flatMap(tableSummary)], tables };
}

export function analyzeSheet(sheet: SheetModel, overrides: Overrides): SheetAnalysis {
	if (sheet.visibility === 'visible') return analyzeVisibleSheet(sheet, overrides);
	if (!overrides.includedHiddenSheets?.includes(sheet.name)) {
		return { name: sheet.name, index: sheet.index, status: 'hidden', reasons: ['Hidden in workbook'], tables: [], aiTrigger: null };
	}
	// Included anyway (D26): analyzed like a visible sheet, but never offered to the AI, so no trigger.
	const analysis = analyzeVisibleSheet(sheet, overrides);
	return { ...analysis, reasons: ['Hidden in Excel; included because you asked', ...analysis.reasons], aiTrigger: null };
}

function analyzeVisibleSheet(sheet: SheetModel, overrides: Overrides): SheetAnalysis {
	const base = { name: sheet.name, index: sheet.index };
	if (!sheet.valueExtent) return { ...base, status: 'no-table', reasons: ['Sheet has no values'], tables: [], aiTrigger: null };

	const manual = (overrides.manualTables ?? []).filter((t) => t.sheet === sheet.name);
	// The user has said where the table is, so there is nothing left to ask the AI.
	if (manual.length > 0) return { ...base, ...manualSheet(sheet, manual, overrides), aiTrigger: null };

	const aiTables = (overrides.aiTables ?? []).filter((t) => t.sheet === sheet.name);
	if (aiTables.length > 0) {
		const { reasons, tables } = aiSheet(sheet, aiTables, overrides);
		// The AI was already consulted for this sheet, so it is not offered again.
		return { ...base, status: tables[0].status, reasons, tables, aiTrigger: null };
	}

	const detection = detectTables(sheet);
	if (detection.tables.length === 0) {
		return {
			...base,
			status: 'no-table',
			reasons: detection.reasons,
			tables: [],
			aiTrigger: identifierTrigger(sheet, 'no table was recognized')
		};
	}

	// Each table is its own unit: its own remaps, decision, and rows. The sheet is ready when one of them is.
	const found = detection.tables.map(({ spec: detected, reasons: notes }) => {
		const id = tableId(sheet.name, detected);
		const { spec, user } = applyUserColumns(detected, overrides.columns?.[id]);
		const { table, competition }: MaterializedTable = materialize(sheet, spec, 'deterministic', user);
		const reasons = [...tableSummary(table), ...notes];
		// How detection found the table goes with the table, ahead of its status, which stays the last reason.
		table.reasons.splice(-1, 0, ...notes);
		return { table, competition, reasons };
	});
	const tables = found.map(({ table }) => table);
	const status = tables.some((table) => table.status === 'ready') ? 'ready' : 'needs-review';
	// The AI proposes one table per sheet, replacing detection there, so it is only offered when no table is ready.
	// A table without a header row was found by its values alone, so the AI has nothing left to decide either.
	const settled = status === 'ready' || tables.some((table) => table.headerRows.length === 0);
	// Any other table that needs review is worth an AI look (D23), even with few identifier-shaped cells.
	const aiTrigger = settled
		? null
		: (found.flatMap(({ competition }) => competition)[0] ??
			identifierTrigger(sheet, tables.length > 1 ? 'none of its tables is ready' : 'the table needs review') ??
			'A table was found, but it needs review');
	// A note about the whole sheet, such as the column limit, comes with every band; it is listed once.
	return { ...base, status, reasons: [...new Set(found.flatMap(({ reasons }) => reasons))], tables, aiTrigger };
}
