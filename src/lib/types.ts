export type MappingInput = {
	part?: string;
	description?: string;
	nsn?: string;
	niin?: string;
	cage?: string;
	/**
	 * Identifiers the importer worked out rather than read (a NIIN from the NSN, an NSN from FSC + NIIN),
	 * kept so the saved list can label them (D25). Optional: data saved before it, and demo data, has none.
	 */
	derived?: Array<'nsn' | 'niin'>;
};

export type MappingRecord = MappingInput & {
	id: string;
	createdAt: string;
	status: 'Ready' | 'Processing' | 'Enriched';
};
