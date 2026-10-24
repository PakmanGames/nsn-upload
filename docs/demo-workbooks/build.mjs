/**
 * Builds the demo workbooks in this folder. Run from the repository root:
 *
 *   node docs/demo-workbooks/build.mjs
 *
 * Every value is fixed, so a rebuild gives the same cells (only the zip entries' timestamps change).
 * README.md says what each one shows, and
 * tests/acceptance/demo-workbooks.test.ts checks that the committed files still behave that way.
 * Part numbers differ from the example workbooks, so demos can run in any order (except c, which needs PENCOM).
 */
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const OUT_DIR = fileURLToPath(new URL('.', import.meta.url));
// Fixed document dates, so rebuilding does not change the files' metadata.
const STAMP = new Date(Date.UTC(2026, 9, 24, 9, 0));

/** A sheet with readable column widths and a bold header row, the way a person would leave it. */
function addSheet(workbook, name, widths) {
	const sheet = workbook.addWorksheet(name);
	sheet.columns = widths.map((width) => ({ width }));
	return sheet;
}

function boldRow(sheet, row) {
	sheet.getRow(row).font = { bold: true };
}

async function write(fileName, build) {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = 'NSN Smart Upload demo';
	workbook.created = STAMP;
	workbook.modified = STAMP;
	build(workbook);
	await workbook.xlsx.writeFile(OUT_DIR + fileName);
	console.log(`wrote docs/demo-workbooks/${fileName}`);
}

// (a) NSNs under a header the rules do not know, below a title: the importer holds the table back and offers AI.
await write('a-ai-unfamiliar-header.xlsx', (workbook) => {
	const sheet = addSheet(workbook, 'Stock List', [12, 22, 28, 8]);
	sheet.addRows([
		['Depot stock list (export 2026-10)'],
		['Quantities as of the last count.'],
		[],
		['Ref', 'National Stock No.', 'Item', 'Qty'],
		['A-100', '5305-01-658-2565', 'Screw, machine', 40],
		['A-101', '5305-01-669-8021', 'Screw, assembly', 25],
		['A-102', '5340-01-102-4535', 'Guard, shock absorber', 4],
		['A-103', '3020-01-660-9619', 'Carrier, drive sprocket', 2],
		['A-104', '2530-00-967-3346', 'Hub assembly, wheel', 6],
		['A-105', '5310-01-678-9012', 'Nut, hex', 120]
	]);
	sheet.getCell('A1').font = { bold: true, size: 14 };
	boldRow(sheet, 4);
});

// (b) Row 2's NIIN contradicts its own NSN (the NSN says 016582565): the identifier decision.
await write('b-identifier-conflict.xlsx', (workbook) => {
	const sheet = addSheet(workbook, 'Catalog', [14, 20, 8, 12, 26]);
	sheet.addRows([
		['Part Number', 'NSN', 'FSC', 'NIIN', 'Description'],
		['SCR-0001', '5305-01-658-2565', '5305', '016698021', 'Screw, machine'],
		['GRD-0003', '5340-01-102-4535', '5340', '011024535', 'Guard, shock absorber'],
		['CAR-0004', '3020-01-660-9619', '3020', '016609619', 'Carrier, drive sprocket'],
		['HUB-0005', '2530-00-967-3346', '2530', '009673346', 'Hub assembly, wheel']
	]);
	boldRow(sheet, 1);
});

// (c) Two PENCOM records again, after PENCOM was imported: one with a new description (saved-record conflict),
// one unchanged (skipped automatically as already saved).
await write('c-pencom-changed-copy.xlsx', (workbook) => {
	const sheet = addSheet(workbook, 'Changes', [36, 20, 32, 10]);
	sheet.addRows([
		['Part Number', 'NSN', 'Description', 'CAGE'],
		['6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P', '5305-01-658-2565', 'Screw, machine, pan head, SEMS', '0BWZ1'],
		['SE5826', '5305-01-669-8021', 'Screw, Assembly', '0BWZ1']
	]);
	boldRow(sheet, 1);
});

// (d) Many messy cases in one sheet.
await write('d-messy-showcase.xlsx', (workbook) => {
	const sheet = addSheet(workbook, 'Active Parts', [38, 18, 20, 20, 28, 12]);
	const header = ['(Do Not Modify) Part', '(Do Not Modify) Modified On', 'Part Number', 'NSN', 'Nomenclature'];
	const modified = (day) => new Date(Date.UTC(2026, 9, day, 14, 30));
	sheet.addRows([
		['ACME Depot - Active Parts'],
		['Exported 2026-10-24. Do not edit the first two columns.'],
		[],
		header,
		['3f2a8c1e-5b7d-4e9a-8c21-0d6e4b9f7a10', modified(1), '10931023*92', '1025-00-067-7921', 'Support, pintle'],
		['7b9e2d40-1c6f-4a8b-9e35-2f8d7c1a6b22', modified(2), 'KIT-100\nKIT-100A', '5340-01-102-4535', 'Bracket, mounting'],
		['e85f1a27-6d3c-4b9e-a4f2-7c1b8e5d9a46', modified(3), 'BH011-HT REV 000', '2520-00-066-0239', 'Hub, final drive'],
		[],
		header,
		['1a6c9e52-3f8d-4c2b-9d74-8e2f5a1c7b58', modified(4), '457985-1 B', '9052-00-101-3101', 'Ring, retaining'],
		// Keep this malformed row below the repeated header: in the first block it currently makes detection pick
		// row 9 as the header and drop rows 5-7 (tests/acceptance/messy.test.ts, "a malformed value above a
		// repeated header").
		['c41d7e93-8a2b-4f6c-b1e7-5a9c3d2e8f34', modified(5), '12663107', '12663107', 'Hub, drive'],
		['9d3b7f16-2e5a-4d8c-b6f1-3c7e9a4d2b60', modified(6), '2132981-2  C', '5210-00-081-6052', 'Indicator, dial'],
		['5e8a2c74-9b1f-4e3d-a7c5-6d2b8f1e4a72', modified(7), 'DRV-2210', '3040-01-555-1234', 'Shaft, straight'],
		// Enough valid NSNs that the one malformed value keeps the column at 10 of 11 (high confidence).
		['0b4f6d38-7c2e-4a1d-9f53-1e8a6c3b5d84', modified(8), 'SPR-4410', '5360-01-567-8901', 'Spring, helical'],
		['6c1e3a95-4d7b-4f2e-8a16-9b5d2e7c3f96', modified(9), 'NUT-6650', '5310-01-678-9012', 'Nut, hex'],
		['d27a5f41-8e3c-4b6d-a9f8-4c6e1b9d7a08', modified(10), 'WSH-7702', '5310-01-789-0123', 'Washer, flat'],
		['8f5c2b69-1a4e-4d7f-b3c9-6e2a8d4f1c19', modified(11), 'GSK-3105', '5330-01-345-6789', 'Gasket']
	]);
	sheet.mergeCells('A1:F1');
	sheet.mergeCells('A2:F2');
	// The Nomenclature header spans E:F over a wide description area.
	sheet.mergeCells('E4:F4');
	sheet.getCell('A1').font = { bold: true, size: 14 };
	boldRow(sheet, 4);
	boldRow(sheet, 9);
	for (const row of [5, 6, 7, ...Array.from({ length: 8 }, (_, i) => 10 + i)]) {
		sheet.getCell(`B${row}`).numFmt = 'yyyy-mm-dd hh:mm';
	}
	sheet.getCell('C6').alignment = { wrapText: true };
});
