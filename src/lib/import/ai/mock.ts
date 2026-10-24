/**
 * Mock interpreter for tests, E2E runs, and demos (`AI_PROVIDER=mock`): no network, deterministic.
 * Also holds the adversarial proposals the verifier must reject.
 */
import {
	PRIMARY_FIELDS,
	type Field,
	type InterpretationRequest,
	type InterpretationTable,
	type WorkbookInterpretation,
	type WorkbookInterpreter
} from '../model';
import { parseA1, parseRange, toA1 } from '../refs';

type Respond =
	| WorkbookInterpretation
	| ((request: InterpretationRequest) => WorkbookInterpretation);

export class MockInterpreter implements WorkbookInterpreter {
	private readonly respond: Respond;

	/** Canned result, or a function of the request. Defaults to `mockInterpretation`. */
	constructor(respond: Respond = mockInterpretation) {
		this.respond = respond;
	}

	async interpret(
		request: InterpretationRequest,
		signal?: AbortSignal
	): Promise<WorkbookInterpretation> {
		signal?.throwIfAborted();
		return typeof this.respond === 'function' ? this.respond(request) : this.respond;
	}
}

const HEADER_KEYWORDS: Array<[Field, RegExp]> = [
	['nsn', /\bnsn\b|national stock/i],
	['niin', /\bniin\b/i],
	['cage', /\bcage\b/i],
	['part', /\bpart\b|\bp\/n\b/i],
	['description', /description|nomenclature|item name/i]
];

/**
 * A plausible answer built only from the request: per sheet, the first sampled row with a
 * header keyword for a primary field becomes the header, spanning to the bottom of the extent.
 * Its confidence is below the auto-apply threshold, so mock proposals always reach the user.
 */
export function mockInterpretation(request: InterpretationRequest): WorkbookInterpretation {
	return {
		tables: request.sheets.flatMap((sheet) => {
			const extent = parseRange(sheet.extent);
			if (!extent) return [];
			const rows = new Map<number, Array<{ col: number; text: string }>>();
			for (const [ref, text] of sheet.cells) {
				const at = parseA1(ref);
				if (at) rows.set(at.row, [...(rows.get(at.row) ?? []), { col: at.col, text }]);
			}
			for (const [row, cells] of [...rows].sort(([a], [b]) => a - b)) {
				if (row >= extent.bottom) break;
				const columns = matchHeaderCells(cells);
				if (!columns.some(({ field }) => PRIMARY_FIELDS.includes(field))) continue;
				const table: InterpretationTable = {
					sheetName: sheet.name,
					range: `${toA1(row, extent.left)}:${toA1(extent.bottom, extent.right)}`,
					headerRows: [row],
					columns,
					confidence: 0.6,
					reasons: [`Mock interpreter: header keywords in row ${row}`]
				};
				return [table];
			}
			return [];
		})
	};
}

function matchHeaderCells(
	cells: Array<{ col: number; text: string }>
): InterpretationTable['columns'] {
	const used = new Set<Field>();
	return cells.flatMap(({ col, text }) => {
		const match = HEADER_KEYWORDS.find(
			([field, pattern]) => !used.has(field) && pattern.test(text)
		);
		if (!match) return [];
		used.add(match[0]);
		return [{ field: match[0], col, headerText: text }];
	});
}

/**
 * Wrong or manipulated variants of a correct proposal, one per verifier rule.
 * `valid` needs at least two columns; `hiddenCol` must be a hidden column inside its range.
 */
export function adversarialTables(
	valid: InterpretationTable,
	hiddenCol: number
): Record<
	'unknownSheet' | 'outOfRangeColumn' | 'offByOneHeader' | 'duplicateField' | 'hiddenColumn',
	InterpretationTable
> {
	const [first, second, ...rest] = valid.columns;
	const range = parseRange(valid.range)!;
	return {
		unknownSheet: { ...valid, sheetName: `${valid.sheetName} (copy)` },
		outOfRangeColumn: { ...valid, columns: [{ ...first, col: range.right + 1 }, second, ...rest] },
		offByOneHeader: { ...valid, headerRows: valid.headerRows.map((row) => row + 1) },
		duplicateField: { ...valid, columns: [first, { ...second, field: first.field }, ...rest] },
		hiddenColumn: { ...valid, columns: [{ ...first, col: hiddenCol }, second, ...rest] }
	};
}
