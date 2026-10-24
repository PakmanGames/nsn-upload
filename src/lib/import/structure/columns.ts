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
import { checkPartShape, checkValue } from './values';

/* Thresholds from ARCHITECTURE.md ("Column confidence"). */
const HIGH_RATE = 0.9;
const MEDIUM_RATE = 0.6;
/** A strong header whose values pass less often than this is a coincidence, not a low-confidence mapping. */
const STRONG_FLOOR = 0.5;
/** NSN and NIIN have validators strict enough to map a column without a header match. */
const VALUE_ONLY_RATE = 0.95;
/** One valid NSN in a notes column proves nothing; value-only evidence needs a few values. */
const VALUE_ONLY_MIN_VALUES = 3;
/** Share of a part-shaped column's values that must differ; repeats suggest a category such as a platform. */
const VALUE_ONLY_PART_DISTINCT = 0.5;
/** Share of rows a part column picked by values must fill; a sparse one is more likely a drawing or replacement number. */
const VALUE_ONLY_PART_FILL = 0.5;

const VALUE_ONLY_FIELDS: readonly Field[] = ['nsn', 'niin'];
/** Fields whose values are checked in every column, because each can map from values alone. */
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

/** How passing values are described: "127 of 129 values are valid NSNs". */
const VALUES_ARE: Record<Field, string> = {
	part: 'are plausible part numbers',
	description: 'are descriptive text',
	nsn: 'are valid NSNs',
	niin: 'are valid NIINs',
	cage: 'are valid CAGE codes',
	fsc: 'are valid FSCs'
};
/** Part values checked by shape alone, without Part vocabulary in the header. */
const VALUES_LOOK_LIKE_PARTS = 'look like part numbers';

export type Tally = {
	/** Non-empty cells that say something about the field (error cells are skipped). */
	checked: number;
	pass: number;
	/** Valid only after a repair such as restoring leading zeros or reading a number as part text. */
	repaired: number;
	/** Different values among those that pass or were repaired; tracked for Part only. */
	distinct: number;
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
	/** Other columns whose values fit Part just as well when no header names Part; a tie maps none of them. */
	partTies: number[];
};

/** Part values are checked by shape alone unless the header names Part with real vocabulary (a hint does not). */
const checksPartShape = (header: HeaderMatch | null | undefined) => !header || header.hint === true;

/**
 * `valueOnlyPart`: the column is the table's one part-shaped column and no header claims Part, a decision
 * evaluateColumns makes across columns. That alone earns medium confidence.
 */
export function confidenceFor(
	field: Field,
	header: HeaderMatch | null,
	tally: Tally,
	valueOnlyPart = false
): Pick<FieldEvidence, 'passed' | 'rate' | 'confidence'> {
	// Repaired values count only when the header names the field, so a Qty column of small numbers is not
	// read as NIINs. Part without a header is the exception: its shape check repairs only number cells that
	// are whole numbers long enough to be codes.
	const passed = header || field === 'part' ? tally.pass + tally.repaired : tally.pass;
	if (tally.checked === 0) return { passed, rate: null, confidence: null };
	const rate = passed / tally.checked;
	let confidence: Confidence | null = null;
	if (header?.strength === 'strong') {
		confidence = rate >= HIGH_RATE ? 'high' : rate >= MEDIUM_RATE ? 'medium' : rate >= STRONG_FLOOR ? 'low' : null;
	} else if (header?.strength === 'weak') {
		confidence = rate >= HIGH_RATE ? 'medium' : rate >= MEDIUM_RATE ? 'low' : null;
	} else if (VALUE_ONLY_FIELDS.includes(field) && tally.checked >= VALUE_ONLY_MIN_VALUES && rate >= VALUE_ONLY_RATE) {
		confidence = 'medium';
	} else if (field === 'part' && valueOnlyPart) {
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

/**
 * Tallies every column over the given rows. One pass per row; each cell is checked only for plausible fields.
 * Part is the one field mapped by shape across columns: see choosePartByValues.
 */
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
		const tallies = new Map([...fields].map((f) => [f, { checked: 0, pass: 0, repaired: 0, distinct: 0 } as Tally]));
		const partShape = checksPartShape(matches.get('part'));
		const partValues = new Set<string>();
		const strongFields = new Set([...matches.values()].filter((m) => m.strength === 'strong').map((m) => m.field));
		const echo = options.skipHeaderEcho && header.text ? { keys: new Set(header.echoes.map(normalizeHeader)), strongFields } : null;
		return { col, header, matches, tallies, partShape, partValues, echo };
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
				const partShape = field === 'part' && plan.partShape;
				const verdict = partShape ? checkPartShape(cell) : checkValue(field, cell, sheet.name);
				if (verdict === 'skip') continue;
				tally.checked++;
				if (verdict === 'pass') tally.pass++;
				if (verdict === 'repaired') tally.repaired++;
				if (field === 'part' && verdict !== 'fail') plan.partValues.add(cell.text.trim().toUpperCase());
			}
		}
	}

	const columns = plans.map(({ col, header, matches, tallies, partValues }): ColumnEvidence => {
		tallies.get('part')!.distinct = partValues.size;
		const fields = new Map<Field, FieldEvidence>();
		for (const [field, tally] of tallies) {
			const match = matches.get(field) ?? null;
			fields.set(field, { field, header: match, tally, ...confidenceFor(field, match, tally) });
		}
		return { col, header: header.text, hidden: sheet.hiddenCols.has(col), fields, valueOnlyAlternatives: [], partTies: [] };
	});
	choosePartByValues(columns, plans.map((plan) => plan.header.label), rows.length);
	return columns;
}

/**
 * Without a header, nearly all values must pass the strict part shape check. A modifier header (dates,
 * comments, statuses) describes metadata, so shape is no hint there, and values that pass the strict NSN or
 * NIIN check are identifiers rather than part numbers.
 */
function isPartShapedColumn(column: ColumnEvidence, label: string): boolean {
	const part = column.fields.get('part')!;
	if (part.header || hasModifier(label) || part.tally.checked < VALUE_ONLY_MIN_VALUES) return false;
	const identifiers = VALUE_ONLY_FIELDS.some((f) => {
		const t = column.fields.get(f)!.tally;
		return t.checked > 0 && t.pass / t.checked >= MEDIUM_RATE;
	});
	return !identifiers && part.rate! >= HIGH_RATE;
}

/**
 * Maps Part from values alone when no visible column claims Part through its header (header and values
 * together) and exactly one visible part-shaped column clearly qualifies: it has values on most rows, they
 * are mostly different (a repeated value is a category, such as a platform), and no other field explains
 * them (an FSC column). Shape is weak evidence, so the column gets medium confidence, and a tie maps none.
 * Every other visible part-shaped column is offered Part as an alternative (Statz `Dwg Number` beside
 * `G & B P/N`); hidden columns are never mapped automatically, so they are not offered either.
 */
function choosePartByValues(columns: ColumnEvidence[], labels: readonly string[], rowCount: number): void {
	const shaped = columns.filter((column, i) => !column.hidden && isPartShapedColumn(column, labels[i]));
	const claimed = columns.some((column) => !column.hidden && column.fields.get('part')!.header && column.fields.get('part')!.confidence);
	const qualified = shaped.filter((column) => {
		const part = column.fields.get('part')!;
		const explained = [...column.fields.values()].some((e) => e.field !== 'part' && e.confidence);
		return (
			!explained &&
			part.tally.checked >= rowCount * VALUE_ONLY_PART_FILL &&
			part.tally.distinct >= part.passed * VALUE_ONLY_PART_DISTINCT
		);
	});
	const chosen = !claimed && qualified.length === 1 ? qualified[0] : null;
	if (chosen) {
		const part = chosen.fields.get('part')!;
		chosen.fields.set('part', { ...part, ...confidenceFor('part', null, part.tally, true) });
	}
	const tied = !claimed && qualified.length > 1 ? qualified : [];
	for (const column of shaped) {
		if (column === chosen) continue;
		column.valueOnlyAlternatives = ['part'];
		if (tied.includes(column)) column.partTies = tied.filter((other) => other !== column).map((other) => other.col);
	}
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

/** "127 of 129 values are valid NSNs", or "139 of 139 values look like part numbers" for the shape check. */
function describeValues(e: FieldEvidence): string {
	const phrase = e.field === 'part' && checksPartShape(e.header) ? VALUES_LOOK_LIKE_PARTS : VALUES_ARE[e.field];
	return `${e.passed} of ${e.tally.checked} values ${phrase}`;
}

/**
 * Evidence quoted in reasons, e.g. "Header 'NSN' matches NSN" and "127 of 129 values are valid NSNs".
 * The lines this importer adds for Part by values, hints, and mere mentions are plain sentences, and they do
 * not repeat the header, which the Columns card shows right above them. A header that names a field its
 * values do not back is one line ("Header mentions NSN, but 0 of 68 values are valid NSNs"), so it never
 * reads like a match.
 */
export function describeEvidence(column: ColumnEvidence, e: FieldEvidence): string[] {
	const label = FIELD_LABEL[e.field];
	const header = column.header.replace(/\s+/g, ' ');
	const values = describeValues(e);
	if (e.header && !e.confidence && e.tally.checked > 0) {
		return [e.header.hint ? `${capitalize(e.header.weakBecause!)}, but ${values}` : `Header mentions ${label}, but ${values}`];
	}
	if (!e.header && e.confidence && e.field === 'part') return [`No header says Part, but ${values}`];
	const reasons = [
		!header
			? 'No header text'
			: !e.header
				? `Header '${header}' does not name ${label}`
				: e.header.hint
					? `The header doesn't say ${label}, but ${e.header.weakBecause}`
					: e.header.strength === 'strong'
						? `Header '${header}' matches ${label}`
						: `Header '${header}' mentions ${label} but ${e.header.weakBecause}`
	];
	reasons.push(e.tally.checked === 0 ? 'No values in the data rows' : values);
	return reasons;
}

/** Why a part-shaped column was left out: no header says Part, and in a tie the values fit another column too. */
export function describeValueOnlyAlternative(column: ColumnEvidence, field: Field): string {
	const values = describeValues(column.fields.get(field)!);
	if (column.partTies.length === 0) return `${values}, but the header doesn't say ${FIELD_LABEL[field]}`;
	const others = column.partTies.map(colLetter);
	const which = others.length === 1 ? `column ${others[0]}` : `columns ${others.slice(0, -1).join(', ')} and ${others.at(-1)}`;
	return `${values}, and so do the values in ${which}; no header says which one holds them`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
