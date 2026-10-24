/**
 * The PLAN.md fixture expectations as typed data, for the acceptance suite and the E2E smoke test.
 *
 * Every number was recounted from the real workbooks with SheetJS before it was written down.
 * Columns are Excel letters and rows are 1-based Excel rows, so each value can be checked by opening the file.
 * A property is left out only where PLAN.md does not pin the behavior; the suite then asserts nothing about it.
 */
import type { Field, ImportSummary, MappingInput, SheetStatus, SkippedRow } from '../../src/lib/import/model';

export type TableExpectation = {
	headerRows: number[];
	/** Every mapped column as field -> column letter. Columns not listed must stay unmapped. */
	mapping?: Partial<Record<Field, string>>;
	dataRows?: number[];
	skippedRows?: SkippedRow[];
	/** Candidate records built from this table. */
	records?: number;
	/** Optional fields without a column: a table-level reason each, never a per-row warning. */
	absentOptional?: Field[];
};

export type SheetExpectation = {
	name: string;
	status: SheetStatus;
	/** Present exactly when the status is ready or needs-review. */
	table?: TableExpectation;
};

export type FixtureExpectation = {
	file: string;
	/** In workbook order. */
	sheets: SheetExpectation[];
	/** analyze(model, [], {}) before any decision. Counts cover included and pending tables, not excluded ones. */
	initial: Partial<ImportSummary>;
	/** After every pending decision is resolved with its suggestion in one pass ("Accept all suggestions"). */
	afterAcceptAll: Partial<ImportSummary>;
};

/** Inclusive run of row numbers. */
export function rows(first: number, last: number): number[] {
	return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export const wow = {
	file: 'WOW NSN list 7-20-26 (2).xlsx',
	sheets: [
		{
			name: 'Active Parts',
			status: 'ready',
			table: {
				headerRows: [1],
				// A-C hold a UUID, a checksum, and a modified date in zero-width columns.
				mapping: { part: 'D', nsn: 'E', description: 'F' },
				dataRows: rows(2, 180),
				skippedRows: [],
				records: 180
			}
		},
		{ name: 'hiddenSheet', status: 'hidden' }
	],
	initial: {
		sheets: 2,
		tablesIncluded: 1,
		sourceRows: 179,
		candidates: 180,
		invalid: 0,
		duplicates: 0,
		conflicts: 0,
		splitRecords: 2,
		pendingDecisions: 0,
		toImport: 180
	},
	afterAcceptAll: { pendingDecisions: 0, toImport: 180 },
	nsn: {
		column: 'E',
		nonEmpty: 129,
		valid: 127,
		/** Both rows still import their part number (D6: valid portion). */
		malformed: [
			{ row: 134, original: '12663107', sameAsPartIn: 'D134' },
			{ row: 166, original: '280-035-330-101F' }
		]
	},
	split: { row: 136, cell: 'D136', parts: ['12669555', 'RVX08212'], description: 'Sprocket, Final Drive' },
	/** Rows whose mapped Description cell is empty. */
	missingDescriptionRows: [180],
	/** D9: kept verbatim with a warning. */
	annotatedPart: { row: 43, value: '12273108 (EATON M144E)' }
} satisfies FixtureExpectation & Record<string, unknown>;

export const statz = {
	file: 'Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx',
	sheets: [
		{
			name: 'Sheet1',
			status: 'ready',
			table: {
				headerRows: [1],
				// B "Dwg Number" competes for part and must stay unmapped.
				mapping: { part: 'A', nsn: 'C' },
				dataRows: [...rows(2, 31), ...rows(35, 58)],
				skippedRows: [
					{ row: 32, reason: 'blank' },
					{ row: 33, reason: 'blank' },
					{ row: 34, reason: 'repeated-header' }
				],
				records: 54,
				absentOptional: ['description', 'cage']
			}
		}
	],
	initial: {
		sheets: 1,
		tablesIncluded: 1,
		sourceRows: 54,
		candidates: 54,
		invalid: 0,
		duplicates: 0,
		conflicts: 0,
		splitRecords: 0,
		pendingDecisions: 0,
		toImport: 54
	},
	afterAcceptAll: { pendingDecisions: 0, toImport: 54 },
	competingPartColumn: 'B',
	/** Rows sharing a NIIN under different FSCs (D4): every row gets fsc-niin-mismatch and still imports. */
	fscNiinMismatchGroups: [
		[20, 22],
		[25, 26],
		[37, 38, 39],
		[44, 45]
	],
	partsWithSeveralNsns: 13
} satisfies FixtureExpectation & Record<string, unknown>;

const XREF = 'NSN Cross-Reference';
const INTAKE = 'Part Number Intake';

export const pencom = {
	file: 'PENCOM_Government_Procurement_Database (2).xlsx',
	sheets: [
		{ name: 'Dashboard', status: 'no-table' },
		{
			name: XREF,
			status: 'ready',
			table: {
				headerRows: [2],
				// G "Manufacturer" holds "PENCOM" and must not become CAGE.
				mapping: { nsn: 'A', fsc: 'B', niin: 'C', description: 'D', part: 'E', cage: 'F' },
				dataRows: [3, 4],
				skippedRows: [],
				records: 2
			}
		},
		{ name: 'Opportunity Matrix', status: 'no-table' },
		{
			name: INTAKE,
			status: 'ready',
			table: {
				headerRows: [2],
				// I "NSN Found" holds Yes/No and must not become NSN.
				mapping: { part: 'A', description: 'C', nsn: 'J', fsc: 'K' },
				dataRows: [3, 4],
				skippedRows: [
					{ row: 5, reason: 'no-mapped-values' },
					{ row: 6, reason: 'no-mapped-values' },
					{ row: 7, reason: 'no-mapped-values' }
				],
				records: 2
			}
		},
		{ name: 'Search Log', status: 'needs-review', table: { headerRows: [2] } },
		{ name: 'Sources & Notes', status: 'no-table' }
	],
	// Summary counts cover included and pending tables, so the initial counts also include Search Log's records,
	// whose number depends on how its columns are mapped. Once it is excluded only XRef and Intake count.
	initial: { sheets: 6, tablesIncluded: 2, conflicts: 4, pendingDecisions: 3, toImport: 0 },
	afterAcceptAll: { tablesIncluded: 2, sourceRows: 4, candidates: 4, pendingDecisions: 0, toImport: 2 },
	/** D5: held back as a pending include-table decision with "exclude" suggested. */
	heldBackSheet: 'Search Log',
	/** Same part + NSN on both sheets with different descriptions; the XRef record has more fields (CAGE). */
	conflicts: [
		{
			preferred: { sheet: XREF, row: 3, descriptionCell: 'D3' },
			other: { sheet: INTAKE, row: 4, descriptionCell: 'C4' }
		},
		{
			preferred: { sheet: XREF, row: 4, descriptionCell: 'D4' },
			other: { sheet: INTAKE, row: 3, descriptionCell: 'C3' }
		}
	],
	/** toImportPlan().add after "Accept all suggestions". */
	imported: [
		{
			part: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P',
			description: 'Screw, Machine',
			nsn: '5305016582565',
			niin: '016582565',
			cage: '0BWZ1'
		},
		{
			part: 'SE5826',
			description: 'Screw, Assembly',
			nsn: '5305016698021',
			niin: '016698021',
			cage: '0BWZ1'
		}
	] satisfies MappingInput[]
} satisfies FixtureExpectation & Record<string, unknown>;

export const FIXTURES: FixtureExpectation[] = [wow, statz, pencom];
