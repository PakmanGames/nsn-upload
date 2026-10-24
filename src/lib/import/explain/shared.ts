/**
 * Templates that decisions and issues share: a rejected value, an NSN that contradicts its own FSC or NIIN,
 * a row with several multi-value cells, a column the importer is unsure of, and two records that differ.
 * Each one writes into a Draft and returns the headline and body; the Draft keeps the facts it cited.
 */
import {
	FIELDS,
	PRIMARY_FIELDS,
	type CandidateRecord,
	type ColumnMapping,
	type Field,
	type TableCandidate
} from '../model';
import { colLetter } from '../refs';
import { matchHeader } from '../structure/header';
import { loose } from '../validate/entry';
import { digitsOf, ownValue, type Context, type Draft } from './context';
import { aNoun, capitalize, count, formatNsn, joinList, noun, ordinal, shortList, show } from './text';

export type Text = { headline: string; body: string };

const LENGTH: Partial<Record<Field, number>> = { nsn: 13, niin: 9, fsc: 4 };
/** The label normalization strips before an identifier ("NSN: 5305-..."). */
const LABEL_PREFIX = /^(?:NSN|NIIN|FSC)\s*[:#.]?\s*(?=\d)/i;
const EXCEL_ERROR = /^#[A-Z0-9/_]+[!?]?$/;

const lines = (text: string) =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

const isValidDigits = (field: Field, text: string) => {
	const length = LENGTH[field];
	return length !== undefined && new RegExp(`^\\d{${length}}$`).test(digitsOf(text.replace(LABEL_PREFIX, '')));
};

/** Why a value in `record.rejected` is not a valid value for its field, read from the value itself. */
export function rejectedValue(d: Draft, record: CandidateRecord, field: Field): Text {
	const { cell, original: raw } = record.rejected[field]!;
	const original = raw.trim();
	const name = noun(field);
	const shown = d.value(`${capitalize(name)} in the cell`, field, original, cell);

	if (original === '' || EXCEL_ERROR.test(original)) {
		return {
			headline: `${cell} shows an Excel error`,
			body: `${cell} shows ${original || 'an Excel error'} instead of ${aNoun(field)}, so there is no value to read.`
		};
	}
	const all = lines(original);
	if (all.length > 1) {
		const bad = all.filter((line) => !isValidDigits(field, line));
		if (bad.length === 0) {
			return {
				headline: `${cell} lists ${count(all.length, field)} on separate lines`,
				body: `Read as one value, the cell is not a valid ${name}.`
			};
		}
		return {
			headline: `${cell} has a line that is not ${aNoun(field)}`,
			body: `${cell} lists ${all.length} lines, and ${joinList(bad.map((line) => show(field, line)))} ${
				bad.length === 1 ? `is not a valid ${name}` : `are not valid ${noun(field, 2)}`
			}.`
		};
	}
	if (field === 'part') {
		// Normalization rejects a part number only when Excel stored it as a date (error cells are handled above).
		return {
			headline: `Excel turned the part number in ${cell} into a date`,
			body: `Excel stored ${cell} as the date ${shown}, so the part number that was typed there is lost.`
		};
	}
	if (field === 'cage') {
		const letters = original.toUpperCase();
		return {
			headline: /^[A-Z0-9]+$/.test(letters)
				? `This CAGE code has ${letters.length} characters, not 5`
				: `The CAGE code in ${cell} has stray characters`,
			body: `${cell} holds ${shown}, but a CAGE code is exactly 5 letters or digits.`
		};
	}
	const expected = LENGTH[field];
	if (expected === undefined) return { headline: `${cell} could not be read`, body: `${cell} holds ${shown}.` };

	const part = record.fields.part;
	if (field === 'nsn' && part && part.value === original) {
		const partCell = part.provenance.cell;
		d.value('Part number', 'part', part.value, partCell);
		return {
			headline: `${cell} holds the part number, not an NSN`,
			body: `${cell} holds ${shown}, the same value as the part number in ${partCell}; an NSN has 13 digits.`
		};
	}
	const digits = digitsOf(original.replace(LABEL_PREFIX, ''));
	if (/^\d+$/.test(digits)) {
		if (field === 'nsn' && digits.length === 9) {
			return {
				headline: `${cell} holds a NIIN, not an NSN`,
				body: `${shown} has 9 digits, like a NIIN. An NSN has 13: its 4-digit FSC, then the NIIN.`
			};
		}
		if (field !== 'nsn' && digits.length === 13) {
			return {
				headline: `${cell} holds an NSN, not ${aNoun(field)}`,
				body: `${shown} has 13 digits, like an NSN, but ${aNoun(field)} has ${expected}.`
			};
		}
		return {
			headline: `This ${name} has ${digits.length} ${digits.length === 1 ? 'digit' : 'digits'}, not ${expected}`,
			body: `${cell} holds ${shown}, but ${aNoun(field)} has exactly ${expected} digits.`
		};
	}
	if (!/\d/.test(digits)) {
		return {
			headline: `${cell} holds text, not ${aNoun(field)}`,
			body: `${cell} holds ${shown}, but ${aNoun(field)} is ${expected} digits.`
		};
	}
	if (/\p{L}/u.test(digits)) {
		// One code-like token is most likely a part number typed into the wrong column; a phrase is a note.
		const looksLikePart = field === 'nsn' && !/\s/.test(original);
		return {
			headline: `The ${name} in ${cell} contains letters`,
			body: looksLikePart
				? `${cell} holds ${shown}. An NSN is 13 digits, so this looks like a part number in the NSN column.`
				: `${cell} holds ${shown}, but ${aNoun(field)} is ${expected} digits.`
		};
	}
	return {
		headline: `The ${name} in ${cell} has stray characters`,
		body: `${cell} holds ${shown}, but ${aNoun(field)} is ${expected} digits.`
	};
}

type IdentifierPart = 'fsc' | 'niin';

/** The parts of the record's NSN that disagree with the row's own FSC or NIIN cell. */
function mismatches(record: CandidateRecord): IdentifierPart[] {
	const nsn = ownValue(record, 'nsn');
	const digits = nsn ? digitsOf(nsn.value) : '';
	if (digits.length !== 13) return [];
	const expected: Record<IdentifierPart, string> = { fsc: digits.slice(0, 4), niin: digits.slice(4) };
	return (['fsc', 'niin'] as const).filter((part) => {
		const own = ownValue(record, part);
		return own !== null && digitsOf(own.value) !== expected[part];
	});
}

const RULE: Record<string, string> = {
	fsc: 'An NSN starts with its 4-digit FSC.',
	niin: 'An NSN ends with its 9-digit NIIN.',
	'fsc,niin': 'An NSN is its 4-digit FSC followed by its 9-digit NIIN.'
};

/**
 * An NSN that disagrees with the FSC or NIIN in its own row. `records` all come from one row; `only` limits
 * the explanation to one part, for an issue about that part alone. Other NSNs in the same cell that do agree
 * are mentioned, because they show the row is not wrong as a whole.
 */
export function identifierConflict(d: Draft, records: CandidateRecord[], ctx: Context, only?: IdentifierPart): Text {
	const limit = (parts: IdentifierPart[]) => (only ? parts.filter((part) => part === only) : parts);
	const conflicting = records.filter((record) => limit(mismatches(record)).length > 0);
	// Every choice keeps the losing cell's text, so a conflict always shows; this only guards odd input.
	if (conflicting.length === 0) {
		return { headline: "The NSN doesn't match its row", body: 'The NSN, FSC, and NIIN in this row do not agree.' }
	}
	const first = conflicting[0];
	const shownParts = limit((['fsc', 'niin'] as const).filter((part) => conflicting.some((record) => mismatches(record).includes(part))));
	const nsnCell = ownValue(first, 'nsn')?.cell ?? '';
	const nsns = conflicting.map((record) => digitsOf(ownValue(record, 'nsn')!.value));
	nsns.forEach((digits) => d.fact('NSN', formatNsn(digits), nsnCell));
	const own = Object.fromEntries(
		shownParts.map((part) => {
			const value = ownValue(first, part)!;
			return [part, { cell: value.cell, value: d.fact(part.toUpperCase(), digitsOf(value.value), value.cell) }];
		})
	) as Partial<Record<IdentifierPart, { cell: string; value: string }>>;

	// NSNs from the same cell that agree with the row.
	const agreeingRecords = ctx
		.row(first)
		.filter(
			(record) =>
				!conflicting.includes(record) &&
				record.fields.nsn?.provenance.origin === 'source' &&
				record.fields.nsn.provenance.cell === nsnCell &&
				limit(mismatches(record)).length === 0
		);
	const agreeing = agreeingRecords.map((record) => d.fact('NSN that matches', formatNsn(record.fields.nsn!.value), nsnCell));
	const total = first.split?.total ?? 1;
	const rule = RULE[shownParts.join(',')];
	const says = shownParts.map((part) => `${own[part]!.cell} says ${own[part]!.value}`);
	const what = shownParts.length === 2 ? 'The FSC and NIIN' : `The ${shownParts[0].toUpperCase()}`;

	if (conflicting.length <= 1) {
		const nsn = nsns[0] ?? '';
		const reads =
			shownParts.length === 2
				? `reads ${nsn.slice(0, 4)} then ${nsn.slice(4)}`
				: shownParts[0] === 'fsc'
					? `starts with ${nsn.slice(0, 4)}`
					: `ends with ${nsn.slice(4)}`;
		const second = total === 2 ? 'a second NSN' : 'another NSN';
		const aside = agreeing.length
			? ` (${nsnCell} lists ${agreeing.length === 1 ? second : `${agreeing.length} more NSNs`}, ${joinList(agreeing)}, which ${
					agreeing.length === 1 ? 'does' : 'do'
				} match.)`
			: '';
		return {
			headline: `${what} ${shownParts.length === 2 ? "don't" : "doesn't"} match this NSN`,
			body: `${rule} ${nsnCell}'s NSN ${formatNsn(nsn)} ${reads}, but ${joinList(says)}.${aside}`
		};
	}

	const which = conflicting.length === total ? `any of the ${total}` : `${conflicting.length} of the ${total}`;
	const ends =
		shownParts.length === 2
			? `are ${shortList(nsns.map(formatNsn), 3)}`
			: shownParts[0] === 'fsc'
				? `start with ${shortList([...new Set(nsns.map((nsn) => nsn.slice(0, 4)))])}`
				: `end with ${shortList([...new Set(nsns.map((nsn) => nsn.slice(4)))], 3)}`;
	const position = agreeingRecords[0]?.split ? `${ordinal(agreeingRecords[0].split.index)} ` : '';
	const aside =
		agreeing.length === 1
			? ` (The ${position}NSN, ${agreeing[0]}, does match.)`
			: agreeing.length > 1
				? ` (The other ${agreeing.length}, ${shortList(agreeing, 3)}, do match.)`
				: '';
	return {
		headline: `${what} ${shownParts.length === 2 ? "don't" : "doesn't"} match ${which} NSNs`,
		body: `${rule} ${joinList(says)}, but the NSNs in ${nsnCell} ${ends}.${aside}`
	};
}

/** The whole text of the field's source cell, whether its value was read, set aside, or rejected. */
function cellText(record: CandidateRecord, field: Field): { cell: string; text: string } | null {
	const value = record.fields[field];
	if (value) return value.provenance.origin === 'source' ? { cell: value.provenance.cell, text: value.provenance.original } : null;
	const rejected = record.rejected[field];
	return rejected ? { cell: rejected.cell, text: rejected.original } : null;
}

/** Identifier cells of the row that hold several values on separate lines, with those values. */
export function multiLineCells(record: CandidateRecord): Array<{ field: Field; cell: string; values: string[] }> {
	return PRIMARY_FIELDS.flatMap((field) => {
		const source = cellText(record, field);
		const values = source ? lines(source.text) : [];
		return source && values.length > 1 ? [{ field, cell: source.cell, values }] : [];
	});
}

/** A row where two identifier cells each hold several values, so their pairing is unknown. */
export function ambiguousRow(d: Draft, record: CandidateRecord): Text {
	const cells = multiLineCells(record);
	for (const { field, cell, values } of cells) d.fact(capitalize(noun(field, 2)), values.map((value) => show(field, value)).join(', '), cell);
	const lists = cells.map(({ field, cell, values }) => `${cell} lists ${count(values.length, field)}`);
	const pairing =
		cells.length === 2 ? `which ${noun(cells[0].field)} goes with which ${noun(cells[1].field)}` : 'which values belong together';
	const uneven = new Set(cells.map(({ values }) => values.length)).size > 1;
	return {
		headline: 'Not clear which values go together',
		body: `${joinList(lists)} on separate lines, so it is not clear ${pairing}.${
			uneven ? ' The counts differ, so they cannot be lined up in order.' : ''
		}`
	};
}

const VALUES_FIT: Record<Field, (share: string) => string> = {
	part: (share) => `${share} of its values look like part numbers`,
	description: (share) => `${share} of its values look like descriptions`,
	nsn: (share) => `${share} of its values are valid NSNs`,
	niin: (share) => `${share} of its values are valid NIINs`,
	cage: (share) => `${share} of its values are valid CAGE codes`,
	fsc: (share) => `${share} of its values are valid FSCs`
};

/** Rounded, but never up to 100%: only a column where every value fits reads as "all". */
const share = (rate: number) => (rate >= 1 ? 'all' : `${Math.min(99, Math.round(rate * 100))}%`);

/**
 * Why the importer is unsure a column holds its field, from the header match and the share of values that
 * fit, the two measurements behind a column's confidence. Null when the column is a clear match.
 */
export function columnDoubt(d: Draft, column: ColumnMapping & { field: Field }): Text | null {
	if (column.confidence === 'high') return null;
	const { field } = column;
	const letter = colLetter(column.col);
	const header = column.header.replace(/\s+/g, ' ').trim();
	const strength = header ? (matchHeader(header).find((match) => match.field === field)?.strength ?? 'none') : 'none';
	const rate = column.valuePassRate;
	const fits = rate !== null && rate >= 0.9;
	const said = header
		? `Its header, ${d.value(`Header of column ${letter}`, null, header)}, ${
				strength === 'strong' ? 'names' : strength === 'weak' ? 'only partly names' : 'does not name'
			} ${noun(field, 2)}`
		: 'It has no header';
	const values = rate === null ? '' : VALUES_FIT[field](d.fact(`Share of column ${letter} that fits`, share(rate)));
	const join = fits ? ', though ' : header && strength === 'strong' ? ', but only ' : ', and only ';
	return {
		headline: `Not sure column ${letter} holds ${noun(field, 2)}`,
		body: `${said}${values ? `${join}${values}` : ''}.`
	};
}

/** The table's least certain identifier column: the one that keeps it from being ready. */
export function weakestColumn(table: TableCandidate): (ColumnMapping & { field: Field }) | undefined {
	const rank = { low: 0, medium: 1, high: 2 } as const;
	const primary = table.columns.filter(
		(column): column is ColumnMapping & { field: Field } => column.field !== null && PRIMARY_FIELDS.includes(column.field)
	);
	// Strict comparison keeps the leftmost column on a tie.
	return primary.reduce<(ColumnMapping & { field: Field }) | undefined>(
		(weakest, column) => (!weakest || rank[column.confidence] < rank[weakest.confidence] ? column : weakest),
		undefined
	);
}

/** Fields on which at least two of the records hold different values, compared the way duplicates are. */
export function differingFields(records: CandidateRecord[]): Field[] {
	return FIELDS.filter((field) => {
		const values = records.flatMap((record) => record.fields[field]?.value ?? []);
		return new Set(values.map(loose)).size > 1;
	});
}

/**
 * "C107 says "RIVET" and C123 says "TAPE"" for one field, naming each record by `place`; with several
 * fields, one clause per field.
 */
export function differences(
	d: Draft,
	records: CandidateRecord[],
	fields: Field[],
	place: (record: CandidateRecord, cell: string) => string
): string {
	const clauses = fields.map((field) => {
		const holders = records.filter((record) => record.fields[field]);
		const says = holders.map((record) => {
			const value = record.fields[field]!;
			const cell = value.provenance.cell;
			const shown = d.value(`${capitalize(noun(field))} in ${place(record, cell)}`, field, value.value, cell);
			return fields.length === 1 ? `${place(record, cell)} says ${shown}` : `${shown} in ${place(record, cell)}`;
		});
		return fields.length === 1 ? joinList(says) : `the ${noun(field, 2)} are ${joinList(says)}`;
	});
	return fields.length === 1 ? clauses[0] : clauses.join('; ');
}
