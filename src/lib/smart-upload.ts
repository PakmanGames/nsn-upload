import type { Cell } from 'exceljs';
import type { MappingInput, UploadAnalysis, UploadRow } from './types';

const fields: Array<keyof MappingInput> = ['part', 'description', 'nsn', 'niin', 'cage'];

const aliases: Record<keyof MappingInput, string[]> = {
	part: ['part', 'part number', 'part no', 'part #', 'pn', 'p/n'],
	description: ['description', 'item description', 'nomenclature', 'name'],
	nsn: ['nsn', 'national stock number'],
	niin: ['niin', 'national item identification number'],
	cage: ['cage', 'cage code', 'manufacturer cage']
};

function normalizedHeader(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ');
}

export function detectColumns(headers: string[]): Record<keyof MappingInput, number> {
	const normalized = headers.map(normalizedHeader);
	const result = Object.fromEntries(fields.map((field) => [field, -1])) as Record<
		keyof MappingInput,
		number
	>;

	for (const field of fields) {
		result[field] = normalized.findIndex((header) => aliases[field].includes(header));
	}

	return result;
}

function cleanValue(value: string | undefined): string | undefined {
	const cleaned = value?.trim();
	return !cleaned || cleaned === '-' ? undefined : cleaned;
}

function identifierFor(input: MappingInput): string {
	return input.nsn || input.niin || input.part || 'No identifier';
}

export function uniqueKey(input: MappingInput): string {
	return [
		input.nsn ? `nsn:${input.nsn}` : '',
		input.niin ? `niin:${input.niin}` : '',
		input.part ? `part:${input.part.toUpperCase()}` : '',
		input.cage ? `cage:${input.cage}` : ''
	]
		.filter(Boolean)
		.join('|');
}

export function parseRows(
	rows: string[][],
	columns: Record<keyof MappingInput, number>,
	startingLine = 2
): UploadRow[] {
	const seen = new Set<string>();

	return rows
		.map((values, index): UploadRow | null => {
			const valueAt = (field: keyof MappingInput) =>
				columns[field] >= 0 ? cleanValue(values[columns[field]]) : undefined;

			const input: MappingInput = {
				part: valueAt('part'),
				description: valueAt('description'),
				nsn: valueAt('nsn')?.replace(/[\s-]/g, ''),
				niin: valueAt('niin')?.replace(/[\s-]/g, ''),
				cage: valueAt('cage')?.toUpperCase()
			};

			if (!Object.values(input).some(Boolean)) return null;

			const warnings: string[] = [];
			let error: string | undefined;

			if (!input.nsn && !input.niin && !input.part) {
				error = 'At least one identifier (Part, NSN, or NIIN) is required.';
			} else if (input.nsn && !/^\d{13}$/.test(input.nsn)) {
				error = 'NSN must contain 13 digits.';
			} else if (input.niin && !/^\d{9}$/.test(input.niin)) {
				error = 'NIIN must contain 9 digits.';
			} else if (input.cage && !/^[A-Z0-9]{5}$/.test(input.cage)) {
				error = 'CAGE must contain 5 letters or numbers.';
			}

			if (!input.description) warnings.push('Description is empty');
			if (!input.cage) warnings.push('CAGE is empty');

			const key = uniqueKey(input);
			if (!error && seen.has(key)) error = 'Duplicate row in this workbook.';
			if (!error) seen.add(key);

			return {
				line: startingLine + index,
				input,
				identifier: identifierFor(input),
				warnings,
				error
			};
		})
		.filter((row): row is UploadRow => row !== null);
}

function cellText(cell: Cell): string {
	const value = cell.value;
	if (value === null || value === undefined) return '';
	if (typeof value !== 'object') return String(value);

	if ('richText' in value && Array.isArray(value.richText)) {
		return value.richText.map((entry) => entry.text).join('');
	}
	if ('text' in value) return String(value.text ?? '');
	if ('result' in value) return String(value.result ?? '');
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

export async function analyzeWorkbook(file: File): Promise<UploadAnalysis> {
	if (!file.name.toLowerCase().endsWith('.xlsx')) {
		throw new Error('Choose an .xlsx workbook.');
	}

	const { default: ExcelJS } = await import('exceljs');
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await file.arrayBuffer());
	const worksheet = workbook.worksheets[0];
	if (!worksheet) throw new Error('The workbook does not contain a worksheet.');

	const table: string[][] = [];
	worksheet.eachRow({ includeEmpty: false }, (row) => {
		const values: string[] = [];
		row.eachCell({ includeEmpty: true }, (cell, column) => {
			while (values.length < column - 1) values.push('');
			values[column - 1] = cellText(cell);
		});
		table.push(values);
	});

	if (table.length < 2) throw new Error('The first worksheet needs a header and at least one row.');

	const headers = table[0].map((header) => header.trim());
	const columns = detectColumns(headers);
	if (columns.nsn < 0 && columns.niin < 0 && columns.part < 0) {
		throw new Error('Could not detect a Part, NSN, or NIIN column.');
	}

	return {
		fileName: file.name,
		sheetName: worksheet.name,
		headers,
		columns,
		rows: parseRows(table.slice(1), columns)
	};
}

export async function downloadSampleWorkbook(): Promise<void> {
	const { default: ExcelJS } = await import('exceljs');
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('NSN Upload');
	sheet.addRow(['part', 'description', 'nsn', 'niin', 'cage']);
	sheet.addRow(['M30294', 'BOLT, HEX HEAD, 1/4-20', '1560000000047', '000000047', '12345']);
	sheet.addRow(['7320651-J', 'WASHER, FLAT, STEEL', '-', '000000048', 'ABC12']);
	sheet.addRow(['-', 'SCREW, MACHINE, PHILLIPS', '1560000000049', '-', '67890']);
	sheet.getRow(1).font = { bold: true };
	sheet.columns = [
		{ width: 20 },
		{ width: 34 },
		{ width: 20 },
		{ width: 16 },
		{ width: 14 }
	];

	const buffer = await workbook.xlsx.writeBuffer();
	const blob = new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = 'sample-nsn-upload.xlsx';
	link.click();
	URL.revokeObjectURL(url);
}
