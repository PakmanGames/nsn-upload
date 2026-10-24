import type { ReadLimits, WorkbookModel } from '../model';

export async function readWorkbook(
	data: ArrayBuffer,
	fileName: string,
	limits?: Partial<ReadLimits>
): Promise<WorkbookModel> {
	throw new Error('T1: not implemented');
}
