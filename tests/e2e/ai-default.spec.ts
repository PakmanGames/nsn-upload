/**
 * AI assistance on by default (D23, docs/tasks/AI1-ai-on-by-default.md), against the mock provider: a fresh visitor
 * gets PENCOM's Search Log read by AI without touching the switch and sees it happen, a workbook the importer reads by
 * itself sends nothing, a browser that turned AI off sends nothing again, and a server without AI sends nothing.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pencom, wow } from '../fixtures/expectations';
import { AI_PREFERENCE_KEY, FIXTURE_DIR, openSection, recordAiRequests, section, upload } from './helpers';

const NO_KEY = 'AI assistance is not configured on this server (OPENROUTER_API_KEY is not set)';

/** Holds every interpretation until the returned function is called, so the test sees the AI at work. */
async function holdInterpretations(page: Page): Promise<() => void> {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/api/interpret', async (route) => {
		if (route.request().method() === 'POST') await released;
		await route.continue();
	});
	return release;
}

const savedPreference = (page: Page) => page.evaluate((key) => localStorage.getItem(key), AI_PREFERENCE_KEY);

/** The AI line next to the summary sentence. */
const aiNote = (dialog: Locator) => dialog.locator('header').getByRole('status');

async function sheetLine(dialog: Locator, name: string): Promise<Locator> {
	const sheets = await openSection(dialog, 'sheets');
	return sheets.getByRole('listitem').filter({ has: dialog.page().getByText(name, { exact: true }) });
}

test('a fresh visitor gets Search Log read by AI without touching the switch, and sees it happen', async ({ page }) => {
	const requests = recordAiRequests(page);
	const release = await holdInterpretations(page);
	const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);

	// The importer's own reading shows at once; the summary bar and Search Log's line say the AI is still reading.
	await expect(dialog.locator('#import-summary')).toContainText('3 decisions need you');
	await expect(aiNote(dialog)).toHaveText('AI is reading Search Log…');
	const searchLog = await sheetLine(dialog, 'Search Log');
	await expect(searchLog).toContainText('AI is reading…');

	release();
	await expect(aiNote(dialog)).toHaveText('AI read Search Log: found 1 table');
	await expect(searchLog).not.toContainText('AI is reading');
	await expect(searchLog.getByText('AI', { exact: true })).toBeVisible();
	const ai = section(dialog, 'ai');
	await expect(ai).toContainText('Sent Search Log. Accepted 1 table.');
	await expect(ai.getByRole('switch', { name: 'AI assistance' })).toHaveAttribute('aria-checked', 'true');
	// The mock's proposal is below the auto-apply threshold, so Search Log still waits for the user, now marked as AI.
	await expect(dialog.locator('#import-summary')).toContainText('3 decisions need you');

	expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
	// Only the user's own choice is saved.
	expect(await savedPreference(page)).toBeNull();
});

test('a workbook the importer reads by itself sends nothing, and AI assistance says what it would send', async ({ page }) => {
	const requests = recordAiRequests(page);
	const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
	const ai = section(dialog, 'ai');
	await expect(ai.locator('summary')).toContainText(
		'On · sheets the importer cannot read are sent to the AI provider as sampled cells'
	);
	await expect(aiNote(dialog)).toHaveText('');
	// The availability check only; no sheet needed help.
	expect(requests.map((request) => request.method)).toEqual(['GET']);
});

test('turning AI off is remembered: after a reload nothing is sent, not even the availability check', async ({ page }) => {
	let dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	let ai = section(dialog, 'ai');
	await expect(ai).toContainText('Sent Search Log. Accepted 1 table.');
	await ai.getByRole('switch', { name: 'AI assistance' }).click();
	await expect(ai.getByRole('switch', { name: 'AI assistance' })).toHaveAttribute('aria-checked', 'false');
	// Off drops the AI's table, so Search Log is back to the importer's own reading.
	await expect(aiNote(dialog)).toHaveText('');
	await expect((await sheetLine(dialog, 'Search Log')).getByText('AI', { exact: true })).toHaveCount(0);
	expect(await savedPreference(page)).toBe('off');

	const requests = recordAiRequests(page);
	await page.reload();
	dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	ai = section(dialog, 'ai');
	await expect(ai.getByRole('switch', { name: 'AI assistance' })).toHaveAttribute('aria-checked', 'false');
	await expect(ai.locator('summary')).toContainText('Off · could help with Search Log');
	await expect(ai).toContainText('Could help with Search Log. It is off, so nothing is sent.');
	await expect(aiNote(dialog)).toHaveText('');
	expect(requests).toEqual([]);
});

test('AI can be turned off on the upload screen, before the first file is sent', async ({ page }) => {
	const requests = recordAiRequests(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Smart Upload' }).click();
	const dialog = page.getByRole('dialog', { name: 'Smart Upload' });
	const toggle = dialog.getByRole('switch', { name: 'AI assistance' });
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await toggle.click();
	await expect(dialog).toContainText('AI assistance is off, so nothing leaves this browser.');

	await dialog.locator('input[type=file]').setInputFiles(`${FIXTURE_DIR}${pencom.file}`);
	const ai = section(dialog, 'ai');
	await expect(ai).toContainText('Could help with Search Log. It is off, so nothing is sent.');
	expect(await savedPreference(page)).toBe('off');
	// Only the availability check that opening the window started; no sheet was sent.
	expect(requests.map((request) => request.method)).toEqual(['GET']);
});

test('without AI on the server, the switch shows off with the reason and nothing is sent', async ({ page }) => {
	const requests = recordAiRequests(page);
	// The E2E server always has the mock, so answer the availability check as a server without a key does.
	await page.route('**/api/interpret', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { available: false, reason: NO_KEY } })
			: route.abort()
	);
	const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	const ai = section(dialog, 'ai');
	const toggle = ai.getByRole('switch', { name: 'AI assistance' });
	await expect(ai.locator('summary')).toContainText(`Unavailable · ${NO_KEY}`);
	await expect(ai).toContainText('The importer works without it.');
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await expect(toggle).toBeDisabled();
	await expect(aiNote(dialog)).toHaveText('');
	await expect(dialog.locator('#import-summary')).toContainText('3 decisions need you');

	expect(requests.map((request) => request.method)).toEqual(['GET']);
	// Left alone, so the same browser gets AI once the server has a key.
	expect(await savedPreference(page)).toBeNull();
});
