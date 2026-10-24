export type MappingInput = {
	part?: string;
	description?: string;
	nsn?: string;
	niin?: string;
	cage?: string;
};

export type MappingRecord = MappingInput & {
	id: string;
	createdAt: string;
	status: 'Ready' | 'Processing' | 'Enriched';
};

export type UploadRow = {
	line: number;
	input: MappingInput;
	identifier: string;
	warnings: string[];
	error?: string;
};

export type UploadAnalysis = {
	fileName: string;
	sheetName: string;
	headers: string[];
	columns: Record<keyof MappingInput, number>;
	rows: UploadRow[];
};

export type ImportResult = {
	success: number;
	failed: Array<{ line: number; identifier: string; error: string }>;
};
