/**
 * Tables without a header row and tables set up by hand, in a real browser: Just NSNs found by its values and
 * accepted, the same table set up by hand from the summary, and a sheet with no table set up with its header row.
 */
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { demoMappings } from '../../src/lib/demo-data';
import { justNsns } from '../fixtures/just-nsns';
import { FIXTURE_DIR, importButton, openSection, upload, XLSX_TYPE } from './helpers';

const imported = justNsns.afterAcceptAll.toImport;

test('Just NSNs: the found table and the same table set up by hand import the same records', async ({ page }) => {
	let dialog = await upload(page, `${FIXTURE_DIR}${justNsns.file}`);
	const summary = dialog.locator('#import-summary');
	await expect(summary).toContainText('99 rows · 1 decision needs you');
	await expect(dialog.getByText('Nothing will import until you make the decision below.')).toBeVisible();
	const decision = dialog.getByRole('region', { name: /^Needs your decision/ });
	await expect(decision).toContainText('has no header row, but every value in column A is a valid NSN');
	await expect(decision.getByRole('radio', { name: /Include table/ })).toBeChecked();

	await dialog.getByRole('button', { name: 'Accept all suggestions' }).click();
	await expect(summary).toContainText('nothing needs you');
	await expect(importButton(dialog, imported)).toBeEnabled();

	// A fresh review of the same file, this time setting the table up by hand from the summary.
	await page.reload();
	dialog = await upload(page, `${FIXTURE_DIR}${justNsns.file}`);
	await dialog.getByRole('button', { name: 'Set up a table by hand' }).click();
	const setup = dialog.getByRole('form', { name: `Set up a table on ${justNsns.manual.sheet}` });
	await expect(setup.getByLabel('Header row')).toHaveValue('none');
	// Each column shows its first values, so which field it holds is plain to see.
	await expect(setup.getByRole('listitem').filter({ hasText: justNsns.firstNsn.original })).toBeVisible();
	await setup.getByRole('combobox', { name: /^Column A/ }).selectOption('nsn');
	await setup.getByRole('button', { name: 'Use this table' }).click();

	await expect(setup).toBeHidden();
	await expect(dialog.locator('#import-summary')).toContainText('nothing needs you');
	await expect(dialog.getByRole('region', { name: /^Needs your decision/ })).toHaveCount(0);
	const sheets = await openSection(dialog, 'sheets');
	await expect(sheets.getByText('Set up by you', { exact: true })).toBeVisible();

	// Removing it gives the sheet back to detection, with its decision.
	await sheets.getByRole('button', { name: 'Remove table set up by hand' }).click();
	await expect(dialog.locator('#import-summary')).toContainText('1 decision needs you');
	await expect(sheets.getByRole('button', { name: 'Set up table' })).toBeFocused();

	await sheets.getByRole('button', { name: 'Set up table' }).click();
	await dialog.getByRole('button', { name: 'Use this table' }).click();
	await importButton(dialog, imported).click();
	await expect(dialog.getByRole('heading', { name: `${imported} records added to your NSN table` })).toBeVisible();
	await dialog.getByRole('button', { name: 'Back to mappings' }).click();
	await expect(page.getByText(`of ${demoMappings.length + imported} mappings`)).toBeVisible();
});

/** A stock list whose headers the importer does not know, below a title: no table is found. */
async function vendorStock(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Vendor stock');
	sheet.addRows([
		['Vendor stock list'],
		[],
		['Item', 'Stock No.', 'Item name', 'Qty on hand'],
		['SE5826', '5305-01-658-2565', 'Screw, machine', 12],
		['RC 620', '5305-01-669-8021', 'Screw, assembly', 4],
		['NASM21083', null, 'Nut, self-locking', 100]
	]);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('a sheet with no table is set up by hand from the summary, with its header row', async ({ page }) => {
	const dialog = await upload(page, { name: 'vendor-stock.xlsx', mimeType: XLSX_TYPE, buffer: await vendorStock() });
	await expect(dialog.locator('#import-summary')).toContainText('0 rows · nothing will import');
	await expect(dialog.getByText('We could not find a table on this sheet.')).toBeVisible();

	await dialog.getByRole('button', { name: 'Set up a table by hand' }).click();
	const setup = dialog.getByRole('form', { name: 'Set up a table on Vendor stock' });
	await expect(setup.getByLabel('Header row')).toBeFocused();
	const use = setup.getByRole('button', { name: 'Use this table' });
	await expect(use).toBeDisabled();
	await expect(setup.getByText('Map at least one column to Part number, NSN, or NIIN')).toBeVisible();

	await setup.getByLabel('Header row').selectOption({ label: 'Row 3 · Item | Stock No. | Item name | Qty on hand' });
	await expect(setup.getByRole('combobox', { name: 'Column A (Item) maps to' })).toBeVisible();
	await setup.getByRole('combobox', { name: 'Column A (Item) maps to' }).selectOption('part');
	await setup.getByRole('combobox', { name: 'Column B (Stock No.) maps to' }).selectOption('nsn');
	await setup.getByRole('combobox', { name: 'Column C (Item name) maps to' }).selectOption('description');
	// One field, one column: giving Part to column C takes it from column A, and says so.
	await setup.getByRole('combobox', { name: 'Column C (Item name) maps to' }).selectOption('part');
	await expect(setup.getByRole('combobox', { name: 'Column A (Item) maps to' })).toHaveValue('');
	await expect(setup.getByRole('status')).toHaveText('Column A no longer maps to Part number: column C does now.');
	await setup.getByRole('combobox', { name: 'Column A (Item) maps to' }).selectOption('part');
	await setup.getByRole('combobox', { name: 'Column C (Item name) maps to' }).selectOption('description');
	await use.click();

	await expect(importButton(dialog, 3)).toBeEnabled();
	await expect(dialog.getByText('We could not find a table on this sheet.')).toHaveCount(0);
	const columns = await openSection(dialog, 'columns');
	await expect(columns).toContainText('header row 3 · 3 data rows');
});
