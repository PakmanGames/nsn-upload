/**
 * Two tables on one sheet in a real browser: ShiftedTable.xlsx's second table, four columns right of the first,
 * gets its own line in Sheets, its own Columns group, and its own switch, and both import.
 * Expected counts come from tests/fixtures/shifted-table.ts.
 */
import { expect, test, type Locator } from '@playwright/test';
import { shiftedTable } from '../fixtures/shifted-table';
import { FIXTURE_DIR, importButton, openSection, upload } from './helpers';

const { sheet: SHEET } = shiftedTable;
const [first, second] = shiftedTable.tables;
const total = first.records + second.records;

/** The sheet's line in Sheets, which lists each of its tables on a line of its own. */
async function sheetCard(dialog: Locator): Promise<Locator> {
	const sheets = await openSection(dialog, 'sheets');
	return sheets.getByRole('listitem').filter({ has: dialog.page().getByText(SHEET, { exact: true }) });
}

test('lists both tables of the sheet and imports their records', async ({ page }) => {
	const dialog = await upload(page, `${FIXTURE_DIR}${shiftedTable.file}`);
	await expect(dialog.locator('#import-summary')).toContainText('2 tables on 1 sheet are ready');
	await expect(importButton(dialog, total)).toBeVisible();

	const card = await sheetCard(dialog);
	await expect(card).toContainText('2 tables');
	for (const [rows, columns, records] of [
		['Rows 1-31', 'columns A-G', first.records],
		['Rows 34-58', 'columns E-K', second.records]
	] as const) {
		const line = card.getByRole('listitem').filter({ hasText: rows });
		await expect(line).toContainText(`${columns} · ${records} records`);
		await expect(line.getByText('Ready', { exact: true })).toBeVisible();
		await expect(line.getByRole('switch', { name: `Include ${SHEET}, ${rows.toLowerCase()}` })).toBeChecked();
	}

	const columns = await openSection(dialog, 'columns');
	for (const rows of ['rows 1-31', 'rows 34-58']) {
		await expect(columns.getByRole('heading', { name: `${SHEET}, ${rows}`, exact: true })).toBeVisible();
	}

	await dialog.getByRole('button', { name: /^Import \d+ records?\b/ }).click();
	await expect(dialog.getByText(`${total} records added to your NSN table`)).toBeVisible();
});

test('leaves one table out with its switch, says how to bring it back, and imports the other', async ({ page }) => {
	const dialog = await upload(page, `${FIXTURE_DIR}${shiftedTable.file}`);
	const line = (await sheetCard(dialog)).getByRole('listitem').filter({ hasText: 'Rows 34-58' });
	const toggle = line.getByRole('switch', { name: `Include ${SHEET}, rows 34-58` });

	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await expect(line).toContainText(
		`Left out of the import. To bring it back, switch it on to import its ${second.records} records.`
	);
	await expect(importButton(dialog, first.records)).toBeVisible();

	await toggle.click();
	await expect(toggle).toBeChecked();
	await expect(line).not.toContainText('Left out of the import');
	await expect(importButton(dialog, total)).toBeVisible();
});
