import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionId, type ImportPlan } from '$lib/import/model';
import { ImportSession, type ImportEngine } from '$lib/import/session.svelte';
import { mockEngine } from './mock-analysis';

const xlsx = () => new File(['x'], 'parts.xlsx');

function spyEngine() {
	return {
		...mockEngine,
		read: vi.fn(mockEngine.read),
		interpret: vi.fn(mockEngine.interpret),
		aiAvailability: vi.fn(mockEngine.aiAvailability)
	};
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

	it('re-analyzes with a row unchecked, and without it once checked again', async () => {
		const engine = { ...spyEngine(), analyze: vi.fn(mockEngine.analyze) };
		const session = await loaded(engine);
		session.setRecordExcluded('Sheet1@1:r2', true);
		session.setRecordExcluded('Sheet1@1:r5', true);
		expect(engine.analyze).toHaveBeenLastCalledWith(session.model, [], { excludedRecords: ['Sheet1@1:r2', 'Sheet1@1:r5'] });

		session.setRecordExcluded('Sheet1@1:r2', false);
		expect(session.overrides.excludedRecords).toEqual(['Sheet1@1:r5']);
		expect(engine.read).toHaveBeenCalledTimes(1);
	});

	it('sets up a table by hand in place of earlier column choices for the same table, and removes it again', async () => {
		const engine = { ...spyEngine(), analyze: vi.fn(mockEngine.analyze) };
		const session = await loaded(engine);
		const spec = { headerRows: [], range: { top: 1, left: 1, bottom: 99, right: 1 }, columns: { 1: 'nsn' as const } };
		session.setColumn('Sheet1@1', 2, 'part');
		session.setColumn('Search Log@2', 2, null);

		session.setManualTable('Sheet1', spec);
		// The column choice was made for the detected Sheet1@1, which the table set up by hand replaces.
		expect(session.overrides).toEqual({
			columns: { 'Search Log@2': { 2: null } },
			manualTables: [{ ...spec, sheet: 'Sheet1' }]
		});
		expect(engine.analyze).toHaveBeenLastCalledWith(session.model, [], session.overrides);

		session.setColumn('Sheet1@1', 1, 'niin');
		session.removeManualTable('Sheet1');
		// Changes made to the table set up by hand leave with it, so detection takes over as it was.
		expect(session.overrides).toEqual({ columns: { 'Search Log@2': { 2: null } } });
		expect(engine.read).toHaveBeenCalledTimes(1);
	});

	it('keeps the spreadsheet focus across re-analysis and clears it for another file', async () => {
		const session = await loaded();
		const focus = { sheet: 'Sheet1', ranges: [{ top: 2, left: 1, bottom: 2, right: 3 }] };
		session.focus = focus;
		// The cells do not move when a mapping changes, so the highlight stays.
		session.setColumn('Sheet1@1', 2, 'part');
		expect(session.focus).toBe(focus);

		session.reset();
		expect(session.focus).toBeNull();
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

	it('applies one option to several decisions in one re-analysis, and remembers them as a group', async () => {
		const engine = { ...spyEngine(), analyze: vi.fn(mockEngine.analyze) };
		const session = await loaded(engine);
		const [first, second] = session.analysis!.decisions.filter((decision) => decision.state === 'pending');
		const ids = [first.id, second.id];
		engine.analyze.mockClear();

		session.chooseMany(ids, 'exclude-row');
		expect(engine.analyze).toHaveBeenCalledTimes(1);
		expect(session.overrides.decisions).toEqual({ [first.id]: 'exclude-row', [second.id]: 'exclude-row' });
		expect(session.decisionGroups).toEqual([{ ids, option: 'exclude-row' }]);
		expect(engine.read).toHaveBeenCalledTimes(1);
	});

	it('reverts a group in one re-analysis, leaving other choices alone', async () => {
		const engine = { ...spyEngine(), analyze: vi.fn(mockEngine.analyze) };
		const session = await loaded(engine);
		const pending = session.analysis!.decisions.filter((decision) => decision.state === 'pending');
		const [a, b, c] = pending.map((decision) => decision.id);
		session.chooseMany([a, b], pending[0].suggested);
		session.choose(c, pending[2].suggested);
		engine.analyze.mockClear();

		session.resetDecisions([a, b]);
		expect(engine.analyze).toHaveBeenCalledTimes(1);
		expect(session.overrides.decisions).toEqual({ [c]: pending[2].suggested });
		expect(session.decisionGroups).toEqual([]);
		for (const id of [a, b]) {
			expect(session.analysis!.decisions.find((decision) => decision.id === id)?.state).toBe('pending');
		}
	});

	it('moves a decision to the group it was last applied with, and drops groups of one', async () => {
		const session = await loaded();
		const [a, b, c] = session.analysis!.decisions.filter((decision) => decision.state === 'pending').map((d) => d.id);
		session.chooseMany([a, b], 'x');
		session.chooseMany([b, c], 'y');
		expect(session.decisionGroups).toEqual([{ ids: [b, c], option: 'y' }]);

		session.resetDecisions([c]);
		expect(session.decisionGroups).toEqual([]);
		session.chooseMany([a, b], 'x');
		session.reset();
		expect(session.decisionGroups).toEqual([]);
	});

	it('makes no AI request, not even the availability check, until AI assistance is turned on', async () => {
		const engine = spyEngine();
		const session = await loaded(engine);
		session.initAi();
		await vi.runAllTimersAsync();
		expect(engine.aiAvailability).not.toHaveBeenCalled();
		expect(engine.interpret).not.toHaveBeenCalled();
		expect(session.aiAvailability).toBeNull();
	});

	it('turns the switch back off with the reason when AI is unavailable', async () => {
		const engine = { ...spyEngine(), aiAvailability: vi.fn(async () => ({ available: false, reason: 'No key' })) };
		const session = await loaded(engine);
		await session.setAiEnabled(true);
		expect(session.aiEnabled).toBe(false);
		expect(session.aiAvailability).toEqual({ available: false, reason: 'No key' });
		expect(engine.interpret).not.toHaveBeenCalled();
	});

	it('sends triggered sheets only while AI assistance is on, and drops AI tables when it is turned off', async () => {
		const engine = spyEngine();
		const session = await loaded(engine);
		expect(engine.interpret).not.toHaveBeenCalled();

		const enabling = session.setAiEnabled(true);
		await vi.runAllTimersAsync();
		await enabling;
		expect(engine.aiAvailability).toHaveBeenCalledTimes(1);
		expect(engine.interpret).toHaveBeenCalledTimes(1);
		expect(session.aiRun).toMatchObject({ status: 'done', sheets: ['Search Log'] });
		expect(session.overrides.aiTables).toHaveLength(1);
		expect(session.analysis!.sheets.find((sheet) => sheet.name === 'Search Log')!.tables[0].source).toBe('ai');

		session.setAiEnabled(false);
		expect(session.aiRun).toBeNull();
		expect(session.overrides.aiTables).toBeUndefined();
		expect(session.analysis!.sheets.find((sheet) => sheet.name === 'Search Log')!.tables[0].source).toBe('deterministic');
	});

	it('imports only approved records as additions', async () => {
		const session = await loaded();
		const onImport = vi.fn<(plan: ImportPlan) => void>();
		session.import(onImport);
		expect(session.phase).toBe('done');
		expect(onImport.mock.calls[0][0].add).toHaveLength(session.analysis!.summary.toImport);
		expect(onImport.mock.calls[0][0].replace).toEqual([]);
		expect(session.imported).toBe(onImport.mock.calls[0][0]);
	});

	it('replaces the saved record when a storage conflict is resolved with replace-saved', async () => {
		const session = await loaded();
		const conflict = session.analysis!.decisions.find((decision) => decision.kind === 'resolve-storage-conflict')!;
		session.choose(conflict.id, 'replace-saved');
		const onImport = vi.fn<(plan: ImportPlan) => void>();
		session.import(onImport);
		const plan = onImport.mock.calls[0][0];
		expect(plan.replace).toEqual([
			{ id: 'demo-1', input: expect.objectContaining({ part: 'M30294', description: 'Bolt, hexagon head' }) }
		]);
		expect(plan.add.length + plan.replace.length).toBe(session.analysis!.summary.toImport);
	});
});
