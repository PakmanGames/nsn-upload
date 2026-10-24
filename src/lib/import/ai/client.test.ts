import { describe, expect, it, vi } from 'vitest';
import type { InterpretationRequest, WorkbookInterpretation } from '../model';
import { createHttpInterpreter, getAiAvailability, InterpretationError } from './client';
import { MockInterpreter } from './mock';

const request: InterpretationRequest = {
	fileName: 'parts.xlsx',
	sheets: [
		{ name: 'Parts', extent: 'A1:B2', merges: [], reason: 'trigger', cells: [['A1', 'NSN']] }
	]
};
const interpretation: WorkbookInterpretation = {
	tables: [
		{
			sheetName: 'Parts',
			range: 'A1:B2',
			headerRows: [1],
			columns: [{ field: 'nsn', col: 1, headerText: 'NSN' }],
			confidence: 0.9,
			reasons: []
		}
	]
};

const reply = (body: unknown, status = 200) =>
	vi.fn<typeof fetch>(async () => Response.json(body, { status }));

describe('createHttpInterpreter', () => {
	it('posts the request to /api/interpret with the abort signal', async () => {
		const fetchMock = reply(interpretation);
		const signal = new AbortController().signal;

		const result = await createHttpInterpreter(fetchMock).interpret(request, signal);

		expect(result).toEqual(interpretation);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/interpret');
		expect(init).toMatchObject({ method: 'POST', signal });
		expect(JSON.parse(init!.body as string)).toEqual(request);
	});

	it("throws the route's error code and message", async () => {
		const fetchMock = reply({ code: 'ai-unavailable', message: 'Not configured' }, 503);

		const error = await createHttpInterpreter(fetchMock)
			.interpret(request)
			.catch((e) => e);

		expect(error).toBeInstanceOf(InterpretationError);
		expect(error).toMatchObject({ code: 'ai-unavailable', message: 'Not configured' });
	});

	it('rejects a reply that is not a valid interpretation', async () => {
		const fetchMock = reply({ tables: [{ sheetName: 'Parts' }] });

		await expect(createHttpInterpreter(fetchMock).interpret(request)).rejects.toMatchObject({
			code: 'ai-invalid-response'
		});
	});
});

describe('getAiAvailability', () => {
	it('returns what the route reports', async () => {
		const fetchMock = reply({ available: false, reason: 'No key' });

		expect(await getAiAvailability(fetchMock)).toEqual({ available: false, reason: 'No key' });
		expect(fetchMock).toHaveBeenCalledWith('/api/interpret');
	});

	it('reports unavailable when the route cannot be reached', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => {
			throw new TypeError('Failed to fetch');
		});

		expect(await getAiAvailability(fetchMock)).toEqual({
			available: false,
			reason: 'AI service is unreachable'
		});
	});
});

describe('MockInterpreter', () => {
	it('returns canned results and honors an aborted signal', async () => {
		const interpreter = new MockInterpreter(interpretation);

		expect(await interpreter.interpret(request)).toEqual(interpretation);
		await expect(interpreter.interpret(request, AbortSignal.abort())).rejects.toThrow();
	});
});
