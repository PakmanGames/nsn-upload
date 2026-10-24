import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionId } from '$lib/import/model';
import { ImportSession, type ImportEngine } from '$lib/import/session.svelte';
import { mockEngine } from './mock-analysis';

const xlsx = () => new File(['x'], 'parts.xlsx');

function spyEngine() {
	return { ...mockEngine, read: vi.fn(mockEngine.read), interpret: vi.fn(mockEngine.interpret) };
}

describe('ImportSession', () => {
	beforeEach(() => {
		// load() waits for a frame so the analyzing state can paint; node has no frames.
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback));
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	async function loaded(engine: ImportEngine = mockEngine) {
		const session = new ImportSession(engine);
		const loading = session.load(xlsx(), []);
		await vi.runAllTimersAsync();
		await loading;
		return session;
	}

	it('reads once, analyzes, and reaches ready', async () => {
		const engine = spyEngine();
		const session = await loaded(engine);
		expect(session.phase).toBe('ready');
		expect(session.fileName).toBe('parts.xlsx');
		expect(session.analysis?.records.length).toBeGreaterThan(0);
		expect(engine.read).toHaveBeenCalledTimes(1);
	});

	it('shows a read error message verbatim', async () => {
		const session = new ImportSession(mockEngine);
		const loading = session.load(new File(['x'], 'parts.csv'), []);
		await vi.runAllTimersAsync();
		await loading;
		expect(session.phase).toBe('error');
		expect(session.error).toBe('"parts.csv" is not an .xlsx workbook. Save it as Excel Workbook (.xlsx) and try again.');
	});

	it('recomputes a column remap without rereading the file', async () => {
		const engine = spyEngine();
		const session = await loaded(engine);
		session.setColumn('Sheet1@1', 2, 'part');
		const columns = session.analysis!.sheets.find((sheet) => sheet.name === 'Sheet1')!.tables[0].columns;
		expect(columns[1]).toMatchObject({ field: 'part', overridden: true });
		expect(columns[0].field).toBeNull();
		expect(engine.read).toHaveBeenCalledTimes(1);

		session.resetColumn('Sheet1@1', 2);
		expect(session.analysis!.sheets.find((sheet) => sheet.name === 'Sheet1')!.tables[0].columns[0].field).toBe('part');
	});

	it('accepts every suggestion in one step, and a revert brings a decision back to pending', async () => {
		const session = await loaded();
		const before = session.analysis!.summary;
		expect(before.pendingDecisions).toBeGreaterThan(0);

		session.acceptAllSuggestions();
		expect(session.analysis!.summary.pendingDecisions).toBe(0);
		expect(session.analysis!.summary.toImport).toBeGreaterThan(before.toImport);

		const id = decisionId('include-table', 'Search Log@2');
		session.resetDecision(id);
		expect(session.analysis!.decisions.find((decision) => decision.id === id)?.state).toBe('pending');
	});

	it('sends triggered sheets only while AI assistance is on, and drops AI tables when it is turned off', async () => {
		const engine = spyEngine();
		const session = await loaded(engine);
		expect(engine.interpret).not.toHaveBeenCalled();

		session.aiAvailability = { available: true };
		session.setAiEnabled(true);
		await vi.runAllTimersAsync();
		expect(engine.interpret).toHaveBeenCalledTimes(1);
		expect(session.aiRun).toMatchObject({ status: 'done', sheets: ['Search Log'] });
		expect(session.overrides.aiTables).toHaveLength(1);
		expect(session.analysis!.sheets.find((sheet) => sheet.name === 'Search Log')!.tables[0].source).toBe('ai');

		session.setAiEnabled(false);
		expect(session.aiRun).toBeNull();
		expect(session.overrides.aiTables).toBeUndefined();
		expect(session.analysis!.sheets.find((sheet) => sheet.name === 'Search Log')!.tables[0].source).toBe('deterministic');
	});

	it('imports only approved records and reports the count', async () => {
		const session = await loaded();
		const onImport = vi.fn((inputs: unknown[]) => inputs.length);
		await session.import(onImport);
		expect(session.phase).toBe('done');
		expect(session.importedCount).toBe(session.analysis!.summary.toImport);
		expect(onImport.mock.calls[0][0]).toHaveLength(session.analysis!.summary.toImport);
	});
});
