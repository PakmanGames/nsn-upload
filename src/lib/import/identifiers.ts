/**
 * Identifier checks shared by column mapping (T3) and normalization (T2).
 * Kept in one place so a column is scored with exactly the rules used to validate its values.
 */

/** Whitespace (incl. NBSP), zero-width characters, ASCII hyphen, Unicode dashes and the minus sign. */
const SEPARATORS = /[\s\u200B-\u200D\uFEFF\u2010-\u2015\u2212-]/g;

export function stripSeparators(text: string): string {
	return text.replace(SEPARATORS, '');
}

export const isNsnDigits = (value: string) => /^\d{13}$/.test(value);
export const isNiinDigits = (value: string) => /^\d{9}$/.test(value);
export const isFscDigits = (value: string) => /^\d{4}$/.test(value);
export const isCage = (value: string) => /^[A-Z0-9]{5}$/.test(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_OR_EMAIL = /^(?:https?:\/\/|www\.)|@/i;
/** ISO dates and timestamps, e.g. 2026-07-20 or 2026-07-20T14:03:00Z. */
const ISO_DATE =
	/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** Slash dates as Excel displays them, e.g. 7/20/26 or 20/07/2026 14:03. */
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?(?: ?[AP]M)?)?$/i;
/**
 * Long mixed-case runs of base64 characters, such as row checksums.
 * Part numbers are almost always single-case, so requiring both cases keeps long real parts plausible.
 */
const BASE64 = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9+/]{20,}={0,2}$/;

/** Loose shape check for part numbers, which have no strict format. Used for column scoring and split decisions. */
export function isPlausiblePart(text: string): boolean {
	const value = text.trim();
	if (value.length === 0 || value.length > 40) return false;
	if (!/\d/.test(value)) return false;
	if (UUID.test(value) || URL_OR_EMAIL.test(value)) return false;
	if (ISO_DATE.test(value) || SLASH_DATE.test(value) || BASE64.test(value)) return false;
	return value.split(/\s+/).length <= 4;
}
