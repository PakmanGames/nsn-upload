import type {
	CandidateRecord,
	MappingInput,
	Overrides,
	SheetAnalysis,
	WorkbookAnalysis,
	WorkbookModel
} from '../model';

export function finalizeAnalysis(
	model: WorkbookModel,
	sheets: SheetAnalysis[],
	records: CandidateRecord[],
	existing: MappingInput[],
	overrides: Overrides
): WorkbookAnalysis {
	throw new Error('T5: not implemented');
}

export function toMappingInputs(analysis: WorkbookAnalysis): MappingInput[] {
	throw new Error('T5: not implemented');
}
