/**
 * Mock pipeline for exercising the review window and its session without SheetJS or a network.
 *
 * One workbook combines the shapes of the three fixtures (WOW, Statz, PENCOM) so every sheet status, record
 * status, issue code, and decision kind and state appears. buildMockAnalysis() honors Overrides in a simplified
 * way (decision choices, column remaps, AI tables) so the window can be exercised end to end. It is a UI fixture,
 * not a reference for pipeline behavior.
 */
import {
	decisionId,
	WorkbookReadError,
	type CandidateRecord,
	type ColumnMapping,
	type Confidence,
	type Decision,
	type DecisionKind,
	type DecisionOption,
	type Field,
	type FieldValue,
	type Issue,
	type MappingInput,
	type Overrides,
	type SheetAnalysis,
	type SkippedRow,
	type TableCandidate,
	type Transform,
	type VerificationResult,
	type WorkbookAnalysis
} from '$lib/import/model';
import { qualifiedRef, toA1 } from '$lib/import/refs';
import type { ImportEngine } from '$lib/import/session.svelte';

const FILE = 'mock-supplier-workbook.xlsx';

/* ---------- Tables ---------- */

type ColumnDef = {
	header: string;
	field: Field | null;
	confidence: Confidence;
	reasons: string[];
	alternatives?: Field[];
	passRate?: number;
};

type TableDef = {
	sheet: string;
	headerRow: number;
	lastRow: number;
	/** Column A first. */
	columns: ColumnDef[];
	skippedRows: SkippedRow[];
	status: TableCandidate['status'];
	confidence: Confidence;
	reasons: string[];
};

const ACTIVE_PARTS: TableDef = {
	sheet: 'Active Parts',
	headerRow: 1,
	lastRow: 180,
	columns: [
		{
			header: '(Do Not Modify) Part',
			field: null,
			confidence: 'low',
			reasons: ['Hidden column (zero width); never mapped automatically', 'Values are UUIDs, not part numbers']
		},
		{
			header: '(Do Not Modify) Row Checksum',
			field: null,
			confidence: 'low',
			reasons: ['Hidden column (zero width); never mapped automatically', 'Values look like checksums']
		},
		{
			header: '(Do Not Modify) Modified On',
			field: null,
			confidence: 'low',
			reasons: ['Hidden column (zero width); never mapped automatically', 'Values are timestamps']
		},
		{
			header: 'Part Number',
			field: 'part',
			confidence: 'high',
			reasons: ['Header "Part Number" matches Part number', '177 of 178 values look like part numbers'],
			passRate: 177 / 178
		},
		{
			header: 'NSN',
			field: 'nsn',
			confidence: 'high',
			reasons: ['Header "NSN" matches NSN', '127 of 129 values are valid NSNs'],
			alternatives: ['niin'],
			passRate: 127 / 129
		},
		{
			header: 'Nomenclature',
			field: 'description',
			confidence: 'high',
			reasons: ['Header "Nomenclature" matches Description', '178 of 178 values are text'],
			passRate: 1
		}
	],
	skippedRows: [],
	status: 'ready',
	confidence: 'high',
	reasons: ['Part number and NSN columns recognized with high confidence', 'No CAGE column found']
};

const STATZ: TableDef = {
	sheet: 'Sheet1',
	headerRow: 1,
	lastRow: 58,
	columns: [
		{
			header: 'G & B P/N',
			field: 'part',
			confidence: 'high',
			reasons: ['Header "G & B P/N" matches Part number (vendor prefix ignored)', '54 of 54 values look like part numbers'],
			passRate: 1
		},
		{
			header: 'Dwg Number',
			field: null,
			confidence: 'medium',
			reasons: [
				'Values also look like part numbers (52 of 54)',
				'Column A has the stronger part header, so this column is offered as an alternative'
			],
			alternatives: ['part']
		},
		{
			header: 'NSN',
			field: 'nsn',
			confidence: 'high',
			reasons: ['Header "NSN" matches NSN', '54 of 54 values are valid NSNs'],
			alternatives: ['niin'],
			passRate: 1
		}
	],
	skippedRows: [
		{ row: 32, reason: 'blank' },
		{ row: 33, reason: 'blank' },
		{ row: 34, reason: 'repeated-header' }
	],
	status: 'ready',
	confidence: 'high',
	reasons: ['Part number and NSN columns recognized with high confidence', 'No Description column found', 'No CAGE column found']
};

const XREF: TableDef = {
	sheet: 'NSN Cross-Reference',
	headerRow: 2,
	lastRow: 5,
	columns: [
		{
			header: 'PENCOM Part Number',
			field: 'part',
			confidence: 'high',
			reasons: ['Header "PENCOM Part Number" matches Part number (vendor prefix ignored)', '2 of 2 values look like part numbers'],
			passRate: 1
		},
		{
			header: 'NSN',
			field: 'nsn',
			confidence: 'high',
			reasons: ['Header "NSN" matches NSN', '2 of 2 values are valid NSNs'],
			passRate: 1
		},
		{
			header: 'Description',
			field: 'description',
			confidence: 'high',
			reasons: ['Header "Description" matches Description', '2 of 2 values are text'],
			passRate: 1
		},
		{
			header: 'CAGE Code',
			field: 'cage',
			confidence: 'high',
			reasons: ['Header "CAGE Code" matches CAGE', '2 of 2 values are valid CAGE codes'],
			passRate: 1
		},
		{
			header: 'MIL/MS/NAS Equivalent',
			field: null,
			confidence: 'low',
			reasons: ['Header has the modifier "equivalent": a competing part column, not mapped'],
			alternatives: ['part']
		},
		{ header: 'Notes', field: null, confidence: 'low', reasons: ['No field matches the header "Notes"'] },
		{
			header: 'NIIN',
			field: 'niin',
			confidence: 'high',
			reasons: ['Header "NIIN" matches NIIN', '1 of 1 values are valid NIINs'],
			passRate: 1
		}
	],
	skippedRows: [],
	status: 'ready',
	confidence: 'high',
	reasons: ['Part number, NSN, NIIN, Description and CAGE columns recognized with high confidence']
};

const INTAKE: TableDef = {
	sheet: 'Part Number Intake',
	headerRow: 2,
	lastRow: 7,
	columns: [
		{
			header: 'Part Number',
			field: 'part',
			confidence: 'high',
			reasons: ['Header "Part Number" matches Part number', '2 of 2 values look like part numbers'],
			passRate: 1
		},
		{
			header: 'NSN',
			field: 'nsn',
			confidence: 'high',
			reasons: ['Header "NSN" matches NSN', '2 of 2 values are valid NSNs'],
			passRate: 1
		},
		{
			header: 'Description',
			field: 'description',
			confidence: 'high',
			reasons: ['Header "Description" matches Description', '2 of 2 values are text'],
			passRate: 1
		},
		{
			header: 'Manufacturer',
			field: null,
			confidence: 'low',
			reasons: ['Values are company names, not CAGE codes (0 of 2 valid)']
		},
		{
			header: 'NSN Found',
			field: null,
			confidence: 'low',
			reasons: ['Header has the modifier "found"', 'Values are Yes/No, not NSNs (0 of 2 valid)']
		},
		{ header: 'Mfg.', field: null, confidence: 'low', reasons: ['No field matches the header "Mfg."', 'Values are Y/N'] }
	],
	skippedRows: [
		{ row: 5, reason: 'no-mapped-values' },
		{ row: 6, reason: 'no-mapped-values' },
		{ row: 7, reason: 'no-mapped-values' }
	],
	status: 'ready',
	confidence: 'high',
	reasons: ['Part number, NSN and Description columns recognized with high confidence', 'No CAGE column found']
};

const SEARCH_LOG: TableDef = {
	sheet: 'Search Log',
	headerRow: 2,
	lastRow: 6,
	columns: [
		{
			header: 'Part Query',
			field: 'part',
			confidence: 'medium',
			reasons: ['Header "Part Query" matches Part number only weakly (modifier "query")', '3 of 3 values look like part numbers'],
			passRate: 1
		},
		{
			header: 'FSC',
			field: 'fsc',
			confidence: 'high',
			reasons: ['Header "FSC" matches FSC', '3 of 3 values are valid FSCs'],
			passRate: 1
		},
		{
			header: 'NIIN Result',
			field: 'niin',
			confidence: 'medium',
			reasons: ['Header "NIIN Result" matches NIIN only weakly (modifier "result")', '3 of 3 values are valid NIINs'],
			passRate: 1
		},
		{ header: 'Searched On', field: null, confidence: 'low', reasons: ['Values are dates'] },
		{ header: 'Status', field: null, confidence: 'low', reasons: ['No field matches the header "Status"'] }
	],
	skippedRows: [{ row: 6, reason: 'blank' }],
	status: 'needs-review',
	confidence: 'medium',
	reasons: [
		'The part and NIIN columns match only weakly ("Part Query", "NIIN Result")',
		'Reads like a log of searches rather than a parts list'
	]
};

const TABLES = [ACTIVE_PARTS, STATZ, XREF, INTAKE, SEARCH_LOG];

const tableId = (def: TableDef) => `${def.sheet}@${def.headerRow}`;

function dataRows(def: TableDef): number[] {
	const skipped = new Set(def.skippedRows.map((skip) => skip.row));
	const rows: number[] = [];
	for (let row = def.headerRow + 1; row <= def.lastRow; row++) if (!skipped.has(row)) rows.push(row);
	return rows;
}

/** Applies column overrides the way the brief describes: the overridden column wins and evicts its rival. */
function toCandidate(def: TableDef, overrides: Overrides): TableCandidate {
	const id = tableId(def);
	const remaps = overrides.columns?.[id] ?? {};
	const columns: ColumnMapping[] = def.columns.map((column, index) => ({
		col: index + 1,
		header: column.header,
		field: column.field,
		confidence: column.confidence,
		reasons: column.reasons,
		alternatives: column.alternatives ?? [],
		valuePassRate: column.field ? (column.passRate ?? 1) : null,
		overridden: false
	}));
	for (const [key, field] of Object.entries(remaps)) {
		const col = Number(key);
		for (const other of columns) {
			if (other.col !== col && field !== null && other.field === field && !(other.col in remaps)) {
				other.field = null;
				other.valuePassRate = null;
				other.reasons = [`Replaced by user mapping of column ${toA1(1, col).replace(/\d+$/, '')}`];
			}
		}
		const column = columns[col - 1];
		column.field = field;
		column.confidence = 'high';
		column.reasons = ['Set by user'];
		column.valuePassRate = field ? 0.95 : null;
		column.overridden = true;
	}
	return {
		id,
		sheet: def.sheet,
		headerRows: [def.headerRow],
		range: { top: def.headerRow, left: 1, bottom: def.lastRow, right: def.columns.length },
		dataRows: dataRows(def),
		skippedRows: def.skippedRows,
		columns,
		status: def.status,
		confidence: def.confidence,
		reasons: def.reasons,
		source: 'deterministic'
	};
}

/* ---------- Sheets ---------- */

type SheetDef = Omit<SheetAnalysis, 'index' | 'tables'> & { table?: TableDef };

const SHEETS: SheetDef[] = [
	{
		name: 'Active Parts',
		status: 'ready',
		reasons: ['Header found on row 1', '179 data rows', 'Hidden columns A-C (zero width) ignored'],
		table: ACTIVE_PARTS,
		aiTrigger: null
	},
	{ name: 'hiddenSheet', status: 'hidden', reasons: ['Very hidden in the workbook; ignored'], aiTrigger: null },
	{
		name: 'Sheet1',
		status: 'ready',
		reasons: [
			'Header found on row 1',
			'Rows 32-33 are blank and row 34 repeats the header; skipped',
			'Both data blocks read as one table'
		],
		table: STATZ,
		aiTrigger: null
	},
	{
		name: 'Dashboard',
		status: 'no-table',
		reasons: [
			'Mentions "NSN" and "part number" in 6 cells, but no row reads as a table header',
			'Cells hold counts and labels, not identifiers'
		],
		aiTrigger: null
	},
	{
		name: 'NSN Cross-Reference',
		status: 'ready',
		reasons: ['Title in row 1 (merged A1:F1) skipped', 'Header found on row 2', '998 formatted empty rows ignored'],
		table: XREF,
		aiTrigger: null
	},
	{
		name: 'Part Number Intake',
		status: 'ready',
		reasons: ['Header found on row 2', 'Rows 5-7 have values only in unmapped columns; skipped'],
		table: INTAKE,
		aiTrigger: null
	},
	{
		name: 'Search Log',
		status: 'needs-review',
		reasons: ['Possible table on rows 2-5, but its identifier columns match only weakly', 'Held back until you include it'],
		table: SEARCH_LOG,
		aiTrigger: 'No ready table, but 3 cells hold valid NIINs'
	},
	{
		name: 'Opportunity Matrix',
		status: 'no-table',
		reasons: [
			'Header row has no Part number, NSN, or NIIN column',
			'"NSN Matchability (1-5)" holds scores and "NSN Found" holds Yes/No'
		],
		aiTrigger: null
	},
	{
		name: 'Sources & Notes',
		status: 'no-table',
		reasons: ['Header on row 3 ("Source", "URL", "Notes") has no identifier column', 'Mentions NSNs only in prose'],
		aiTrigger: null
	}
];

/* ---------- Records ---------- */

/** A plain string is normalized by field rules; a tuple gives the original, value, and transforms explicitly. */
type Value = string | [original: string, value: string, transforms: Transform[]];

type RecordSpec = {
	row: number;
	values: Partial<Record<Field, Value>>;
	rejected?: Partial<Record<Field, string>>;
	issues?: Issue[];
	status?: CandidateRecord['status'];
	split?: { field: Field; index: number; total: number };
};

function normalize(field: Field, original: string): [string, Transform[]] {
	const trimmed = original.trim();
	const transforms: Transform[] = trimmed === original ? [] : ['trim'];
	if (field === 'nsn' || field === 'niin') {
		const digits = trimmed.replace(/[\s‐-―-]/g, '');
		return [digits, digits === trimmed ? transforms : [...transforms, 'strip-separators']];
	}
	if (field === 'cage') return [trimmed.toUpperCase(), trimmed === trimmed.toUpperCase() ? transforms : [...transforms, 'uppercase']];
	return [trimmed, transforms];
}

function buildRecord(table: TableCandidate, def: TableDef, spec: RecordSpec): CandidateRecord {
	const colOf = (field: Field) => def.columns.findIndex((column) => column.field === field) + 1;
	const ref = (field: Field) => toA1(spec.row, colOf(field));
	const fields: CandidateRecord['fields'] = {};

	for (const [key, input] of Object.entries(spec.values)) {
		const field = key as Field;
		const [original, value, transforms] = typeof input === 'string' ? [input, ...normalize(field, input)] : input;
		fields[field] = {
			value,
			provenance: {
				file: FILE,
				sheet: def.sheet,
				row: spec.row,
				col: colOf(field),
				cell: ref(field),
				original,
				transforms,
				origin: 'source'
			}
		};
	}

	// Derived values take the cell, column, and original of their first source, as the records stage does.
	const derive = (from: FieldValue[], value: string, transform: Transform): FieldValue => ({
		value,
		provenance: {
			...from[0].provenance,
			transforms: [transform],
			origin: 'derived',
			derivedFrom: from.map((fieldValue) => fieldValue.provenance.cell)
		}
	});
	if (fields.nsn && !fields.niin) fields.niin = derive([fields.nsn], fields.nsn.value.slice(4), 'derive-niin-from-nsn');
	if (fields.fsc && fields.niin && !fields.nsn) {
		fields.nsn = derive([fields.niin, fields.fsc], fields.fsc.value + fields.niin.value, 'derive-nsn-from-fsc-niin');
	}

	const rejected: CandidateRecord['rejected'] = {};
	for (const [key, original] of Object.entries(spec.rejected ?? {})) {
		rejected[key as Field] = { original, cell: ref(key as Field) };
	}

	const split = spec.split && { cell: ref(spec.split.field), index: spec.split.index, total: spec.split.total };
	const status = spec.status ?? 'valid';
	return {
		id: `${table.id}:r${spec.row}${split ? `.${split.index}` : ''}`,
		tableId: table.id,
		sheet: def.sheet,
		sourceRow: spec.row,
		...(split && { split }),
		fields,
		rejected,
		issues: spec.issues ?? [],
		status,
		approved: status === 'valid' || status === 'warning'
	};
}

const at = (sheet: string, ref: string) => qualifiedRef(sheet, ref);

const FSCS = ['5305', '5310', '2530', '2940', '4730', '5340', '5330', '2590'];
const NOUNS = [
	'Screw, cap, hexagon head',
	'Washer, lock',
	'Nut, self-locking, hexagon',
	'Gasket',
	'Filter element, fluid',
	'Seal, plain encased',
	'Hose assembly, nonmetallic',
	'Valve, check',
	'Bearing, ball, annular',
	'Pin, cotter'
];

/** Deterministic filler with the part-number shapes seen in the fixtures (punctuation, revisions, suffixes). */
function fillerPart(row: number): string {
	const n = (row * 7919) % 100_000;
	switch (row % 6) {
		case 0:
			return `126${String(n).padStart(5, '0')}`;
		case 1:
			return `MS${21_000 + (n % 9000)}-${(row % 12) + 1}`;
		case 2:
			return `BH0${(n % 90) + 10}-HT REV 00${row % 3}`;
		case 3:
			return `${11_000_000 + n * 3}-GRN`;
		case 4:
			return `NAS${1100 + (n % 800)}C${(row % 9) + 2}`;
		default:
			return `${2_132_000 + n}-2  C`;
	}
}

function fillerNsn(row: number): string {
	const niin = String((row * 104_729) % 10_000_000).padStart(7, '0');
	return `${FSCS[row % FSCS.length]}-01-${niin.slice(0, 3)}-${niin.slice(3)}`;
}

function activePartsSpecs(choices: Choices): RecordSpec[] {
	const sheet = ACTIVE_PARTS.sheet;
	const special = new Map<number, RecordSpec[]>();
	const add = (...specs: RecordSpec[]) => specs.forEach((spec) => special.set(spec.row, [...(special.get(spec.row) ?? []), spec]));

	add({
		row: 9,
		values: { part: '12273108 (EATON M144E)', nsn: '2940-01-421-8856', description: 'Filter element, intake' },
		issues: [
			{
				code: 'suspicious-value',
				severity: 'warning',
				field: 'part',
				message: `Part number "12273108 (EATON M144E)" in ${at(sheet, 'D9')} contains text in parentheses; kept as written`,
				cells: [at(sheet, 'D9')]
			}
		],
		status: 'warning'
	});
	add({ row: 40, values: { part: 'MS35338-44', nsn: '5310-00-045-3299', description: 'Washer, lock' } });
	add({ row: 60, values: { part: 'NAS1149F0332P', description: 'Washer, flat' } });
	add({ row: 70, values: { part: 'M30294', nsn: '1560-00-000-0047', description: 'Bolt, hexagon head' }, status: 'conflict' });
	add({ row: 89, values: { part: '10931023*92', nsn: '2530-01-123-4567', description: 'Shoe, brake' } });
	add({ row: 90, values: { part: '10931023*92', nsn: '2530-01-123-4567', description: 'Shoe, brake' } });
	add({
		row: 134,
		values: { part: '12663107', description: 'Bracket, engine accessory' },
		rejected: { nsn: '12663107' },
		issues: [
			{
				code: 'invalid-identifier',
				severity: 'error',
				field: 'nsn',
				message: `NSN "12663107" in ${at(sheet, 'E134')} has 8 digits, expected 13; same value as part number in ${at(sheet, 'D134')}`,
				cells: [at(sheet, 'E134'), at(sheet, 'D134')]
			}
		],
		status: 'warning'
	});

	add({
		row: 120,
		values: { part: 'MS9068-012', description: 'Packing, preformed' },
		rejected: { nsn: '' },
		issues: [
			{
				code: 'invalid-identifier',
				severity: 'error',
				field: 'nsn',
				message: `Excel error value #N/A in ${at(sheet, 'E120')}`,
				cells: [at(sheet, 'E120')]
			}
		],
		status: 'warning'
	});

	const parts = ['12669555', 'RVX08212'];
	const multi = '12669555\nRVX08212';
	if (choices.split === 'keep-as-one') {
		add({ row: 136, values: { part: [multi, multi, []], nsn: '2940-01-559-1191', description: 'Filter element, fluid' } });
	} else {
		add(
			...parts.map((part, i) => ({
				row: 136,
				values: { part: [multi, part, ['split-multi-value']] as Value, nsn: '2940-01-559-1191', description: 'Filter element, fluid' },
				issues: [
					{
						code: 'split-from-multi-value' as const,
						severity: 'info' as const,
						field: 'part' as const,
						message: `Part number in ${at(sheet, 'D136')} holds 2 values on separate lines; this record is value ${i + 1} of 2`,
						cells: [at(sheet, 'D136')]
					}
				],
				split: { field: 'part' as const, index: i + 1, total: 2 }
			}))
		);
	}

	add({
		row: 150,
		values: { nsn: '' },
		rejected: { part: '4-Mar' },
		issues: [
			{
				code: 'invalid-identifier',
				severity: 'error',
				field: 'part',
				message: `Part number in ${at(sheet, 'D150')} is stored as a date ("4-Mar"); Excel converted it and the original value cannot be recovered`,
				cells: [at(sheet, 'D150')]
			},
			{
				code: 'missing-primary-identifier',
				severity: 'error',
				message: `Row 150 has no valid part number, NSN, or NIIN`,
				cells: [at(sheet, 'D150'), at(sheet, 'E150')]
			}
		],
		status: 'invalid'
	});
	add({
		row: 166,
		values: { part: 'LS-4471-C', description: 'Lamp, incandescent' },
		rejected: { nsn: '280-035-330-101F' },
		issues: [
			{
				code: 'invalid-identifier',
				severity: 'error',
				field: 'nsn',
				message: `NSN "280-035-330-101F" in ${at(sheet, 'E166')} contains letters; an NSN is 13 digits`,
				cells: [at(sheet, 'E166')]
			}
		],
		status: 'warning'
	});
	add({
		row: 170,
		values: { description: 'Bracket, mounting' },
		issues: [
			{
				code: 'missing-primary-identifier',
				severity: 'error',
				message: 'Row 170 has no valid part number, NSN, or NIIN',
				cells: [at(sheet, 'D170'), at(sheet, 'E170')]
			}
		],
		status: 'invalid'
	});
	add({
		row: 180,
		values: { part: '2132981-2  C', nsn: '5330-01-238-9102' },
		issues: [
			{
				code: 'missing-optional',
				severity: 'warning',
				field: 'description',
				message: `Description is empty in ${at(sheet, 'F180')}`,
				cells: [at(sheet, 'F180')]
			}
		],
		status: 'warning'
	});

	return dataRows(ACTIVE_PARTS).flatMap((row) => {
		const specs = special.get(row);
		if (specs) return specs.map((spec) => ({ ...spec, values: Object.fromEntries(Object.entries(spec.values).filter(([, v]) => v !== '')) }));
		const values: RecordSpec['values'] = { part: fillerPart(row), description: NOUNS[row % NOUNS.length] };
		if (row % 4 !== 3) values.nsn = fillerNsn(row);
		return [{ row, values }];
	});
}

function statzSpecs(choices: Choices): RecordSpec[] {
	const sheet = STATZ.sheet;
	const mismatch = (row: number, related: number[]): Issue => ({
		code: 'fsc-niin-mismatch',
		severity: 'warning',
		field: 'nsn',
		message: `Same NIIN as ${related.map((r) => at(sheet, `C${r}`)).join(', ')} but a different FSC`,
		cells: [at(sheet, `C${row}`), ...related.map((r) => at(sheet, `C${r}`))],
		relatedRecords: related.map((r) => `${tableId(STATZ)}:r${r}`)
	});
	const special = new Map<number, RecordSpec[]>([
		[
			5,
			[
				{
					row: 5,
					values: { part: ['7646198', '7646198', ['numeric-to-text']], nsn: '5305-01-118-2210' },
					issues: [
						{
							code: 'suspicious-value',
							severity: 'warning',
							field: 'part',
							message: `Part number in ${at(sheet, 'A5')} is stored as a number; leading zeros may have been lost`,
							cells: [at(sheet, 'A5')]
						}
					],
					status: 'warning'
				}
			]
		],
		[12, [{ row: 12, values: { part: 'MS35338-44', nsn: '5310-00-045-3299' } }]],
		[20, [{ row: 20, values: { part: 'GB-1042', nsn: '2530-01-485-5871' }, issues: [mismatch(20, [22])], status: 'warning' }]],
		[22, [{ row: 22, values: { part: 'GB-1043', nsn: '2590-01-485-5871' }, issues: [mismatch(22, [20])], status: 'warning' }]],
		...[37, 38, 39].map((row, i): [number, RecordSpec[]] => [
			row,
			[
				{
					row,
					values: { part: 'G-1180-3', nsn: `${['2530', '2590', '4730'][i]}-01-332-1188` },
					issues: [mismatch(row, [37, 38, 39].filter((r) => r !== row))],
					status: 'warning'
				}
			]
		])
	]);

	const parts = ['GB-2210', 'GB-2211'];
	const nsns = ['5340-01-111-2222', '5340-01-111-2223'];
	const ambiguous = (outcome: string): Issue => ({
		code: 'ambiguous-multi-value',
		severity: 'warning',
		message: `Part number in ${at(sheet, 'A50')} and NSN in ${at(sheet, 'C50')} hold 2 and 2 values on separate lines; ${outcome}`,
		cells: [at(sheet, 'A50'), at(sheet, 'C50')]
	});
	if (choices.ambiguous === 'keep-as-one') {
		special.set(50, [
			{ row: 50, values: { part: [parts.join('\n'), parts.join('\n'), []] }, rejected: { nsn: nsns.join('\n') },
				issues: [
					ambiguous('kept as one record'),
					{
						code: 'invalid-identifier',
						severity: 'error',
						field: 'nsn',
						message: `NSN in ${at(sheet, 'C50')} holds 2 values on separate lines; kept as one value it is not a valid NSN`,
						cells: [at(sheet, 'C50')]
					}
				],
				status: 'warning'
			}
		]);
	} else {
		special.set(
			50,
			parts.map((part, i) => ({
				row: 50,
				values: {
					part: [parts.join('\n'), part, ['split-multi-value']] as Value,
					nsn: [nsns.join('\n'), nsns[i].replaceAll('-', ''), ['split-multi-value', 'strip-separators']] as Value
				},
				issues: [ambiguous(`paired in order, value ${i + 1} of 2`)],
				status: choices.ambiguous === 'pair-in-order' ? ('valid' as const) : ('pending' as const),
				split: { field: 'part' as const, index: i + 1, total: 2 }
			}))
		);
	}

	return dataRows(STATZ).flatMap(
		(row) => special.get(row) ?? [{ row, values: { part: `GB-${1000 + row * 3}`, nsn: fillerNsn(row + 400) } }]
	);
}

const SCREW = '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P';

function conflictIssue(own: TableDef, ownRow: number, other: TableDef, otherRow: number, otherText: string): Issue {
	return {
		code: 'conflict',
		severity: 'warning',
		field: 'description',
		message: `Same part and NSN as ${other.sheet} row ${otherRow}, but the description differs ("${otherText}")`,
		cells: [at(own.sheet, `C${ownRow}`), at(other.sheet, `C${otherRow}`)],
		relatedRecords: [`${tableId(other)}:r${otherRow}`]
	};
}

const xrefSpecs: RecordSpec[] = [
	{
		row: 3,
		values: { part: SCREW, nsn: '5305-01-658-2565', description: 'Screw, Machine', cage: '0bwz1' },
		issues: [conflictIssue(XREF, 3, INTAKE, 3, '6-32 x 1/4 pan-head SEMS machine screw')],
		status: 'conflict'
	},
	{
		row: 4,
		values: { part: 'NAS1352-06-8P', nsn: '5305-00-987-6543', description: 'Screw, Assembly', cage: '0BWZ1' },
		issues: [conflictIssue(XREF, 4, INTAKE, 4, 'Assembly screw')],
		status: 'conflict'
	},
	{
		row: 5,
		values: { part: 'NAS1352-06-10P', nsn: '5305-01-658-2566', niin: '016582565', description: 'Screw, Cap', cage: '0BWZ1' },
		issues: [
			{
				code: 'conflict',
				severity: 'error',
				field: 'niin',
				message: `NSN 5305016582566 in ${at(XREF.sheet, 'B5')} does not match NIIN 016582565 in ${at(XREF.sheet, 'G5')}`,
				cells: [at(XREF.sheet, 'B5'), at(XREF.sheet, 'G5')]
			}
		],
		status: 'pending'
	}
];

const intakeSpecs: RecordSpec[] = [
	{
		row: 3,
		values: { part: ` ${SCREW}`, nsn: '5305 01 658 2565', description: '6-32 x 1/4 pan-head SEMS machine screw' },
		issues: [conflictIssue(INTAKE, 3, XREF, 3, 'Screw, Machine')],
		status: 'conflict'
	},
	{
		row: 4,
		values: { part: 'NAS1352-06-8P', nsn: '5305–00–987–6543', description: 'Assembly screw' },
		issues: [conflictIssue(INTAKE, 4, XREF, 4, 'Screw, Assembly')],
		status: 'conflict'
	}
];

function searchLogSpecs(): RecordSpec[] {
	const sheet = SEARCH_LOG.sheet;
	const lowConfidence = (row: number): Issue[] =>
		[
			{ field: 'part' as const, col: 'A', header: 'Part Query', label: 'Part number' },
			{ field: 'niin' as const, col: 'C', header: 'NIIN Result', label: 'NIIN' }
		].map(({ field, col, header, label }) => ({
			code: 'low-confidence-mapping',
			severity: 'warning',
			field,
			message: `${label} column ${col} ("${header}") was mapped with medium confidence`,
			cells: [at(sheet, `${col}${row}`)]
		}));
	return [
		{ row: 3, values: { part: 'MS51957-3', fsc: '5305', niin: '00-054-5631' }, issues: lowConfidence(3), status: 'pending' },
		{
			row: 4,
			values: { part: 'AN960C10L', fsc: '5310', niin: ['16582565', '016582565', ['numeric-to-text', 'restore-leading-zeros']] },
			issues: [
				...lowConfidence(4),
				{
					code: 'suspicious-value',
					severity: 'warning',
					field: 'niin',
					message: `NIIN in ${at(sheet, 'C4')} is stored as a number (16582565); restored leading zeros to 016582565`,
					cells: [at(sheet, 'C4')]
				}
			],
			status: 'pending'
		},
		{ row: 5, values: { part: 'M83248/1-014', fsc: '5331', niin: '01-224-9872' }, issues: lowConfidence(5), status: 'pending' }
	];
}

/* ---------- Decisions and their effects ---------- */

type Choices = { split: string; ambiguous: string | null };

const options = (...pairs: [string, string][]): DecisionOption[] => pairs.map(([id, label]) => ({ id, label }));

function makeDecision(
	overrides: Overrides,
	kind: DecisionKind,
	subject: string,
	policy: 'auto' | 'pending',
	fields: Omit<Decision, 'id' | 'kind' | 'state' | 'chosen'>
): Decision {
	const id = decisionId(kind, subject);
	const user = overrides.decisions?.[id];
	if (user) return { id, kind, state: 'user', chosen: user, ...fields };
	return { id, kind, state: policy, chosen: policy === 'auto' ? fields.suggested : null, ...fields };
}

function cellsOf(records: CandidateRecord[], field: Field): string[] {
	return records.flatMap((record) => {
		const value = record.fields[field];
		return value ? [at(record.sheet, value.provenance.cell)] : [];
	});
}

/** Drops values whose column the user unmapped or remapped; the mock has no cells to read new mappings from. */
function applyRemaps(record: CandidateRecord, table: TableCandidate) {
	const mapped = (value: FieldValue | undefined, field: Field) =>
		value && (value.provenance.origin === 'derived' || table.columns[value.provenance.col - 1]?.field === field);
	const fields: CandidateRecord['fields'] = {};
	for (const [key, value] of Object.entries(record.fields)) {
		if (mapped(value, key as Field)) fields[key as Field] = value;
	}
	if (fields.niin?.provenance.origin === 'derived' && !fields.nsn) delete fields.niin;
	if (fields.nsn?.provenance.origin === 'derived' && !(fields.fsc && fields.niin)) delete fields.nsn;
	record.fields = fields;
}

/** Builds the mock analysis with the given overrides applied. */
export function buildMockAnalysis(overrides: Overrides = {}, fileName = FILE): WorkbookAnalysis {
	const candidates = new Map(TABLES.map((def) => [def.sheet, toCandidate(def, overrides)]));
	for (const aiTable of overrides.aiTables ?? []) candidates.set(aiTable.sheet, aiTable);

	const sheets: SheetAnalysis[] = SHEETS.map(({ table, ...sheet }, index) => {
		const candidate = table && candidates.get(sheet.name);
		if (!candidate) return { ...sheet, index, tables: [] };
		const ai = candidate.source === 'ai';
		return {
			...sheet,
			index,
			status: candidate.status,
			reasons: ai ? ['Table proposed by AI and verified against the workbook', ...candidate.reasons] : sheet.reasons,
			tables: [candidate],
			aiTrigger: ai ? null : sheet.aiTrigger
		};
	});

	const table = (def: TableDef) => candidates.get(def.sheet)!;
	const choice = (kind: DecisionKind, subject: string, policy: string | null) =>
		overrides.decisions?.[decisionId(kind, subject)] ?? policy;
	const choices: Choices = {
		split: choice('split-cell', `${tableId(ACTIVE_PARTS)}:r136`, 'split')!,
		ambiguous: choice('ambiguous-multi-value', `${tableId(STATZ)}:r50`, null)
	};

	const records = [
		...activePartsSpecs(choices).map((spec) => buildRecord(table(ACTIVE_PARTS), ACTIVE_PARTS, spec)),
		...statzSpecs(choices).map((spec) => buildRecord(table(STATZ), STATZ, spec)),
		...xrefSpecs.map((spec) => buildRecord(table(XREF), XREF, spec)),
		...intakeSpecs.map((spec) => buildRecord(table(INTAKE), INTAKE, spec)),
		...searchLogSpecs().map((spec) => buildRecord(table(SEARCH_LOG), SEARCH_LOG, spec))
	];
	const byId = new Map(records.map((record) => [record.id, record]));
	const get = (id: string) => byId.get(id)!;
	for (const record of records) applyRemaps(record, candidates.get(record.sheet)!);

	const decisions: Decision[] = [];
	const decide = (
		kind: DecisionKind,
		subject: string,
		policy: 'auto' | 'pending',
		fields: Omit<Decision, 'id' | 'kind' | 'state' | 'chosen'>,
		apply: (chosen: string | null) => void
	) => {
		const decision = makeDecision(overrides, kind, subject, policy, fields);
		decisions.push(decision);
		apply(decision.chosen);
	};
	const setApproved = (ids: string[], approved: boolean) => ids.forEach((id) => (get(id).approved = approved));

	// Tables first: as in the validate stage, row decisions and duplicate checks only run for included tables.
	const included = new Set<string>();
	const excluded = new Set<string>();
	for (const def of TABLES) {
		const candidate = table(def);
		const ids = records.filter((record) => record.tableId === candidate.id).map((record) => record.id);
		const ai = candidate.source === 'ai' ? 'AI proposed this table. ' : '';
		decide(
			'include-table',
			candidate.id,
			candidate.status === 'ready' ? 'auto' : 'pending',
			{
				tableId: candidate.id,
				recordIds: ids,
				cells: [],
				options: options(['include', 'Include table'], ['exclude', 'Exclude table']),
				suggested: candidate.status === 'ready' ? 'include' : 'exclude',
				reason:
					candidate.status === 'ready'
						? `${ai}Ready: ${candidate.reasons[0]}`
						: `${ai}Needs review: ${candidate.reasons.join('; ')}`
			},
			(chosen) => {
				if (chosen === 'exclude') excluded.add(candidate.id);
				if (chosen !== 'include') return setApproved(ids, false);
				included.add(candidate.id);
				for (const record of ids.map(get)) {
					if (record.status === 'pending' && record.tableId === tableId(SEARCH_LOG)) {
						record.status = 'warning';
						record.approved = true;
					}
				}
			}
		);
	}
	const isIncluded = (...defs: TableDef[]) => defs.every((def) => included.has(tableId(def)));

	if (isIncluded(STATZ)) {
		const ids = records.filter((record) => record.tableId === tableId(STATZ) && record.sourceRow === 50).map((r) => r.id);
		decide(
			'ambiguous-multi-value',
			`${tableId(STATZ)}:r50`,
			'pending',
			{
				tableId: tableId(STATZ),
				recordIds: ids,
				cells: [at(STATZ.sheet, 'A50'), at(STATZ.sheet, 'C50')],
				options: options(['pair-in-order', 'Pair values in order (2 records)'], ['keep-as-one', 'Keep as one record'], ['exclude', 'Exclude the row']),
				suggested: 'pair-in-order',
				reason: 'Part number and NSN cells both hold 2 values on separate lines; pairing them in order is likely but not certain'
			},
			(chosen) => setApproved(ids, chosen === 'pair-in-order' || chosen === 'keep-as-one')
		);
	}

	for (const row of [3, 4]) {
		const [xref, intake] = [get(`${tableId(XREF)}:r${row}`), get(`${tableId(INTAKE)}:r${row}`)];
		if (!isIncluded(XREF, INTAKE)) {
			// Without the other sheet there is nothing to conflict with.
			for (const record of [xref, intake]) {
				record.status = 'valid';
				record.issues = [];
				record.approved = included.has(record.tableId);
			}
			continue;
		}
		const ids = [xref.id, intake.id].sort();
		decide(
			'resolve-conflict',
			ids.join('+'),
			'pending',
			{
				recordIds: ids,
				cells: cellsOf([xref, intake], 'description'),
				options: options(
					[`prefer:${xref.id}`, `Keep ${XREF.sheet} row ${row}`],
					[`prefer:${intake.id}`, `Keep ${INTAKE.sheet} row ${row}`],
					['keep-all', 'Import both'],
					['exclude-all', 'Exclude both']
				),
				suggested: `prefer:${xref.id}`,
				reason: `Same part and NSN on two sheets with different descriptions; ${XREF.sheet} row ${row} has more fields (CAGE ${xref.fields.cage?.value})`
			},
			(chosen) => {
				for (const record of [xref, intake]) {
					record.approved = chosen === 'keep-all' || chosen === `prefer:${record.id}`;
					// The preferred record takes compatible fields from the other one.
					if (chosen === `prefer:${record.id}`) record.fields = { ...(record === xref ? intake : xref).fields, ...record.fields };
				}
			}
		);
	}

	if (isIncluded(ACTIVE_PARTS)) {
		const splitIds = records.filter((record) => record.tableId === tableId(ACTIVE_PARTS) && record.sourceRow === 136).map((r) => r.id);
		decide(
			'split-cell',
			`${tableId(ACTIVE_PARTS)}:r136`,
			'auto',
			{
				tableId: tableId(ACTIVE_PARTS),
				recordIds: splitIds,
				cells: [at(ACTIVE_PARTS.sheet, 'D136')],
				options: options(['split', 'Split into 2 records'], ['keep-as-one', 'Keep as one value']),
				suggested: 'split',
				reason: `${at(ACTIVE_PARTS.sheet, 'D136')} lists 2 part number values`
			},
			() => {}
		);

		for (const row of [120, 134, 166]) {
			const id = `${tableId(ACTIVE_PARTS)}:r${row}`;
			decide(
				'import-valid-portion',
				id,
				'auto',
				{
					tableId: tableId(ACTIVE_PARTS),
					recordIds: [id],
					cells: [at(ACTIVE_PARTS.sheet, `E${row}`)],
					options: options(['import-valid-portion', 'Import without the malformed NSN'], ['exclude-row', 'Exclude the row']),
					suggested: 'import-valid-portion',
					reason: get(id).issues.find((issue) => issue.code === 'invalid-identifier')!.message
				},
				(chosen) => (get(id).approved = chosen === 'import-valid-portion')
			);
		}

		const [first, copy] = [get(`${tableId(ACTIVE_PARTS)}:r89`), get(`${tableId(ACTIVE_PARTS)}:r90`)];
		decide(
			'drop-duplicate',
			[first.id, copy.id].sort().join('+'),
			'auto',
			{
				tableId: tableId(ACTIVE_PARTS),
				recordIds: [first.id, copy.id],
				cells: [at(ACTIVE_PARTS.sheet, 'D89'), at(ACTIVE_PARTS.sheet, 'D90')],
				options: options(['drop', 'Drop the later copy'], ['keep', 'Import it anyway']),
				suggested: 'drop',
				reason: 'Row 90 repeats row 89 exactly'
			},
			(chosen) => {
				copy.status = 'duplicate';
				copy.approved = chosen === 'keep';
				copy.issues = [
					{
						code: 'duplicate-in-table',
						severity: 'info',
						message: 'Exact copy of row 89',
						cells: [at(ACTIVE_PARTS.sheet, 'D90'), at(ACTIVE_PARTS.sheet, 'D89')],
						relatedRecords: [first.id]
					}
				];
			}
		);

		const stored = get(`${tableId(ACTIVE_PARTS)}:r60`);
		decide(
			'drop-duplicate',
			stored.id,
			'auto',
			{
				tableId: tableId(ACTIVE_PARTS),
				recordIds: [stored.id],
				cells: [at(ACTIVE_PARTS.sheet, 'D60')],
				options: options(['drop', 'Skip it'], ['keep', 'Import it anyway']),
				suggested: 'drop',
				reason: 'Part NAS1149F0332P is already in your NSN table'
			},
			(chosen) => {
				stored.status = 'duplicate';
				stored.approved = chosen === 'keep';
				stored.issues = [
					{
						code: 'duplicate-in-storage',
						severity: 'info',
						message: 'Already in your NSN table (same part, no NSN)',
						cells: [at(ACTIVE_PARTS.sheet, 'D60')]
					}
				];
			}
		);
	}

	if (isIncluded(XREF)) {
		const record = get(`${tableId(XREF)}:r5`);
		decide(
			'resolve-identifier-conflict',
			`${tableId(XREF)}:r5`,
			'pending',
			{
				tableId: tableId(XREF),
				recordIds: [record.id],
				cells: [at(XREF.sheet, 'B5'), at(XREF.sheet, 'G5')],
				options: options(['prefer-nsn', 'Keep the NSN'], ['prefer-niin-fsc', 'Keep the NIIN and FSC'], ['exclude-row', 'Exclude the row']),
				suggested: 'exclude-row',
				reason: `NSN 5305016582566 in ${at(XREF.sheet, 'B5')} does not match NIIN 016582565 in ${at(XREF.sheet, 'G5')}`
			},
			(chosen) => {
				if (chosen !== 'prefer-nsn' && chosen !== 'prefer-niin-fsc') return;
				record.status = 'warning';
				record.approved = true;
				// The losing identifier is dropped; the records stage would also derive it again from the winner.
				const { [chosen === 'prefer-nsn' ? 'niin' : 'nsn']: _, ...fields } = record.fields;
				record.fields = fields;
			}
		);
	}

	if (isIncluded(ACTIVE_PARTS)) {
		const record = get(`${tableId(ACTIVE_PARTS)}:r70`);
		decide(
			'resolve-storage-conflict',
			`${record.id}+saved:demo-1`,
			'pending',
			{
				tableId: tableId(ACTIVE_PARTS),
				recordIds: [record.id],
				existingIds: ['demo-1'],
				cells: [at(ACTIVE_PARTS.sheet, 'D70'), at(ACTIVE_PARTS.sheet, 'F70')],
				options: options(['keep-saved', 'Keep the saved record'], ['replace-saved', 'Replace the saved record'], ['keep-both', 'Keep both records']),
				suggested: 'keep-saved',
				reason: 'Part M30294 with NSN 1560000000047 is already saved with a different description ("Bolt, hex head, 1/4-20")'
			},
			(chosen) => {
				if (chosen === null) return;
				record.status = chosen === 'keep-saved' ? 'duplicate' : 'valid';
				record.approved = chosen !== 'keep-saved';
			}
		);
	}

	if (isIncluded(ACTIVE_PARTS, STATZ)) {
		const [keep, drop] = [get(`${tableId(ACTIVE_PARTS)}:r40`), get(`${tableId(STATZ)}:r12`)];
		decide(
			'merge-duplicates',
			[keep.id, drop.id].sort().join('+'),
			'auto',
			{
				recordIds: [keep.id, drop.id],
				cells: [...cellsOf([keep, drop], 'part'), ...cellsOf([keep, drop], 'nsn')],
				options: options(['merge', 'Merge into one record'], ['keep-separate', 'Keep both records']),
				suggested: 'merge',
				reason: `Same part and NSN on ${ACTIVE_PARTS.sheet} row 40 and ${STATZ.sheet} row 12 with compatible fields`
			},
			(chosen) => {
				if (chosen !== 'merge') return;
				keep.mergedFrom = [drop.id];
				drop.status = 'duplicate';
				drop.approved = false;
				drop.issues = [
					{
						code: 'duplicate-across-sheets',
						severity: 'info',
						message: `Merged into ${ACTIVE_PARTS.sheet} row 40 (same part and NSN)`,
						cells: [at(STATZ.sheet, 'A12'), at(ACTIVE_PARTS.sheet, 'D40')],
						relatedRecords: [keep.id]
					}
				];
			}
		);
	}

	const order = { pending: 0, user: 1, auto: 1 } as const;
	decisions.sort((a, b) => order[a.state] - order[b.state]);

	// Summary counts leave out excluded tables, whose records stay listed so the table can be re-included.
	const counted = records.filter((record) => !excluded.has(record.tableId));
	const count = (status: CandidateRecord['status']) => counted.filter((record) => record.status === status).length;
	return {
		fileName,
		sheets,
		records,
		decisions,
		summary: {
			sheets: sheets.length,
			tablesIncluded: included.size,
			sourceRows: new Set(counted.map((record) => `${record.tableId}:${record.sourceRow}`)).size,
			candidates: counted.length,
			valid: count('valid'),
			warnings: count('warning'),
			invalid: count('invalid'),
			duplicates: count('duplicate'),
			conflicts: count('conflict'),
			splitRecords: counted.filter((record) => record.split).length,
			pendingDecisions: decisions.filter((d) => d.state === 'pending').length,
			toImport: records.filter((record) => record.approved).length
		}
	};
}

/** Covers the 'user' decision state too: the storage duplicate is kept by a user override. */
export const mockAnalysis: WorkbookAnalysis = buildMockAnalysis({
	decisions: { [decisionId('drop-duplicate', `${tableId(ACTIVE_PARTS)}:r60`)]: 'keep' }
});

/* ---------- AI ---------- */

const MOCK_AI_RESULT: VerificationResult = {
	tables: [
		{
			...toCandidate(SEARCH_LOG, {}),
			range: { top: 2, left: 1, bottom: 5, right: 5 },
			skippedRows: [],
			reasons: [
				'AI: row 2 is the header; rows 3-5 list part numbers with the FSC and NIIN found for each',
				'AI confidence 0.62 is below 0.8, so the table needs review'
			],
			source: 'ai'
		}
	],
	rejected: [
		{ sheetName: 'Search Log', range: 'A2:H40', reason: 'Range A2:H40 extends beyond the sheet\'s values (A1:E6)' },
		{ sheetName: 'Dashboard', range: 'B3:D12', reason: 'Sheet "Dashboard" was not in the request' }
	]
};

const delay = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		});
	});

/** Test double for the pipeline: any .xlsx file yields the mock analysis. */
export const mockEngine: ImportEngine = {
	async read(file) {
		await delay(500);
		if (!file.name.toLowerCase().endsWith('.xlsx')) {
			throw new WorkbookReadError('not-xlsx', `"${file.name}" is not an .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again.`);
		}
		return { fileName: file.name, sheets: [] };
	},
	analyze: (model, _existing, overrides) => buildMockAnalysis(overrides, model.fileName),
	toMappingInputs: (analysis) =>
		analysis.records
			.filter((record) => record.approved)
			.map(({ fields }) => {
				const input: MappingInput = {};
				for (const field of ['part', 'description', 'nsn', 'niin', 'cage'] as const) {
					if (fields[field]) input[field] = fields[field].value;
				}
				return input;
			}),
	aiAvailability: async () => ({ available: true }),
	async interpret(_model, _sheets, signal) {
		await delay(1500, signal);
		return { sent: ['Search Log'], result: MOCK_AI_RESULT };
	}
};
