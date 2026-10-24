/**
 * Wording helpers and the copy rules every explanation follows, whether the rules or the AI wrote it.
 *
 * The copy rules live here so the template tests and the AI verifier check exactly the same things.
 */
import type { Field } from '../model';
import { stripSeparators } from '../identifiers';
import type { Fact } from './types';

const NOUN: Record<Field, { one: string; many: string; article: 'a' | 'an' }> = {
	part: { one: 'part number', many: 'part numbers', article: 'a' },
	description: { one: 'description', many: 'descriptions', article: 'a' },
	nsn: { one: 'NSN', many: 'NSNs', article: 'an' },
	niin: { one: 'NIIN', many: 'NIINs', article: 'a' },
	cage: { one: 'CAGE code', many: 'CAGE codes', article: 'a' },
	fsc: { one: 'FSC', many: 'FSCs', article: 'an' }
};

export const noun = (field: Field, n = 1) => (n === 1 ? NOUN[field].one : NOUN[field].many);
/** "an NSN", "a part number". */
export const aNoun = (field: Field) => `${NOUN[field].article} ${NOUN[field].one}`;
/** "2 NSNs", "1 part number". */
export const count = (n: number, field: Field) => `${n.toLocaleString()} ${noun(field, n)}`;
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
	if (items.length < 2) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** At most `max` items, the rest counted: "A, B, C and 5 more". */
export function shortList(items: string[], max = 4): string {
	if (items.length <= max) return joinList(items);
	return `${items.slice(0, max - 1).join(', ')} and ${items.length - max + 1} more`;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** 1 -> "first", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n: number): string {
	if (n >= 1 && n <= ORDINALS.length) return ORDINALS[n - 1];
	const tens = n % 100;
	const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${suffix}`;
}

/** "5305016582565" -> "5305-01-658-2565", the way NSNs are written; anything else is returned unchanged. */
export function formatNsn(digits: string): string {
	return /^\d{13}$/.test(digits)
		? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`
		: digits;
}

/**
 * A value as the user should read it. NSN, NIIN, and FSC values lose their separators (a 13-digit run is
 * written as an NSN even when it sits in the wrong column); other text is quoted unless it is a single
 * code-like token such as RVX08212. Lines of a multi-line cell are joined with " / ".
 */
export function show(field: Field | null, value: string): string {
	const text = value.trim().replace(/\s*\n\s*/g, ' / ');
	if (field === 'nsn' || field === 'niin' || field === 'fsc') {
		const digits = stripSeparators(text);
		if (/^\d+$/.test(digits)) return formatNsn(digits);
	}
	// Identifier-like tokens read fine bare; words and phrases are quoted so they stand out from the sentence.
	return /\d/.test(text) && /^[A-Za-z0-9\-./*#]+$/.test(text) ? text : `"${text}"`;
}

/** "Active Parts!E134" -> "E134". Sheet names may hold "!", so the ref is what follows the last one. */
export const bareRef = (qualified: string) => qualified.slice(qualified.lastIndexOf('!') + 1);

/* ---------- Copy rules ---------- */

/** Words from inside the importer that mean nothing to the user. */
export const JARGON = ['candidate record', 'primary identifier', 'valid portion', 'provenance', 'split', 'materializ'];

/** A sheet-qualified cell reference such as `Active Parts!E134` or `'Sheet 1'!$B$2`. */
const QUALIFIED_REF = /!\$?[A-Z]{1,3}\$?[1-9]/;
/** Thirteen digits in a row: an NSN written without its hyphens. */
const BARE_NSN = /(?<![\d-])\d{13}(?![\d-])/;

/**
 * Text with every fact value blanked out, so a rule about the wording is not broken by the data it quotes:
 * a description may well say "SPLIT PIN", and a part number may be 13 digits long.
 */
export function wordingOnly(text: string, facts: readonly Fact[]): string {
	const values = facts.flatMap((fact) => [fact.value, ...fact.value.split('\n')]).filter((value) => value.trim().length > 2);
	// Longest first, so a value is not left half-blanked by a shorter value it contains.
	let wording = text;
	for (const value of [...new Set(values)].sort((a, b) => b.length - a.length)) {
		wording = wording.split(value.trim()).join('…');
	}
	return wording;
}

/** Copy rules the text breaks, as short reasons; empty when it follows them all. */
export function copyProblems(text: string, facts: readonly Fact[]): string[] {
	const wording = wordingOnly(text, facts);
	const problems: string[] = [];
	if (QUALIFIED_REF.test(wording)) problems.push('names a cell with its sheet');
	if (BARE_NSN.test(wording)) problems.push('writes an NSN without hyphens');
	const lower = wording.toLowerCase();
	const jargon = JARGON.filter((word) => lower.includes(word));
	if (jargon.length) problems.push(`uses importer jargon (${jargon.join(', ')})`);
	return problems;
}
