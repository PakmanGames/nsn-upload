/**
 * The import flow in a real browser against the production build: upload, review, decide, import, and find
 * the records in the mappings table. Counts come from tests/fixtures/expectations.ts, the same targets the
 * acceptance suite checks on the pipeline, so the UI is held to what the analysis promises.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { demoMappings } from '../../src/lib/demo-data';
import type { ImportSummary, MappingInput, SheetStatus } from '../../src/lib/import/model';
import { FIXTURES, pencom, statz, wow } from '../fixtures/expectations';
import { FIXTURE_DIR, importButton, interpretRequests, openSection, recordAiRequests, section, turnAiOff, upload, XLSX_TYPE } from './helpers';

/** What each sheet card's badge says. */
const BADGE: Record<SheetStatus, string> = {
	ready: 'Ready',
	'needs-review': 'Needs review',
	'no-table': 'No importable table',
	hidden: 'Hidden - ignored'
};

/** Summary chips by count; only counts above zero get a chip. Without a count the pattern matches any chip of that kind. */
const CHIPS: Array<[keyof ImportSummary, (count?: number) => RegExp]> = [
	['valid', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} valid$`)],
	['warnings', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} warnings?$`)],
	['invalid', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} invalid$`)],
	['duplicates', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} duplicates?$`)],
	['conflicts', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} in conflict$`)],
	// "2 split from D136" when every split record comes from one cell.
	['splitRecords', (n) => new RegExp(String.raw`^${n ?? String.raw`\d+`} split\b`)]
];

type SavedRow = Partial<Record<'part' | 'description' | 'nsn' | 'niin' | 'cage', string>> & Pick<MappingInput, 'derived'>;

/** Records to find in the mappings table after import: the search text, then every row it must show. */
const SAVED: Record<string, Array<{ search: string; rows: SavedRow[] }>> = {
	[wow.file]: [
		{
			search: '10552364',
			rows: [{ part: '10552364', description: 'Pin', nsn: '5315219078920', niin: '219078920', derived: ['niin'] }]
		},
		// D136 holds two part numbers; each becomes its own record.
		{ search: '12669555', rows: [{ part: '12669555', description: 'Sprocket, Final Drive' }] },
		{ search: 'RVX08212', rows: [{ part: 'RVX08212', description: 'Sprocket, Final Drive' }] },
		// E134 repeats the part number instead of an NSN: the part imports, the malformed NSN does not.
		{ search: '12663107', rows: [{ part: '12663107', description: 'Hub, Drive' }] }
	],
	[statz.file]: [
		// One part with three NSNs that share a NIIN under different FSCs: all three are kept.
		{
			search: '2-24024',
			rows: ['5210011066157', '5220011066157', '6685011066157'].map((nsn) => ({
				part: '2-24024',
				nsn,
				niin: '011066157',
				derived: ['niin' as const]
			}))
		}
	],
	[pencom.file]: pencom.imported.map((input: MappingInput) => ({ search: input.part ?? '', rows: [input] }))
};

async function sheetCard(dialog: Locator, name: string): Promise<Locator> {
	const sheets = await openSection(dialog, 'sheets');
	return sheets.getByRole('listitem').filter({ has: dialog.page().getByText(name, { exact: true }) });
}

async function expectSummary(dialog: Locator, summary: Partial<ImportSummary>) {
	// The one-line summary carries rows, records, and pending decisions; the chips carry the status counts.
	const sentence = dialog.locator('#import-summary');
	const { sourceRows, candidates } = summary;
	if (sourceRows !== undefined && candidates !== undefined) {
		// Source rows and records differ when a cell splits into several records (WOW: 179 rows, 180 records).
		await expect(sentence).toContainText(
			sourceRows === candidates ? `${sourceRows} rows ·` : `${sourceRows} rows → ${candidates} records`
		);
	}
	const chips = dialog.getByRole('list', { name: 'Summary' });
	for (const [key, pattern] of CHIPS) {
		const value = summary[key];
		if (value === undefined) continue;
		if (value === 0) await expect(chips.getByRole('button', { name: pattern() })).toHaveCount(0);
		else await expect(chips.getByRole('button', { name: pattern(value) })).toBeVisible();
	}
	const pending = summary.pendingDecisions;
	if (pending !== undefined) {
		await expect(sentence).toContainText(
			pending ? `${pending} ${pending === 1 ? 'decision needs' : 'decisions need'} you` : 'nothing needs you'
		);
	}
	if (summary.toImport !== undefined) await expect(importButton(dialog, summary.toImport)).toBeVisible();
}

async function expectSaved(page: Page, search: string, rows: SavedRow[]) {
	await page.getByPlaceholder('Search mappings…').fill(search);
	const body = page.getByRole('table').locator('tbody tr');
	await expect(body).toHaveCount(rows.length);
	for (const [i, row] of rows.entries()) {
		const cells = body.nth(i).getByRole('cell');
		for (const [col, key] of (['part', 'description', 'nsn', 'niin', 'cage'] as const).entries()) {
			const derived = (key === 'nsn' || key === 'niin') && row.derived?.includes(key);
			await expect(cells.nth(col), `${search} row ${i + 1} ${key}`).toHaveText(
				derived ? `${row[key]} derived` : (row[key] ?? '—')
			);
		}
	}
}

for (const fixture of FIXTURES) {
	test(`${fixture.file}: review, resolve, import, and see the records`, async ({ page }) => {
		// The deterministic flow: with AI on (the default), PENCOM's Search Log would get an AI table mid-test.
		await turnAiOff(page);
		const requests = recordAiRequests(page);
		const dialog = await upload(page, `${FIXTURE_DIR}${fixture.file}`);

		for (const sheet of fixture.sheets) {
			await expect(await sheetCard(dialog, sheet.name), sheet.name).toContainText(BADGE[sheet.status]);
		}
		await expectSummary(dialog, fixture.initial);
		if (fixture.initial.toImport === 0) await expect(importButton(dialog, 0)).toBeDisabled();

		if (fixture.initial.pendingDecisions) {
			await dialog.getByRole('button', { name: 'Accept all suggestions' }).click();
			await expectSummary(dialog, fixture.afterAcceptAll);
		}

		const imported = fixture.afterAcceptAll.toImport ?? 0;
		await importButton(dialog, imported).click();
		const added = `${imported} record${imported === 1 ? '' : 's'} added to your NSN table`;
		await expect(dialog.getByRole('heading', { name: added })).toBeVisible();
		await dialog.getByRole('button', { name: 'Back to mappings' }).click();
		await expect(dialog).toBeHidden();

		await expect(page.getByText(`of ${demoMappings.length + imported} mappings`)).toBeVisible();
		for (const { search, rows } of SAVED[fixture.file]) await expectSaved(page, search, rows);
		expect(requests, 'AI requests after AI assistance was turned off').toEqual([]);
	});
}

test('keeps the NIIN worked out from the NSN labeled derived after importing Statz (D25)', async ({ page }) => {
	// A record saved before the label existed has no `derived` field, and still shows as it always did.
	const saved = {
		id: 'old-1',
		part: 'OLD-1',
		nsn: '5305016582565',
		niin: '016582565',
		createdAt: '2026-10-01T00:00:00.000Z',
		status: 'Ready'
	};
	await page.addInitScript((record) => {
		if (!localStorage.getItem('nsn-upload-interview-task:mappings')) {
			localStorage.setItem('nsn-upload-interview-task:mappings', JSON.stringify([record]));
		}
	}, saved);
	const dialog = await upload(page, `${FIXTURE_DIR}${statz.file}`);
	await importButton(dialog, statz.afterAcceptAll.toImport).click();
	await dialog.getByRole('button', { name: 'Back to mappings' }).click();

	await expectSaved(page, 'OLD-1', [saved]);
	const rows = page.getByRole('table').locator('tbody tr');
	await expect(rows.getByText('derived', { exact: true })).toHaveCount(0);

	await page.getByPlaceholder('Search mappings…').fill('');
	await expect(page.getByText(`of ${statz.afterAcceptAll.toImport + 1} mappings`)).toBeVisible();
	// The first page shows 8 Statz records: each NIIN carries the tag, and no NSN does, since Statz has an NSN column.
	const statzRows = rows.filter({ hasNotText: 'OLD-1' });
	await expect(statzRows).toHaveCount(8);
	for (const row of await statzRows.all()) {
		const [nsn, niin] = [row.getByRole('cell').nth(2), row.getByRole('cell').nth(3)];
		await expect(niin.getByText('derived', { exact: true })).toHaveAttribute('title', 'Worked out from the NSN');
		await expect(nsn.getByText('derived', { exact: true })).toHaveCount(0);
	}
});

/** A sheet the importer only half understands: NSNs under a header it does not know, and no part header. */
async function stockExport(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Stock');
	sheet.addRows([
		['Ref', 'National Stock No.', 'Qty'],
		['A-100', '5305-01-658-2565', 4],
		['A-101', '5305-01-669-8021', 2],
		['A-102', '5340-01-102-4535', 10],
		['A-103', '3020-01-660-9619', 1],
		['A-104', '2530-00-967-3346', 6]
	]);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A visible parts sheet and a hidden one holding 3 more parts (D26). */
async function withHiddenArchive(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	workbook.addWorksheet('Parts').addRows([
		['Part Number', 'NSN', 'Description'],
		['LIV-1', '5305-01-658-2565', 'Screw, machine'],
		['LIV-2', '5305-01-669-8021', 'Screw, assembly']
	]);
	workbook.addWorksheet('Archive', { state: 'hidden' }).addRows([
		['Part Number', 'NSN', 'Description'],
		['ARC-1', '5340-01-102-4535', 'Bracket'],
		['ARC-2', '3020-01-660-9619', 'Sprocket'],
		['ARC-3', '2530-00-967-3346', 'Hub']
	]);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('"Include anyway" brings a hidden sheet in, held back until its suggestion is accepted', async ({ page }) => {
	const requests = recordAiRequests(page);
	const dialog = await upload(page, { name: 'with-archive.xlsx', mimeType: XLSX_TYPE, buffer: await withHiddenArchive() });
	await expect(await sheetCard(dialog, 'Archive')).toContainText(BADGE.hidden);
	await expectSummary(dialog, { pendingDecisions: 0, toImport: 2 });

	await (await sheetCard(dialog, 'Archive')).getByRole('button', { name: 'Include Archive anyway' }).click();
	const archive = await sheetCard(dialog, 'Archive');
	await expect(archive).toContainText('3 records');
	await expect(archive).toContainText('hidden in Excel');
	await expect(archive).toContainText('Not imported yet: this sheet is hidden in Excel. Switch it on to import its 3 records.');
	await expect(archive.getByRole('switch', { name: 'Include Archive' })).not.toBeChecked();
	await expectSummary(dialog, { pendingDecisions: 1, toImport: 2 });
	await expect(dialog.getByRole('region', { name: /^Needs your decision/ })).toContainText(
		'A table of 3 rows in A1:C4, on a sheet hidden in Excel'
	);

	await dialog.getByRole('button', { name: 'Accept all suggestions' }).click();
	await expectSummary(dialog, { pendingDecisions: 0, toImport: 5 });

	// "Hide again" takes the sheet back out, and the count follows.
	await archive.getByRole('button', { name: 'Hide Archive again' }).click();
	await expect(await sheetCard(dialog, 'Archive')).toContainText(BADGE.hidden);
	await expectSummary(dialog, { toImport: 2 });
	await (await sheetCard(dialog, 'Archive')).getByRole('button', { name: 'Include Archive anyway' }).click();
	await expectSummary(dialog, { toImport: 5 });

	await importButton(dialog, 5).click();
	await expect(dialog.getByRole('heading', { name: '5 records added to your NSN table' })).toBeVisible();
	expect(requests, 'hidden sheets never go to the AI').toEqual([]);
});

test('AI assistance turned off sends nothing; turned on, it shows the mock proposal with an AI badge', async ({ page }) => {
	await turnAiOff(page);
	const requests = recordAiRequests(page);
	const dialog = await upload(page, { name: 'stock-export.xlsx', mimeType: XLSX_TYPE, buffer: await stockExport() });
	const card = await sheetCard(dialog, 'Stock');
	// AI assistance opens by itself when a sheet could use it.
	const ai = section(dialog, 'ai');
	await expect(ai).toHaveAttribute('open', '');

	await expect(card).toContainText(BADGE['needs-review']);
	await expect(card.getByText('AI', { exact: true })).toHaveCount(0);
	await expect(ai).toContainText('Could help with Stock. It is off, so nothing is sent.');
	expect(requests).toEqual([]);

	await ai.getByRole('switch', { name: 'AI assistance' }).click();
	await expect(ai).toContainText('Sent Stock. Accepted 1 table.');
	await expect(card.getByText('AI', { exact: true })).toBeVisible();
	// The availability check, then one interpretation.
	expect(interpretRequests(requests)).toEqual(['GET', 'POST']);

	// The mock's confidence is below the auto-apply threshold, so its table waits for the user, marked as AI.
	const tableDecision = dialog.getByRole('region', { name: /^Needs your decision/ });
	await expect(tableDecision).toContainText('Table needs review');
	await expect(tableDecision.getByText('AI', { exact: true })).toBeVisible();
	await expect(importButton(dialog, 0)).toBeDisabled();
});
