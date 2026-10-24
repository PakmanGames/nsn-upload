/**
 * Expectations for `Merged Column, FSC + NIIN NSN Tests (1).xlsx`, in the shape of expectations.ts.
 *
 * Sheet `RFI Response`: a title, a subtitle, and instructions merged across the sheet (rows 1-4); the header on
 * row 6 with FSC in A and "NIIN" merged across B6:C6; 24 parts on rows 7-30, each NIIN merged across B:C; supplier
 * names and an email in O-P without a header; then blank rows 31-32, a "Supplier Information" form (A33:A40),
 * and a contract-terms paragraph on row 43. Every number was counted from the file.
 */
import { rows, type FixtureExpectation } from './expectations';

export const mergedColumn = {
	file: 'Merged Column, FSC + NIIN NSN Tests (1).xlsx',
	sheets: [
		{
			name: 'RFI Response',
			status: 'ready',
			table: {
				headerRows: [6],
				mapping: { fsc: 'A', niin: 'B' },
				dataRows: rows(7, 30),
				// The form and the terms stay listed, outside the table's range; the blank rows are only spacing.
				skippedRows: [...rows(33, 40), 43].map((row) => ({ row, reason: 'below-table' })),
				records: 24,
				absentOptional: ['description', 'cage']
			}
		}
	],
	initial: {
		sheets: 1,
		tablesIncluded: 1,
		sourceRows: 24,
		candidates: 24,
		valid: 24,
		warnings: 0,
		invalid: 0,
		duplicates: 0,
		conflicts: 0,
		splitRecords: 0,
		pendingDecisions: 0,
		toImport: 24
	},
	afterAcceptAll: { pendingDecisions: 0, toImport: 24 },
	range: 'A6:P30',
	/** Why rows 33-43, under the blank gap, are left out. */
	belowTableReason:
		"The table ends at row 30: rows 33-43, after the blank rows 31-32, have no FSC, NIIN, or NSN, so they aren't imported",
	/** C sits under the merged header and holds nothing of its own: every NIIN is merged across B:C. */
	mergedHeader: {
		dropped: 'C',
		reason: 'Column C shares the merged "NIIN" header with column B and has no values of its own, so they are one column'
	},
	/** Supplier names (O7:O30) and one email (P7) with no header cell. */
	unlabeledColumns: ['O', 'P'],
	/** Row 7 as a spot check: FSC A7 + NIIN B7 give the derived NSN. */
	firstRecord: { row: 7, fsc: '1560', niin: '007616260', nsn: '1560007616260' }
} satisfies FixtureExpectation & Record<string, unknown>;
