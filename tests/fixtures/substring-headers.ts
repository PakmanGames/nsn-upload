/**
 * Expectations for `Substring Headers in Diff Sheet (1).xlsx` (E4), in the FixtureExpectation shape so the
 * coordinator can register it in FIXTURES after the Wave 2 merges.
 *
 * Every count was recounted from the workbook with SheetJS, independently of the importer: 139 data rows,
 * 182 NSN values (or one record for a row without an NSN), and the FSC in column E against each row's NSNs.
 */
import { rows, type FixtureExpectation } from './expectations';

const SHEET = 'T6 Consumable Parts Matching';

export const substringHeaders = {
	file: 'Substring Headers in Diff Sheet (1).xlsx',
	sheets: [
		// Supplier names, emails, and award amounts: no identifiers.
		{ name: 'Summary', status: 'no-table' },
		{
			name: SHEET,
			status: 'ready',
			table: {
				headerRows: [1],
				// A "Material #" holds the part numbers. D quantities, F prices, and G-N supplier names and emails
				// (under headers that mention NSN, PN, CAGE, or FSC) stay unmapped.
				mapping: { part: 'A', nsn: 'B', description: 'C', fsc: 'E' },
				dataRows: rows(2, 140),
				skippedRows: [],
				records: 182
			}
		}
	],
	initial: {
		sheets: 2,
		tablesIncluded: 1,
		sourceRows: 139,
		candidates: 182,
		invalid: 0,
		duplicates: 1,
		conflicts: 0,
		splitRecords: 71,
		pendingDecisions: 1,
		toImport: 180
	},
	// Row 49 is now kept by "Keep the NSN" (D24): its NSN imports, with the FSC worked out from it, so 180 + 1.
	afterAcceptAll: { pendingDecisions: 0, toImport: 181 },
	sheet: SHEET,
	/** Part comes from a header hint, so medium; it does not hold the table back. */
	partColumn: { column: 'A', confidence: 'medium' },
	unmappedColumns: ['D', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'],
	/** Part numbers with no NSN: part-only records. */
	partOnlyRows: [134, 135],
	/** Several NSNs in B, and E's FSC matches some of them: the FSC belongs to the matching records only. */
	fscForSomeNsnsRows: [10, 11, 14, 17, 33, 40, 89, 93, 122, 140],
	/** The one real contradiction: NSN 6850-01-494-9650 under FSC 8030. */
	identifierConflictRow: 49,
	/** B36 lists the same NSN twice, so its second record is an exact duplicate. */
	duplicateRow: 36,
	/** NSNs listed under two different part numbers (rows 107-122 and 123-140): separate records, no conflict. */
	nsnsUnderTwoParts: 18
} satisfies FixtureExpectation & Record<string, unknown>;
