/**
 * Header text matching for column mapping.
 *
 * The vocabulary is deliberately small: a header only nominates a field, and the column's values decide.
 * Matching is token-based so vendor prefixes (`PENCOM Part Number`, `G & B P/N`) still match,
 * while modifier words (`NSN Found`, `Part Number / Family`) downgrade a match to weak.
 */
import type { Field } from '../model';

export type HeaderStrength = 'strong' | 'weak';

export type HeaderMatch = {
	field: Field;
	strength: HeaderStrength;
	/** Why a match is weak, e.g. "also says 'found'"; null for strong matches. */
	weakBecause: string | null;
};

const VOCABULARY: Record<Field, string[]> = {
	part: ['part', 'part number', 'part no', 'part #', 'p/n', 'pn'],
	description: ['description', 'nomenclature', 'item name'],
	nsn: ['nsn', 'national stock number'],
	niin: ['niin', 'national item identification number'],
	cage: ['cage', 'cage code'],
	fsc: ['fsc', 'federal supply class']
};

/** Words that mark a column as being about the field rather than holding it (`NSN Found`, `Part Family`). */
const MODIFIERS = [
	'found',
	'status',
	'date',
	'url',
	'source',
	'notes',
	'note',
	'comments',
	'comment',
	'equivalent',
	'competitor',
	'family',
	'series',
	'matchability',
	'result',
	'query',
	'owner',
	'priority',
	'verified',
	'checksum',
	'modified',
	'do not modify',
	'id'
];

const PHRASES = Object.entries(VOCABULARY).map(([field, phrases]) => ({
	field: field as Field,
	phrases: phrases.map((p) => p.split(' '))
}));
const MODIFIER_PHRASES = MODIFIERS.map((m) => ({ text: m, tokens: m.split(' ') }));
/** Column labels are short; a cell beyond this reads like a sentence that merely mentions a field. */
const LABEL_MAX_WORDS = 5;
const LABEL_MAX_LENGTH = 40;
/** Slash tokens that are vocabulary on their own and must not be split (`p/n`). */
const SLASH_WORDS = new Set(Object.values(VOCABULARY).flat().filter((p) => p.includes('/')));

/**
 * Lowercase, NFKC, punctuation / underscores / line breaks to spaces (keeping `/ # &`), whitespace collapsed.
 * Also used to compare repeated headers and, by T6, to check the header text an AI proposal claims to have read.
 */
export function normalizeHeader(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[#&]/g, ' $& ')
		.replace(/[^\p{L}\p{N}\s/#&]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** `nsn/niin` and `mil/ms/nas` become separate words; `p/n` stays one word because it is vocabulary. */
function tokenize(normalized: string): string[] {
	return normalized
		.split(' ')
		.filter(Boolean)
		.flatMap((token) =>
			token.includes('/') && !SLASH_WORDS.has(token)
				? token.split(/(\/)/).filter(Boolean)
				: [token]
		);
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
	for (let i = 0; i + phrase.length <= tokens.length; i++) {
		if (phrase.every((word, j) => tokens[i + j] === word)) return true;
	}
	return false;
}

/**
 * Every field the header names, strong or weak. Usually zero or one entry; `NSN/NIIN` yields two.
 * Weak: a modifier word is present (`NSN Found`), a word holds digits, or the text is a sentence rather than a label.
 * A word with digits marks a value, not a label: `PN-4410` is a part number that starts with header vocabulary,
 * and treating it as a strong `Part` label would make data rows look like repeated headers.
 */
export function matchHeader(text: string): HeaderMatch[] {
	const tokens = tokenize(normalizeHeader(text));
	if (tokens.length === 0) return [];
	const modifiers = MODIFIER_PHRASES.filter((m) => containsPhrase(tokens, m.tokens)).map((m) => m.text);
	const code = text.split(/\s+/).find((word) => /\d/.test(word));
	const sentence = tokens.length > LABEL_MAX_WORDS || text.trim().length > LABEL_MAX_LENGTH;
	const weakBecause =
		modifiers.length > 0
			? `also says '${modifiers.join("', '")}'`
			: code
				? `contains '${code}', which looks like a value, not a label`
				: sentence
					? 'reads like a sentence, not a column label'
					: null;
	return PHRASES.filter(({ phrases }) => phrases.some((p) => containsPhrase(tokens, p))).map(({ field }) => ({
		field,
		strength: weakBecause ? 'weak' : 'strong',
		weakBecause
	}));
}

/** True when the header carries a modifier word, i.e. it describes metadata (dates, notes, statuses). */
export function hasModifier(text: string): boolean {
	const tokens = tokenize(normalizeHeader(text));
	return MODIFIER_PHRASES.some((m) => containsPhrase(tokens, m.tokens));
}
