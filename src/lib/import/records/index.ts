import type { CandidateRecord, Overrides, SheetAnalysis, WorkbookModel } from '../model';
import { buildTableRecords } from './table';

/**
 * Builds candidate records for every detected table, ready or needs-review, in sheet and row order.
 * Tables awaiting review are built too so the preview can show them; validate/ keeps them out of import.
 */
export function buildRecords(
	model: WorkbookModel,
	sheets: SheetAnalysis[],
	overrides: Overrides
): CandidateRecord[] {
	const sheetModels = new Map(model.sheets.map((sheet) => [sheet.name, sheet]));
	return sheets.flatMap((analysis) =>
		analysis.tables.flatMap((table) => {
			const sheet = sheetModels.get(table.sheet);
			if (!sheet) throw new Error(`Table ${table.id} refers to unknown sheet "${table.sheet}"`);
			return buildTableRecords(model.fileName, sheet, table, overrides);
		})
	);
}
