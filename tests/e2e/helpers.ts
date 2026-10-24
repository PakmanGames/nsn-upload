/** Shared steps for the E2E specs: open Smart Upload with a file, and reach the review window's parts. */
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURE_DIR = fileURLToPath(new URL('../../example-excel-uploads/', import.meta.url));
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Where the app keeps this browser's AI choice (`aiPreferenceKey` in session.svelte.ts). */
export const AI_PREFERENCE_KEY = 'nsn-upload-interview-task:ai-assistance';

/**
 * Saves "AI assistance off" before the app loads, on every navigation of this page, as a user who turned it off would have.
 * AI is on by default (D23) and these runs use the mock provider, so specs that pin the deterministic flow call this
 * first; otherwise a sheet that needs review would get an AI table while the test is looking at it.
 */
export async function turnAiOff(page: Page) {
	await page.addInitScript((key) => localStorage.setItem(key, 'off'), AI_PREFERENCE_KEY);
}

export type AiRequest = { method: string; path: '/api/interpret' | '/api/explain' };

/** Requests to the AI routes: the availability check (GET) and interpretations (POST), and explanations (POST). */
export function recordAiRequests(page: Page): AiRequest[] {
	const requests: AiRequest[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (path === '/api/interpret' || path === '/api/explain') requests.push({ method: request.method(), path });
	});
	return requests;
}

/** Methods of the requests to the interpretation route, in order. */
export const interpretRequests = (requests: AiRequest[]) =>
	requests.filter((request) => request.path === '/api/interpret').map((request) => request.method);

/** Opens the Smart Upload window from the mappings page. */
export async function openSmartUpload(page: Page): Promise<Locator> {
	await page.goto('/');
	const dialog = page.getByRole('dialog', { name: 'Smart Upload' });
	// The page is server-rendered, and a click that lands before hydration does nothing (seen on a loaded
	// machine), so click again until the window opens. Clicking only while it is closed keeps the retry safe.
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Smart Upload' }).click();
		await expect(dialog).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	return dialog;
}

export async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
	const dialog = await openSmartUpload(page);
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
	// Opening a fold drops it from the closed set, so always open the first closed one until none is left.
	const closed = details.locator('details:not([open]) > summary');
	while ((await closed.count()) > 0) await closed.first().click();
	return details;
}
