/**
 * The review window's guided flow (UX1, docs/tasks/UX1-review-window-redesign.md): the decision stage, a chip
 * opening Rows, held-back tables folded out of the main list, the Columns open-by-default rule, and "Worth a look".
 * Expected rows come from tests/fixtures/expectations.ts; quoted copy is the brief's.
 */
import { expect, test, type Locator } from '@playwright/test';
import { pencom, statz, wow } from '../fixtures/expectations';
import { FIXTURE_DIR, importButton, openSection, section, upload } from './helpers';

/** Rows that become warnings in WOW: the 2 malformed NSNs, the bracketed part note, and the missing description. */
const WOW_WARNING_ROWS = [
	...wow.nsn.malformed.map(({ row }) => row),
	wow.annotatedPart.row,
	...wow.missingDescriptionRows
];

/** Source rows listed in the Rows section's main table, read from each row's details button. */
async function listedRows(rows: Locator, sheet: string): Promise<number[]> {
	const names = await rows.locator('table').getByRole('button', { name: /^Details for / }).evaluateAll((buttons) =>
		buttons.map((button) => button.getAttribute('aria-label') ?? '')
	);
	const prefix = `Details for ${sheet} row `;
	expect(names.every((name) => name.startsWith(prefix)), names.join(', ')).toBe(true);
	return names.map((name) => Number.parseInt(name.slice(prefix.length), 10)).sort((a, b) => a - b);
}

async function expectRowsFilteredTo(dialog: Locator, tab: RegExp, sheet: string, expected: number[]) {
	const rows = section(dialog, 'rows');
	await expect(rows).toHaveAttribute('open', '');
	await expect(rows).toBeInViewport();
	await expect(rows.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
	expect(await listedRows(rows, sheet)).toEqual([...expected].sort((a, b) => a - b));
}

test.describe('decision stage', () => {
	// PENCOM's decisions in workbook order: the two XRef-vs-Intake conflicts, then the held-back Search Log table.
	const steps = [
		{
			title: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P · NSN 5305-01-658-2565',
			suggested: 'Use NSN Cross-Reference row 3',
			spoken: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P · NSN 5305-01-658-2565, same part on two sheets',
			// Not the suggestion, so "Review my choices" can show it is the choice that comes back preselected.
			pick: 'Use Part Number Intake row 4'
		},
		{
			title: 'SE5826 · NSN 5305-01-669-8021',
			suggested: 'Use NSN Cross-Reference row 4',
			spoken: 'SE5826 · NSN 5305-01-669-8021, same part on two sheets'
		},
		{ title: 'Search Log (A2:I5) · 3 rows', suggested: 'Exclude table', spoken: 'Search Log (A2:I5) · 3 rows, table needs review' }
	];

	test('Apply and continue moves to the next decision; "Review my choices" brings choices back', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);

		for (const [i, step] of steps.entries()) {
			const stage = dialog.getByRole('region', { name: `Needs your decision · ${i + 1} of ${steps.length}` });
			const heading = stage.getByRole('heading', { level: 3 });
			const apply = stage.getByRole('button', { name: 'Apply and continue' });
			await expect(heading).toHaveText(step.title);
			// After Apply, focus stays on the button so Enter applies the next one, and the next decision is announced.
			if (i > 0) {
				await expect(apply).toBeFocused();
				await expect(dialog.locator('p[aria-live="polite"]')).toHaveText(`Decision ${i + 1} of ${steps.length}: ${step.spoken}`);
			}
			await expect(stage.getByRole('radio', { name: step.suggested })).toBeChecked();
			if (step.pick) await stage.getByRole('radio', { name: step.pick }).check();
			await apply.click();
		}

		const done = dialog.getByRole('region', { name: `All ${steps.length} decisions made` });
		await expect(done.getByRole('heading')).toBeFocused();
		for (const step of steps) {
			await expect(done.getByRole('listitem').filter({ hasText: step.title })).toContainText(
				`${step.title}: ${step.pick ?? step.suggested}`
			);
		}
		await expect(importButton(dialog, pencom.afterAcceptAll.toImport)).toBeEnabled();

		await done.getByRole('button', { name: 'Review my choices' }).click();
		const review = dialog.getByRole('region', { name: `Your decision · 1 of ${steps.length}` });
		await expect(review.getByRole('heading', { level: 3 })).toBeFocused();
		await expect(review.getByRole('radio', { name: steps[0].pick })).toBeChecked();
		await review.getByRole('button', { name: 'Done reviewing' }).click();
		await expect(dialog.getByRole('region', { name: `All ${steps.length} decisions made` })).toBeVisible();
	});
});

test('a summary chip opens Rows with its status filter', async ({ page }) => {
	const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
	await expect(section(dialog, 'rows')).not.toHaveAttribute('open', '');

	const chip = dialog.getByRole('list', { name: 'Summary' }).getByRole('button', { name: /^4 warnings$/ });
	await chip.click();
	await expectRowsFilteredTo(dialog, /^Warnings/, 'Active Parts', WOW_WARNING_ROWS);
});

test('held-back rows fold into one line per table, outside the main list', async ({ page }) => {
	const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
	const rows = section(dialog, 'rows');
	await rows.locator('summary').first().click();

	// The main list holds the two included tables only; Search Log waits on its include decision.
	const included = pencom.sheets.filter((sheet) => sheet.status === 'ready');
	const names = await rows.locator('table').getByRole('button', { name: /^Details for / }).evaluateAll((buttons) =>
		buttons.map((button) => button.getAttribute('aria-label') ?? '')
	);
	expect(names).toHaveLength(included.reduce((sum, sheet) => sum + (sheet.table?.records ?? 0), 0));
	expect(names.filter((name) => name.includes(pencom.heldBackSheet))).toEqual([]);

	const foldSummary = page.locator('summary', { hasText: `${pencom.heldBackSheet} ·` });
	const fold = rows.locator('details').filter({ has: foldSummary });
	await expect(fold.locator('summary')).toHaveText(`${pencom.heldBackSheet} · 3 rows held back, not importing`);
	await expect(fold).not.toHaveAttribute('open', '');
	await fold.locator('summary').click();
	await expect(fold.getByRole('button')).toHaveCount(3);
});

test('unchecking a row leaves it out of the import, and checking it again brings it back', async ({ page }) => {
	const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
	const rows = section(dialog, 'rows');
	await rows.locator('summary').first().click();
	const toggle = rows.getByRole('checkbox', { name: `Import Active Parts row ${wow.annotatedPart.row}` });
	const bracketNote = dialog.getByText('1 part number has a note in brackets');
	await expect(toggle).toBeChecked();
	await expect(bracketNote).toBeVisible();

	await toggle.uncheck();
	await expect(importButton(dialog, wow.initial.toImport - 1)).toBeVisible();
	await expect(rows.getByText('Excluded by you')).toHaveCount(1);
	// "Worth a look" promises its rows still import, so the unchecked row leaves it.
	await expect(bracketNote).toHaveCount(0);
	// The checkbox toggles the import only; it does not open the row's details.
	await expect(dialog.getByRole('complementary')).toHaveCount(0);

	await toggle.check();
	await expect(importButton(dialog, wow.initial.toImport)).toBeVisible();
	await expect(rows.getByText('Excluded by you')).toHaveCount(0);
	await expect(bracketNote).toBeVisible();
});

test.describe('Columns open-by-default rule', () => {
	test('stays closed on a clean file, and opens by itself once a table with an uncertain column is included', async ({
		page
	}) => {
		let dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		await expect(section(dialog, 'columns')).not.toHaveAttribute('open', '');

		// PENCOM: Search Log's columns are uncertain, but it is held back, so Columns starts closed.
		dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
		const columns = section(dialog, 'columns');
		await expect(columns).not.toHaveAttribute('open', '');
		const stage = dialog.getByRole('region', { name: /^Needs your decision/ });
		const apply = stage.getByRole('button', { name: 'Apply and continue' });
		for (let i = 0; i < pencom.conflicts.length; i++) await apply.click();
		await stage.getByRole('radio', { name: 'Include table' }).check();
		await apply.click();
		await expect(columns).toHaveAttribute('open', '');
		await expect(columns).toContainText(pencom.heldBackSheet);
	});

	test('a remap recomputes the analysis and keeps Columns open', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${wow.file}`);
		const columns = await openSection(dialog, 'columns');
		const summary = columns.locator('summary').first();
		const worth = dialog.locator('p', { hasText: 'Worth a look before importing' }).locator('..');
		await expect(summary).toContainText('Part number, NSN, Description');
		await expect(worth).toContainText('1 record has no description');

		const picker = columns.getByRole('combobox', { name: 'Column F (Nomenclature) maps to' });
		await picker.selectOption({ label: 'Ignore column' });
		await expect(columns).toHaveAttribute('open', '');
		await expect(summary).toContainText('Part number, NSN');
		await expect(summary).not.toContainText('Description');
		await expect(columns.getByRole('button', { name: 'Undo mapping change for column F' })).toBeVisible();
		// Without a description column there is no missing description to warn about.
		await expect(worth).not.toContainText('no description');
	});
});

test.describe('Worth a look', () => {
	const cases = [
		{
			fixture: wow,
			sheet: 'Active Parts',
			lines: [
				'2 rows had a malformed NSN · rows 134 and 166; the part number imports, the bad NSN does not',
				'1 part number has a note in brackets · row 43, kept as written',
				'1 record has no description · row 180'
			],
			rows: WOW_WARNING_ROWS
		},
		{
			fixture: statz,
			sheet: 'Sheet1',
			lines: ['9 records list the same item under different NSNs · at most one NSN per item is current'],
			rows: statz.fscNiinMismatchGroups.flat()
		}
	];

	for (const { fixture, sheet, lines, rows } of cases) {
		test(`${fixture.file}: lists the warnings, and "Show these rows" filters Rows to them`, async ({ page }) => {
			const dialog = await upload(page, `${FIXTURE_DIR}${fixture.file}`);
			const worth = dialog.locator('p', { hasText: 'Worth a look before importing. These still import.' }).locator('..');
			await expect(worth.getByRole('listitem')).toHaveText(lines);

			await worth.getByRole('button', { name: 'Show these rows' }).click();
			await expectRowsFilteredTo(dialog, /^Warnings/, sheet, rows);
		});
	}

	test('is not shown when nothing imports with a warning', async ({ page }) => {
		const dialog = await upload(page, `${FIXTURE_DIR}${pencom.file}`);
		await expect(dialog.getByText('Worth a look before importing')).toHaveCount(0);
	});
});
