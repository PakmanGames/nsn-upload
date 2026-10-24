/**
 * Tables side by side on one sheet (E5), written as real .xlsx files: two tables sharing rows 1-40 split by a
 * blank column are read as two tables, while a notes column beside a single table stays part of it.
 */
import { describe, expect, it } from 'vitest';
import { rangeToA1 } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { mappedColumns, sheetOf, useWorkbook } from './helpers';

const HEADER = ['Part Number', 'NSN', 'Description', 'CAGE'];
const nsn = (i: number) => `5305-01-${String(100 + i).padStart(3, '0')}-${String(2000 + i)}`;
const item = (i: number) => [`BRK-${1000 + i}`, nsn(i), `Screw ${i}`, '1ABC2'];

/** Rows 1-40: a parts table at A:D, nothing in E, and `right(row)` from F on. */
const sheetRows = (right: (row: number) => Array<string | null>) =>
	Array.from({ length: 40 }, (_, i) => [...(i === 0 ? HEADER : item(i)), null, ...right(i)]);

describe('two tables side by side, A1:D40 and F1:I40', () => {
	const context = useWorkbook('side-by-side.xlsx', [
		{ name: 'Parts', rows: sheetRows((i) => (i === 0 ? HEADER : item(100 + i))) }
	]);

	it('reads each as its own ready table, its id naming its first column', () => {
		const { tables } = sheetOf(context.analysis, 'Parts');
		expect(tables.map((t) => [t.id, rangeToA1(t.range), t.status, mappedColumns(t)])).toEqual([
			['Parts@1:A', 'A1:D40', 'ready', { part: 'A', nsn: 'B', description: 'C', cage: 'D' }],
			['Parts@1:F', 'F1:I40', 'ready', { part: 'F', nsn: 'G', description: 'H', cage: 'I' }]
		]);
	});

	it('imports all 78 records, each traced to its own table', () => {
		expect(toImportPlan(context.analysis).add).toHaveLength(78);
		const right = context.analysis.records.find((r) => r.fields.part?.value === 'BRK-1101')!;
		expect(right.tableId).toBe('Parts@1:F');
		expect(right.fields.part!.provenance).toMatchObject({ sheet: 'Parts', cell: 'F2' });
	});
});

describe('a notes column beside one table', () => {
	const context = useWorkbook('notes-beside.xlsx', [
		{ name: 'Parts', rows: sheetRows((i) => [i === 0 ? 'Notes' : `Checked by QA ${i}`]) }
	]);

	it('imports one table with the id it always had', () => {
		const { tables } = sheetOf(context.analysis, 'Parts');
		expect(tables.map((t) => [t.id, rangeToA1(t.range), t.status])).toEqual([['Parts@1', 'A1:F40', 'ready']]);
		expect(toImportPlan(context.analysis).add).toHaveLength(39);
	});
});
