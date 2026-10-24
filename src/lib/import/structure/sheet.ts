/**
 * Sheet classification: hidden, no table, or the sheet's one table with user remaps and AI proposals applied.
 */
import type { Field, Overrides, SheetAnalysis, SheetModel, TableCandidate, TableSpec } from '../model';
import { rangeToA1 } from '../refs';
import { detectTable, MAX_COLUMNS } from './detect';
import { formatRows, materialize, tableId, type MaterializedTable, type UserColumns } from './table';
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
		`Table ${rangeToA1(table.range)} ${table.headerRows.length ? `with header on row ${formatRows(table.headerRows)}` : 'without a header row'}: ${rows.length} data rows${span}`,
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

export function analyzeSheet(sheet: SheetModel, overrides: Overrides): SheetAnalysis {
	const base = { name: sheet.name, index: sheet.index };
	if (sheet.visibility !== 'visible') return { ...base, status: 'hidden', reasons: ['Hidden in workbook'], tables: [], aiTrigger: null };
	if (!sheet.valueExtent) return { ...base, status: 'no-table', reasons: ['Sheet has no values'], tables: [], aiTrigger: null };

	const aiTables = (overrides.aiTables ?? []).filter((t) => t.sheet === sheet.name);
	if (aiTables.length > 0) {
		const { reasons, tables } = aiSheet(sheet, aiTables, overrides);
		// The AI was already consulted for this sheet, so it is not offered again.
		return { ...base, status: tables[0].status, reasons, tables, aiTrigger: null };
	}

	const detection = detectTable(sheet);
	if (!detection.spec) {
		return {
			...base,
			status: 'no-table',
			reasons: detection.reasons,
			tables: [],
			aiTrigger: identifierTrigger(sheet, 'no table was recognized')
		};
	}

	const id = tableId(sheet.name, detection.spec.headerRows[0]);
	const { spec, user } = applyUserColumns(detection.spec, overrides.columns?.[id]);
	const { table, competition }: MaterializedTable = materialize(sheet, spec, 'deterministic', user);
	const aiTrigger = table.status === 'ready' ? null : (competition[0] ?? identifierTrigger(sheet, 'the table needs review'));
	return { ...base, status: table.status, reasons: [...tableSummary(table), ...detection.reasons], tables: [table], aiTrigger };
}
