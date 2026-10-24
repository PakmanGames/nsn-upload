/**
 * DS1 (docs/tasks/DS1-faster-decisions.md): working through many decisions. "Apply and continue" stays put and
 * applies exactly one decision per click or Enter, and one choice can settle every decision of the same shape.
 * The workbook is synthetic: 12 rows whose FSC cell disagrees with the NSN, 2 whose NIIN cell does, 1 that agrees.
 */
import ExcelJS from 'exceljs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { importButton, upload, XLSX_TYPE } from './helpers';

const TOTAL = 14;
const nsnFor = (i: number) => `5305-01-658-${2500 + i}`;
const niinFor = (i: number) => `01658${2500 + i}`;

async function catalog(): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Catalog');
	sheet.addRow(['Part Number', 'NSN', 'NIIN', 'FSC', 'Description']);
	for (let i = 0; i < 12; i++) sheet.addRow([`SCR-${i}`, nsnFor(i), niinFor(i), '5310', 'Screw, machine']);
	sheet.addRow(['NUT-1', nsnFor(20), '016589999', '5305', 'Nut, plain']);
	sheet.addRow(['NUT-2', nsnFor(21), '016589998', '5305', 'Nut, plain']);
	sheet.addRow(['WSH-1', nsnFor(30), niinFor(30), '5305', 'Washer, flat']);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function open(page: Page) {
	const dialog = await upload(page, { name: 'catalog-export.xlsx', mimeType: XLSX_TYPE, buffer: await catalog() });
	const stage = dialog.getByRole('region', { name: /^(Needs your decision|All \d+ decisions made)/ });
	return { dialog, stage, apply: stage.getByRole('button', { name: 'Apply and continue' }) };
}

/** The card shows decision `n` of TOTAL; decision n is about source row n + 1. */
async function expectDecision(stage: Locator, n: number) {
	await expect(stage).toHaveAccessibleName(`Needs your decision · ${n} of ${TOTAL}`);
	await expect(stage.getByRole('heading', { level: 3 })).toHaveText(n <= 12 ? `SCR-${n - 1} · Catalog row ${n + 1}` : `NUT-${n - 12} · Catalog row ${n + 1}`);
}

test('"Apply and continue" stays at the same place for every decision, and keeps focus', async ({ page }) => {
	const { dialog, stage, apply } = await open(page);
	await expectDecision(stage, 1);
	const first = await apply.boundingBox();
	expect(first).not.toBeNull();
	for (let n = 2; n <= TOTAL; n++) {
		await apply.click();
		await expectDecision(stage, n);
		expect(await apply.boundingBox(), `decision ${n}`).toEqual(first);
		await expect(apply).toBeFocused();
	}
	await expect(dialog.locator('p[aria-live="polite"]')).toHaveText(`Decision ${TOTAL} of ${TOTAL}: row ${TOTAL + 1}, NSN disagrees with NIIN`);
});

test('10 fast clicks in one place apply exactly decisions 1-10, in order', async ({ page }) => {
	const { dialog, stage, apply } = await open(page);
	await expectDecision(stage, 1);
	const box = (await apply.boundingBox())!;
	// The pointer never moves: every click lands where the button was for decision 1.
	for (let i = 0; i < 10; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

	await expectDecision(stage, 11);
	// Each applied "Keep the NSN" imports its row; the row that agrees imported from the start.
	await expect(importButton(dialog, 11)).toBeVisible();
	await expect(stage.getByRole('radio', { name: /Keep the NSN/ })).toBeChecked();
});

test('Enter on the focused button applies one decision per press', async ({ page }) => {
	const { dialog, stage, apply } = await open(page);
	await apply.focus();
	for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');

	await expectDecision(stage, 11);
	await expect(apply).toBeFocused();
	await expect(importButton(dialog, 11)).toBeVisible();
});

test('one choice settles every row of the same shape, and one revert brings them all back', async ({ page }) => {
	const { dialog, stage, apply } = await open(page);
	const also = stage.getByRole('checkbox', { name: 'Also apply "Keep the NSN" to the 11 other rows where the NSN disagrees with the FSC' });
	await expect(also).not.toBeChecked();
	await stage.getByText('Show rows').click();
	await expect(stage.getByRole('button', { name: /^Row \d+ · SCR-/ })).toHaveCount(11);
	// The label follows the selected option.
	await stage.getByRole('radio', { name: 'Exclude row' }).check();
	await expect(stage.getByRole('checkbox', { name: /^Also apply "Exclude row" to the 11 other rows/ })).toBeVisible();
	await stage.getByRole('radio', { name: /Keep the NSN/ }).check();

	await also.check();
	await apply.click();
	// The two NIIN conflicts are a different shape, so the next decision is the first of them.
	await expectDecision(stage, 13);
	await expect(importButton(dialog, 13)).toBeVisible();
	await expect(stage.getByRole('checkbox', { name: /^Also apply "Keep the NSN" to the 1 other row where the NSN disagrees with the NIIN$/ })).not.toBeChecked();
	await apply.click();
	await apply.click();

	const done = dialog.getByRole('region', { name: `All ${TOTAL} decisions made` });
	const group = done.getByRole('listitem').filter({ hasText: '12 rows where the NSN disagrees with the FSC: Keep the NSN' });
	await expect(group).toHaveCount(1);
	await expect(done.getByRole('listitem')).toHaveCount(3);
	await expect(importButton(dialog, 15)).toBeVisible();

	await group.getByRole('button', { name: /^Revert/ }).click();
	await expectDecision(stage, 1);
	await expect(apply).toBeFocused();
	await expect(importButton(dialog, 3)).toBeVisible();
	await expect(stage.getByRole('checkbox', { name: /^Also apply "Keep the NSN" to the 11 other rows/ })).toBeVisible();
});
