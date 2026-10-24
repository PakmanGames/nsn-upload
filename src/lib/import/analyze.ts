import type { Overrides, StoredMapping, WorkbookAnalysis, WorkbookModel } from './model';
import { analyzeStructure } from './structure';
import { buildRecords } from './records';
import { finalizeAnalysis } from './validate';

/** Pure and deterministic: the UI calls it again with new overrides instead of rereading the file. */
export function analyze(
	model: WorkbookModel,
	existing: StoredMapping[],
	overrides: Overrides = {}
): WorkbookAnalysis {
	const sheets = analyzeStructure(model, overrides);
	const records = buildRecords(model, sheets, overrides);
	return finalizeAnalysis(model, sheets, records, existing, overrides);
}
