/**
 * Workbook reader: .xlsx bytes -> `WorkbookModel`.
 *
 * The only module that touches SheetJS. It is imported on demand, which keeps the parser out of the initial page
 * bundle, and everything it returns is library-neutral, so later stages and their tests never see SheetJS types.
 * Formulas are never evaluated: only the results Excel cached in the file are read.
 */
import type { WorkBook } from 'xlsx';
import {
	DEFAULT_READ_LIMITS,
	WorkbookReadError,
	type ReadLimits,
	type SheetVisibility,
	type WorkbookModel
} from '../model';
import { toSheetModel } from './sheet';
import { holdsDeclaredSizes, readCentralDirectory } from './zip';

const VISIBILITY: Record<number, SheetVisibility> = { 0: 'visible', 1: 'hidden', 2: 'veryHidden' };

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** OLE compound file: what Excel writes for a password-protected .xlsx, and the format of legacy .xls. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export async function readWorkbook(
	data: ArrayBuffer,
	fileName: string,
	limits: Partial<ReadLimits> = {}
): Promise<WorkbookModel> {
	const max = { ...DEFAULT_READ_LIMITS, ...limits };
	if (!/\.xlsx$/i.test(fileName)) {
		throw new WorkbookReadError(
			'not-xlsx',
			`"${fileName}" is not an .xlsx file. Save it in Excel as "Excel Workbook (.xlsx)" and upload it again.`
		);
	}
	if (data.byteLength > max.maxFileBytes) {
		throw new WorkbookReadError(
			'too-large',
			`"${fileName}" is ${megabytes(data.byteLength)}; the limit is ${megabytes(max.maxFileBytes)}.`
		);
	}

	const bytes = new Uint8Array(data);
	// SheetJS parses almost anything, including plain text and random bytes (as a one-sheet CSV), so the
	// container is checked by signature first.
	const isOle = startsWith(bytes, OLE_SIGNATURE);
	if (!isOle && !startsWith(bytes, ZIP_SIGNATURE)) throw damaged(fileName);

	const XLSX = await import('xlsx');
	if (isOle) throw oleError(XLSX.CFB, bytes, fileName);

	// Zip-bomb guard. SheetJS trusts whatever sizes the zip's headers declare (see zip.ts), so the declared total is
	// capped before anything is inflated, and then every entry must hold exactly what it declares.
	const entries = readCentralDirectory(bytes);
	if (!entries) throw damaged(fileName);
	const unzippedBytes = entries.reduce((total, entry) => total + entry.size, 0);
	if (unzippedBytes > max.maxUncompressedBytes) {
		throw new WorkbookReadError(
			'too-large',
			`"${fileName}" would expand to ${megabytes(unzippedBytes)} when unzipped; the limit is ${megabytes(max.maxUncompressedBytes)}. The file may be damaged or deliberately oversized.`
		);
	}
	if (!(await holdsDeclaredSizes(bytes, entries))) throw damaged(fileName);

	let workbook: WorkBook;
	try {
		workbook = XLSX.read(bytes, {
			type: 'array',
			dense: true,
			cellFormula: true,
			cellNF: true,
			cellText: true,
			// Required for column widths and hidden rows and columns.
			cellStyles: true,
			cellDates: false,
			cellHTML: false
		});
	} catch (error) {
		throw new WorkbookReadError(
			'corrupt',
			`"${fileName}" could not be read; the file may be damaged (${error instanceof Error ? error.message : error}).`
		);
	}

	const sheetCount = workbook.SheetNames.length;
	if (sheetCount > max.maxSheets) {
		throw new WorkbookReadError(
			'too-many-sheets',
			`"${fileName}" has ${count(sheetCount)} sheets; the limit is ${count(max.maxSheets)}.`
		);
	}

	let cells = 0;
	const spend = (added: number) => {
		cells += added;
		if (cells > max.maxCells) {
			throw new WorkbookReadError(
				'too-many-cells',
				`"${fileName}" has more than ${count(max.maxCells)} cells with values, the limit for one upload.`
			);
		}
	};
	const isDateFormat = (format: string): boolean => XLSX.SSF.is_date(format);

	const sheets = workbook.SheetNames.map((name, index) => {
		const source = workbook.Sheets[name];
		// SheetJS skips a worksheet it fails to parse instead of throwing, which leaves only its name behind.
		if (!source) {
			throw new WorkbookReadError('corrupt', `Sheet "${name}" in "${fileName}" is damaged and could not be read.`);
		}
		const visibility = VISIBILITY[workbook.Workbook?.Sheets?.[index]?.Hidden ?? 0];
		const sheet = toSheetModel(source, { name, index, visibility }, isDateFormat, spend);
		const lastRow = sheet.valueExtent?.bottom ?? 0;
		if (lastRow > max.maxRowsPerSheet) {
			throw new WorkbookReadError(
				'too-many-rows',
				`Sheet "${name}" has data down to row ${count(lastRow)}; the limit is ${count(max.maxRowsPerSheet)} rows per sheet.`
			);
		}
		return sheet;
	});

	return { fileName, sheets };
}

/**
 * An OLE container named .xlsx is either a password-protected workbook, which stores its encrypted package next to
 * an EncryptionInfo stream (ECMA-376 Part 2), or a legacy .xls with the wrong extension.
 */
function oleError(cfb: typeof import('xlsx').CFB, bytes: Uint8Array, fileName: string): WorkbookReadError {
	let encrypted: boolean;
	try {
		encrypted = Boolean(cfb.find(cfb.read(bytes, { type: 'array' }), 'EncryptionInfo'));
	} catch {
		return damaged(fileName);
	}
	return encrypted
		? new WorkbookReadError(
				'encrypted',
				`"${fileName}" is password-protected. Remove the password in Excel and upload it again.`
			)
		: new WorkbookReadError(
				'not-xlsx',
				`"${fileName}" is not an .xlsx workbook; it looks like an older .xls file. Save it in Excel as "Excel Workbook (.xlsx)" and upload it again.`
			);
}

function damaged(fileName: string): WorkbookReadError {
	return new WorkbookReadError('corrupt', `"${fileName}" is not a valid .xlsx workbook; the file may be damaged.`);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
	return signature.every((byte, i) => bytes[i] === byte);
}

const count = (n: number) => n.toLocaleString('en-US');
const megabytes = (bytes: number) => `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;
