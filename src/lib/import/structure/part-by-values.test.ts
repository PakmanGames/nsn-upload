/**
 * A Part column chosen by its values, the `Material #` hint, and headers that only mention a field (E4).
 * The shapes follow `Substring Headers in Diff Sheet (1).xlsx`: part numbers under a label that is not Part
 * vocabulary, next to prices, quantities, and supplier columns whose headers mention NSN, PN, or CAGE.
 */
import { describe, expect, it } from 'vitest';
import type { TableCandidate } from '../model';
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure } from '.';

const PARTS = ['02-15784', '03W2504-164', '130909B190', '131554-4F', '132877-2', '131960 AMS3208'];
const OTHER_PARTS = ['MS35106-1', '12297933', 'SM-A-802914', '457985-1 B', '415374-1', '12273488-D'];
const NSNS = ['4330-01-320-0968', '5310-01-580-7835', '5306-01-482-8472', '5340-01-482-2716', '4910-01-362-2331', '3110-01-398-0114'];
const DESCRIPTIONS = ['FILTER,FUEL PUMP OUTLET', 'WASHER', 'BOLT', 'BRACKET', 'SHIM', 'SPACER'];
const PRICES = ['$44.03', '$44.03', '$2.06', '$249.75', '$188.01', '$1,133.31'];
const QUANTITIES = [220, 25.55555555555556, 66, 1253.555555555556, 31.33333333333334, 4004.222222222222];
const PLATFORMS = [
	'AIRCRAFT, GALAXY C-5',
	'AIRCRAFT, STRATOLIFTER C/KC-135',
	'AIRCRAFT, AWACS, E-3A',
	'AIRCRAFT, GALAXY C-5',
	'AIRCRAFT,B-2 BOMBER (ATB)',
	'AIRCRAFT, B-1B'
];
const CONTACTS = [
	'Chad | chad.rowe@fdhaero.com',
	'Colene Cumbo | sales@dbr-industries.com',
	' | joes@bladeindustrial.com',
	'Enrique | DANS@HCPACIFIC.COM',
	'Thomas Smith | gtinc1@comcast.net',
	'Craig Morgan | craig.morgan@appliedavionics.com'
];
const SUPPLIERS = ['DBR INDUSTRIES, INC.', 'BLADE INDUSTRIAL PRODUCTS INC', 'HC MERCHANDISERS INC', 'FDH AERO, LLC', 'WAMCO INC', 'GREGORY THOMAS INC'];

/** One table, header on row 1: each entry is a column's header and its values, in order. */
function tableOf(columns: Record<string, CellInput[]>): TableCandidate {
	const headers = Object.keys(columns);
	const length = Math.max(...Object.values(columns).map((values) => values.length));
	const rows = Array.from({ length }, (_, i) => headers.map((header) => columns[header][i] ?? null));
	const [sheet] = analyzeStructure(makeWorkbook('test.xlsx', [makeSheet('Parts', [headers, ...rows])]), {});
	expect(sheet.tables, `tables on ${sheet.name}: ${sheet.reasons.join('; ')}`).toHaveLength(1);
	return sheet.tables[0];
}

/** Field -> column letter for mapped columns. */
function mapping(table: TableCandidate): Record<string, string> {
	return Object.fromEntries(table.columns.filter((c) => c.field).map((c) => [c.field!, String.fromCharCode(64 + c.col)]));
}

const column = (table: TableCandidate, header: string) => table.columns.find((c) => c.header === header)!;

describe('a Part column chosen by its values', () => {
	it('maps the one part-shaped column at medium confidence when no header says Part', () => {
		const table = tableOf({ Item: PARTS, NSN: NSNS, Description: DESCRIPTIONS, 'Unit Price': PRICES, 'Qty/Year': QUANTITIES });

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'B', description: 'C' });
		expect(column(table, 'Item')).toMatchObject({
			confidence: 'medium',
			reasons: ['No header says Part, but 6 of 6 values look like part numbers']
		});
		// The NSN column is high, and a medium Part column does not hold the table back.
		expect(table.status).toBe('ready');
	});

	it('never counts prices, decimals, platform names, or emails as part numbers', () => {
		const table = tableOf({ NSN: NSNS, 'Unit Price': PRICES, 'Qty/Year': QUANTITIES, Platform: PLATFORMS, Contact: CONTACTS });

		expect(mapping(table)).toEqual({ nsn: 'A' });
		for (const header of ['Unit Price', 'Qty/Year', 'Platform', 'Contact']) {
			expect(column(table, header).alternatives, header).toEqual([]);
		}
	});

	it('maps neither of two part-shaped columns and offers both, naming the tie', () => {
		const table = tableOf({ Item: PARTS, Drawing: OTHER_PARTS, NSN: NSNS });

		expect(mapping(table)).toEqual({ nsn: 'C' });
		expect(column(table, 'Item')).toMatchObject({ field: null, alternatives: ['part'] });
		expect(column(table, 'Item').reasons).toContain(
			'6 of 6 values look like part numbers, and so do the values in column B; no header says which one holds them'
		);
		expect(column(table, 'Drawing')).toMatchObject({ field: null, alternatives: ['part'] });
	});

	it('leaves categories alone: letters (A/O) never qualify, and a repeated code is only an alternative', () => {
		const table = tableOf({
			Item: PARTS,
			NSN: NSNS,
			Status: ['A', 'O', 'A', 'A', 'O', 'A'],
			Platform: ['C-130', 'C-130', 'C-17', 'C-130', 'C-17', 'C-130']
		});

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'B' });
		expect(column(table, 'Status').alternatives).toEqual([]);
		expect(column(table, 'Platform')).toMatchObject({ field: null, alternatives: ['part'] });
	});

	it('does not pick a mostly empty column, which is more likely a drawing or replacement number', () => {
		const replacements = ['12297933', null, null, '11669861', null, null, '12273488-D', null];
		const table = tableOf({ NSN: [...NSNS, '5305-01-658-2565', '5305-01-669-8021'], 'Replaced By': replacements });

		expect(mapping(table)).toEqual({ nsn: 'A' });
		expect(column(table, 'Replaced By')).toMatchObject({ field: null, alternatives: ['part'] });
	});

	it('does not count a column that another field explains, such as CAGE codes', () => {
		const table = tableOf({ Item: PARTS, NSN: NSNS, CAGE: ['0BWZ1', '1ABC2', '3D4E5', '6F7G8', '9H0J1', '2K3L4'] });

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'B', cage: 'C' });
	});

	it('lets a column whose header names Part win; a part-shaped column beside it is only an alternative', () => {
		const table = tableOf({ 'Part Number': PARTS, Drawing: OTHER_PARTS, NSN: NSNS });

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'C' });
		expect(column(table, 'Part Number').confidence).toBe('high');
		expect(column(table, 'Drawing').reasons).toEqual(["6 of 6 values look like part numbers, but the header doesn't say Part"]);
		expect(table.status).toBe('ready');
	});

	it('keeps values under a Part header passing even where the shape check would reject them', () => {
		const table = tableOf({ 'Part Number': ['5342', '12.5', 'AN 3', 'C-5, REV A', '220', 'Widget 0'], NSN: NSNS });

		expect(column(table, 'Part Number')).toMatchObject({
			field: 'part',
			confidence: 'high',
			reasons: ["Header 'Part Number' matches Part", '6 of 6 values are plausible part numbers']
		});
	});

	it('is not blocked by a header that only mentions Part (MATCH: NSN/PN Supplier)', () => {
		const table = tableOf({ Item: PARTS, NSN: NSNS, 'MATCH: NSN/PN Supplier': SUPPLIERS });

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'B' });
		expect(column(table, 'Item').confidence).toBe('medium');
	});
});

describe('the Material # hint', () => {
	it.each(['Material #', 'Material Number', 'Material No.'])('maps %j as Part at medium confidence, never high', (header) => {
		const table = tableOf({ [header]: PARTS, NSN: NSNS });

		expect(mapping(table)).toEqual({ part: 'A', nsn: 'B' });
		expect(column(table, header)).toMatchObject({
			confidence: 'medium',
			reasons: ["The header doesn't say Part, but a material number is usually the part number", '6 of 6 values look like part numbers']
		});
	});

	it('checks a hinted column by shape, so prices under it are not part numbers', () => {
		const table = tableOf({ 'Material No': PRICES, NSN: NSNS });

		expect(mapping(table)).toEqual({ nsn: 'B' });
		expect(column(table, 'Material No').reasons).toEqual([
			'A material number is usually the part number, but 0 of 6 values look like part numbers'
		]);
	});

	it('wins over a part-shaped column without a header hint', () => {
		const table = tableOf({ Item: OTHER_PARTS, 'Material #': PARTS, NSN: NSNS });

		expect(mapping(table)).toEqual({ part: 'B', nsn: 'C' });
		expect(column(table, 'Item')).toMatchObject({ field: null, alternatives: ['part'] });
	});
});

describe('headers that only mention a field', () => {
	// Two real NSNs among supplier names: a coincidence, not an NSN column.
	const MENTIONS = ['5305-01-658-2565', 'DBR INDUSTRIES, INC.', 'HC MERCHANDISERS INC', '5305-01-669-8021', 'WAMCO INC', 'FDH AERO, LLC'];

	it('never lets MATCH: NSN/PN Supplier with a few valid NSNs outrank the real NSN column', () => {
		const table = tableOf({ 'MATCH: NSN/PN Supplier': MENTIONS, 'Material #': PARTS, 'Matched NSN(s)': NSNS });

		expect(mapping(table)).toEqual({ part: 'B', nsn: 'C' });
		expect(column(table, 'MATCH: NSN/PN Supplier')).toMatchObject({ field: null, alternatives: [] });
		expect(column(table, 'MATCH: NSN/PN Supplier').reasons).toEqual([
			'Header mentions NSN, but 2 of 6 values are valid NSNs',
			'Header mentions Part, but 2 of 6 values are plausible part numbers'
		]);
		expect(table.status).toBe('ready');
	});

	it('nor an NSN column found by its values alone', () => {
		const table = tableOf({ 'MATCH: NSN/PN Supplier': MENTIONS, Stock: NSNS });

		expect(mapping(table)).toEqual({ nsn: 'B' });
		expect(column(table, 'Stock')).toMatchObject({ field: 'nsn', confidence: 'medium' });
	});

	it('explains a CAGE mention with no CAGE codes in one line', () => {
		const table = tableOf({ 'Material #': PARTS, NSN: NSNS, 'MATCH: CAGE Supplier': SUPPLIERS });

		expect(column(table, 'MATCH: CAGE Supplier').reasons).toEqual(['Header mentions CAGE, but 0 of 6 values are valid CAGE codes']);
	});
});
