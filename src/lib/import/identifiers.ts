/**
 * Identifier checks shared by column mapping (T3) and normalization (T2).
 * Kept in one place so a column is scored with exactly the rules used to validate its values.
 */

/** Whitespace (incl. NBSP), zero-width characters, ASCII hyphen, Unicode dashes and the minus sign. */
const SEPARATORS = /[\s​-‍﻿‐-―−-]/g;

export function stripSeparators(text: string): string {
	return text.replace(SEPARATORS, '');
}

export const isNsnDigits = (value: string) => /^\d{13}$/.test(value);
export const isNiinDigits = (value: string) => /^\d{9}$/.test(value);
export const isFscDigits = (value: string) => /^\d{4}$/.test(value);
export const isCage = (value: string) => /^[A-Z0-9]{5}$/.test(value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loose shape check for part numbers, which have no strict format. Used for column scoring and split decisions. */
export function isPlausiblePart(text: string): boolean {
	const value = text.trim();
	if (value.length === 0 || value.length > 40) return false;
	if (!/\d/.test(value)) return false;
	if (UUID.test(value) || /^https?:\/\//i.test(value) || value.includes('@')) return false;
	return value.split(/\s+/).length <= 4;
}
