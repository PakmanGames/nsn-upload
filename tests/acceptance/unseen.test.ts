/**
 * Synthetic "unseen" workbooks: shapes the three fixtures do not contain, written with ExcelJS and read back
 * through the real reader, so the whole pipeline is exercised on files it was not tuned against.
 * Every workbook also has to satisfy the provenance contract (expectTraceable).
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import { decisionId, type StoredMapping } from '../../src/lib/import/model';
import { buildInterpretationRequest } from '../../src/lib/import/ai/request';
import { toImportPlan } from '../../src/lib/import/validate';
import { rows } from '../fixtures/expectations';
import {
	acceptAllSuggestions,
	digits,
	expectSummaryConsistent,
	expectTraceable,
	mappedColumns,
	NSN,
	recordAt,
	recordsOf,
	sheetOf,
	singleRecordAt,
	tableOf,
	useWorkbook,
	type SheetSpec
} from './helpers';

describe('unseen workbooks', () => {
	describe('title rows and a merged header cell above a table on row 4', () => {
		const workbook = useWorkbook('depot-register.xlsx', [
			{
				name: 'Register',
				rows: [
					['Depot Spares Register'],
					['Exported from the depot system. NSNs are checked against FLIS every quarter.'],
					[],
					['Part Number', 'NSN', 'Nomenclature', null, 'CAGE Code'],
					['BRK-1001', NSN[0], 'Screw, machine', null, '0BWZ1'],
					['VLV-220 REV B', NSN[1], 'Screw, assembly', null, '1ABC2'],
					['7731-44*2', NSN[2], 'Guard, shock absorber', null, '2DEF3'],
					['HSG-9/A', NSN[3], 'Carrier, drive sprocket', null, '3GHJ4'],
					['PIN-50-1', NSN[4], 'Hub assembly, wheel', null, '4KLM5']
				],
				// The title rows span the table, and Nomenclature spans C:D with its values in C only.
				merges: ['A1:E1', 'A2:E2', 'C4:D4']
			}
		]);

		it('finds the header on row 4 and maps the merge master column once', () => {
			const table = tableOf(workbook.analysis, 'Register');
			expect(table).toMatchObject({ id: 'Register@4', status: 'ready', headerRows: [4] });
			expect(mappedColumns(table)).toEqual({ part: 'A', nsn: 'B', description: 'C', cage: 'E' });
			expect(table.dataRows).toEqual(rows(5, 9));
			expect(recordsOf(workbook.analysis, 'Register')).toHaveLength(5);
			expect(workbook.analysis.summary.toImport).toBe(5);
		});
	});

	describe('headers with line breaks and a vendor prefix', () => {
		const workbook = useWorkbook('vendor-export.xlsx', [
			{
				name: 'Export',
				rows: [
					['ACME Part\nNumber', 'National Stock\nNumber', 'Item\nName', 'Manufacturer CAGE'],
					['ACM-100-2', NSN[0], 'Screw, machine', '0BWZ1'],
					['ACM-101/B', NSN[1], 'Screw, assembly', '0BWZ1'],
					['ACM-102 REV C', NSN[2], 'Guard, shock absorber', '1ABC2'],
					['ACM-103', NSN[3], 'Carrier, drive sprocket', '1ABC2']
				]
			}
		]);

		it('maps every column despite the line breaks and the prefix', () => {
			const table = tableOf(workbook.analysis, 'Export');
			expect(table).toMatchObject({ status: 'ready', headerRows: [1] });
			expect(mappedColumns(table)).toEqual({ part: 'A', nsn: 'B', description: 'C', cage: 'D' });
			expect(workbook.analysis.summary.toImport).toBe(4);
		});
	});

	describe('part numbers that start with a header word', () => {
		// "PN" is part-header vocabulary, but here it is only a prefix inside real part numbers.
		const workbook = useWorkbook('pn-prefix.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN'],
					['PN-4410', NSN[0]],
					['PN-4411', NSN[1]],
					['PN-4412', NSN[2]]
				]
			}
		]);

		it('still maps the part column', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Parts'))).toEqual({ part: 'A', nsn: 'B' });
			expect(toImportPlan(workbook.analysis).add.map((input) => input.part)).toEqual(['PN-4410', 'PN-4411', 'PN-4412']);
		});
	});

	describe('a numeric NIIN cell that lost its leading zero', () => {
		const workbook = useWorkbook('niin-list.xlsx', [
			{
				name: 'NIINs',
				rows: [
					['Part Number', 'NIIN', 'Description'],
					['SCR-4410', 16582565, 'Screw, machine'],
					['SCR-4411', '016698021', 'Screw, assembly'],
					['GRD-4412', '011024535', 'Guard, shock absorber'],
					['CAR-4413', '016609619', 'Carrier, drive sprocket'],
					['HUB-4414', '009673346', 'Hub assembly, wheel']
				]
			}
		]);

		it('restores the zero, keeps the original, and warns', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'NIINs'))).toEqual({
				part: 'A',
				niin: 'B',
				description: 'C'
			});
			const record = singleRecordAt(workbook.analysis, 'NIINs', 2);
			expect(record.fields.niin?.value).toBe('016582565');
			expect(record.fields.niin?.provenance).toMatchObject({ cell: 'B2', original: '16582565', origin: 'source' });
			expect(record.fields.niin?.provenance.transforms).toContain('restore-leading-zeros');
			expect(record.issues).toContainEqual(
				expect.objectContaining({ code: 'suspicious-value', field: 'niin', severity: 'warning' })
			);
			expect(record).toMatchObject({ status: 'warning', approved: true });

			const text = singleRecordAt(workbook.analysis, 'NIINs', 3);
			expect(text.fields.niin?.value).toBe('016698021');
			expect(text.fields.niin?.provenance.transforms).not.toContain('restore-leading-zeros');
		});
	});

	describe('FSC and NIIN columns without an NSN column', () => {
		const lines = [
			['BRK-1001', '5305', '016582565', 'Screw, machine'],
			['BRK-1002', '5305', '016698021', 'Screw, assembly'],
			['GRD-3001', '5340', '011024535', 'Guard, shock absorber'],
			['CAR-4001', '3020', '016609619', 'Carrier, drive sprocket']
		];
		const workbook = useWorkbook('fsc-niin.xlsx', [
			{ name: 'Catalog', rows: [['P/N', 'FSC', 'NIIN', 'Nomenclature'], ...lines] }
		]);

		it('derives each NSN from FSC + NIIN and labels it as derived', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Catalog'))).toEqual({
				part: 'A',
				fsc: 'B',
				niin: 'C',
				description: 'D'
			});
			lines.forEach(([, fsc, niin], i) => {
				const row = i + 2;
				const record = singleRecordAt(workbook.analysis, 'Catalog', row);
				expect(record.fields.nsn?.value).toBe(fsc + niin);
				expect(record.fields.nsn?.provenance.origin).toBe('derived');
				expect(record.fields.nsn?.provenance.transforms).toContain('derive-nsn-from-fsc-niin');
				expect(record.fields.nsn?.provenance.derivedFrom).toEqual(expect.arrayContaining([`B${row}`, `C${row}`]));
				expect(record.fields.niin?.provenance.origin).toBe('source');
				expect(record.approved).toBe(true);
			});
			expect(toImportPlan(workbook.analysis).add.map((input) => input.nsn)).toEqual(
				lines.map(([, fsc, niin]) => fsc + niin)
			);
		});
	});

	describe('a row whose NIIN contradicts its own NSN', () => {
		// Row 2: the NSN's NIIN is 016582565, but the NIIN cell says 016698021. The FSC agrees with the NSN.
		const workbook = useWorkbook('contradiction.xlsx', [
			{
				name: 'Catalog',
				rows: [
					['Part Number', 'NSN', 'FSC', 'NIIN', 'Description'],
					['SCR-0001', NSN[0], '5305', '016698021', 'Screw, machine'],
					['GRD-0003', NSN[2], '5340', '011024535', 'Guard, shock absorber'],
					['CAR-0004', NSN[3], '3020', '016609619', 'Carrier, drive sprocket'],
					['HUB-0005', NSN[4], '2530', '009673346', 'Hub assembly, wheel']
				]
			}
		]);
		const id = decisionId('resolve-identifier-conflict', 'Catalog@1:r2');
		const partOnly = { part: 'SCR-0001', description: 'Screw, machine' };
		const withChoice = (choice: string) => analyze(workbook.model, [], { decisions: { [id]: choice } });

		it('holds the row back as a pending decision with "prefer-nsn" suggested', () => {
			const { analysis } = workbook;
			const decision = analysis.decisions.find((candidate) => candidate.id === id);
			expect(decision).toMatchObject({
				kind: 'resolve-identifier-conflict',
				state: 'pending',
				chosen: null,
				suggested: 'prefer-nsn'
			});
			expect(decision?.options.map((option) => option.id)).toEqual(
				expect.arrayContaining(['prefer-nsn', 'prefer-niin-fsc', 'exclude-row'])
			);
			expect(decision?.cells).toEqual(expect.arrayContaining(['Catalog!B2', 'Catalog!D2']));

			const record = singleRecordAt(analysis, 'Catalog', 2);
			expect(record).toMatchObject({ status: 'pending', approved: false });
			const issue = record.issues.find((candidate) => candidate.code === 'conflict');
			expect(issue?.cells).toEqual(expect.arrayContaining(['Catalog!B2', 'Catalog!D2']));
			expect(analysis.summary).toMatchObject({ pendingDecisions: 1, toImport: 3 });
		});

		it('"Accept all suggestions" keeps the NSN and never imports the contradicted NIIN', () => {
			const accepted = analyze(workbook.model, [], acceptAllSuggestions(workbook.analysis));
			expect(accepted.decisions.find((candidate) => candidate.id === id)).toMatchObject({ chosen: 'prefer-nsn' });
			expect(singleRecordAt(accepted, 'Catalog', 2).approved).toBe(true);
			expect(toImportPlan(accepted).add).toContainEqual({ ...partOnly, nsn: '5305016582565', niin: '016582565', derived: ['niin'] });
			expect(accepted.summary).toMatchObject({ pendingDecisions: 0, toImport: 4 });
		});

		it('prefer-nsn keeps the NSN, rejects the NIIN cell, derives the NIIN, and warns about the cell', () => {
			const analysis = withChoice('prefer-nsn');
			const record = singleRecordAt(analysis, 'Catalog', 2);
			expect(record).toMatchObject({ status: 'warning', approved: true });
			expect(record.fields.nsn).toMatchObject({ value: '5305016582565', provenance: { cell: 'B2', origin: 'source' } });
			expect(record.fields.niin).toMatchObject({ value: '016582565', provenance: { origin: 'derived' } });
			expect(record.fields.niin?.provenance.derivedFrom).toContain('B2');
			// The FSC cell agrees with the NSN, so it stays the source value.
			expect(record.fields.fsc).toMatchObject({ value: '5305', provenance: { origin: 'source' } });
			expect(record.rejected.niin).toEqual({ original: '016698021', cell: 'D2' });
			expect(record.issues).toContainEqual(
				expect.objectContaining({ code: 'conflict', severity: 'warning', cells: ['Catalog!D2', 'Catalog!B2'] })
			);
			expect(toImportPlan(analysis).add).toContainEqual({ ...partOnly, nsn: '5305016582565', niin: '016582565', derived: ['niin'] });
			expectSummaryConsistent(analysis);
			expectTraceable(workbook.model, analysis);
		});

		it('prefer-niin-fsc keeps the NIIN and FSC, rejects the NSN cell, and derives the NSN', () => {
			const analysis = withChoice('prefer-niin-fsc');
			const record = singleRecordAt(analysis, 'Catalog', 2);
			expect(record).toMatchObject({ status: 'valid', approved: true });
			expect(record.fields.niin).toMatchObject({ value: '016698021', provenance: { cell: 'D2', origin: 'source' } });
			expect(record.fields.nsn).toMatchObject({ value: '5305016698021', provenance: { origin: 'derived' } });
			expect(record.fields.nsn?.provenance.transforms).toContain('derive-nsn-from-fsc-niin');
			expect(record.fields.nsn?.provenance.derivedFrom).toEqual(expect.arrayContaining(['C2', 'D2']));
			expect(record.rejected.nsn).toEqual({ original: NSN[0], cell: 'B2' });
			expect(record.issues).toContainEqual(expect.objectContaining({ code: 'conflict', severity: 'info' }));
			expect(toImportPlan(analysis).add).toContainEqual({ ...partOnly, nsn: '5305016698021', niin: '016698021', derived: ['nsn'] });
			expectSummaryConsistent(analysis);
			expectTraceable(workbook.model, analysis);
		});

		it('exclude-row imports the other rows only', () => {
			const analysis = withChoice('exclude-row');
			expect(analysis.decisions.find((candidate) => candidate.id === id)).toMatchObject({
				state: 'user',
				chosen: 'exclude-row'
			});
			expect(singleRecordAt(analysis, 'Catalog', 2).approved).toBe(false);
			expect(toImportPlan(analysis).add.map((input) => input.part)).toEqual(['GRD-0003', 'CAR-0004', 'HUB-0005']);
			expect(analysis.summary.pendingDecisions).toBe(0);
			expectSummaryConsistent(analysis);
		});
	});

	describe('two visible sheets with the same mapping: one compatible and one conflicting duplicate', () => {
		const header = ['Part Number', 'NSN', 'Description', 'CAGE'];
		const workbook = useWorkbook('benches.xlsx', [
			{
				name: 'Bench A',
				rows: [
					header,
					['VLV-220', '4820-01-234-5678', 'Valve, check', null],
					['GSK-310', '5330-01-345-6789', 'Gasket', '1ABC2'],
					['BRG-400', '3110-01-456-7890', 'Bearing, ball', '1ABC2'],
					['SPR-500', '5360-01-567-8901', 'Spring, helical', '1ABC2']
				]
			},
			{
				name: 'Bench B',
				rows: [
					header,
					// Same identity as Bench A row 2 after case and separator normalization; adds a CAGE.
					['vlv-220', '4820 01 234 5678', 'valve, check', '2DEF3'],
					// Same identity as Bench A row 3 with a different description.
					['GSK-310', '5330-01-345-6789', 'Seal ring', null],
					['NUT-600', '5310-01-678-9012', 'Nut, hex', '2DEF3'],
					['WSH-700', '5310-01-789-0123', 'Washer, flat', '2DEF3']
				]
			}
		]);

		it('maps both sheets the same way', () => {
			for (const sheet of ['Bench A', 'Bench B']) {
				const table = tableOf(workbook.analysis, sheet);
				expect(table.status, sheet).toBe('ready');
				expect(mappedColumns(table), sheet).toEqual({ part: 'A', nsn: 'B', description: 'C', cage: 'D' });
			}
		});

		it('merges the compatible pair automatically, keeping provenance from both sheets', () => {
			const kept = singleRecordAt(workbook.analysis, 'Bench A', 2);
			const folded = singleRecordAt(workbook.analysis, 'Bench B', 2);
			const decision = workbook.analysis.decisions.find((candidate) => candidate.kind === 'merge-duplicates');
			expect(decision).toMatchObject({
				id: decisionId('merge-duplicates', [kept.id, folded.id].sort().join('+')),
				state: 'auto',
				chosen: 'merge'
			});
			expect(kept).toMatchObject({ approved: true, mergedFrom: [folded.id] });
			expect(kept.fields.description?.provenance).toMatchObject({ sheet: 'Bench A', cell: 'C2' });
			expect(kept.fields.cage).toMatchObject({ value: '2DEF3', provenance: { sheet: 'Bench B', cell: 'D2' } });
			expect(folded).toMatchObject({ status: 'duplicate', approved: false });
			expect(folded.issues.map((issue) => issue.code)).toContain('duplicate-across-sheets');
		});

		it('holds the conflicting pair back and suggests the record with more fields', () => {
			const preferred = singleRecordAt(workbook.analysis, 'Bench A', 3);
			const other = singleRecordAt(workbook.analysis, 'Bench B', 3);
			const decision = workbook.analysis.decisions.find((candidate) => candidate.kind === 'resolve-conflict');
			expect(decision).toMatchObject({
				id: decisionId('resolve-conflict', [preferred.id, other.id].sort().join('+')),
				state: 'pending',
				suggested: `prefer:${preferred.id}`
			});
			expect(decision?.cells).toEqual(expect.arrayContaining(['Bench A!C3', 'Bench B!C3']));
			for (const record of [preferred, other]) expect(record).toMatchObject({ status: 'conflict', approved: false });
		});

		it('imports the merged and unique records now, and the preferred one after "Accept all suggestions"', () => {
			expect(workbook.analysis.summary).toMatchObject({ pendingDecisions: 1, toImport: 5 });
			const accepted = analyze(workbook.model, [], acceptAllSuggestions(workbook.analysis));
			expect(accepted.summary).toMatchObject({ pendingDecisions: 0, toImport: 6 });
			expect(singleRecordAt(accepted, 'Bench A', 3).approved).toBe(true);
			expect(singleRecordAt(accepted, 'Bench B', 3).approved).toBe(false);
			expectSummaryConsistent(accepted);
		});
	});

	describe('hidden and very hidden sheets with valid NSNs', () => {
		const table = [['Part Number', 'NSN'], ['ARC-1', NSN[0]], ['ARC-2', NSN[1]], ['ARC-3', NSN[2]]];
		const workbook = useWorkbook('with-archive.xlsx', [
			{
				name: 'Parts',
				rows: [['Part Number', 'NSN', 'Description'], ['LIV-1', NSN[3], 'Carrier'], ['LIV-2', NSN[4], 'Hub']]
			},
			{ name: 'Archive', rows: table, state: 'hidden' },
			{ name: 'Lookup', rows: table, state: 'veryHidden' }
		]);

		it('classifies the hidden sheets as hidden and builds nothing from them', () => {
			expect(workbook.analysis.sheets.map(({ name, status }) => [name, status])).toEqual([
				['Parts', 'ready'],
				['Archive', 'hidden'],
				['Lookup', 'hidden']
			]);
			for (const name of ['Archive', 'Lookup']) {
				expect(sheetOf(workbook.analysis, name), name).toMatchObject({ tables: [], aiTrigger: null });
				expect(recordsOf(workbook.analysis, name), name).toEqual([]);
			}
			expect(workbook.analysis.summary.toImport).toBe(2);
		});

		it('holds an included hidden sheet back until its suggested include is accepted (D26)', () => {
			const overrides = { includedHiddenSheets: ['Archive'] };
			const included = analyze(workbook.model, [], overrides);
			const archive = sheetOf(included, 'Archive');
			expect(archive).toMatchObject({ status: 'ready', aiTrigger: null });
			expect(archive.reasons[0]).toBe('Hidden in Excel; included because you asked');
			expect(sheetOf(included, 'Lookup').status).toBe('hidden');
			const decision = included.decisions.find((d) => d.id === decisionId('include-table', 'Archive@1'));
			expect(decision).toMatchObject({ state: 'pending', suggested: 'include', chosen: null });
			expect(decision?.reason).toMatch(/^This sheet is hidden in Excel; you asked to include it\./);
			expect(included.summary).toMatchObject({ pendingDecisions: 1, toImport: 2 });
			expectSummaryConsistent(included);
			expectTraceable(workbook.model, included);

			const accepted = analyze(workbook.model, [], acceptAllSuggestions(included, overrides));
			expect(accepted.summary).toMatchObject({ pendingDecisions: 0, toImport: 5 });
			const plan = toImportPlan(accepted).add.filter((input) => input.part?.startsWith('ARC-'));
			expect(plan.map((input) => input.part)).toEqual(['ARC-1', 'ARC-2', 'ARC-3']);
			for (const record of recordsOf(accepted, 'Archive')) {
				expect(record.fields.part?.provenance).toMatchObject({ sheet: 'Archive', file: 'with-archive.xlsx' });
			}
			expectSummaryConsistent(accepted);
		});

		it('never sends a hidden sheet to the AI, included or not', () => {
			const included = analyze(workbook.model, [], { includedHiddenSheets: ['Archive', 'Lookup'] });
			expect(included.sheets.map((sheet) => sheet.aiTrigger)).toEqual([null, null, null]);
			// Even with a trigger on every sheet, the request leaves the hidden ones out.
			const triggered = included.sheets.map((sheet) => ({ ...sheet, aiTrigger: 'test' }));
			const request = buildInterpretationRequest(workbook.model, triggered);
			expect(request.sheets.map((sheet) => sheet.name)).toEqual(['Parts']);
		});
	});

	describe('a multi-line description next to a multi-line part cell', () => {
		const bracket = 'Bracket, mounting\nfor rear panel';
		const clamp = 'Clamp, loop\ncushioned, 1/2 in';
		const workbook = useWorkbook('kits.xlsx', [
			{
				name: 'Kits',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['KIT-100\nKIT-100A', null, bracket],
					['KIT-200', NSN[2], clamp],
					['KIT-300', NSN[3], 'Spacer, sleeve'],
					['KIT-400', NSN[4], 'Washer, lock']
				]
			}
		]);

		it('splits the part cell and copies the whole description to each record', () => {
			const records = recordAt(workbook.analysis, 'Kits', 2);
			expect(records.map((record) => record.fields.part?.value)).toEqual(['KIT-100', 'KIT-100A']);
			for (const record of records) {
				expect(record.fields.description?.value).toBe(bracket);
				expect(record.fields.description?.provenance).toMatchObject({ cell: 'C2', original: bracket });
				expect(record.fields.description?.provenance.transforms).not.toContain('split-multi-value');
			}
			const decision = workbook.analysis.decisions.find(
				(candidate) => candidate.id === decisionId('split-cell', 'Kits@1:r2')
			);
			expect(decision).toMatchObject({ state: 'auto', chosen: 'split' });
		});

		it('never splits a multi-line description', () => {
			const record = singleRecordAt(workbook.analysis, 'Kits', 3);
			expect(record.split).toBeUndefined();
			expect(record.fields.description?.value).toBe(clamp);
		});
	});

	describe('a notes sheet that mentions NSNs and part numbers in prose', () => {
		const workbook = useWorkbook('with-notes.xlsx', [
			{
				name: 'Read Me',
				rows: [
					['How to fill in this workbook'],
					['Enter one part number per row on the Parts sheet.'],
					['The NSN column takes the 13-digit National Stock Number, for example 5305-01-658-2565.'],
					['Leave the CAGE code blank when the manufacturer is unknown.'],
					[],
					['Topic', 'Notes'],
					['Part number', 'Keep revision suffixes such as REV B.'],
					['NSN', 'Hyphens are optional.'],
					['NIIN', 'The last 9 digits of the NSN.'],
					['Description', 'Use the government item name when known.']
				]
			},
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', NSN[0], 'Screw, machine'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber']
				]
			}
		]);

		it('finds no table in the notes and imports only the Parts sheet', () => {
			expect(sheetOf(workbook.analysis, 'Read Me')).toMatchObject({ status: 'no-table', tables: [] });
			expect(recordsOf(workbook.analysis, 'Read Me')).toEqual([]);
			expect(tableOf(workbook.analysis, 'Parts').status).toBe('ready');
			expect(workbook.analysis.summary.toImport).toBe(3);
		});
	});

	describe('a record that is already in local storage', () => {
		const existing: StoredMapping[] = [
			// Differs from row 2 only in case and internal whitespace, and stores the NSN normalized.
			{ id: 'saved-1', part: 'brk  1001', nsn: digits(NSN[0]) },
			// Same part as row 3 but another NSN: a different mapping, not a duplicate.
			{ id: 'saved-2', part: 'BRK-1002', nsn: digits(NSN[1]) }
		];
		const sheets: SheetSpec[] = [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK 1001', NSN[0], 'Screw, machine'],
					['BRK-1002', NSN[2], 'Guard, shock absorber'],
					['BRK-1003', NSN[3], 'Carrier, drive sprocket']
				]
			}
		];
		const workbook = useWorkbook('storage.xlsx', sheets, existing);

		it('drops the stored duplicate automatically and keeps a part with a new NSN', () => {
			const duplicate = singleRecordAt(workbook.analysis, 'Parts', 2);
			expect(duplicate).toMatchObject({ status: 'duplicate', approved: false });
			expect(duplicate.issues.map((issue) => issue.code)).toContain('duplicate-in-storage');
			const id = decisionId('drop-duplicate', duplicate.id);
			expect(workbook.analysis.decisions.find((candidate) => candidate.id === id)).toMatchObject({
				state: 'auto',
				chosen: 'drop',
				recordIds: [duplicate.id]
			});

			expect(singleRecordAt(workbook.analysis, 'Parts', 3).approved).toBe(true);
			expect(workbook.analysis.summary.toImport).toBe(2);
		});

		it('re-approves the record when the user keeps it', () => {
			const duplicate = singleRecordAt(workbook.analysis, 'Parts', 2);
			const id = decisionId('drop-duplicate', duplicate.id);
			const kept = analyze(workbook.model, existing, { decisions: { [id]: 'keep' } });
			expect(singleRecordAt(kept, 'Parts', 2).approved).toBe(true);
			expect(kept.decisions.find((candidate) => candidate.id === id)).toMatchObject({ state: 'user', chosen: 'keep' });
			expect(kept.summary.toImport).toBe(3);
		});
	});

	describe('a table that starts at C5, so every coordinate is offset', () => {
		const workbook = useWorkbook('offset.xlsx', [
			{
				name: 'Offset',
				rows: [
					['Offset export'],
					[],
					[],
					[],
					[null, null, 'Part Number', 'NSN', 'Description', 'CAGE'],
					// Padding, NBSP and en dash separators, and a lowercase CAGE: each needs a recorded transform.
					[null, null, '  HSG-9/A  ', '5305 01–658 2565', 'Screw, machine', '0bwz1'],
					[null, null, 'BRK-1002', NSN[1], 'Screw, assembly', '1ABC2'],
					[null, null, 'GRD-3001', NSN[2], 'Guard, shock absorber', '2DEF3'],
					[null, null, 'CAR-4001', NSN[3], 'Carrier, drive sprocket', '3GHJ4']
				]
			}
		]);

		it('records the exact cell, original text, and transforms of each value', () => {
			const table = tableOf(workbook.analysis, 'Offset');
			expect(table.headerRows).toEqual([5]);
			expect(mappedColumns(table)).toEqual({ part: 'C', nsn: 'D', description: 'E', cage: 'F' });

			const { fields } = singleRecordAt(workbook.analysis, 'Offset', 6);
			const source = { file: 'offset.xlsx', sheet: 'Offset', row: 6, origin: 'source' };
			expect(fields.part).toMatchObject({
				value: 'HSG-9/A',
				provenance: { ...source, col: 3, cell: 'C6', original: '  HSG-9/A  ' }
			});
			expect(fields.part?.provenance.transforms).toContain('trim');
			expect(fields.nsn).toMatchObject({
				value: '5305016582565',
				provenance: { ...source, col: 4, cell: 'D6', original: '5305 01–658 2565' }
			});
			expect(fields.nsn?.provenance.transforms).toContain('strip-separators');
			expect(fields.cage).toMatchObject({ value: '0BWZ1', provenance: { ...source, col: 6, cell: 'F6' } });
			expect(fields.cage?.provenance.transforms).toContain('uppercase');
			expect(fields.niin).toMatchObject({
				value: '016582565',
				provenance: { origin: 'derived', derivedFrom: ['D6'] }
			});
		});
	});
});
