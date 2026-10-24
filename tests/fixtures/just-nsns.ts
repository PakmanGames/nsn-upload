/**
 * Expectations for `Just NSNs (1).xlsx`: one sheet holding nothing but NSNs in column A, with no header row.
 *
 * Counted from the workbook's XML, not through the importer: `A1:A99` holds 99 NSNs written `1025-00-0425307`,
 * all 13 digits once the hyphens are removed, and 42 distinct values (16 appear once, 9 twice, 8 three times,
 * 6 four times, 1 five times, 2 six times). No other cell has a value.
 */
import type { MappingInput, TableSpec } from '../../src/lib/import/model';
import { rows, type FixtureExpectation } from './expectations';

export const justNsns = {
	file: 'Just NSNs (1).xlsx',
	sheets: [
		{
			name: 'Sheet1',
			// Found by its values alone, so it waits for the user (suggested include).
			status: 'needs-review',
			table: {
				headerRows: [],
				mapping: { nsn: 'A' },
				dataRows: rows(1, 99),
				skippedRows: [],
				records: 99,
				absentOptional: ['description', 'cage']
			}
		}
	],
	initial: {
		sheets: 1,
		tablesIncluded: 0,
		sourceRows: 99,
		candidates: 99,
		invalid: 0,
		duplicates: 0,
		conflicts: 0,
		splitRecords: 0,
		pendingDecisions: 1,
		toImport: 0
	},
	// Later copies of an NSN are exact duplicates in one table and are dropped. Every record keeps a warning:
	// its column was mapped with medium confidence, from values alone.
	afterAcceptAll: {
		tablesIncluded: 1,
		sourceRows: 99,
		candidates: 99,
		valid: 0,
		warnings: 42,
		invalid: 0,
		duplicates: 57,
		pendingDecisions: 0,
		toImport: 42
	},
	tableId: 'Sheet1@1',
	range: 'A1:A99',
	/** Rows holding the first copy of each distinct NSN: the records that import. */
	firstRows: [
		1, 5, 10, 14, 17, 23, 26, 28, 32, 33, 34, 37, 38, 39, 40, 43, 46, 47, 50, 54, 55, 57, 59, 63, 67, 68, 69, 71,
		73, 75, 76, 77, 78, 81, 82, 83, 86, 89, 95, 97, 98, 99
	],
	/** A1 and the rows that repeat it. */
	firstNsn: {
		cell: 'A1',
		original: '1025-00-0425307',
		copies: [2, 3, 4],
		// The sheet has no NIIN column, so the saved NIIN is worked out from the NSN and labeled (D25).
		imported: { nsn: '1025000425307', niin: '000425307', derived: ['niin'] } satisfies MappingInput
	},
	/** The same table set up by hand in the review window: "No header row", column A = NSN. */
	manual: {
		sheet: 'Sheet1',
		spec: { headerRows: [], range: { top: 1, left: 1, bottom: 99, right: 1 }, columns: { 1: 'nsn' } } satisfies TableSpec
	}
} satisfies FixtureExpectation & Record<string, unknown>;
