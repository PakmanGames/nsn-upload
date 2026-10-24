/**
 * The spreadsheet inside the review window (V1, docs/tasks/V1-spreadsheet-view.md): the toggle and split, the sheet
 * tabs, what the importer found drawn on the grid, and the focus that a row in Rows or a cell link in the details
 * sets. Expected cells come from tests/fixtures/expectations.ts.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { pencom, wow } from '../fixtures/expectations';
import { FIXTURE_DIR, importButton, openSection, openSmartUpload, upload, XLSX_TYPE } from './helpers';

const WIDE = { width: 1440, height: 900 };

async function openSpreadsheet(dialog: Locator) {
	const toggle = dialog.getByRole('button', { name: 'Spreadsheet' });
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	return dialog.getByRole('grid');
}

/** "D136"-style refs of the highlighted cells, read from their row and column. */
async function selectedCells(grid: Locator): Promise<string[]> {
	return grid.locator('[role=gridcell][aria-selected=true]').evaluateAll((cells) =>
		cells.map((cell) => {
			const { row, col } = (cell as HTMLElement).dataset;
			return `${String.fromCharCode(64 + Number(col))}${row}`;
		})
	);
}

async function noPageScroll(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test.describe('at 1440 px', () => {
	test.use({ viewport: WIDE });

	test('opens beside the review with WOW\'s table, chips, and hidden columns, and is remembered', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const grid = await openSpreadsheet(dialog);

		// Beside the review: both show, and the import button stays where it was.
		await expect(dialog.locator('#review-pane')).toBeVisible();
		await expect(grid).toBeVisible();
		await expect(importButton(dialog, 180)).toBeInViewport();
		await expect(dialog.getByRole('separator', { name: 'Resize the review and the spreadsheet' })).toBeVisible();

		// The very hidden sheet has no tab; A-C are zero-width metadata columns, so D comes first.
		await expect(dialog.getByRole('tab')).toHaveText(['Active Parts']);
		const headers = grid.getByRole('columnheader');
		await expect(headers.nth(1)).toHaveText(/^D/);
		await expect(headers.filter({ hasText: /^A$/ })).toHaveCount(0);
		for (const [letter, chip] of [['D', 'Part'], ['E', 'NSN'], ['F', 'Description']]) {
			await expect(headers.filter({ hasText: new RegExp(`^${letter}`) })).toHaveText(new RegExp(`^${letter}\\s*${chip}\\s*$`));
		}
		await expect(grid.locator('[data-outline=included]')).toHaveCount(1);
		await noPageScroll(page);

		await page.reload();
		const again = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		await expect(again.getByRole('button', { name: 'Spreadsheet' })).toHaveAttribute('aria-pressed', 'true');
		await expect(again.getByRole('grid')).toBeVisible();
	});

	test('switches sheets with the tab strip and says why a sheet does not import', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
		await openSpreadsheet(dialog);
		const tabs = dialog.getByRole('tab');
		await expect(tabs).toHaveText(pencom.sheets.map((sheet) => sheet.name));
		// It opens on the first sheet with a table that imports.
		await expect(dialog.getByRole('tab', { name: 'NSN Cross-Reference' })).toHaveAttribute('aria-selected', 'true');

		await dialog.getByRole('tab', { name: 'Dashboard' }).click();
		await expect(dialog.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
		await expect(dialog.getByText('Nothing on this sheet will be imported.')).toBeVisible();
		await expect(dialog.getByRole('grid')).toContainText('PENCOM Government Procurement Database');

		// Arrow keys move along the tabs, as in any tab list.
		await dialog.getByRole('tab', { name: 'Dashboard' }).press('End');
		await expect(dialog.getByRole('tab', { name: 'Sources & Notes' })).toBeFocused();
		await dialog.getByRole('tab', { name: 'Sources & Notes' }).press('ArrowLeft');
		await expect(dialog.getByRole('tab', { name: 'Search Log' })).toHaveAttribute('aria-selected', 'true');
		await expect(dialog.getByText('This table waits for your decision before it imports.')).toBeVisible();
		await expect(dialog.getByRole('grid').locator('[data-outline=pending]')).toHaveCount(1);

		// The decision stage stays beside the spreadsheet.
		await expect(dialog.getByRole('region', { name: /^Needs your decision/ })).toBeInViewport();
	});

	test('selecting a row in Rows scrolls the grid to its cells and highlights them', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const grid = await openSpreadsheet(dialog);
		const rows = await openSection(dialog, 'rows');
		await rows.getByRole('searchbox').fill('D136');
		await rows.getByRole('button', { name: 'Details for Active Parts row 136, value 1 of 2' }).click();

		// D136 holds the two part numbers; F136 the description; E136 is empty, so it is not a source cell.
		await expect.poll(() => selectedCells(grid)).toEqual(['D136', 'F136']);
		await expect(grid.locator('[role=gridcell][aria-selected=true]').first()).toBeInViewport();
		await expect(dialog.getByLabel('Selected cell')).toHaveValue('D136');
		await expect(dialog.getByLabel('Cell value')).toHaveValue('12669555  ↵  RVX08212');

		// The details open over the review, not over the spreadsheet; a cell link there moves the highlight.
		const details = dialog.getByRole('complementary');
		await expect(details.getByRole('heading', { name: 'Active Parts · row 136' })).toBeVisible();
		await details.getByRole('button', { name: 'Show F136 in the spreadsheet' }).click();
		await expect.poll(() => selectedCells(grid)).toEqual(['F136']);
		await expect(details).toBeVisible();
		await expect(grid).toBeInViewport();
	});

	test('a cell link in the details opens the spreadsheet when it is closed', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const rows = await openSection(dialog, 'rows');
		await rows.getByRole('searchbox').fill('E134');
		await rows.getByRole('button', { name: 'Details for Active Parts row 134' }).click();
		const rejected = dialog.getByRole('complementary').getByRole('region', { name: 'Rejected values' });
		await rejected.getByRole('button', { name: 'Show E134 in the spreadsheet' }).click();

		const grid = dialog.getByRole('grid');
		await expect(grid).toBeVisible();
		await expect.poll(() => selectedCells(grid)).toEqual(['E134']);
		await expect(dialog.getByLabel('Cell value')).toHaveValue('12663107');
	});

	test('the grid is reachable by keyboard, and a cell opens the record it belongs to', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const grid = await openSpreadsheet(dialog);

		// Rows are drawn only near the viewport, so scroll to row 134 before clicking it.
		await grid.evaluate((element) => (element.scrollTop = 22 * 125));
		await grid.locator('[data-row="134"][data-col="6"]').click();
		await expect(dialog.getByRole('complementary').getByRole('heading', { name: 'Active Parts · row 134' })).toBeVisible();
		await expect(dialog.getByLabel('Selected cell')).toHaveValue('F134');

		await grid.focus();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowLeft');
		await expect(dialog.getByLabel('Selected cell')).toHaveValue('E135');
		// A-C are hidden, so Home lands on D.
		await page.keyboard.press('Home');
		await expect(dialog.getByLabel('Selected cell')).toHaveValue('D135');
		const active = await grid.getAttribute('aria-activedescendant');
		await expect(grid.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true');
	});

	test('a 100,000-row sheet draws only the rows in view and reaches the last one', async ({ page }) => {
		test.setTimeout(90_000);
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Parts');
		sheet.addRow(['Part Number', 'NSN', 'Description']);
		for (let i = 1; i < 100_000; i++) {
			const niin = String(1_000_000_000 + i).slice(1);
			sheet.addRow([`PN-${i}`, `5305-${niin.slice(0, 2)}-${niin.slice(2, 5)}-${niin.slice(5)}`, `Screw ${i % 40}`]);
		}
		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
		// upload() waits the default 5 s; reading and analyzing 100,000 rows can take longer on a slow machine.
		const dialog = await openSmartUpload(page);
		await dialog.locator('input[type=file]').setInputFiles({ name: 'large.xlsx', mimeType: XLSX_TYPE, buffer });
		await expect(dialog.getByRole('button', { name: /^Import 99,999 records/ })).toBeVisible({ timeout: 30_000 });
		const grid = await openSpreadsheet(dialog);

		await expect(grid).toHaveAttribute('aria-rowcount', '100021');
		expect(await grid.getByRole('row').count()).toBeLessThan(80);
		await grid.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
		await expect(grid.getByRole('rowheader', { name: '100000', exact: true })).toBeVisible();
		await expect(grid.getByRole('gridcell', { name: 'PN-99999', exact: true })).toBeVisible();
		expect(await grid.getByRole('row').count()).toBeLessThan(80);
	});
});

test.describe('at 1024 px', () => {
	test.use({ viewport: { width: 1024, height: 768 } });

	test('the spreadsheet replaces the review, keeps the import button, and says what waits', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
		const grid = await openSpreadsheet(dialog);

		await expect(grid).toBeVisible();
		await expect(dialog.locator('#review-pane')).toBeHidden();
		await expect(importButton(dialog, 0)).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Accept all suggestions' })).toBeVisible();
		await expect(dialog.getByRole('region', { name: 'Spreadsheet' }).getByText('3 decisions need you')).toBeVisible();
		await noPageScroll(page);

		await dialog.getByRole('button', { name: 'Back to review' }).click();
		await expect(dialog.locator('#review-pane')).toBeVisible();
		await expect(dialog.getByRole('grid')).toHaveCount(0);
		await expect(dialog.getByRole('region', { name: /^Needs your decision/ })).toBeVisible();
	});
});

test.describe('at phone width', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('opens without a horizontal page scroll', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const grid = await openSpreadsheet(dialog);
		await expect(grid).toBeVisible();
		await expect(importButton(dialog, 180)).toBeVisible();
		await noPageScroll(page);
	});
});
