import { describe, expect, it } from 'vitest';
import { matchHeader, normalizeHeader } from './header';

const fieldsOf = (text: string, strength: 'strong' | 'weak') =>
	matchHeader(text)
		.filter((m) => m.strength === strength)
		.map((m) => m.field);

describe('normalizeHeader', () => {
	it.each([
		['Part\nNumber', 'part number'],
		['  Part No. ', 'part no'],
		['G&B P/N', 'g & b p/n'],
		['Part#', 'part #'],
		['NSN_Found', 'nsn found'],
		['(Do Not Modify) Part', 'do not modify part'],
		['ＮＳＮ', 'nsn']
	])('%j -> %j', (input, expected) => {
		expect(normalizeHeader(input)).toBe(expected);
	});
});

describe('matchHeader', () => {
	it.each([
		['G & B P/N', 'part'],
		['PENCOM Part Number', 'part'],
		['Part\nNumber', 'part'],
		['P/N', 'part'],
		['Part No.', 'part'],
		['PN', 'part'],
		['Nomenclature', 'description'],
		['Government Item Name', 'description'],
		['National Stock Number', 'nsn'],
		['NIIN', 'niin'],
		['Manufacturer CAGE', 'cage'],
		['CAGE Code', 'cage'],
		['Federal Supply Class', 'fsc']
	])('%j is a strong %s header', (header, field) => {
		expect(fieldsOf(header, 'strong')).toEqual([field]);
	});

	it.each([
		['NSN Found', 'nsn', 'found'],
		['NSN Matchability (1-5)', 'nsn', 'matchability'],
		['(Do Not Modify) Part', 'part', 'do not modify'],
		['Part Number / Family', 'part', 'family'],
		['MIL/MS/NAS Equivalent Part', 'part', 'equivalent']
	])('%j is only a weak %s header', (header, field, modifier) => {
		const [match] = matchHeader(header);
		expect(match).toMatchObject({ field, strength: 'weak' });
		expect(match.weakBecause).toContain(modifier);
	});

	it.each(['Manufacturer', 'Mfg.', 'Dwg Number', 'Product Family', 'Item Number', 'Status'])(
		'%j names no field',
		(header) => {
			expect(matchHeader(header)).toEqual([]);
		}
	);

	it('splits slash-joined words but keeps p/n whole', () => {
		expect(fieldsOf('NSN/NIIN', 'strong')).toEqual(['nsn', 'niin']);
		expect(fieldsOf('Vendor P/N', 'strong')).toEqual(['part']);
	});

	it('treats a sentence that mentions a field as weak', () => {
		const [match] = matchHeader('Fast public discovery of NSN and supplier associations');
		expect(match).toMatchObject({ field: 'nsn', strength: 'weak', weakBecause: 'reads like a sentence, not a column label' });
	});
});
