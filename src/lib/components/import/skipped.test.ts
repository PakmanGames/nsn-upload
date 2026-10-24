import { describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import { makeSheet, makeWorkbook } from '$lib/import/testing';
import { skippedGroups } from './skipped';

const nsn = (i: number) => `5305-01-${100 + i}-${2000 + i}`;

describe('skippedGroups', () => {
	const model = makeWorkbook('quote.xlsx', [
		makeSheet(
			'Quote',
			[
				['Part Number', 'NSN'],
				...Array.from({ length: 10 }, (_, i) => [`SE58${i}`, nsn(i)]),
				['Part Number', 'NSN'],
				['SE5899', nsn(10)],
				[],
				['Supplier Information'],
				['Supplier_Name', null, 'Acme   Corp']
			],
			{ merges: ['A15:B15'] }
		)
	]);
	const analysis = analyze(model, [], {});

	it('lists every non-blank row a table left out, with its values and reason', () => {
		const [group] = skippedGroups(analysis, model);
		expect(group.table.id).toBe('Quote@1');
		expect(group.rows).toEqual([
			{ row: 12, reason: 'repeated-header', preview: 'Part Number · NSN' },
			{ row: 15, reason: 'below-table', preview: 'Supplier Information' },
			{ row: 16, reason: 'below-table', preview: 'Supplier_Name · Acme Corp' }
		]);
	});

	it('lists nothing for a table that skipped no rows, or before a workbook is read', () => {
		const clean = makeWorkbook('clean.xlsx', [makeSheet('Parts', [['Part Number', 'NSN'], ['SE5826', nsn(0)]])]);
		expect(skippedGroups(analyze(clean, [], {}), clean)).toEqual([]);
		expect(skippedGroups(analysis, null)).toEqual([]);
	});
});
