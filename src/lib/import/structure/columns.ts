/**
 * Column evidence: what a column's header says and what its values say, combined into a confidence.
 *
 * Detection, user remaps, and AI proposals all go through these rules, so the same column always gets the
 * same confidence no matter who proposed the mapping.
 */
import type { Cell, CellRange, Confidence, Field, SheetModel } from '../model';
import { PRIMARY_FIELDS } from '../model';
import { colLetter } from '../refs';
import { hasModifier, matchHeader, normalizeHeader, type HeaderMatch } from './header';
import { checkValue } from './values';

/* Thresholds from ARCHITECTURE.md ("Column confidence"). */
const HIGH_RATE = 0.9;
const MEDIUM_RATE = 0.6;
/** A strong header whose values pass less often than this is a coincidence, not a low-confidence mapping. */
const STRONG_FLOOR = 0.5;
/** Only NSN and NIIN have validators strict enough to map a column without a header match. */
const VALUE_ONLY_RATE = 0.95;
/** One valid NSN in a notes column proves nothing; value-only evidence needs a few values. */
const VALUE_ONLY_MIN_VALUES = 3;
/** Without a header, a number cell counts as a part number only from this length, so 1-5 scores do not. */
const VALUE_ONLY_PART_MIN_LENGTH = 4;

const VALUE_ONLY_FIELDS: readonly Field[] = ['nsn', 'niin'];
/** Fields whose values are checked in every column: NSN/NIIN can map from values, part feeds alternatives. */
const ALWAYS_CHECKED: readonly Field[] = ['nsn', 'niin', 'part'];
/** Tie-break order: a column that passes a strict check is better described by it than by part plausibility. */
const SPECIFICITY: readonly Field[] = ['nsn', 'niin', 'cage', 'fsc', 'part', 'description'];
const TIER: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export const FIELD_LABEL: Record<Field, string> = {
	part: 'Part',
	description: 'Description',
	nsn: 'NSN',
	niin: 'NIIN',
	cage: 'CAGE',
	fsc: 'FSC'
};

const VALUE_NOUN: Record<Field, string> = {
	part: 'plausible part numbers',
	description: 'descriptive text',
	nsn: 'valid NSNs',
	niin: 'valid NIINs',
	cage: 'valid CAGE codes',
	fsc: 'valid FSCs'
};

export type Tally = {
	/** Non-empty cells that say something about the field (error cells are skipped). */
	checked: number;
	pass: number;
	/** Valid only after a repair such as restoring leading zeros or reading a number as part text. */
	repaired: number;
	/** Repaired values at least VALUE_ONLY_PART_MIN_LENGTH long. */
	repairedLong: number;
};

export type FieldEvidence = {
	field: Field;
	header: HeaderMatch | null;
	tally: Tally;
	/** Values counted for the confidence rule: repaired values count only when the header names the field. */
	passed: number;
	/** Null when the column has no checked values. */
	rate: number | null;
	/** Confidence of an automatic mapping; null when the evidence is too weak to map at all. */
	confidence: Confidence | null;
};

export type ColumnEvidence = {
	col: number;
	header: string;
	hidden: boolean;
	fields: Map<Field, FieldEvidence>;
	/** Fields the values fit even though nothing nominated them (`Dwg Number` holding part numbers). */
	valueOnlyAlternatives: Field[];
};

export function confidenceFor(field: Field, header: HeaderMatch | null, tally: Tally): Pick<FieldEvidence, 'passed' | 'rate' | 'confidence'> {
	const passed = header ? tally.pass + tally.repaired : tally.pass;
	if (tally.checked === 0) return { passed, rate: null, confidence: null };
	const rate = passed / tally.checked;
	let confidence: Confidence | null = null;
	if (header?.strength === 'strong') {
		confidence = rate >= HIGH_RATE ? 'high' : rate >= MEDIUM_RATE ? 'medium' : rate >= STRONG_FLOOR ? 'low' : null;
	} else if (header?.strength === 'weak') {
		confidence = rate >= HIGH_RATE ? 'medium' : rate >= MEDIUM_RATE ? 'low' : null;
	} else if (VALUE_ONLY_FIELDS.includes(field) && tally.checked >= VALUE_ONLY_MIN_VALUES && rate >= VALUE_ONLY_RATE) {
		confidence = 'medium';
	}
	return { passed, rate, confidence };
}

export type ColumnHeader = {
	/** Header text as shown: the header rows' texts joined with a space. */
	text: string;
	/** Text matched against the vocabulary: the joined text, or the first row's text when that matches better. */
	label: string;
	/** Texts that mark a data cell as a header echo: the joined text and each header row's own text. */
	echoes: string[];
	/**
	 * The header cells' extent when they are merged across columns (`B6:C6`): every column in it shows the same
	 * header. Null when the column's header cells are its own.
	 */
	merge: CellRange | null;
};

/** A lone hyphen, dash, or minus sign: an empty cell typed by hand. */
export const DASH_ONLY = /^[-\u2010-\u2015\u2212]$/;

/** Strength of the best match, then how many fields are named; higher is better. */
function matchQuality(text: string): number {
	const matches = matchHeader(text);
	const best = matches.some((m) => m.strength === 'strong') ? 2 : matches.length > 0 ? 1 : 0;
	return best * 10 + matches.length;
}

/**
 * A column's header across the header rows. Joining keeps `Part` + `Number` together; a hint row such as
 * `(13 digits)` would make the joined text a weak match, so the first row's text is matched when it is better.
 * A vertically merged header is not repeated, and a lone `-` counts as empty.
 */
export function readHeader(sheet: SheetModel, headerRows: readonly number[], col: number): ColumnHeader {
	const read = (row: number) => {
		const text = sheet.cell(row, col).text.trim();
		return DASH_ONLY.test(text) ? '' : text;
	};
	const texts = headerRows.map(read).filter(Boolean);
	const text = texts.filter((t, i) => t !== texts[i - 1]).join(' ');
	const first = headerRows.length > 0 ? read(headerRows[0]) : '';
	const merge = headerMerge(sheet, headerRows, col);
	let label = first !== text && matchQuality(first) > matchQuality(text) ? first : text;
	if (merge) label = withNsnParts(label);
	return { text, label, echoes: [...new Set([text, ...texts])], merge };
}

const masterRef = (cell: Cell) => cell.mergedFrom ?? cell.ref;

/** Columns whose header cell is this column's, in every header row: the header is merged across them. */
function headerMerge(sheet: SheetModel, headerRows: readonly number[], col: number): CellRange | null {
	if (headerRows.length === 0) return null;
	let left = 1;
	let right = Infinity;
	for (const row of headerRows) {
		const master = masterRef(sheet.cell(row, col));
		let l = col;
		while (l > 1 && masterRef(sheet.cell(row, l - 1)) === master) l--;
		let r = col;
		while (masterRef(sheet.cell(row, r + 1)) === master) r++;
		left = Math.max(left, l);
		right = Math.min(right, r);
	}
	return left < right ? { top: headerRows[0], left, bottom: headerRows.at(-1)!, right } : null;
}

/**
 * An NSN header merged across columns usually spans its two parts, the FSC and the NIIN. A strong NSN label is
 * then read as naming those parts too, so each column's values decide whether it holds the NSN, FSC, or NIIN.
 * The label is rebuilt from single-word field names: a strong match has no modifier words to keep.
 */
function withNsnParts(label: string): string {
	const matches = matchHeader(label);
	if (!matches.some((m) => m.field === 'nsn' && m.strength === 'strong')) return label;
	return [...new Set<Field>([...matches.map((m) => m.field), 'fsc', 'niin'])].join(' ');
}

type EvaluateOptions = {
	/** Fields that must be tallied even without a header match (the field a spec maps the column to). */
	mapped?: ReadonlyMap<number, Field>;
	/**
	 * Ignore cells that repeat the column header, by text or by naming the same field (`Part No.` under `P/N`),
	 * so repeated headers do not count against a column before rows are classified.
	 */
	skipHeaderEcho?: boolean;
};

/** Tallies every column over the given rows. One pass per row; each cell is checked only for plausible fields. */
export function evaluateColumns(
	sheet: SheetModel,
	headers: ReadonlyMap<number, ColumnHeader>,
	rows: readonly number[],
	options: EvaluateOptions = {}
): ColumnEvidence[] {
	const plans = [...headers].map(([col, header]) => {
		const matches = new Map(matchHeader(header.label).map((m) => [m.field, m]));
		const fields = new Set<Field>([...ALWAYS_CHECKED, ...matches.keys()]);
		const mappedField = options.mapped?.get(col);
		if (mappedField) fields.add(mappedField);
		const tallies = new Map([...fields].map((f) => [f, { checked: 0, pass: 0, repaired: 0, repairedLong: 0 } as Tally]));
		const strongFields = new Set([...matches.values()].filter((m) => m.strength === 'strong').map((m) => m.field));
		const echo = options.skipHeaderEcho && header.text ? { keys: new Set(header.echoes.map(normalizeHeader)), strongFields } : null;
		return { col, header, matches, tallies, echo };
	});
	const isEcho = (echo: { keys: Set<string>; strongFields: Set<Field> }, text: string) =>
		echo.keys.has(normalizeHeader(text)) ||
		matchHeader(text).some((m) => m.strength === 'strong' && echo.strongFields.has(m.field));

	for (const row of rows) {
		for (const plan of plans) {
			const cell = sheet.cell(row, plan.col);
			// Covered merge cells repeat their master; counting them would weigh one value several times.
			if (cell.kind === 'empty' || cell.kind === 'error' || cell.mergedFrom) continue;
			if (plan.echo && cell.kind === 'text' && isEcho(plan.echo, cell.text)) continue;
			for (const [field, tally] of plan.tallies) {
				const verdict = checkValue(field, cell, sheet.name);
				if (verdict === 'skip') continue;
				tally.checked++;
				if (verdict === 'pass') tally.pass++;
				if (verdict === 'repaired') {
					tally.repaired++;
					if (cell.text.trim().length >= VALUE_ONLY_PART_MIN_LENGTH) tally.repairedLong++;
				}
			}
		}
	}

	return plans.map(({ col, header, matches, tallies }) => {
		const fields = new Map<Field, FieldEvidence>();
		for (const [field, tally] of tallies) {
			const match = matches.get(field) ?? null;
			fields.set(field, { field, header: match, tally, ...confidenceFor(field, match, tally) });
		}
		const part = fields.get('part')!;
		const partLike = part.tally.pass + part.tally.repairedLong;
		// Modifier headers (dates, comments, statuses) describe metadata, so value shape alone is not a hint there.
		// NSNs and NIINs also look like part numbers; values that pass a strict check are identifiers, not parts.
		const strict = VALUE_ONLY_FIELDS.some((f) => {
			const t = fields.get(f)!.tally;
			return t.checked > 0 && t.pass / t.checked >= MEDIUM_RATE;
		});
		const valueOnlyAlternatives: Field[] =
			!part.header &&
			!strict &&
			!hasModifier(header.label) &&
			part.tally.checked >= VALUE_ONLY_MIN_VALUES &&
			partLike / part.tally.checked >= HIGH_RATE
				? ['part']
				: [];
		return { col, header: header.text, hidden: sheet.hiddenCols.has(col), fields, valueOnlyAlternatives };
	});
}

function rank(e: FieldEvidence): number[] {
	const strength = e.header?.strength === 'strong' ? 2 : e.header ? 1 : 0;
	return [TIER[e.confidence!], strength, e.rate ?? 0, -SPECIFICITY.indexOf(e.field)];
}

function compareRank(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
	return 0;
}

/** Mappable (column, field) pairs, best first. Hidden columns are never mapped automatically. */
export function mappableCandidates(columns: readonly ColumnEvidence[]): Array<{ col: number; evidence: FieldEvidence }> {
	return columns
		.filter((c) => !c.hidden)
		.flatMap((c) => [...c.fields.values()].filter((e) => e.confidence).map((evidence) => ({ col: c.col, evidence })))
		.sort((a, b) => compareRank(rank(a.evidence), rank(b.evidence)) || a.col - b.col);
}

/** Greedy one-to-one assignment: each column gets at most one field and each field at most one column. */
export function assignFields(columns: readonly ColumnEvidence[]): Map<number, FieldEvidence> {
	const assigned = new Map<number, FieldEvidence>();
	const usedFields = new Set<Field>();
	for (const { col, evidence } of mappableCandidates(columns)) {
		if (assigned.has(col) || usedFields.has(evidence.field)) continue;
		assigned.set(col, evidence);
		usedFields.add(evidence.field);
	}
	return assigned;
}

/** Other fields the column plausibly fits, best first. */
export function alternativesFor(column: ColumnEvidence, mapped: Field | null): Field[] {
	const ranked = [...column.fields.values()]
		.filter((e) => e.confidence && e.field !== mapped)
		.sort((a, b) => compareRank(rank(a), rank(b)))
		.map((e) => e.field);
	for (const field of column.valueOnlyAlternatives) if (field !== mapped && !ranked.includes(field)) ranked.push(field);
	return ranked;
}

export const isPrimary = (field: Field) => PRIMARY_FIELDS.includes(field);
export const tierOf = (confidence: Confidence) => TIER[confidence];
export const columnName = (col: number, header: string) => (header ? `column ${colLetter(col)} '${header}'` : `column ${colLetter(col)}`);

/** Evidence quoted in reasons, e.g. "Header 'NSN' matches NSN" and "127 of 129 values are valid NSNs". */
export function describeEvidence(column: ColumnEvidence, e: FieldEvidence): string[] {
	const label = FIELD_LABEL[e.field];
	const header = column.header.replace(/\s+/g, ' ');
	const reasons = [
		!header
			? 'No header text'
			: !e.header
				? `Header '${header}' does not name ${label}`
				: e.header.strength === 'strong'
					? `Header '${header}' matches ${label}`
					: `Header '${header}' mentions ${label} but ${e.header.weakBecause}`
	];
	reasons.push(
		e.tally.checked === 0 ? 'No values in the data rows' : `${e.passed} of ${e.tally.checked} values are ${VALUE_NOUN[e.field]}`
	);
	return reasons;
}

/** "Values look like part numbers (17 of 17), but the header does not name a part column". */
export function describeValueOnlyAlternative(column: ColumnEvidence, field: Field): string {
	const e = column.fields.get(field)!;
	const count = e.tally.pass + e.tally.repairedLong;
	return `${count} of ${e.tally.checked} values look like ${VALUE_NOUN[field]}, but the header does not name ${FIELD_LABEL[field]}; offered as an alternative`;
}
