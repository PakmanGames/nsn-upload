/** Shared steps for the E2E specs: open Smart Upload with a file, and reach the review window's parts. */
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURE_DIR = fileURLToPath(new URL('../../example-excel-uploads/', import.meta.url));
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Smart Upload' }).click();
	const dialog = page.getByRole('dialog', { name: 'Smart Upload' });
	await dialog.locator('input[type=file]').setInputFiles(file);
	await expect(importButton(dialog)).toBeVisible();
	return dialog;
}

export function importButton(dialog: Locator, count?: number): Locator {
	const label = count === undefined ? String.raw`\d+ records?` : `${count} records?`;
	return dialog.getByRole('button', { name: new RegExp(`^Import ${label}\\b`) });
}

export type SectionId = 'sheets' | 'columns' | 'rows' | 'auto' | 'ai';

/** A collapsible section of the review window (Sheets, Columns, Rows, Applied automatically, AI assistance). */
export function section(dialog: Locator, id: SectionId): Locator {
	return dialog.locator(`details#section-${id}`);
}

/** Opens a section, and the folded lists inside it (sheets with nothing to import, hidden sheets). */
export async function openSection(dialog: Locator, id: SectionId): Promise<Locator> {
	const details = section(dialog, id);
	const isOpen = await details.evaluate((element) => (element as HTMLDetailsElement).open);
	if (!isOpen) await details.locator('summary').first().click();
	for (const fold of await details.locator('details:not([open]) > summary').all()) await fold.click();
	return details;
}
