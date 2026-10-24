/**
 * Zip-bomb checks on the .xlsx container, run before SheetJS unzips anything.
 *
 * SheetJS 0.20.3 (`parse_zip` and `parse_local_file` in xlsx.mjs) inflates every entry the central directory lists,
 * sizes each output buffer from the entry's local header, and never compares a declared size with the data:
 * - a local header that declares more than the entry holds reserves all of it up front (a 6 KB file allocated 2 GB);
 * - a declared size of 0, which streamed zips write ahead of a data descriptor, lets the buffer grow for as long as
 *   the data inflates (a 300 KB entry grew to 513 MB);
 * - a declared size below the real one silently cuts the entry short (a sheet kept its rows and lost every cell).
 * So the caller first caps the sizes the central directory declares, then checks that every entry holds exactly
 * that. Sizes are read the way SheetJS reads them, so the checks bound what it will actually allocate.
 */

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const ZIP64_FIELD = 0x0001;
const STORED = 0;
const DEFLATED = 8;
/** Compressed bytes inflated per step. Deflate expands at most about 1,000x, so a step yields at most ~64 MB. */
const STEP = 64 * 1024;

/** A central directory entry, with ZIP64 sizes applied. */
export type ZipEntry = {
	/** Uncompressed size. */
	size: number;
	compressedSize: number;
	/** Offset of the entry's local file header. */
	headerOffset: number;
};

/** The entries SheetJS will unzip, or null when the central directory is missing or unreadable. */
export function readCentralDirectory(bytes: Uint8Array): ZipEntry[] | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// Like SheetJS, use the last end-of-central-directory signature in the file.
	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== END_OF_DIRECTORY) end--;
	if (end < 0) return null;

	// SheetJS reads only this disk's entry count and the directory offset.
	const count = view.getUint16(end + 8, true);
	let at = view.getUint32(end + 16, true);
	const entries: ZipEntry[] = [];
	try {
		for (let i = 0; i < count; i++) {
			if (view.getUint32(at, true) !== DIRECTORY_ENTRY) return null;
			const extraStart = at + 46 + view.getUint16(at + 28, true);
			const extraEnd = extraStart + view.getUint16(at + 30, true);
			const zip64 = zip64Sizes(bytes.subarray(extraStart, extraEnd));
			entries.push({
				size: zip64.size || view.getUint32(at + 24, true),
				compressedSize: zip64.compressedSize || view.getUint32(at + 20, true),
				headerOffset: view.getUint32(at + 42, true)
			});
			at = extraEnd + view.getUint16(at + 32, true);
		}
	} catch {
		// DataView throws a RangeError past the end of the file.
		return null;
	}
	return entries;
}

/**
 * Whether every entry's local header agrees with its central directory sizes and its data inflates to exactly the
 * declared size. Each entry stops inflating once it passes its declared size, and nothing inflated is kept, so this
 * never does more work than the declared total the caller has already capped.
 */
export async function holdsDeclaredSizes(bytes: Uint8Array<ArrayBuffer>, entries: ZipEntry[]): Promise<boolean> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (const { size, compressedSize, headerOffset: at } of entries) {
		// Like SheetJS, read the local header wherever the directory points, without checking its signature.
		if (at + 30 > bytes.length) return false;
		const extraStart = at + 30 + view.getUint16(at + 26, true);
		const dataStart = extraStart + view.getUint16(at + 28, true);
		const zip64 = zip64Sizes(bytes.subarray(extraStart, dataStart));
		// SheetJS allocates the local header's size up front; 0, as streamed zips write, makes it grow the buffer.
		const localSize = zip64.size || view.getUint32(at + 22, true);
		const localCompressedSize = zip64.compressedSize || view.getUint32(at + 18, true);
		if (localSize !== 0 && localSize !== size) return false;
		if (localCompressedSize !== 0 && localCompressedSize !== compressedSize) return false;

		const data = bytes.subarray(dataStart, dataStart + compressedSize);
		if (data.length !== compressedSize) return false;
		// SheetJS uses the local header's method. It rejects any other method itself.
		const method = view.getUint16(at + 8, true);
		if (method === STORED && compressedSize !== size) return false;
		if (method === DEFLATED && !(await inflatesTo(data, size))) return false;
	}
	return true;
}

/**
 * Sizes from the last ZIP64 extended-information field in `extra`, 0 where absent. Read exactly as SheetJS's
 * `parse_extra_field` reads them: both sizes come from the field's first 16 bytes even when it is shorter, and bytes
 * past the end of `extra` read as 0.
 */
function zip64Sizes(extra: Uint8Array): { size: number; compressedSize: number } {
	const u16 = (at: number) => (extra[at] ?? 0) | ((extra[at + 1] ?? 0) << 8);
	const u32 = (at: number) => (u16(at) | (u16(at + 2) << 16)) >>> 0;
	const u64 = (at: number) => u32(at) + u32(at + 4) * 2 ** 32;
	let sizes = { size: 0, compressedSize: 0 };
	for (let at = 0; at + 4 <= extra.length; at += 4 + u16(at + 2)) {
		if (u16(at) === ZIP64_FIELD) sizes = { size: u64(at + 4), compressedSize: u64(at + 12) };
	}
	return sizes;
}

/** Whether raw-deflate `data` is one complete stream that inflates to exactly `size` bytes. */
async function inflatesTo(data: Uint8Array<ArrayBuffer>, size: number): Promise<boolean> {
	let offset = 0;
	// Fed one step at a time, so backpressure holds at most about one step's output in memory.
	const steps = new ReadableStream<Uint8Array<ArrayBuffer>>({
		pull(controller) {
			if (offset >= data.length) controller.close();
			else controller.enqueue(data.subarray(offset, (offset += STEP)));
		}
	});
	// Outside the try: a browser without 'deflate-raw' support should fail loudly, not report the file as damaged.
	const output = steps.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
	let inflated = 0;
	try {
		for (let chunk = await output.read(); !chunk.done; chunk = await output.read()) {
			inflated += chunk.value.byteLength;
			if (inflated > size) {
				await output.cancel();
				return false;
			}
		}
	} catch {
		// Truncated or not deflate at all.
		return false;
	}
	return inflated === size;
}
