/**
 * M1 (docs/tasks/M1-plain-language-messages.md): the decision card explains the problem in plain language,
 * with the pipeline's own text behind "Technical details". With AI assistance on (the mock provider here),
 * the wording is replaced by checked AI wording with a marker, without moving the rest of the card.
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { pencom } from '../fixtures/expectations';
import { FIXTURE_DIR, openSection, turnAiOff, upload } from './helpers';

const DEMO_DIR = fileURLToPath(new URL('../../docs/demo-workbooks/', import.meta.url));

// These start from the plain wording, so AI assistance (on by default, D23) starts off.
test.beforeEach(({ page }) => turnAiOff(page));

/** POSTs to the explanation route. */
function recordExplainPosts(page: Page): string[] {
	const posts: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/explain') posts.push(request.url());
	});
	return posts;
}

test('the decision card explains a conflict in plain words, with the technical details folded away', async ({ page }) => {
	const posts = recordExplainPosts(page);
	const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	const card = dialog.getByRole('region', { name: /^Needs your decision · 1 of/ });

	await expect(card).toContainText('The two sheets disagree on the description');
	await expect(card).toContainText(
		'Both list this part number and NSN, but NSN Cross-Reference row 3 says "Screw, Machine" and Part Number Intake row 4 says "6-32 x 1/4 pan-head SEMS machine screw".'
	);
	await expect(card).toContainText('Suggested: Use NSN Cross-Reference row 3');
	await expect(card.getByText('AI wording')).toHaveCount(0);

	const technical = card.getByRole('button', { name: 'Technical details' });
	const reason = card.getByText('NSN Cross-Reference row 3 and Part Number Intake row 4 describe the same part', { exact: false });
	await expect(technical).toHaveAttribute('aria-expanded', 'false');
	await expect(reason).toBeHidden();
	await technical.click();
	await expect(reason).toBeVisible();

	expect(posts, 'explanation requests with AI assistance off').toEqual([]);
});

test('an identifier conflict says which part of the NSN disagrees', async ({ page }) => {
	const dialog = await upload(page, `${DEMO_DIR}b-identifier-conflict.xlsx`);
	const card = dialog.getByRole('region', { name: /^Needs your decision · 1 of/ });
	await expect(card).toContainText("The NIIN doesn't match this NSN");
	await expect(card).toContainText("An NSN ends with its 9-digit NIIN. B2's NSN 5305-01-658-2565 ends with 016582565, but D2 says 016698021.");
	await expect(card.getByRole('button', { name: 'row 2', exact: true })).toBeVisible();
});

test('with AI assistance on, the card shows the checked AI wording without moving the options', async ({ page }) => {
	const posts = recordExplainPosts(page);
	const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	const card = dialog.getByRole('region', { name: /^Needs your decision · 1 of/ });
	// Positions inside the card: turning the switch on scrolls the window, which moves the whole card.
	const offsets = () =>
		card.evaluate((element) => {
			const top = element.getBoundingClientRect().top;
			const suggested = [...element.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Suggested:'))!;
			const option = element.querySelector('input[type=radio]')!;
			return [suggested.getBoundingClientRect().top - top, option.getBoundingClientRect().top - top];
		});
	const before = await offsets();

	const ai = await openSection(dialog, 'ai');
	await ai.getByRole('switch', { name: 'AI assistance' }).click();

	// The plain wording keeps an invisible marker in reserve, so only one is visible.
	await expect(card.getByText('AI wording').filter({ visible: true })).toHaveCount(1);
	// The mock rewords from the facts alone, so its text is recognizable.
	await expect(card).toContainText('Based on NSN 5305-01-658-2565');
	await expect(card).toContainText('Suggested: Use NSN Cross-Reference row 3');
	await expect(card.getByRole('button', { name: 'Technical details' })).toBeVisible();
	await expect(ai).toContainText(/Explained \d+ decisions/);

	expect(await offsets()).toEqual(before);
	expect(posts).toHaveLength(1);
});
