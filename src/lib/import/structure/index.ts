/**
 * Structure stage: finds each sheet's table, maps its columns to fields, and classifies the sheet.
 * See docs/ARCHITECTURE.md, "Structure detection and mapping".
 */
import type {
	Overrides,
	SheetAnalysis,
	SheetModel,
	TableCandidate,
	TableSpec,
	WorkbookModel
} from '../model';
import { analyzeSheet } from './sheet';
import { materialize } from './table';

export { normalizeHeader } from './header';

export function analyzeStructure(model: WorkbookModel, overrides: Overrides): SheetAnalysis[] {
	return model.sheets.map((sheet) => analyzeSheet(sheet, overrides));
}

/** Scores a table shape from detection, the user, or the AI with the same rules. */
export function materializeTable(
	sheet: SheetModel,
	spec: TableSpec,
	source: TableCandidate['source']
): TableCandidate {
	return materialize(sheet, spec, source).table;
}
