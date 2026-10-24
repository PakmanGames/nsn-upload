/**
 * Per-field normalization rules. Each rule receives a non-empty cell whose text has already had
 * its line endings normalized and been trimmed, and decides what the field's values are.
 *
 * Identifier text is only ever edited as a string: routing it through Number() would drop
 * leading zeros and turn exponent-shaped part numbers such as 13211E9213 into floats.
 */
import { isCage, isPlausiblePart, stripSeparators } from '../identifiers';
import type {
	Cell,
	Field,
	Issue,
	NormalizeResult,
	NormalizedValue,
	Transform
} from '../model';

export type PreparedCell = {
	cell: Cell;
	/** Qualified ref of the cell, used in messages and Issue.cells. */
	at: string;
	/** Cell text after the shared cleanup. Never empty. */
	text: string;
	/** Transforms the shared cleanup applied. Rules copy this array, never mutate it. */
	transforms: readonly Transform[];
};

type FieldRule = (input: PreparedCell) => NormalizeResult;

export function invalid(field: Field, at: string, message: string): NormalizeResult {
	return {
		kind: 'invalid',
		issue: { code: 'invalid-identifier', severity: 'error', field, message, cells: [at] }
	};
}

function warning(field: Field, at: string, message: string): Issue {
	return { code: 'suspicious-value', severity: 'warning', field, message, cells: [at] };
}

/** Applies one step to a working value and records its transform only when the text changed. */
function step(working: NormalizedValue, transform: Transform, next: string): void {
	if (next === working.value) return;
	working.value = next;
	working.transforms.push(transform);
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Newline-separated segments, each trimmed, with empty ones dropped. */
function splitLines(text: string): NormalizedValue[] {
	return text.split('\n').flatMap((line) => {
		const value = line.trim();
		if (!value) return [];
		return [{ value, transforms: value === line ? [] : ['trim' as const] }];
	});
}

/**
 * The cell becomes one value per line. Values carry the cell-level transforms, then
 * split-multi-value, then whatever the line itself needed.
 */
function splitValues(text: string, transforms: readonly Transform[]): NormalizedValue[] {
	return splitLines(text).map((line) => ({
		value: line.value,
		transforms: [...transforms, 'split-multi-value', ...line.transforms]
	}));
}

/** Digits joined by single separators, as a date format that mirrors typing shows it (`4-2002` under m-yyyy). */
const DIGITS_AND_SEPARATORS = /^\d+(?:[-/.]\d+)+$/;

const part: FieldRule = ({ cell, at, text, transforms }) => {
	if (cell.kind === 'date') {
		// A month name (`4-Mar`) or a full date (`4/1/2002`) is Excel's rewrite, and the typed value is gone.
		// Digits and separators that still read as a part number are most likely what was typed, as with a
		// part number stored as a number; the warning says it may still differ.
		if (!DIGITS_AND_SEPARATORS.test(text) || !isPlausiblePart(text)) {
			return invalid(
				'part',
				at,
				`Part number in ${at} is stored as a date ("${text}"); Excel converted it and the original value cannot be recovered`
			);
		}
		return {
			kind: 'ok',
			values: [{ value: text, transforms: [...transforms] }],
			warnings: [
				warning('part', at, `Part number in ${at} is stored as a date; imported as Excel shows it ("${text}"), which may differ from what was typed`)
			]
		};
	}
	const warnings: Issue[] = [];
	if (cell.kind === 'number') {
		warnings.push(
			warning('part', at, `Part number in ${at} is stored as a number; leading zeros may have been lost`)
		);
	}

	let values: NormalizedValue[] = [{ value: text, transforms: [...transforms] }];
	if (text.includes('\n')) {
		// Split only when every line is a part number on its own; a part number followed by a
		// note is more likely one annotated value than two records.
		const lines = splitValues(text, transforms);
		if (lines.every((line) => isPlausiblePart(line.value))) values = lines;
		else {
			warnings.push(
				warning(
					'part',
					at,
					`Part number cell ${at} has ${lines.length} lines, but not every line looks like a part number; kept as one value`
				)
			);
		}
	} else if (!isPlausiblePart(text)) {
		warnings.push(warning('part', at, `"${text}" in ${at} does not look like a part number`));
	}

	for (const { value } of values) {
		if (/\(.*\)/.test(value)) {
			warnings.push(
				warning('part', at, `Part number "${value}" in ${at} contains text in parentheses; kept as written`)
			);
		}
	}
	return { kind: 'ok', values, warnings };
};

const description: FieldRule = ({ text, transforms }) => ({
	kind: 'ok',
	values: [{ value: text, transforms: [...transforms] }],
	warnings: []
});

type DigitField = 'nsn' | 'niin' | 'fsc';

const DIGIT_FIELDS: Record<DigitField, { label: string; length: number; prefix: RegExp }> = {
	nsn: { label: 'NSN', length: 13, prefix: /^NSN\s*[:#.]?\s*(?=\d)/i },
	niin: { label: 'NIIN', length: 9, prefix: /^NIIN\s*[:#.]?\s*(?=\d)/i },
	fsc: { label: 'FSC', length: 4, prefix: /^FSC\s*[:#.]?\s*(?=\d)/i }
};

/** Why a separator-free value is not a valid identifier, phrased to follow the quoted value; null when valid. */
function digitProblem(field: DigitField, value: string): string | null {
	const { length } = DIGIT_FIELDS[field];
	if (/^\d+$/.test(value)) {
		if (value.length === length) return null;
		if (field === 'nsn' && value.length === 9) return 'has 9 digits and looks like a NIIN';
		if (field !== 'nsn' && value.length === 13) return 'has 13 digits and looks like an NSN';
		return `has ${count(value.length, 'digit')}, expected ${length}`;
	}
	if (!/\d/.test(value)) return 'contains no digits';
	if (/\p{L}/u.test(value)) return 'contains letters and looks like a part number';
	return 'contains characters other than digits and separators';
}

/** NSN, NIIN, and FSC: strip a leading label and separators, then require an exact digit count. */
function digits(field: DigitField): FieldRule {
	const { label, length, prefix } = DIGIT_FIELDS[field];
	return ({ cell, at, text, transforms }) => {
		// FSC is never split: it only feeds NSN derivation, which needs a single value.
		const multi = field !== 'fsc' && text.includes('\n');
		const values = multi ? splitValues(text, transforms) : [{ value: text, transforms: [...transforms] }];
		const originals = values.map((value) => value.value);
		const warnings: Issue[] = [];

		for (const working of values) {
			step(working, 'strip-label', working.value.replace(prefix, ''));
			step(working, 'strip-separators', stripSeparators(working.value));
		}
		// A NIIN typed into a General-format cell loses its leading zeros (NCB code 00 or 01).
		// Numeric cells cannot hold newlines, so this only ever applies to a single value.
		const [first] = values;
		if (field === 'niin' && cell.kind === 'number' && /^\d{1,8}$/.test(first.value)) {
			step(first, 'restore-leading-zeros', first.value.padStart(length, '0'));
			warnings.push(
				warning(
					'niin',
					at,
					`NIIN in ${at} is stored as a number (${text}); restored leading zeros to ${first.value}`
				)
			);
		}

		const problems = values.map((value) => digitProblem(field, value.value));
		if (!multi && problems[0]) return invalid(field, at, `${label} "${text}" in ${at} ${problems[0]}`);
		if (problems.some(Boolean)) {
			const lines = originals.map((original, i) => `"${original}" ${problems[i] ?? 'is valid'}`);
			return invalid(
				field,
				at,
				`${label} cell ${at} has ${values.length} lines, but not all are valid ${label}s: ${lines.join('; ')}`
			);
		}
		return { kind: 'ok', values, warnings };
	};
}

const cage: FieldRule = ({ cell, at, text, transforms }) => {
	const working: NormalizedValue = { value: text, transforms: [...transforms] };
	const warnings: Issue[] = [];
	if (cell.kind === 'number' && /^\d{1,4}$/.test(text)) {
		step(working, 'restore-leading-zeros', text.padStart(5, '0'));
		warnings.push(
			warning('cage', at, `CAGE in ${at} is stored as a number (${text}); restored leading zeros to ${working.value}`)
		);
	}
	step(working, 'uppercase', working.value.toUpperCase());
	if (isCage(working.value)) return { kind: 'ok', values: [working], warnings };
	const problem = /^[A-Z0-9]+$/.test(working.value)
		? `has ${count(working.value.length, 'character')}, expected 5 letters or digits`
		: 'contains characters other than letters and digits';
	return invalid('cage', at, `CAGE "${text}" in ${at} ${problem}`);
};

export const FIELD_RULES: Record<Field, FieldRule> = {
	part,
	description,
	nsn: digits('nsn'),
	niin: digits('niin'),
	fsc: digits('fsc'),
	cage
};
