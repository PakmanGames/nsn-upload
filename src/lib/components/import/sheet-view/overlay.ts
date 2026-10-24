/**
 * What the importer found, in the shape the spreadsheet view draws: per sheet, each table's outline and tone, its
 * header rows, the field chip of each mapped column, its skipped rows, and which record each data row became.
 *
 * Built once per analysis, so drawing a cell is a few map lookups rather than a walk over the analysis.
 */
import type { CellRange, Field, SkippedRow, WorkbookAnalysis } from '$lib/import/model';
import { contains } from './geometry';

/** included: the table imports. pending: it waits on a decision. excluded: left out by the user or a suggestion. */
export type TableTone = 'included' | 'pending' | 'excluded';

/** Skipped rows the view dims; hidden rows are collapsed instead. */
export type DimReason = Exclude<SkippedRow['reason'], 'hidden'>;

export type TableOverlay = {
	id: string;
	range: CellRange;
	tone: TableTone;
	headerRows: ReadonlySet<number>;
	/** Mapped columns and their fields. */
	fields: ReadonlyMap<number, Field>;
	skipped: ReadonlyMap<number, DimReason>;
	/** Data row -> its first record's id (a split row has several), so clicking a cell opens that record. */
	records: ReadonlyMap<number, string>;
};

export type Chip = { field: Field; tone: TableTone };

export type SheetOverlay = {
	tables: TableOverlay[];
	/** Column -> the chips under its letter: stacked tables can map one column to different fields. */
	chips: ReadonlyMap<number, Chip[]>;
};

export const EMPTY_OVERLAY: SheetOverlay = { tables: [], chips: new Map() };

export function buildOverlay(analysis: WorkbookAnalysis): Map<string, SheetOverlay> {
	const include = new Map(
		analysis.decisions
			.filter((decision) => decision.kind === 'include-table' && decision.tableId)
			.map((decision) => [decision.tableId!, decision])
	);
	const firstRecord = new Map<string, Map<number, string>>();
	for (const record of analysis.records) {
		const rows = firstRecord.get(record.tableId) ?? new Map<number, string>();
		if (!rows.has(record.sourceRow)) rows.set(record.sourceRow, record.id);
		firstRecord.set(record.tableId, rows);
	}

	const overlays = new Map<string, SheetOverlay>();
	for (const sheet of analysis.sheets) {
		const chips = new Map<number, Chip[]>();
		const tables = sheet.tables.map((table): TableOverlay => {
			const decision = include.get(table.id);
			// A table without an include decision imports, as a ready table does.
			const tone: TableTone =
				!decision || decision.chosen === 'include' ? 'included' : decision.state === 'pending' ? 'pending' : 'excluded';
			const fields = new Map<number, Field>();
			for (const column of table.columns) {
				if (!column.field) continue;
				fields.set(column.col, column.field);
				const list = chips.get(column.col) ?? [];
				if (!list.some((chip) => chip.field === column.field && chip.tone === tone)) list.push({ field: column.field, tone });
				chips.set(column.col, list);
			}
			return {
				id: table.id,
				range: table.range,
				tone,
				headerRows: new Set(table.headerRows),
				fields,
				skipped: new Map(
					table.skippedRows.flatMap((skip) => (skip.reason === 'hidden' ? [] : [[skip.row, skip.reason] as const]))
				),
				records: firstRecord.get(table.id) ?? new Map()
			};
		});
		overlays.set(sheet.name, { tables, chips });
	}
	return overlays;
}

/** The table a cell falls in, if any. */
export function tableAt(overlay: SheetOverlay, row: number, col: number): TableOverlay | undefined {
	return overlay.tables.find((table) => contains(table.range, row, col));
}
