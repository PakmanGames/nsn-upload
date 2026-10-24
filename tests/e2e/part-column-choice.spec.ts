/**
 * Two columns whose values look like part numbers, and no header says Part (E4): the importer maps neither,
 * so the Columns card asks the user to pick one and offers both. Picking is a normal remap, with its undo.
 */
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { openSection, upload, XLSX_TYPE } from './helpers';

async function tiedParts(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	workbook.addWorksheet('Parts').addRows([
		['Item', 'Drawing', 'NSN', 'Description'],
		['02-15784', 'MS35106-1', '4330-01-320-0968', 'Filter'],
		['03W2504-164', '12297933', '5310-01-580-7835', 'Washer'],
		['130909B190', 'SM-A-802914', '5306-01-482-8472', 'Bolt'],
		['131554-4F', '457985-1 B', '5340-01-482-2716', 'Bracket']
	]);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('asks which of two tied columns holds part numbers, maps the one picked, and undoes it', async ({ page }) => {
	const dialog = await upload(page, { name: 'tied-parts.xlsx', mimeType: XLSX_TYPE, buffer: await tiedParts() });
	const summary = dialog.locator('#import-summary');
	await expect(summary).toContainText('pick the part number column');

	// Columns opens by itself so the question is not folded away.
	const columns = dialog.locator('details#section-columns');
	await expect(columns).toHaveAttribute('open', '');
	const choice = columns.getByRole('group', { name: 'Choose the part number column' });
	await expect(choice).toContainText('Columns A and B both look like part numbers');
	await expect(choice.getByRole('button')).toHaveText(['Use column A "Item"', 'Use column B "Drawing"']);

	await choice.getByRole('button', { name: 'Use column B "Drawing"' }).click();
	await expect(choice).toHaveCount(0);
	await expect(summary).toContainText('nothing needs you');
	await expect(columns.locator('summary').first()).toContainText('Part number');
	await expect(columns.getByRole('combobox', { name: 'Column B (Drawing) maps to' })).toHaveValue('part');

	await openSection(dialog, 'columns');
	await columns.getByRole('button', { name: 'Undo mapping change for column B' }).click();
	await expect(columns.getByRole('group', { name: 'Choose the part number column' })).toBeVisible();
	await expect(summary).toContainText('pick the part number column');
});
