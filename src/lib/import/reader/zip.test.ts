import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ReadLimits } from '../model';
import { readWorkbook } from '.';

type Part = {
	name: string;
	content: Uint8Array;
	/** Uncompressed size in both headers; the real size by default. */
	size?: number;
	/** Uncompressed size in the local header only; `size` by default, 0 when `streamed`. */
	localSize?: number;
	/** Compressed size in both headers; the real size by default. */
	compressedSize?: number;
	/** Compressed size in the local header only; `compressedSize` by default, 0 when `streamed`. */
	localCompressedSize?: number;
	stored?: boolean;
	/** Sizes follow the data in a data descriptor, as streaming zip writers do. */
	streamed?: boolean;
	/** Sizes in ZIP64 extra fields, with 0xFFFFFFFF in the 32-bit fields. */
	zip64?: boolean;
};

/**
 * Writes a zip by hand, so every declared size can differ from the data.
 * CRCs and timestamps stay 0: neither SheetJS nor the reader checks them.
 */
function zip(parts: Part[]): ArrayBuffer {
	const files: Uint8Array[] = [];
	const directory: Uint8Array[] = [];
	let offset = 0;
	for (const part of parts) {
		const name = new TextEncoder().encode(part.name);
		const data = part.stored ? part.content : new Uint8Array(deflateRawSync(part.content));
		const size = part.size ?? part.content.length;
		const compressedSize = part.compressedSize ?? data.length;
		const localSize = part.localSize ?? (part.streamed ? 0 : size);
		const localCompressedSize = part.localCompressedSize ?? (part.streamed ? 0 : compressedSize);
		const flags = part.streamed ? 0x08 : 0;
		const method = part.stored ? 0 : 8;
		const u32 = (value: number) => (part.zip64 ? 0xffffffff : value);
		const zip64 = (usz: number, csz: number) =>
			part.zip64 ? fields([2, 0x0001], [2, 16], [8, usz], [8, csz]) : new Uint8Array(0);

		const localExtra = zip64(localSize, localCompressedSize);
		// signature, version, flags, method, time and date, CRC, sizes, name and extra lengths
		const local = fields(
			[4, 0x04034b50], [2, 20], [2, flags], [2, method], [4, 0], [4, 0],
			[4, u32(localCompressedSize)], [4, u32(localSize)], [2, name.length], [2, localExtra.length]
		);
		const descriptor = part.streamed
			? fields([4, 0x08074b50], [4, 0], [4, compressedSize], [4, size])
			: new Uint8Array(0);
		files.push(local, name, localExtra, data, descriptor);

		const extra = zip64(size, compressedSize);
		// signature, versions, flags, method, time and date, CRC, sizes, name, extra and comment lengths, disk,
		// attributes, local header offset
		const entry = fields(
			[4, 0x02014b50], [2, 20], [2, 20], [2, flags], [2, method], [4, 0], [4, 0],
			[4, u32(compressedSize)], [4, u32(size)], [2, name.length], [2, extra.length], [2, 0], [2, 0],
			[2, 0], [4, 0], [4, offset]
		);
		directory.push(entry, name, extra);
		offset += local.length + name.length + localExtra.length + data.length + descriptor.length;
	}
	const directorySize = directory.reduce((total, chunk) => total + chunk.length, 0);
	// signature, disks, entry counts, directory size and offset, comment length
	const end = fields(
		[4, 0x06054b50], [2, 0], [2, 0], [2, parts.length], [2, parts.length], [4, directorySize], [4, offset], [2, 0]
	);
	return concat([...files, ...directory, end]).buffer;
}

/** Little-endian fields, each a [byte length, value] pair. */
function fields(...values: Array<[2 | 4 | 8, number]>): Uint8Array {
	const bytes = new Uint8Array(values.reduce((total, [length]) => total + length, 0));
	const view = new DataView(bytes.buffer);
	let at = 0;
	for (const [length, value] of values) {
		if (length === 2) view.setUint16(at, value, true);
		else if (length === 4) view.setUint32(at, value, true);
		else view.setBigUint64(at, BigInt(value), true);
		at += length;
	}
	return bytes;
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return bytes;
}

/** A normal one-sheet workbook, compressed the way Excel compresses it. */
const workbook = (() => {
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['NSN'], ['5305-01-658-2565']]), 'S1');
	return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
})();

/** The workbook's parts, to rebuild with hand-set sizes. */
const parts: Part[] = (() => {
	const container = XLSX.CFB.read(new Uint8Array(workbook), { type: 'array' });
	const name = (i: number): string => container.FullPaths[i].replace(/^Root Entry\//, '');
	// CFB adds a placeholder file of its own, "\u0001Sh33tJ5", to every container it reads.
	return container.FileIndex.flatMap((file: { type: number; content: Uint8Array }, i: number) =>
		file.type === 2 && !name(i).startsWith('\u0001') ? [{ name: name(i), content: file.content }] : []
	);
})();
const unzippedBytes = parts.reduce((total, part) => total + part.content.length, 0);
const SHEET = 'xl/worksheets/sheet1.xml';
const withPart = (name: string, change: Partial<Part>) =>
	parts.map((part) => (part.name === name ? { ...part, ...change } : part));
const junk = (change: Partial<Part>): Part[] => [
	...parts,
	{ name: 'xl/media/image1.png', content: new Uint8Array(1024 * 1024), ...change }
];

const outcome = (bytes: ArrayBuffer, limits: Partial<ReadLimits> = {}, fileName = 'test.xlsx') =>
	readWorkbook(bytes, fileName, limits).then(
		() => 'ok',
		(error) => (error.name === 'WorkbookReadError' ? `${error.code}: ${error.message}` : `unexpected: ${error}`)
	);
/** The guard's own message; SheetJS failures read "could not be read", so a match proves the guard caught it. */
const DAMAGED = 'corrupt: "test.xlsx" is not a valid .xlsx workbook; the file may be damaged.';

describe('readWorkbook zip-bomb guard', () => {
	it('rejects a workbook that would unzip past maxUncompressedBytes', async () => {
		expect(await outcome(workbook, { maxUncompressedBytes: unzippedBytes - 1 }, 'small.xlsx')).toMatch(
			/^too-large: "small\.xlsx" would expand to [\d.]+ MB when unzipped; the limit is [\d.]+ MB\. The file may be damaged or deliberately oversized\.$/
		);
		expect(await outcome(workbook, { maxUncompressedBytes: unzippedBytes })).toBe('ok');
	});

	it('rejects a central directory declaring 5 GB before inflating or allocating anything', async () => {
		// The local header declares 5 GB too, which SheetJS would allocate up front.
		const size = 5 * 1024 ** 3;
		const bytes = zip([{ name: 'xl/media/image1.png', content: new Uint8Array(16), size, zip64: true }]);
		const before = process.memoryUsage().arrayBuffers;
		expect(await outcome(bytes, {}, 'bomb.xlsx')).toBe(
			'too-large: "bomb.xlsx" would expand to 5120 MB when unzipped; the limit is 200 MB. The file may be damaged or deliberately oversized.'
		);
		expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
	});

	// Above each case: what SheetJS 0.20.3 does with it when nothing checks first.
	it.each<[string, Part[]]>([
		// Reads the sheet's rows without their cells, and no error.
		['an entry declaring less than it holds', withPart(SHEET, { size: 100 })],
		// Inflates the whole entry into a buffer that keeps growing, and no error.
		['an entry declaring 0 bytes', junk({ size: 0 })],
		// Allocates the local header's size before reading any data, then throws.
		['a local header declaring more than the central directory', junk({ localSize: 1024 ** 3 })],
		// Copies the stored bytes, whatever size is declared.
		['a stored entry declaring a size other than its bytes', junk({ stored: true, size: 1024 })],
		// Copies as many bytes as the local header declares, then throws.
		['a local header declaring another compressed size', junk({ stored: true, localCompressedSize: 2 * 1024 ** 2 })],
		// Copies what is left of the file, and no error.
		[
			'a stored entry running past the end of the file',
			junk({ stored: true, size: 2 * 1024 ** 2, compressedSize: 2 * 1024 ** 2 })
		]
	])('rejects %s as corrupt before SheetJS unzips it', async (_, spoofed) => {
		expect(await outcome(zip(spoofed))).toBe(DAMAGED);
	});

	it('accepts zips that declare their sizes truthfully, streamed or in ZIP64 fields', async () => {
		expect(await outcome(zip(parts))).toBe('ok');
		expect(await outcome(zip(parts.map((part) => ({ ...part, streamed: true }))))).toBe('ok');
		expect(await outcome(zip(parts.map((part) => ({ ...part, zip64: true }))))).toBe('ok');
		expect(await outcome(zip(junk({ stored: true })))).toBe('ok');
	});

	it('reports a missing or unreadable central directory, or an entry without a local header, as corrupt', async () => {
		const end = workbook.byteLength - 22;
		const patched = (offset: number, value: number) => {
			const copy = workbook.slice(0);
			new DataView(copy).setUint32(offset, value, true);
			return copy;
		};
		const directory = new DataView(workbook).getUint32(end + 16, true);
		expect(await outcome(workbook.slice(0, end))).toBe(DAMAGED);
		expect(await outcome(patched(end + 16, workbook.byteLength))).toBe(DAMAGED);
		expect(await outcome(patched(directory + 42, workbook.byteLength))).toBe(DAMAGED);
	});
});
