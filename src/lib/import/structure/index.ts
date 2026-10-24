import type {
	Overrides,
	SheetAnalysis,
	SheetModel,
	TableCandidate,
	TableSpec,
	WorkbookModel
} from '../model';

export function analyzeStructure(model: WorkbookModel, overrides: Overrides): SheetAnalysis[] {
	throw new Error('T3: not implemented');
}

export function materializeTable(
	sheet: SheetModel,
	spec: TableSpec,
	source: TableCandidate['source']
): TableCandidate {
	throw new Error('T3: not implemented');
}
