import { describe, expect, it, vi } from 'vitest';
import { decisionId, type Field, type SheetAnalysis, type SheetModel, type TableCandidate } from '../model';
import { makeSheet, makeWorkbook } from '../testing';
import { buildRecords } from '.';

vi.mock('../normalize', () => import('./fake-normalize'));

/** A table whose data runs from the row after the header to the bottom of the sheet. */
function tableOf(
	sheet: SheetModel,
	headerRow: number,
	fields: Array<Field | null>,
	status: TableCandidate['status'] = 'ready'
): TableCandidate {
	const extent = sheet.valueExtent!;
	const dataRows: number[] = [];
	for (let row = headerRow + 1; row <= extent.bottom; row++) dataRows.push(row);
	return {
		id: `${sheet.name}@${headerRow}`,
		sheet: sheet.name,
		headerRows: [headerRow],
		range: { ...extent, top: headerRow },
		dataRows,
		skippedRows: [],
		columns: fields.map((field, i) => ({
			col: i + 1,
			header: sheet.cell(headerRow, i + 1).text,
			field,
			confidence: 'high',
			reasons: [],
			alternatives: [],
			valuePassRate: null,
			overridden: false
		})),
		status,
		confidence: status === 'ready' ? 'high' : 'medium',
		reasons: [],
		source: 'deterministic'
	};
}

function analysisOf(sheet: SheetModel, status: SheetAnalysis['status'], tables: TableCandidate[] = []): SheetAnalysis {
	return { name: sheet.name, index: sheet.index, status, reasons: [], tables, aiTrigger: null };
}

describe('buildRecords', () => {
	it('builds ready and needs-review tables in sheet order and skips sheets without tables', () => {
		const dashboard = makeSheet('Dashboard', [['NSNs tracked', 42]]);
		const xref = makeSheet('NSN Cross-Reference', [
			['PENCOM Government Procurement Database'],
			['PENCOM Part Number', 'NSN', 'CAGE'],
			['MS51957-3', '5305-01-658-2565', '0bwz1']
		]);
		const log = makeSheet('Search Log', [
			['Part Number', 'Result'],
			['12542334-GRN', 'Found']
		]);
		const hidden = makeSheet('hiddenSheet', [['Part'], ['X-1']], { visibility: 'veryHidden' });
		const model = makeWorkbook('PENCOM.xlsx', [dashboard, xref, log, hidden]);
		const sheets = [
			analysisOf(dashboard, 'no-table'),
			analysisOf(xref, 'ready', [tableOf(xref, 2, ['part', 'nsn', 'cage'])]),
			analysisOf(log, 'needs-review', [tableOf(log, 1, ['part', null], 'needs-review')]),
			analysisOf(hidden, 'hidden')
		];

		const records = buildRecords(model, sheets, {});

		expect(records.map((r) => [r.id, r.sheet, r.status])).toEqual([
			['NSN Cross-Reference@2:r3', 'NSN Cross-Reference', 'valid'],
			['Search Log@1:r2', 'Search Log', 'valid']
		]);
		expect(records[0].fields.cage).toEqual({
			value: '0BWZ1',
			provenance: {
				file: 'PENCOM.xlsx',
				sheet: 'NSN Cross-Reference',
				row: 3,
				col: 3,
				cell: 'C3',
				original: '0bwz1',
				transforms: ['uppercase'],
				origin: 'source'
			}
		});
	});

	it('applies decision overrides only to the table they name', () => {
		const sheet = (name: string) => makeSheet(name, [['Part'], ['12669555\nRVX08212']]);
		const first = sheet('Parts A');
		const second = sheet('Parts B');
		const model = makeWorkbook('parts.xlsx', [first, second]);
		const sheets = [first, second].map((s) => analysisOf(s, 'ready', [tableOf(s, 1, ['part'])]));
		const overrides = { decisions: { [decisionId('split-cell', 'Parts B@1:r2')]: 'keep-as-one' } };

		expect(buildRecords(model, sheets, overrides).map((r) => r.id)).toEqual([
			'Parts A@1:r2.1',
			'Parts A@1:r2.2',
			'Parts B@1:r2'
		]);
	});
});
