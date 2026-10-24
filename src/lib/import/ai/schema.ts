/**
 * Wire schemas for the AI boundary, shared by the browser and the `/api/interpret` route.
 *
 * The same Zod schema validates the model's output, generates the JSON Schema sent as
 * OpenRouter's `response_format`, and checks the route's reply in the browser, so the three can never drift.
 */
import { z } from 'zod';
import { FIELDS, type InterpretationRequest, type WorkbookInterpretation } from '../model';
import { parseA1 } from '../refs';

/** Upper bounds on what leaves the browser. The route enforces the same numbers. */
export const AI_LIMITS = {
	maxSheets: 3,
	maxRowsPerSheet: 60,
	/** Rows taken from the top of the sheet, where titles and headers live. */
	headRows: 40,
	/** Rows sampled evenly from the rest, so the model can see where the table ends. */
	sampledRows: 20,
	maxColumns: 30,
	maxCellChars: 120,
	maxCells: 3000,
	maxMergesPerSheet: 100,
	maxReasonChars: 500
} as const;

/** Below this model confidence an AI table is never applied without the user. */
export const AI_MIN_CONFIDENCE = 0.8;

const A1_REF = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
const A1_RANGE = /^[A-Z]{1,3}[1-9]\d{0,6}:[A-Z]{1,3}[1-9]\d{0,6}$/;

const requestSheetSchema = z
	.object({
		name: z.string().min(1).max(31),
		extent: z.string().regex(A1_RANGE),
		merges: z.array(z.string().regex(A1_RANGE)).max(AI_LIMITS.maxMergesPerSheet),
		reason: z.string().max(AI_LIMITS.maxReasonChars),
		cells: z
			.array(z.tuple([z.string().regex(A1_REF), z.string().max(AI_LIMITS.maxCellChars)]))
			.max(AI_LIMITS.maxRowsPerSheet * AI_LIMITS.maxColumns)
	})
	.superRefine((sheet, ctx) => {
		const rows = new Set<number>();
		const cols = new Set<number>();
		for (const [ref] of sheet.cells) {
			const at = parseA1(ref);
			if (at) {
				rows.add(at.row);
				cols.add(at.col);
			}
		}
		if (rows.size > AI_LIMITS.maxRowsPerSheet)
			ctx.addIssue({ code: 'custom', message: `More than ${AI_LIMITS.maxRowsPerSheet} rows` });
		if (cols.size > AI_LIMITS.maxColumns)
			ctx.addIssue({ code: 'custom', message: `More than ${AI_LIMITS.maxColumns} columns` });
	});

export const interpretationRequestSchema = z
	.object({
		fileName: z.string().max(255),
		sheets: z.array(requestSheetSchema).min(1).max(AI_LIMITS.maxSheets)
	})
	.refine(
		(request) =>
			request.sheets.reduce((total, sheet) => total + sheet.cells.length, 0) <= AI_LIMITS.maxCells,
		{ message: `More than ${AI_LIMITS.maxCells} cells in total` }
	) satisfies z.ZodType<InterpretationRequest>;

/** The `.describe()` texts become JSON Schema descriptions, which the model reads as field instructions. */
export const workbookInterpretationSchema = z.object({
	tables: z.array(
		z.object({
			sheetName: z.string().describe('Sheet name exactly as given in the request'),
			range: z
				.string()
				.describe('A1 range from the first header row to the last data row, e.g. "A2:F180"'),
			headerRows: z
				.array(z.int().min(1))
				.describe('1-based row numbers of the header; two adjacent rows if the header spans two'),
			columns: z.array(
				z.object({
					field: z.enum(FIELDS),
					col: z.int().min(1).describe('1-based column number, A = 1'),
					headerText: z
						.string()
						.describe('Header cell text in this column, joined with a space across header rows')
				})
			),
			confidence: z.number().min(0).max(1).describe('0 to 1'),
			reasons: z.array(z.string()).describe('Short structural reasons, without cell values')
		})
	)
}) satisfies z.ZodType<WorkbookInterpretation>;

/**
 * Claude's structured outputs reject numeric, length, and array-size constraints,
 * so they are dropped from the schema sent to the provider; Zod still enforces them on the reply.
 */
const UNSUPPORTED_KEYWORDS = [
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems'
];

export function interpretationJsonSchema(): Record<string, unknown> {
	const schema: Record<string, unknown> = z.toJSONSchema(workbookInterpretationSchema, {
		override: ({ jsonSchema }) => {
			for (const keyword of UNSUPPORTED_KEYWORDS)
				delete (jsonSchema as Record<string, unknown>)[keyword];
		}
	});
	delete schema.$schema;
	return schema;
}

export const aiAvailabilitySchema = z.object({
	available: z.boolean(),
	reason: z.string().optional()
});

export type AiAvailability = z.infer<typeof aiAvailabilitySchema>;

/** Error body returned by `/api/interpret` for every non-2xx response. */
export const aiErrorSchema = z.object({ code: z.string(), message: z.string() });
