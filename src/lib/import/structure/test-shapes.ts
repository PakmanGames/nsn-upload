/**
 * Hand-built sheets that mirror the layouts of the supplied fixtures (and nothing else about them),
 * so structure tests exercise the same shapes as the real files without a reader.
 */
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';

const nsn = (i: number) => `5210-01-${String(100 + i).padStart(3, '0')}-${String(1000 + i)}`;

/** PENCOM: six visible sheets, merged titles on row 1, headers on row 2 (row 3 on the notes sheet). */
export function pencomShape() {
	const dashboard = makeSheet(
		'Dashboard',
		[
			['PENCOM Government Procurement Database'],
			[],
			['Starter database for NSN cross-referencing, government-market research, and part-number intake.'],
			[],
			['Metric', 'Value', null, 'How to use this workbook'],
			['Verified/located NSN records', 2, null, '1. Add PENCOM part numbers to Part Number Intake.\n2. Record NSN results.'],
			['Product families prioritized', 15],
			['High-priority families', 7],
			['Open part-number research rows', 3],
			['Last database build', '2026-07-17'],
			[],
			[],
			['Priority', 'Families'],
			['High', 7],
			['Medium', 6],
			['Low', 2]
		],
		{ merges: ['A1:H2', 'A3:H3', 'D5:H5', 'D6:H10'] }
	);
	const crossReference = makeSheet(
		'NSN Cross-Reference',
		[
			['Confirmed and Candidate PENCOM NSN Cross-Reference'],
			['NSN', 'FSC', 'NIIN', 'Government Item Name', 'PENCOM Part Number', 'CAGE', 'Manufacturer', 'Verification Status', 'Verification Date', 'Primary Source URL', 'Research Notes'],
			['5305-01-658-2565', '5305', '016582565', 'Screw, Machine', '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P', '0BWZ1', 'PENCOM', 'Public-source verified', '2026-07-17', 'https://example.com/screws-623', 'Listing identifies CAGE 0BWZ1. Confirm in WebFLIS.'],
			['5305-01-669-8021', '5305', '016698021', 'Screw, Assembly', 'SE5826', '0BWZ1', 'PENCOM', 'Public-source verified', '2026-07-17', 'https://example.com/screws-s63', 'Listing links SE5826 to this NSN.']
		],
		{ merges: ['A1:K1'] }
	);
	const matrix = makeSheet(
		'Opportunity Matrix',
		[
			['PENCOM Product-Family Government Opportunity Matrix'],
			['Product Family', 'Example PENCOM Series', 'Likely FSC', 'Defense Relevance (1-5)', 'NSN Matchability (1-5)', 'Priority', 'Suggested Search Terms', 'Research Status', 'Owner'],
			['Machine screws', 'Commercial/custom screw lines', '5305', 5, 5, 'High', 'CAGE 0BWZ1 screw; PENCOM part number; NSN 5305', 'Active'],
			['Captive screws', 'CPE, CNC and related', '5305 / 5340', 5, 4, 'High', 'captive screw NSN; panel fastener NSN', 'Active'],
			['Cage nuts', 'Cage nut lines', '5310 / 5340', 5, 5, 'High', 'cage nut NSN; rack nut NSN', 'Active'],
			['Custom manufactured components', 'Print-to-print parts', 'Multiple', 5, 2, 'Low', 'source controlled drawing', 'Active']
		],
		{ merges: ['A1:I1'] }
	);
	const intake = makeSheet(
		'Part Number Intake',
		[
			['PENCOM Part Number Intake and Research Queue'],
			['PENCOM Part Number', 'Product Family', 'Description', 'Thread / Size', 'Research Status', 'NSN Found', 'NSN', 'FSC', 'MIL/MS/NAS Equivalent', 'PEM / Competitor Equivalent', 'Source URL', 'Notes'],
			['SE5826', 'Machine / assembly screw', 'Assembly screw', null, 'Complete', 'Yes', '5305-01-669-8021', '5305', null, null, 'https://example.com/screws-s63', 'Confirm in WebFLIS before bid'],
			['6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P', 'Machine screw', '6-32 x 1/4 pan-head SEMS machine screw', '6-32 x 1/4', 'Complete', 'Yes', '5305-01-658-2565', '5305', null, null, 'https://example.com/screws-623', 'Confirm in WebFLIS before bid'],
			[null, null, null, null, 'Research'],
			[null, null, null, null, 'Research'],
			[null, null, null, null, 'Research']
		],
		{ merges: ['A1:L1'] }
	);
	const searchLog = makeSheet(
		'Search Log',
		[
			['Government Procurement Research Log'],
			['Search Date', 'Part Number / Family', 'Database / Website', 'Search Query', 'Result', 'NSN / Reference', 'Source URL', 'Verified By', 'Follow-up'],
			['2026-07-17', 'PENCOM CAGE', 'PENCOM website', 'PENCOM products and company', 'Manufacturer and product scope confirmed', 'CAGE 0BWZ1 from public NSN sources', 'https://example.com/products', null, 'Validate CAGE status in SAM / DLA'],
			['2026-07-17', '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P', 'PartTarget', 'Exact part number', 'NSN located', '5305-01-658-2565', 'https://example.com/screws-623', null, 'Confirm in WebFLIS'],
			['2026-07-17', 'SE5826', 'PartTarget', 'Exact part number', 'NSN located', '5305-01-669-8021', 'https://example.com/screws-s63', null, 'Confirm in WebFLIS']
		],
		{ merges: ['A1:I1'] }
	);
	const notes = makeSheet(
		'Sources & Notes',
		[
			['Sources, Limitations, and Recommended Data Services'],
			[],
			['Source / Service', 'Type', 'Best Use', 'Access', 'URL', 'Notes'],
			['DLA WebFLIS', 'Government catalog', 'Official NSN item and reference-number research', 'Government', 'https://example.com/webflis', 'Preferred verification source before quoting'],
			['PartTarget', 'Commercial NSN aggregator', 'Fast public discovery of NSN and part-number associations', 'Public', 'https://example.com/parttarget', 'Treat as discovery source, not final authority'],
			[],
			['Recommended expansion workflow'],
			['A complete database requires a source list of PENCOM part numbers, then NSN searches by part number and CAGE.']
		],
		{ merges: ['A1:F1', 'A7:F7', 'A8:F12'] }
	);
	return makeWorkbook('pencom.xlsx', [dashboard, crossReference, matrix, intake, searchLog, notes]);
}

/** Statz: header on row 1, two data blocks split by two blank rows and a repeated header (rows 32-34). */
export function statzShape() {
	const header = ['G & B P/N', 'Dwg Number', 'NSN', 'Status', 'Mfg.', 'Type', 'COMMENTS'];
	const drawings: CellInput[] = [7646198, 'MS35106-1', '2132981-2  C', null, null, 8520286, 'SM-A-802914', '457985-1 B', null, 12297933];
	const row = (i: number): CellInput[] => [
		`2-${10000 + i * 7}`,
		drawings[i % drawings.length],
		nsn(i),
		i % 9 === 0 ? 'O' : 'A',
		i % 9 === 0 ? 'N' : 'Y',
		i % 2 ? 'S' : 'C',
		i % 11 === 0 ? 'MIL-V-3144, Type CA-1' : null
	];
	const rows: CellInput[][] = [header];
	for (let i = 0; i < 30; i++) rows.push(row(i));
	rows.push([], [], header);
	for (let i = 30; i < 54; i++) rows.push(row(i));
	return makeWorkbook('statz.xlsx', [makeSheet('Sheet1', rows)]);
}

const uuid = (i: number) => `${String(i).padStart(8, '0')}-c8c9-f011-bbd2-000d3a3bdce8`;
const checksum = (i: number) => `ek/XvRB+KQDtfaQrA5LpFTL2dmwXKv9fQlxcuCQk6yKxxV8khzs1p9gv${i}==`;
const modified = { kind: 'date', text: '12/12/25 2:48', raw: 46003.1 } as const;

/**
 * WOW: zero-width metadata columns A-C (UUID, checksum, modified date), Part / NSN / Nomenclature in D-F,
 * two malformed NSNs, a two-part cell, rows without an NSN, and a very hidden metadata sheet.
 */
export function wowShape(options: { metadataHidden?: boolean } = {}) {
	const rows: CellInput[][] = [['(Do Not Modify) Part', '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On', 'Part Number', 'NSN', 'Nomenclature']];
	const parts = ['10552364', '10931023*92', '12273108 (EATON M144E)', '12669555\nRVX08212', 'BH011-HT REV 000', 'PPIM 21023', 'MS28775-340', 'RC 620'];
	// 30 rows: 6 without an NSN, 2 malformed (rows 7 and 12), so 22 of 24 NSN values are valid.
	for (let i = 0; i < 30; i++) {
		const part = parts[i % parts.length];
		const value = i === 5 ? '12663107' : i === 10 ? '280-035-330-101F' : i % 5 === 4 ? null : `5340-00-${200 + i}-${4000 + i}`;
		rows.push([uuid(i), checksum(i), modified, part, value, i === 29 ? null : 'Packing, preformed, hydraulic']);
	}
	const active = makeSheet('Active Parts', rows, { hiddenCols: options.metadataHidden === false ? [] : [1, 2, 3] });
	const hidden = makeSheet('hiddenSheet', [['wow_part:JLhgb2R1SGvMRBKPOjcIuXvC6DQJ']], { visibility: 'veryHidden' });
	return makeWorkbook('wow.xlsx', [active, hidden]);
}
