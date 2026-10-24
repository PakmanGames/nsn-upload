import type {
	InterpretationRequest,
	SheetAnalysis,
	VerificationResult,
	WorkbookInterpretation,
	WorkbookInterpreter,
	WorkbookModel
} from '../model';

export function buildInterpretationRequest(
	model: WorkbookModel,
	sheets: SheetAnalysis[]
): InterpretationRequest {
	throw new Error('T6: not implemented');
}

export function verifyInterpretation(
	model: WorkbookModel,
	request: InterpretationRequest,
	interpretation: WorkbookInterpretation
): VerificationResult {
	throw new Error('T6: not implemented');
}

export function createHttpInterpreter(fetchImpl?: typeof fetch): WorkbookInterpreter {
	throw new Error('T6: not implemented');
}

export async function getAiAvailability(
	fetchImpl?: typeof fetch
): Promise<{ available: boolean; reason?: string }> {
	throw new Error('T6: not implemented');
}
