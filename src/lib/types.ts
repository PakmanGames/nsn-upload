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
