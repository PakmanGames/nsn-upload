/**
 * Rows the importer left out of each table, with what they hold, so the Rows section can show that nothing
 * was dropped by mistake. Blank rows are only spacing and are not listed.
 */
import type { SkippedRow, TableCandidate, WorkbookAnalysis, WorkbookModel } from '$lib/import/model';

/** Values shown per skipped row; enough to recognize a form label or a repeated header. */
const PREVIEW_VALUES = 4;

export type SkippedLine = { row: number; reason: SkippedRow['reason']; preview: string };
export type SkippedGroup = { table: TableCandidate; rows: SkippedLine[] };

/** The row's own values across the sheet, joined with " · "; merged cells count once. */
function preview(model: WorkbookModel, sheetName: string, row: number): string {
	const sheet = model.sheets.find((candidate) => candidate.name === sheetName);
	const extent = sheet?.valueExtent;
	if (!sheet || !extent) return '';
	const values: string[] = [];
	for (let col = extent.left; col <= extent.right && values.length < PREVIEW_VALUES; col++) {
		const cell = sheet.cell(row, col);
		if (cell.kind !== 'empty' && !cell.mergedFrom && cell.text.trim()) values.push(cell.text.trim().replace(/\s+/g, ' '));
	}
	return values.join(' · ');
}

export function skippedGroups(analysis: WorkbookAnalysis, model: WorkbookModel | null): SkippedGroup[] {
	if (!model) return [];
	return analysis.sheets.flatMap((sheet) =>
		sheet.tables.flatMap((table) => {
			const rows = table.skippedRows
				.filter((skip) => skip.reason !== 'blank')
				.map((skip) => ({ ...skip, preview: preview(model, table.sheet, skip.row) }));
			return rows.length > 0 ? [{ table, rows }] : [];
		})
	);
}
