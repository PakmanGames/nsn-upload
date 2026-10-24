import { describe, expect, it } from 'vitest';
import type {
	CandidateRecord,
	ColumnMapping,
	Confidence,
	DecisionKind,
	Field,
	FieldValue,
	Issue,
	SheetAnalysis,
	StoredMapping,
	TableCandidate,
	WorkbookAnalysis
} from '../model';
import { makeWorkbook } from '../testing';
import { finalizeAnalysis, toImportPlan } from '.';

const FILE = 'parts.xlsx';
/** One column per field, so every value sits in a distinct, predictable cell. */
const COLUMN: Record<Field, string> = {
	part: 'A',
	description: 'B',
	nsn: 'C',
	niin: 'D',
	cage: 'E',
	fsc: 'F'
};

function value(sheet: string, row: number, field: Field, text: string): FieldValue {
	const cell = `${COLUMN[field]}${row}`;
	return {
		value: text,
		provenance: {
			file: FILE,
			sheet,
			row,
			col: COLUMN[field].charCodeAt(0) - 64,
			cell,
			original: text,
			transforms: [],
			origin: 'source'
		}
	};
}

/** A record shaped like buildRecords() output, including the NIIN it derives from a valid NSN. */
function record(
	sheet: string,
	row: number,
	values: Partial<Record<Field, string>>,
	extra: Partial<CandidateRecord> = {}
): CandidateRecord {
	const fields: CandidateRecord['fields'] = {};
	for (const [field, text] of Object.entries(values) as Array<[Field, string]>) {
		fields[field] = value(sheet, row, field, text);
	}
	if (fields.nsn && !fields.niin) {
		const nsn = fields.nsn.provenance;
		fields.niin = {
			value: fields.nsn.value.slice(4),
			provenance: {
				...nsn,
				transforms: ['derive-niin-from-nsn'],
				origin: 'derived',
				derivedFrom: [nsn.cell]
			}
		};
	}
	const tableId = `${sheet}@1`;
	return {
		id: `${tableId}:r${row}`,
		tableId,
		sheet,
		sourceRow: row,
		fields,
		rejected: {},
		issues: [],
		status: 'valid',
		approved: true,
		...extra
	};
}

function column(field: Field, header: string, confidence: Confidence = 'high'): ColumnMapping {
	return {
		col: COLUMN[field].charCodeAt(0) - 64,
		header,
		field,
		confidence,
		reasons: [],
		alternatives: [],
		valuePassRate: null,
		overridden: false
	};
}

function sheet(
	name: string,
	index: number,
	status: TableCandidate['status'] = 'ready',
	columns: ColumnMapping[] = [column('part', 'Part Number'), column('nsn', 'NSN')]
): SheetAnalysis {
	const table: TableCandidate = {
		id: `${name}@1`,
		sheet: name,
		headerRows: [1],
		range: { top: 1, left: 1, bottom: 200, right: 6 },
		dataRows: [],
		skippedRows: [],
		columns,
		status,
		confidence: status === 'ready' ? 'high' : 'medium',
		reasons: [],
		source: 'deterministic'
	};
	return { name, index, status, reasons: [], tables: [table], aiTrigger: null };
}

function run(
	sheets: SheetAnalysis[],
	records: CandidateRecord[],
	options: { existing?: StoredMapping[]; decisions?: Record<string, string> } = {}
): WorkbookAnalysis {
	return finalizeAnalysis(makeWorkbook(FILE, []), sheets, records, options.existing ?? [], {
		decisions: options.decisions
	});
}

const find = (analysis: WorkbookAnalysis, id: string) =>
	analysis.records.find((record) => record.id === id)!;
const decisionsOf = (analysis: WorkbookAnalysis, kind: DecisionKind) =>
	analysis.decisions.filter((decision) => decision.kind === kind);
/** What the review window's "Accept all suggestions" stores. */
const acceptAll = (analysis: WorkbookAnalysis) =>
	Object.fromEntries(
		analysis.decisions
			.filter((decision) => decision.state === 'pending')
			.map((decision) => [decision.id, decision.suggested])
	);
const issueCodes = (record: CandidateRecord) => record.issues.map((issue) => issue.code);

describe('table inclusion', () => {
	const sheets = [
		sheet('Parts', 0),
		sheet('Search Log', 1, 'needs-review', [
			column('part', 'Item', 'medium'),
			column('description', 'Notes', 'low'),
			column('nsn', 'Stock No', 'low')
		])
	];
	const records = [
		record('Parts', 2, { part: 'A-1', nsn: '5305016582565' }),
		record('Search Log', 3, { part: 'B-2' })
	];

	it('includes ready tables and holds needs-review tables back with a suggestion', () => {
		const analysis = run(sheets, records);

		expect(decisionsOf(analysis, 'include-table')).toMatchObject([
			{
				id: 'include-table:Search Log@1',
				state: 'pending',
				chosen: null,
				suggested: 'exclude',
				recordIds: ['Search Log@1:r3']
			},
			{ id: 'include-table:Parts@1', state: 'auto', chosen: 'include', suggested: 'include' }
		]);
		expect(find(analysis, 'Search Log@1:r3')).toMatchObject({ status: 'pending', approved: false });
		expect(find(analysis, 'Parts@1:r2')).toMatchObject({ status: 'valid', approved: true });
		expect(analysis.summary).toMatchObject({
			tablesIncluded: 1,
			candidates: 2,
			valid: 1,
			pendingDecisions: 1,
			toImport: 1
		});
	});

	it('names the table and its weakest primary column in one line', () => {
		const [parts, searchLog] = decisionsOf(run(sheets, records), 'include-table').reverse();

		// The description column is weaker still, but it cannot identify a record.
		expect(searchLog.reason).toBe(
			'Table on Search Log (A1:F200): weakest primary column is NSN in C ("Stock No"), low confidence.'
		);
		expect(parts.reason).toBe(
			'Table on Parts (A1:F200): weakest primary column is part number in A ("Part Number"), high confidence.'
		);
	});

	it('approves the records of a needs-review table once the user includes it', () => {
		const analysis = run(sheets, records, {
			decisions: { 'include-table:Search Log@1': 'include' }
		});

		expect(decisionsOf(analysis, 'include-table')[1]).toMatchObject({
			state: 'user',
			chosen: 'include'
		});
		expect(find(analysis, 'Search Log@1:r3')).toMatchObject({ status: 'valid', approved: true });
		expect(analysis.summary).toMatchObject({ tablesIncluded: 2, pendingDecisions: 0, toImport: 2 });
	});

	it('leaves excluded tables out of duplicate checks and summary counts', () => {
		const analysis = run(
			[sheet('A', 0), sheet('B', 1)],
			[
				record('A', 2, { part: 'P-1', nsn: '5305016582565' }),
				record('B', 2, { part: 'P-1', nsn: '5305016582565', description: 'Screw' })
			],
			{ decisions: { 'include-table:B@1': 'exclude' } }
		);

		expect(decisionsOf(analysis, 'merge-duplicates')).toEqual([]);
		expect(find(analysis, 'A@1:r2').approved).toBe(true);
		expect(find(analysis, 'B@1:r2').approved).toBe(false);
		expect(analysis.records).toHaveLength(2);
		expect(analysis.summary).toMatchObject({ candidates: 1, valid: 1, toImport: 1 });
	});
});

describe('row decisions', () => {
	const sheets = [sheet('Active Parts', 0)];

	/** buildRecords() output for a split cell: provenance keeps the whole cell text. */
	function splitRecords(cellText: string): CandidateRecord[] {
		const parts = cellText.split('\n');
		return parts.map((part, i) => {
			const split = record('Active Parts', 136, { part, description: 'Pin' }, {
				id: `Active Parts@1:r136.${i + 1}`,
				split: { cell: 'A136', index: i + 1, total: parts.length },
				issues: [
					{
						code: 'split-from-multi-value',
						severity: 'info',
						field: 'part',
						message: 'Split from a multi-value cell',
						cells: ['Active Parts!A136']
					}
				]
			});
			split.fields.part!.provenance.original = cellText;
			split.fields.part!.provenance.transforms = ['split-multi-value'];
			return split;
		});
	}

	it('logs a newline split as an automatic decision listing the new records', () => {
		const analysis = run(sheets, splitRecords('12669555\nRVX08212'));

		expect(decisionsOf(analysis, 'split-cell')).toEqual([
			expect.objectContaining({
				id: 'split-cell:Active Parts@1:r136',
				state: 'auto',
				chosen: 'split',
				recordIds: ['Active Parts@1:r136.1', 'Active Parts@1:r136.2'],
				cells: ['Active Parts!A136']
			})
		]);
		expect(analysis.decisions[1].reason).toContain('lists 2 part number values');
		expect(analysis.records.map((r) => [r.status, r.approved])).toEqual([
			['valid', true],
			['valid', true]
		]);
		expect(analysis.summary).toMatchObject({ sourceRows: 1, candidates: 2, splitRecords: 2 });
	});

	it('keeps the split decision visible after the user chooses keep-as-one', () => {
		const kept = record('Active Parts', 136, { part: '12669555\nRVX08212' });
		const analysis = run(sheets, [kept], {
			decisions: { 'split-cell:Active Parts@1:r136': 'keep-as-one' }
		});

		expect(decisionsOf(analysis, 'split-cell')).toEqual([
			expect.objectContaining({
				state: 'user',
				chosen: 'keep-as-one',
				recordIds: ['Active Parts@1:r136'],
				cells: ['Active Parts!A136']
			})
		]);
	});

	it('keeps the split decision visible when a multi-line NSN kept as one is rejected', () => {
		const kept = record('Active Parts', 136, { part: '12669555' }, {
			rejected: { nsn: { original: '5305016582565\n5305016698021', cell: 'C136' } },
			issues: [
				{
					code: 'invalid-identifier',
					severity: 'error',
					field: 'nsn',
					message: 'NSN in Active Parts!C136 holds 2 values on separate lines',
					cells: ['Active Parts!C136']
				}
			],
			status: 'warning'
		});
		const analysis = run(sheets, [kept], {
			decisions: { 'split-cell:Active Parts@1:r136': 'keep-as-one' }
		});

		expect(decisionsOf(analysis, 'split-cell')).toEqual([
			expect.objectContaining({
				state: 'user',
				chosen: 'keep-as-one',
				cells: ['Active Parts!C136']
			})
		]);
		expect(decisionsOf(analysis, 'import-valid-portion')).toHaveLength(1);
		expect(find(analysis, kept.id)).toMatchObject({ status: 'warning', approved: true });
	});

	/**
	 * buildRecords() output for two multi-valued identifier cells in one row: paired in order when the
	 * counts match, otherwise one record whose joined NSN text is rejected.
	 */
	function ambiguousRecords(partText: string, nsnText: string): CandidateRecord[] {
		const parts = partText.split('\n');
		const nsns = nsnText.split('\n');
		const ambiguous: Issue = {
			code: 'ambiguous-multi-value',
			severity: 'warning',
			message: 'Two identifier cells hold several values',
			cells: ['Active Parts!A20', 'Active Parts!C20']
		};
		if (parts.length !== nsns.length) {
			const rejectedNsn: Issue = {
				code: 'invalid-identifier',
				severity: 'error',
				field: 'nsn',
				message: `NSN in Active Parts!C20 holds ${nsns.length} values on separate lines`,
				cells: ['Active Parts!C20']
			};
			return [
				record('Active Parts', 20, { part: partText }, {
					rejected: { nsn: { original: nsnText, cell: 'C20' } },
					issues: [ambiguous, rejectedNsn],
					status: 'pending',
					approved: false
				})
			];
		}
		return parts.map((part, i) => {
			const paired = record('Active Parts', 20, { part, nsn: nsns[i] }, {
				id: `Active Parts@1:r20.${i + 1}`,
				status: 'pending',
				approved: false,
				issues: [ambiguous]
			});
			paired.fields.part!.provenance.original = partText;
			paired.fields.nsn!.provenance.original = nsnText;
			return paired;
		});
	}

	it('holds ambiguous rows back, suggesting pair-in-order when the counts match', () => {
		const records = ambiguousRecords('P-1\nP-2', '5305016582565\n5305016698021');
		const analysis = run(sheets, records);

		expect(decisionsOf(analysis, 'ambiguous-multi-value')).toEqual([
			expect.objectContaining({
				id: 'ambiguous-multi-value:Active Parts@1:r20',
				state: 'pending',
				chosen: null,
				suggested: 'pair-in-order',
				cells: ['Active Parts!A20', 'Active Parts!C20']
			})
		]);
		expect(analysis.decisions[0].options.map((o) => o.id)).toEqual([
			'pair-in-order',
			'keep-as-one',
			'exclude'
		]);
		expect(decisionsOf(analysis, 'split-cell')).toEqual([]);
		expect(analysis.records.map((r) => [r.status, r.approved])).toEqual([
			['pending', false],
			['pending', false]
		]);

		const paired = run(sheets, records, { decisions: acceptAll(analysis) });
		expect(paired.records.map((r) => [r.status, r.approved])).toEqual([
			['warning', true],
			['warning', true]
		]);

		const excluded = run(sheets, records, {
			decisions: { 'ambiguous-multi-value:Active Parts@1:r20': 'exclude' }
		});
		expect(excluded.summary.toImport).toBe(0);
	});

	it('leaves pair-in-order out and suggests keep-as-one when the value counts differ', () => {
		const records = ambiguousRecords('P-1\nP-2', '5305016582565\n5305016698021\n5305016698022');
		const analysis = run(sheets, records);
		const [decision] = decisionsOf(analysis, 'ambiguous-multi-value');

		expect(decision).toMatchObject({
			state: 'pending',
			suggested: 'keep-as-one',
			cells: ['Active Parts!A20', 'Active Parts!C20']
		});
		expect(decision.options.map((o) => o.id)).toEqual(['keep-as-one', 'exclude']);
		expect(decision.reason).toContain('Active Parts!C20 lists 3 NSN values');
		expect(decision.reason).toContain('cannot be paired in order');

		// A stored pair-in-order is not an offered option here, so the row keeps waiting.
		const stale = run(sheets, records, { decisions: { [decision.id]: 'pair-in-order' } });
		expect(decisionsOf(stale, 'ambiguous-multi-value')[0]).toMatchObject({
			state: 'pending',
			chosen: null
		});
		expect(stale.summary.toImport).toBe(0);
	});

	it('imports the valid portion of an uneven ambiguous row only after it is decided', () => {
		const records = ambiguousRecords('P-1\nP-2', '5305016582565\n5305016698021\n5305016698022');
		const analysis = run(sheets, records);
		// The rejected NSN text only matters once the user has decided how the row becomes records.
		expect(decisionsOf(analysis, 'import-valid-portion')).toEqual([]);

		const kept = run(sheets, records, { decisions: acceptAll(analysis) });
		expect(decisionsOf(kept, 'import-valid-portion')).toEqual([
			expect.objectContaining({ state: 'auto', cells: ['Active Parts!C20'] })
		]);
	});

	const malformed = record('Active Parts', 134, { part: '12663107', description: 'Bolt' }, {
		rejected: { nsn: { original: '12663107', cell: 'C134' } },
		issues: [
			{
				code: 'invalid-identifier',
				severity: 'error',
				field: 'nsn',
				message: "NSN '12663107' is not 13 digits; same value as part number in Active Parts!A134",
				cells: ['Active Parts!C134']
			}
		],
		status: 'warning'
	});

	it('imports the valid portion of a row with a malformed value automatically', () => {
		const analysis = run(sheets, [malformed]);

		expect(decisionsOf(analysis, 'import-valid-portion')).toEqual([
			expect.objectContaining({
				id: 'import-valid-portion:Active Parts@1:r134',
				state: 'auto',
				chosen: 'import-valid-portion',
				cells: ['Active Parts!C134']
			})
		]);
		expect(analysis.decisions[1].reason).toContain('same value as part number in Active Parts!A134');
		expect(find(analysis, malformed.id)).toMatchObject({ status: 'warning', approved: true });
		expect(toImportPlan(analysis).add).toEqual([{ part: '12663107', description: 'Bolt' }]);
	});

	it('excludes the row when the user undoes the valid-portion import', () => {
		const analysis = run(sheets, [malformed], {
			decisions: { 'import-valid-portion:Active Parts@1:r134': 'exclude-row' }
		});

		expect(find(analysis, malformed.id)).toMatchObject({ status: 'warning', approved: false });
	});

	it('marks rows without a valid primary identifier invalid, with no decision', () => {
		const invalid = record('Active Parts', 9, { description: 'Bolt' }, {
			rejected: { nsn: { original: '280-035-330-101F', cell: 'C9' } },
			issues: [
				{
					code: 'missing-primary-identifier',
					severity: 'error',
					message: 'No valid part number, NSN, or NIIN',
					cells: []
				}
			],
			status: 'invalid',
			approved: false
		});
		const analysis = run(sheets, [invalid]);

		expect(analysis.decisions.map((d) => d.kind)).toEqual(['include-table']);
		expect(find(analysis, invalid.id)).toMatchObject({ status: 'invalid', approved: false });
		expect(analysis.summary).toMatchObject({ invalid: 1, toImport: 0 });
	});

	describe('identifier conflicts (NSN vs its own NIIN or FSC)', () => {
		const sheets = [sheet('Parts', 0)];
		const id = 'resolve-identifier-conflict:Parts@1:r4';
		const cells = ['Parts!C4', 'Parts!D4'];

		/** buildRecords() output for row 4, whose NSN contradicts its NIIN cell, under each choice (F1b). */
		function contradictory(choice?: 'prefer-nsn' | 'prefer-niin-fsc'): CandidateRecord {
			const values = { part: 'P-1', nsn: '5305016582565', niin: '016698021', fsc: '5305' };
			if (choice === 'prefer-nsn') {
				// record() derives the NIIN from the kept NSN.
				const { niin, ...kept } = values;
				return record('Parts', 4, kept, {
					rejected: { niin: { original: niin, cell: 'D4' } },
					issues: [
						{
							code: 'conflict',
							severity: 'warning',
							field: 'niin',
							message: 'NIIN in D4 disagrees with NSN in C4; kept the NSN',
							cells
						}
					],
					status: 'warning'
				});
			}
			if (choice === 'prefer-niin-fsc') {
				const { nsn, ...kept } = values;
				const preferred = record('Parts', 4, kept, {
					rejected: { nsn: { original: nsn, cell: 'C4' } },
					issues: [
						{
							code: 'conflict',
							severity: 'warning',
							field: 'nsn',
							message: 'NSN in C4 disagrees with NIIN in D4; kept the NIIN and FSC',
							cells
						}
					],
					status: 'warning'
				});
				preferred.fields.nsn = {
					value: '5305016698021',
					provenance: {
						...preferred.fields.niin!.provenance,
						transforms: ['derive-nsn-from-fsc-niin'],
						origin: 'derived',
						derivedFrom: ['D4', 'F4']
					}
				};
				return preferred;
			}
			return record('Parts', 4, values, {
				issues: [
					{
						code: 'conflict',
						severity: 'error',
						field: 'niin',
						message: 'NSN 5305016582565 in Parts!C4 does not match NIIN 016698021 in Parts!D4',
						cells
					}
				],
				status: 'pending',
				approved: false
			});
		}

		it('holds the row back with exclude-row suggested', () => {
			const analysis = run(sheets, [contradictory()]);

			const [decision] = decisionsOf(analysis, 'resolve-identifier-conflict');
			expect(decision).toMatchObject({
				id,
				state: 'pending',
				chosen: null,
				suggested: 'exclude-row',
				recordIds: ['Parts@1:r4'],
				cells
			});
			expect(decision.options.map((option) => option.id)).toEqual([
				'prefer-nsn',
				'prefer-niin-fsc',
				'exclude-row'
			]);
			expect(decision.reason).toBe(
				'NSN 5305016582565 in Parts!C4 does not match NIIN 016698021 in Parts!D4. The file does not say which identifier is right, so excluding the row is suggested.'
			);
			expect(find(analysis, 'Parts@1:r4')).toMatchObject({ status: 'pending', approved: false });
			expect(analysis.summary).toMatchObject({ pendingDecisions: 1, toImport: 0 });
		});

		it('keeps the row out when the suggestion is accepted', () => {
			const pending = run(sheets, [contradictory()]);
			const analysis = run(sheets, [contradictory()], { decisions: acceptAll(pending) });

			expect(decisionsOf(analysis, 'resolve-identifier-conflict')[0]).toMatchObject({
				state: 'user',
				chosen: 'exclude-row'
			});
			expect(find(analysis, 'Parts@1:r4')).toMatchObject({ status: 'conflict', approved: false });
			expect(analysis.summary).toMatchObject({ conflicts: 1, pendingDecisions: 0, toImport: 0 });
		});

		it.each([
			['prefer-nsn', { part: 'P-1', nsn: '5305016582565', niin: '016582565' }],
			['prefer-niin-fsc', { part: 'P-1', nsn: '5305016698021', niin: '016698021' }]
		] as const)('imports the identifiers the user prefers (%s)', (choice, imported) => {
			const analysis = run(sheets, [contradictory(choice)], { decisions: { [id]: choice } });

			expect(decisionsOf(analysis, 'resolve-identifier-conflict')[0]).toMatchObject({
				state: 'user',
				chosen: choice
			});
			expect(find(analysis, 'Parts@1:r4')).toMatchObject({ status: 'warning', approved: true });
			// The rejected identifier belongs to this decision, not to an import-valid-portion one.
			expect(decisionsOf(analysis, 'import-valid-portion')).toEqual([]);
			expect(toImportPlan(analysis)).toEqual({ add: [imported], replace: [] });
		});

		it('keeps the row out if buildRecords has not applied the preferred identifier', () => {
			const analysis = run(sheets, [contradictory()], { decisions: { [id]: 'prefer-nsn' } });

			expect(decisionsOf(analysis, 'resolve-identifier-conflict')[0].state).toBe('user');
			expect(find(analysis, 'Parts@1:r4')).toMatchObject({ status: 'conflict', approved: false });
		});

		it('falls back to the policy for a stale choice', () => {
			const analysis = run(sheets, [contradictory()], { decisions: { [id]: 'keep-as-one' } });

			expect(decisionsOf(analysis, 'resolve-identifier-conflict')[0]).toMatchObject({
				state: 'pending',
				chosen: null
			});
			expect(find(analysis, 'Parts@1:r4')).toMatchObject({ status: 'pending', approved: false });
		});

		it('still offers the valid portion for another malformed cell in the row', () => {
			const preferred = contradictory('prefer-nsn');
			preferred.rejected.cage = { original: 'ABC', cell: 'E4' };
			preferred.issues.push({
				code: 'invalid-identifier',
				severity: 'error',
				field: 'cage',
				message: 'CAGE "ABC" in Parts!E4 has 3 characters, expected 5 letters or digits',
				cells: ['Parts!E4']
			});
			const analysis = run(sheets, [preferred], { decisions: { [id]: 'prefer-nsn' } });

			expect(decisionsOf(analysis, 'import-valid-portion')).toEqual([
				expect.objectContaining({ state: 'auto', cells: ['Parts!E4'] })
			]);
			expect(find(analysis, 'Parts@1:r4').approved).toBe(true);
		});
	});
});

describe('duplicates and conflicts', () => {
	it('drops an exact duplicate in one table, and imports it when the user keeps it', () => {
		const sheets = [sheet('Parts', 0)];
		const records = [
			record('Parts', 2, { part: 'P-1', nsn: '5305016582565' }),
			record('Parts', 9, { part: 'p-1 ', nsn: '5305016582565' })
		];
		const analysis = run(sheets, records);

		expect(decisionsOf(analysis, 'drop-duplicate')).toEqual([
			expect.objectContaining({
				id: 'drop-duplicate:Parts@1:r2+Parts@1:r9',
				state: 'auto',
				chosen: 'drop',
				recordIds: ['Parts@1:r2', 'Parts@1:r9']
			})
		]);
		expect(find(analysis, 'Parts@1:r9')).toMatchObject({ status: 'duplicate', approved: false });
		expect(issueCodes(find(analysis, 'Parts@1:r9'))).toEqual(['duplicate-in-table']);
		expect(find(analysis, 'Parts@1:r2')).toMatchObject({ status: 'valid', approved: true });

		const kept = run(sheets, records, {
			decisions: { 'drop-duplicate:Parts@1:r2+Parts@1:r9': 'keep' }
		});
		expect(find(kept, 'Parts@1:r9').approved).toBe(true);
		expect(kept.summary.toImport).toBe(2);
	});

	it('merges a compatible duplicate across sheets, keeping provenance from both', () => {
		const analysis = run(
			[sheet('Cross-Reference', 0), sheet('Intake', 1)],
			[
				record('Cross-Reference', 3, { part: 'SE5826', nsn: '5305016698021', cage: '0BWZ1' }),
				record('Intake', 5, {
					part: 'se5826',
					nsn: '5305016698021',
					description: 'Assembly screw'
				})
			]
		);

		expect(decisionsOf(analysis, 'merge-duplicates')).toEqual([
			expect.objectContaining({
				id: 'merge-duplicates:Cross-Reference@1:r3+Intake@1:r5',
				state: 'auto',
				chosen: 'merge'
			})
		]);
		const merged = find(analysis, 'Cross-Reference@1:r3');
		expect(merged).toMatchObject({
			status: 'valid',
			approved: true,
			mergedFrom: ['Intake@1:r5']
		});
		expect(merged.fields.cage!.provenance.sheet).toBe('Cross-Reference');
		expect(merged.fields.description!.provenance).toMatchObject({ sheet: 'Intake', cell: 'B5' });
		expect(find(analysis, 'Intake@1:r5')).toMatchObject({ status: 'duplicate', approved: false });
		expect(issueCodes(find(analysis, 'Intake@1:r5'))).toEqual(['duplicate-across-sheets']);
		expect(toImportPlan(analysis).add).toEqual([
			{
				part: 'SE5826',
				description: 'Assembly screw',
				nsn: '5305016698021',
				niin: '016698021',
				cage: '0BWZ1'
			}
		]);
	});

	describe('conflicting duplicates (PENCOM shape)', () => {
		const sheets = [sheet('NSN Cross-Reference', 1), sheet('Part Number Intake', 3)];
		const records = [
			record('Part Number Intake', 4, {
				part: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P',
				nsn: '5305016582565',
				description: '6-32 x 1/4 pan-head SEMS machine screw'
			}),
			record('NSN Cross-Reference', 3, {
				part: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P',
				nsn: '5305016582565',
				description: 'Screw, Machine',
				cage: '0BWZ1'
			})
		];
		const id = 'resolve-conflict:NSN Cross-Reference@1:r3+Part Number Intake@1:r4';

		it('holds both records back and suggests the one with more filled fields', () => {
			const analysis = run(sheets, records);

			expect(analysis.decisions[0]).toMatchObject({
				id,
				kind: 'resolve-conflict',
				state: 'pending',
				chosen: null,
				suggested: 'prefer:NSN Cross-Reference@1:r3',
				cells: ['NSN Cross-Reference!B3', 'Part Number Intake!B4']
			});
			expect(analysis.decisions[0].options.map((o) => o.id)).toEqual([
				'prefer:NSN Cross-Reference@1:r3',
				'prefer:Part Number Intake@1:r4',
				'keep-all',
				'exclude-all'
			]);
			for (const conflicted of analysis.records) {
				expect(conflicted).toMatchObject({ status: 'conflict', approved: false });
				expect(conflicted.issues).toEqual([
					expect.objectContaining({
						code: 'conflict',
						severity: 'error',
						field: 'description',
						cells: ['NSN Cross-Reference!B3', 'Part Number Intake!B4']
					})
				]);
			}
			expect(analysis.summary).toMatchObject({ conflicts: 2, pendingDecisions: 1, toImport: 0 });
		});

		it('imports the preferred record merged with compatible fields from the other', () => {
			const analysis = run(sheets, records, {
				decisions: { [id]: 'prefer:NSN Cross-Reference@1:r3' }
			});

			const preferred = find(analysis, 'NSN Cross-Reference@1:r3');
			expect(preferred).toMatchObject({
				approved: true,
				mergedFrom: ['Part Number Intake@1:r4']
			});
			expect(preferred.fields.cage!.provenance.sheet).toBe('NSN Cross-Reference');
			expect(preferred.fields.description!.value).toBe('Screw, Machine');
			expect(find(analysis, 'Part Number Intake@1:r4')).toMatchObject({
				status: 'duplicate',
				approved: false
			});
			expect(analysis.summary).toMatchObject({ conflicts: 0, pendingDecisions: 0, toImport: 1 });
		});

		it('keeps or excludes every record on keep-all and exclude-all', () => {
			expect(run(sheets, records, { decisions: { [id]: 'keep-all' } }).summary.toImport).toBe(2);
			const excluded = run(sheets, records, { decisions: { [id]: 'exclude-all' } });
			expect(excluded.records.map((r) => [r.status, r.approved])).toEqual([
				['conflict', false],
				['conflict', false]
			]);
		});
	});

	it('never treats one part with several NSNs as a duplicate', () => {
		const analysis = run(
			[sheet('Sheet1', 0)],
			[
				record('Sheet1', 9, { part: '2-10008', nsn: '5210000618035' }),
				record('Sheet1', 10, { part: '2-10008', nsn: '5210003511375' })
			]
		);

		expect(analysis.decisions.map((d) => d.kind)).toEqual(['include-table']);
		expect(analysis.summary.toImport).toBe(2);
	});

	it('separates records with different CAGE codes unless one without CAGE bridges them', () => {
		const sheets = [sheet('A', 0), sheet('B', 1)];
		const withCage = (sheetName: string, cage: string) =>
			record(sheetName, 2, { part: 'P-1', nsn: '5305016582565', cage });

		const distinct = run(sheets, [withCage('A', '0BWZ1'), withCage('B', '1ABC2')]);
		expect(distinct.decisions.map((d) => d.kind)).toEqual(['include-table', 'include-table']);
		expect(distinct.summary.toImport).toBe(2);

		const bridged = run(
			[...sheets, sheet('C', 2)],
			[
				withCage('A', '0BWZ1'),
				withCage('B', '1ABC2'),
				record('C', 2, { part: 'P-1', nsn: '5305016582565' })
			]
		);
		expect(decisionsOf(bridged, 'resolve-conflict')).toEqual([
			expect.objectContaining({ recordIds: ['A@1:r2', 'B@1:r2', 'C@1:r2'], state: 'pending' })
		]);
		expect(bridged.records[0].issues[0]).toMatchObject({ code: 'conflict', field: 'cage' });
	});

	it('drops records already in storage when their other fields agree or are missing on one side', () => {
		const sheets = [sheet('Parts', 0)];
		const records = [
			record('Parts', 2, { part: 'MS 51957-3', nsn: '5305016582565' }),
			record('Parts', 3, { part: 'SE5826', nsn: '5305016698021', cage: '0BWZ1', description: 'Screw' })
		];
		const existing: StoredMapping[] = [
			{ id: 'saved-1', part: ' ms  51957-3', nsn: '5305-01-658-2565', description: 'Screw, machine' },
			{ id: 'saved-2', part: 'SE5826', nsn: '5305016698021', cage: '0bwz1' }
		];
		const analysis = run(sheets, records, { existing });

		expect(decisionsOf(analysis, 'drop-duplicate')).toEqual([
			expect.objectContaining({
				id: 'drop-duplicate:Parts@1:r2',
				state: 'auto',
				chosen: 'drop',
				cells: ['Parts!A2', 'Parts!C2']
			}),
			expect.objectContaining({ id: 'drop-duplicate:Parts@1:r3', state: 'auto', chosen: 'drop' })
		]);
		expect(decisionsOf(analysis, 'resolve-storage-conflict')).toEqual([]);
		expect(find(analysis, 'Parts@1:r2')).toMatchObject({ status: 'duplicate', approved: false });
		expect(issueCodes(find(analysis, 'Parts@1:r2'))).toEqual(['duplicate-in-storage']);
		expect(find(analysis, 'Parts@1:r3')).toMatchObject({ status: 'duplicate', approved: false });

		const kept = run(sheets, records, {
			existing,
			decisions: { 'drop-duplicate:Parts@1:r2': 'keep' }
		});
		expect(find(kept, 'Parts@1:r2').approved).toBe(true);
	});
});

describe('storage conflicts (saved copy with another description or CAGE)', () => {
	const sheets = [sheet('Parts', 0)];
	const PART = '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P';
	const records = [
		record('Parts', 3, {
			part: PART,
			nsn: '5305016582565',
			description: 'Screw, Machine',
			cage: '0BWZ1'
		})
	];
	const savedCopy: StoredMapping = {
		id: 'saved-1',
		part: PART,
		nsn: '5305016582565',
		niin: '016582565',
		description: 'Screw, machine, pan head',
		cage: '0BWZ1'
	};
	const id = 'resolve-storage-conflict:Parts@1:r3+saved:saved-1';
	const input = {
		part: PART,
		description: 'Screw, Machine',
		nsn: '5305016582565',
		niin: '016582565',
		cage: '0BWZ1'
	};

	it('holds the record back with keep-saved suggested', () => {
		const analysis = run(sheets, records, { existing: [savedCopy] });

		const [decision] = decisionsOf(analysis, 'resolve-storage-conflict');
		expect(decision).toMatchObject({
			id,
			state: 'pending',
			chosen: null,
			suggested: 'keep-saved',
			recordIds: ['Parts@1:r3'],
			existingIds: ['saved-1'],
			cells: ['Parts!A3', 'Parts!C3', 'Parts!B3']
		});
		expect(decision.options.map((option) => option.id)).toEqual([
			'keep-saved',
			'replace-saved',
			'keep-both'
		]);
		expect(decision.reason).toBe(
			`Parts row 3 has the same part ${PART} and NSN 5305016582565 as a saved mapping but a different description. Keeping the saved mapping is suggested.`
		);
		expect(decisionsOf(analysis, 'drop-duplicate')).toEqual([]);
		expect(find(analysis, 'Parts@1:r3')).toMatchObject({ status: 'pending', approved: false });
		expect(find(analysis, 'Parts@1:r3').issues).toEqual([
			{
				code: 'duplicate-in-storage',
				severity: 'warning',
				field: 'description',
				message: 'Description "Screw, Machine" differs from the saved "Screw, machine, pan head".',
				cells: ['Parts!B3']
			}
		]);
		expect(toImportPlan(analysis)).toEqual({ add: [], replace: [] });
	});

	it.each([
		['keep-saved', { status: 'duplicate', approved: false }, { add: [], replace: [] }],
		[
			'replace-saved',
			{ status: 'warning', approved: true },
			{ add: [], replace: [{ id: 'saved-1', input }] }
		],
		['keep-both', { status: 'warning', approved: true }, { add: [input], replace: [] }]
	] as const)('applies %s', (choice, outcome, plan) => {
		const analysis = run(sheets, records, { existing: [savedCopy], decisions: { [id]: choice } });

		expect(decisionsOf(analysis, 'resolve-storage-conflict')[0]).toMatchObject({
			state: 'user',
			chosen: choice
		});
		expect(find(analysis, 'Parts@1:r3')).toMatchObject(outcome);
		expect(toImportPlan(analysis)).toEqual(plan);
	});

	it('keeps the saved mapping when every suggestion is accepted', () => {
		const pending = run(sheets, records, { existing: [savedCopy] });
		const analysis = run(sheets, records, { existing: [savedCopy], decisions: acceptAll(pending) });

		expect(find(analysis, 'Parts@1:r3')).toMatchObject({ status: 'duplicate', approved: false });
		expect(analysis.summary).toMatchObject({ pendingDecisions: 0, toImport: 0 });
	});

	it('treats another CAGE as a conflict and replaces the first of several saved copies', () => {
		const existing: StoredMapping[] = [
			{ ...savedCopy, description: 'screw,  machine', cage: '9ZZZ9' },
			{ ...savedCopy, id: 'saved-2', description: 'Screw' }
		];
		const analysis = run(sheets, records, { existing });

		const [decision] = decisionsOf(analysis, 'resolve-storage-conflict');
		expect(decision).toMatchObject({ id, existingIds: ['saved-1', 'saved-2'] });
		expect(decision.reason).toContain('as 2 saved mappings but a different description and CAGE.');
		expect(find(analysis, 'Parts@1:r3').issues.map((issue) => issue.message)).toEqual([
			'Description "Screw, Machine" differs from the saved "Screw".',
			'CAGE "0BWZ1" differs from the saved "9ZZZ9".'
		]);

		const replaced = run(sheets, records, { existing, decisions: { [id]: 'replace-saved' } });
		expect(toImportPlan(replaced).replace).toEqual([{ id: 'saved-1', input }]);
	});

	it('drops the record instead when any saved copy is compatible', () => {
		const existing: StoredMapping[] = [
			savedCopy,
			{ id: 'saved-2', part: PART.toLowerCase(), nsn: '5305-01-658-2565' }
		];
		const analysis = run(sheets, records, { existing });

		expect(decisionsOf(analysis, 'resolve-storage-conflict')).toEqual([]);
		expect(decisionsOf(analysis, 'drop-duplicate')).toEqual([
			expect.objectContaining({ state: 'auto', chosen: 'drop', recordIds: ['Parts@1:r3'] })
		]);
	});

	it('falls back to the policy for a stale choice', () => {
		const invalid = run(sheets, records, { existing: [savedCopy], decisions: { [id]: 'drop' } });
		expect(decisionsOf(invalid, 'resolve-storage-conflict')[0]).toMatchObject({
			state: 'pending',
			chosen: null
		});

		// The saved copy the choice named is gone, so the choice no longer applies to anything.
		const replacedCopy = { ...savedCopy, id: 'saved-9' };
		const gone = run(sheets, records, {
			existing: [replacedCopy],
			decisions: { [id]: 'replace-saved' }
		});
		expect(decisionsOf(gone, 'resolve-storage-conflict')[0]).toMatchObject({
			id: 'resolve-storage-conflict:Parts@1:r3+saved:saved-9',
			state: 'pending'
		});
		expect(find(gone, 'Parts@1:r3').approved).toBe(false);
		expect(toImportPlan(gone)).toEqual({ add: [], replace: [] });
	});
});

describe('FSC / NIIN mismatch', () => {
	it('flags every record of a NIIN listed under several FSCs and keeps them all (Statz R37-R39)', () => {
		const analysis = run(
			[sheet('Sheet1', 0)],
			[
				record('Sheet1', 37, { part: '2-24024', nsn: '5210011066157' }),
				record('Sheet1', 38, { part: '2-24024', nsn: '5220011066157' }),
				record('Sheet1', 39, { part: '2-24024', nsn: '6685011066157' }),
				record('Sheet1', 40, { part: '2-24033', nsn: '5210010953078' })
			]
		);

		const [r37, r38, r39, r40] = analysis.records;
		for (const flagged of [r37, r38, r39]) {
			expect(flagged).toMatchObject({ status: 'warning', approved: true });
			expect(issueCodes(flagged)).toEqual(['fsc-niin-mismatch']);
		}
		expect(r37.issues[0]).toMatchObject({
			relatedRecords: ['Sheet1@1:r38', 'Sheet1@1:r39'],
			cells: ['Sheet1!C37', 'Sheet1!C38', 'Sheet1!C39']
		});
		expect(r38.issues[0].message).toBe(
			'NIIN 011066157 (one catalog item) appears with 3 FSCs in this upload: 5210 (row 37), 5220 (this row), 6685 (row 39). An item has one FSC at a time, so at most one of these NSNs is current; the others are probably outdated or mistyped. All are imported; verify before use.'
		);
		expect(r37.issues[0].message).toContain(': 5210 (this row), 5220 (row 38), 6685 (row 39).');
		expect(r40).toMatchObject({ status: 'valid', issues: [] });
		expect(analysis.decisions.map((d) => d.kind)).toEqual(['include-table']);
		expect(analysis.summary).toMatchObject({ warnings: 3, valid: 1, toImport: 4 });
	});
});

describe('decision list and re-runs', () => {
	const sheets = [
		sheet('NSN Cross-Reference', 1),
		sheet('Part Number Intake', 3),
		sheet('Search Log', 4, 'needs-review')
	];
	const records = [
		record('NSN Cross-Reference', 3, { part: '6-32X1/4', nsn: '5305016582565', cage: '0BWZ1' }),
		record('NSN Cross-Reference', 4, { part: 'SE5826', nsn: '5305016698021', cage: '0BWZ1' }),
		record('Part Number Intake', 3, { part: 'SE5826', nsn: '5305016698021', description: 'Assembly screw' }),
		record('Part Number Intake', 4, { part: '6-32X1/4', nsn: '5305016582565', description: 'Machine screw' }),
		record('NSN Cross-Reference', 5, { part: 'X-1', description: 'Screw, Assembly' }),
		record('Part Number Intake', 5, { part: 'x-1', description: 'Assembly screw' }),
		record('Search Log', 4, { part: '6-32X1/4', nsn: '5305016582565' })
	];

	it('lists pending decisions first, each group in sheet and row order', () => {
		const analysis = run(sheets, records);

		expect(analysis.decisions.map((d) => [d.state, d.kind, d.id])).toEqual([
			['pending', 'resolve-conflict', 'resolve-conflict:NSN Cross-Reference@1:r5+Part Number Intake@1:r5'],
			['pending', 'include-table', 'include-table:Search Log@1'],
			['auto', 'include-table', 'include-table:NSN Cross-Reference@1'],
			['auto', 'merge-duplicates', 'merge-duplicates:NSN Cross-Reference@1:r3+Part Number Intake@1:r4'],
			['auto', 'merge-duplicates', 'merge-duplicates:NSN Cross-Reference@1:r4+Part Number Intake@1:r3'],
			['auto', 'include-table', 'include-table:Part Number Intake@1']
		]);
	});

	it('finds the same decisions again when re-run with the stored choices', () => {
		const first = run(sheets, records);
		const decisions = acceptAll(first);
		const second = run(sheets, records, { decisions });

		expect(second.decisions.map((d) => d.id).sort()).toEqual(first.decisions.map((d) => d.id).sort());
		for (const [id, chosen] of Object.entries(decisions)) {
			expect(second.decisions.find((d) => d.id === id)).toMatchObject({ state: 'user', chosen });
		}
		expect(second.summary).toMatchObject({ pendingDecisions: 0, toImport: 3 });
		expect(run(sheets, records, { decisions })).toEqual(second);
	});

	it('ignores a stored choice that is no longer one of the options', () => {
		const analysis = run(sheets, records, {
			decisions: {
				'resolve-conflict:NSN Cross-Reference@1:r5+Part Number Intake@1:r5': 'prefer:Gone@1:r9'
			}
		});

		expect(analysis.decisions[0]).toMatchObject({ state: 'pending', chosen: null });
	});

	it('does not mutate the records it was given', () => {
		const before = structuredClone(records);
		run(sheets, records, { decisions: acceptAll(run(sheets, records)) });

		expect(records).toEqual(before);
	});
});

describe('toImportPlan', () => {
	it('adds approved records only, without FSC', () => {
		const analysis = run(
			[sheet('Parts', 0)],
			[
				record('Parts', 2, { part: 'P-1', fsc: '5305', niin: '016582565', nsn: '5305016582565' }),
				record('Parts', 3, { description: 'No identifier' }, { status: 'invalid' })
			]
		);

		expect(toImportPlan(analysis)).toEqual({
			add: [{ part: 'P-1', nsn: '5305016582565', niin: '016582565' }],
			replace: []
		});
	});
});
