import { describe, expect, it } from 'vitest';
import { isPlausiblePart, stripSeparators } from './identifiers';

describe('stripSeparators', () => {
	it.each([
		['space', ' '],
		['tab', '\t'],
		['line feed', '\n'],
		['carriage return', '\r'],
		['no-break space', ' '],
		['figure space', ' '],
		['narrow no-break space', ' '],
		['ideographic space', '　'],
		['zero-width space', '​'],
		['zero-width non-joiner', '‌'],
		['zero-width joiner', '‍'],
		['byte order mark', '﻿'],
		['hyphen-minus', '-'],
		['hyphen', '‐'],
		['non-breaking hyphen', '‑'],
		['figure dash', '‒'],
		['en dash', '–'],
		['em dash', '—'],
		['horizontal bar', '―'],
		['minus sign', '−']
	])('strips %s', (_, separator) => {
		expect(stripSeparators(['5305', '01', '658', '2565'].join(separator))).toBe('5305016582565');
	});

	it.each([
		['period', '.'],
		['slash', '/'],
		['underscore', '_']
	])('keeps %s, which is not a separator', (_, character) => {
		expect(stripSeparators(`5305${character}01`)).toBe(`5305${character}01`);
	});
});

describe('isPlausiblePart', () => {
	it.each([
		'457985-1 B',
		'10931023*92',
		'6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P',
		'BH011-HT REV 000',
		'2132981-2  C',
		'PPIM 21023',
		'13211E9213',
		'201018858',
		'12542334-GRN',
		'12273108 (EATON M144E)',
		'M39029/58-360',
		'3-4',
		'MS35106-1',
		'SM-A-802914',
		// Long single-case alphanumerics are real part shapes, not checksums.
		'ABCDEFGHIJ1234567890XYZ'
	])('accepts %s', (value) => {
		expect(isPlausiblePart(value)).toBe(true);
	});

	it.each([
		['empty', ''],
		['whitespace', '   '],
		['no digit', 'Yes'],
		['too long', '1'.repeat(41)],
		['UUID', 'b1c35601-c8c9-f011-bbd2-000d3a3bdce8'],
		['URL', 'https://www.dla.mil/part/123'],
		['bare www URL', 'www.example.com/123'],
		['email', 'buyer1@example.com'],
		['ISO date', '2026-07-20'],
		['ISO timestamp', '2026-07-20T14:03:00Z'],
		['slash date', '7/20/26'],
		['slash date with time', '12/12/2025 2:48 AM'],
		['short base64 checksum', 'q7YxtvM2fSgox5+DsOSPLg=='],
		['sentence', 'Called vendor on 3 occasions about this']
	])('rejects %s', (_, value) => {
		expect(isPlausiblePart(value)).toBe(false);
	});
});
