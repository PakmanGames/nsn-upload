import { describe, expect, it } from 'vitest';
import type { InterpretationRequest, SheetAnalysis } from '../model';
import { parseA1 } from '../refs';
import { makeSheet, makeWorkbook, type CellInput } from '../testing';
import { buildInterpretationRequest } from './request';
import { AI_LIMITS, interpretationRequestSchema } from './schema';

function triggered(
	name: string,
	aiTrigger: string | null = 'Identifier values but no ready table'
): SheetAnalysis {
	return { name, index: 0, status: 'needs-review', reasons: [], tables: [], aiTrigger };
}

const sentRows = (sheet: InterpretationRequest['sheets'][number]) =>
	[...new Set(sheet.cells.map(([ref]) => parseA1(ref)!.row))].sort((a, b) => a - b);
const sentCols = (sheet: InterpretationRequest['sheets'][number]) =>
	[...new Set(sheet.cells.map(([ref]) => parseA1(ref)!.col))].sort((a, b) => a - b);

/** A header row over `rows` data rows, `cols` wide, every cell filled. */
function wideRows(rows: number, cols: number): CellInput[][] {
	const header = Array.from({ length: cols }, (_, c) => `Column ${c + 1}`);
	const data = Array.from({ length: rows }, (_, r) =>
		Array.from({ length: cols }, (_, c) => `R${r + 2}C${c + 1}`)
	);
	return [header, ...data];
}

describe('buildInterpretationRequest', () => {
	it('sends only visible sheets that analysis flagged, with the trigger as the reason', () => {
		const model = makeWorkbook('parts.xlsx', [
			makeSheet('Parts', [
				['Part Number', 'NSN'],
				['ABC-1', '5305-01-658-2565']
			]),
			makeSheet('Secret', [['NSN'], ['5305016582565']], { visibility: 'veryHidden' }),
			makeSheet('Old', [['NSN'], ['5305016582566']], { visibility: 'hidden' }),
			makeSheet('Notes', [['Search NSNs here'], ['5305016582567']])
		]);

		const request = buildInterpretationRequest(model, [
			triggered('Parts', 'Two columns compete for part'),
			triggered('Secret'),
			triggered('Old'),
			triggered('Notes', null)
		]);

		expect(request.fileName).toBe('parts.xlsx');
		expect(request.sheets).toHaveLength(1);
		expect(request.sheets[0]).toMatchObject({
			name: 'Parts',
			extent: 'A1:B2',
			reason: 'Two columns compete for part'
		});
		expect(JSON.stringify(request)).not.toMatch(/Secret|Old|Notes|5305016582565/);
	});

	it('never sends hidden rows and columns or UUID, checksum, and timestamp columns', () => {
		const uuid = (n: number) => `b1c35601-c8c9-f011-bbd2-000d3a3bdc${String(n).padStart(2, '0')}`;
		const checksum = (n: number) =>
			`ek/XvRB+KQDtfaQrA5LpFTL2dmwXKv9fQlxcuCQk6yKxxV8khzs1p9gvrfOW+qwdF/OlRPxgoNgY${n}D4rm6yeA==`;
		const rows: CellInput[][] = [
			[
				'(Do Not Modify) Part',
				'(Do Not Modify) Row Checksum',
				'(Do Not Modify) Modified On',
				'Synced',
				'Internal',
				'Part Number',
				'NSN'
			]
		];
		for (let n = 1; n <= 5; n++) {
			rows.push([
				uuid(n),
				checksum(n),
				{ kind: 'date', raw: 46003.11 + n, text: `2025-12-1${n} 02:48` },
				`2026-07-20T10:3${n}:00Z`,
				`internal note ${n}`,
				`10552${n}64`,
				`5305-01-658-256${n}`
			]);
		}
		rows.push(['', '', '', '', '', 'HIDDEN-ROW-PART', '5305-01-000-0000']);
		const model = makeWorkbook('wow.xlsx', [
			makeSheet('Active Parts', rows, { hiddenCols: [5], hiddenRows: [7] })
		]);

		const [sheet] = buildInterpretationRequest(model, [triggered('Active Parts')]).sheets;

		expect(sentCols(sheet)).toEqual([6, 7]);
		expect(sentRows(sheet)).toEqual([1, 2, 3, 4, 5, 6]);
		const text = JSON.stringify(sheet.cells);
		expect(text).not.toMatch(
			/Do Not Modify|b1c35601|ek\/XvRB|2025-12|2026-07|internal|HIDDEN-ROW/i
		);
	});

	it('keeps a part column that only has a few UUID-shaped values', () => {
		const model = makeWorkbook('parts.xlsx', [
			makeSheet('Parts', [
				['Part Number', 'NSN'],
				['b1c35601-c8c9-f011-bbd2-000d3a3bdce8', '5305-01-658-2565'],
				['ABC-1', '5305-01-658-2566'],
				['ABC-2', '5305-01-658-2567']
			])
		]);

		const [sheet] = buildInterpretationRequest(model, [triggered('Parts')]).sheets;

		expect(sentCols(sheet)).toEqual([1, 2]);
	});

	it('sends 60 rows (the first 40 plus 20 spread to the end), 30 columns, and 120-character cells', () => {
		const rows = wideRows(200, 40);
		rows[1][0] = 'x'.repeat(500);
		const model = makeWorkbook('wide.xlsx', [makeSheet('Parts', rows)]);

		const request = buildInterpretationRequest(model, [triggered('Parts')]);
		const [sent] = request.sheets;

		const sentRowNumbers = sentRows(sent);
		expect(sentRowNumbers).toHaveLength(AI_LIMITS.maxRowsPerSheet);
		expect(sentRowNumbers.slice(0, 40)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
		expect(sentRowNumbers.at(-1)).toBe(201);
		expect(sentCols(sent)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
		const a2 = sent.cells.find(([ref]) => ref === 'A2')![1];
		expect(a2).toHaveLength(AI_LIMITS.maxCellChars);
		expect(a2.endsWith('…')).toBe(true);
		expect(interpretationRequestSchema.safeParse(request).success).toBe(true);
	});

	it('caps the request at 3 sheets and 3000 cells while keeping each header and table end', () => {
		const sheets = ['A', 'B', 'C', 'D'].map((name) => makeSheet(name, wideRows(100, 30)));
		const model = makeWorkbook('many.xlsx', sheets);

		const request = buildInterpretationRequest(
			model,
			sheets.map((s) => triggered(s.name))
		);

		expect(request.sheets.map((s) => s.name)).toEqual(['A', 'B', 'C']);
		const total = request.sheets.reduce((sum, s) => sum + s.cells.length, 0);
		expect(total).toBeLessThanOrEqual(AI_LIMITS.maxCells);
		for (const sent of request.sheets) {
			const rows = sentRows(sent);
			expect(rows[0]).toBe(1);
			expect(rows.at(-1)).toBe(101);
		}
		expect(interpretationRequestSchema.safeParse(request).success).toBe(true);
	});

	it('sends a merged title once and lists the merge', () => {
		const model = makeWorkbook('merged.xlsx', [
			makeSheet(
				'Parts',
				[
					['Parts list', '', ''],
					['Part Number', 'NSN', 'Description'],
					['ABC-1', '5305-01-658-2565', 'Screw']
				],
				{ merges: ['A1:C1'] }
			)
		]);

		const [sheet] = buildInterpretationRequest(model, [triggered('Parts')]).sheets;

		expect(sheet.merges).toEqual(['A1:C1']);
		expect(sheet.cells.filter(([, text]) => text === 'Parts list')).toEqual([['A1', 'Parts list']]);
	});
});
