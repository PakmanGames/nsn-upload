/**
 * Two tables side by side on one sheet in a real browser: tables at A1:D40 and F1:I40, sharing every row, each
 * get their own line in Sheets, their own Columns group, and their own switch, named by rows and columns.
 */
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { importButton, openSection, upload, XLSX_TYPE } from './helpers';

const HEADER = ['Part Number', 'NSN', 'Description', 'CAGE'];
const nsn = (i: number) => `5305-01-${String(100 + i).padStart(3, '0')}-${String(2000 + i)}`;
const item = (i: number) => [`BRK-${1000 + i}`, nsn(i), `Screw ${i}`, '1ABC2'];

async function sideBySide() {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Parts');
	for (let i = 0; i < 40; i++) {
		sheet.addRow([...(i === 0 ? HEADER : item(i)), null, ...(i === 0 ? HEADER : item(100 + i))]);
	}
	return { name: 'side-by-side.xlsx', mimeType: XLSX_TYPE, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

test('lists both side-by-side tables and imports their records', async ({ page }) => {
	const dialog = await upload(page, await sideBySide());
	await expect(dialog.locator('#import-summary')).toContainText('2 tables on 1 sheet are ready');
	await expect(importButton(dialog, 78)).toBeVisible();

	const sheets = await openSection(dialog, 'sheets');
	const card = sheets.getByRole('listitem').filter({ has: page.getByText('Parts', { exact: true }) });
	await expect(card).toContainText('2 tables');
	for (const [columns, place] of [
		['columns A-D', 'rows 1-40, columns A-D'],
		['columns F-I', 'rows 1-40, columns F-I']
	]) {
		const line = card.getByRole('listitem').filter({ hasText: `Rows 1-40 · ${columns}` });
		await expect(line).toContainText('39 records');
		await expect(line.getByRole('switch', { name: `Include Parts, ${place}` })).toBeChecked();
	}

	const columns = await openSection(dialog, 'columns');
	for (const place of ['rows 1-40, columns A-D', 'rows 1-40, columns F-I']) {
		await expect(columns.getByRole('heading', { name: `Parts, ${place}`, exact: true })).toBeVisible();
	}

	await dialog.getByRole('button', { name: /^Import \d+ records?\b/ }).click();
	await expect(dialog.getByText('78 records added to your NSN table')).toBeVisible();
});
