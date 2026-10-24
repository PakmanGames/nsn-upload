/**
 * The import flow in a real browser against the production build: upload, review, decide, import, and find
 * the records in the mappings table. Counts come from tests/fixtures/expectations.ts, the same targets the
 * acceptance suite checks on the pipeline, so the UI is held to what the analysis promises.
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { demoMappings } from '../../src/lib/demo-data';
import type { ImportSummary, MappingInput, SheetStatus } from '../../src/lib/import/model';
import { FIXTURES, pencom, statz, wow } from '../fixtures/expectations';

const FIXTURE_DIR = fileURLToPath(new URL('../../example-excel-uploads/', import.meta.url));
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What each sheet card's badge says. */
const BADGE: Record<SheetStatus, string> = {
	ready: 'Ready',
	'needs-review': 'Needs review',
	'no-table': 'No importable table',
	hidden: 'Hidden - ignored'
};

/** Summary chips in the review window's header, as "<count> <label>". */
const CHIPS: Array<[keyof ImportSummary, string]> = [
	['candidates', 'candidates'],
	['valid', 'valid'],
	['warnings', 'warnings'],
	['invalid', 'invalid'],
	['duplicates', 'duplicates'],
	['conflicts', 'conflicts'],
	['splitRecords', 'split']
];

type SavedRow = Partial<Record<'part' | 'description' | 'nsn' | 'niin' | 'cage', string>>;

/** Records to find in the mappings table after import: the search text, then every row it must show. */
const SAVED: Record<string, Array<{ search: string; rows: SavedRow[] }>> = {
	[wow.file]: [
		{
			search: '10552364',
			rows: [{ part: '10552364', description: 'Pin', nsn: '5315219078920', niin: '219078920' }]
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
				niin: '011066157'
			}))
		}
	],
	[pencom.file]: pencom.imported.map((input: MappingInput) => ({ search: input.part ?? '', rows: [input] }))
};

/** POSTs to the AI route; parsing and importing must never send one. */
function recordAiPosts(page: Page): string[] {
	const posts: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/interpret') posts.push(request.url());
	});
	return posts;
}

async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Smart Upload' }).click();
	const dialog = page.getByRole('dialog', { name: 'Smart Upload' });
	await dialog.locator('input[type=file]').setInputFiles(file);
	await expect(importButton(dialog)).toBeVisible();
	return dialog;
}

function importButton(dialog: Locator, count?: number): Locator {
	const label = count === undefined ? String.raw`\d+ records?` : `${count} records?`;
	return dialog.getByRole('button', { name: new RegExp(`^Import ${label}\\b`) });
}

function sheetCard(dialog: Locator, name: string): Locator {
	return dialog
		.getByRole('region', { name: /^Sheets/ })
		.getByRole('listitem')
		.filter({ has: dialog.page().getByText(name, { exact: true }) });
}

async function expectSummary(dialog: Locator, summary: Partial<ImportSummary>) {
	const chips = dialog.getByRole('list', { name: 'Summary' });
	for (const [key, label] of CHIPS) {
		const value = summary[key];
		if (value === undefined) continue;
		await expect(chips.getByRole('button', { name: `${value} ${label}`, exact: true })).toBeVisible();
	}
	const pending = summary.pendingDecisions;
	if (pending !== undefined) {
		const name = `${pending} pending decision${pending === 1 ? '' : 's'}`;
		await expect(chips.getByRole('link', { name, exact: true })).toBeVisible();
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
			await expect(cells.nth(col), `${search} row ${i + 1} ${key}`).toHaveText(row[key] ?? '—');
		}
	}
}

for (const fixture of FIXTURES) {
	test(`${fixture.file}: review, resolve, import, and see the records`, async ({ page }) => {
		const posts = recordAiPosts(page);
		const dialog = await upload(page, `${FIXTURE_DIR}${fixture.file}`);

		for (const sheet of fixture.sheets) {
			await expect(sheetCard(dialog, sheet.name), sheet.name).toContainText(BADGE[sheet.status]);
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
		expect(posts, 'AI requests without AI assistance turned on').toEqual([]);
	});
}

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

test('AI assistance sends nothing until turned on, then shows the mock proposal with an AI badge', async ({ page }) => {
	const posts = recordAiPosts(page);
	const dialog = await upload(page, { name: 'stock-export.xlsx', mimeType: XLSX_TYPE, buffer: await stockExport() });
	const card = sheetCard(dialog, 'Stock');
	const ai = dialog.getByRole('region', { name: 'AI assistance' });

	await expect(card).toContainText(BADGE['needs-review']);
	await expect(card.getByText('AI', { exact: true })).toHaveCount(0);
	await expect(ai).toContainText('Could help with Stock');
	expect(posts).toEqual([]);

	await ai.getByRole('switch', { name: 'AI assistance' }).click();
	await expect(ai).toContainText('Sent Stock. Accepted 1 table.');
	await expect(card.getByText('AI', { exact: true })).toBeVisible();
	expect(posts).toHaveLength(1);

	// The mock's confidence is below the auto-apply threshold, so its table waits for the user, marked as AI.
	const tableDecision = dialog
		.getByRole('region', { name: /^Needs you/ })
		.getByRole('listitem')
		.filter({ hasText: 'Tables' });
	await expect(tableDecision.getByText('AI', { exact: true })).toBeVisible();
	await expect(importButton(dialog, 0)).toBeDisabled();
});
