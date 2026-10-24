/**
 * State of one import in the review window: the file's parsed WorkbookModel, the user's Overrides, and the
 * WorkbookAnalysis they produce.
 *
 * The workbook is read once. Every correction (column remap, decision choice, verified AI table) builds new
 * Overrides and re-runs analyze() on the kept model, so the preview recomputes without rereading the file.
 * The pipeline sits behind ImportEngine so the session can be tested against a mock without SheetJS or a network.
 */
import { browser } from '$app/environment';
import {
	buildInterpretationRequest,
	createHttpInterpreter,
	getAiAvailability,
	verifyInterpretation,
	type AiAvailability
} from './ai';
import { analyze } from './analyze';
import {
	WorkbookReadError,
	type Field,
	type MappingInput,
	type Overrides,
	type SheetAnalysis,
	type VerificationResult,
	type WorkbookAnalysis,
	type WorkbookModel
} from './model';
import { readWorkbook } from './reader';
import { toMappingInputs } from './validate';

export type ImportPhase = 'idle' | 'reading' | 'analyzing' | 'ready' | 'importing' | 'done' | 'error';

/** Pipeline entry points the session drives. */
export type ImportEngine = {
	read(file: File): Promise<WorkbookModel>;
	analyze(model: WorkbookModel, existing: MappingInput[], overrides: Overrides): WorkbookAnalysis;
	toMappingInputs(analysis: WorkbookAnalysis): MappingInput[];
	aiAvailability(): Promise<AiAvailability>;
	/** Sends the sheets that asked for help to the interpreter and verifies its answer against the workbook. */
	interpret(
		model: WorkbookModel,
		sheets: SheetAnalysis[],
		signal: AbortSignal
	): Promise<{ sent: string[]; result: VerificationResult }>;
};

export const pipelineEngine: ImportEngine = {
	read: async (file) => readWorkbook(await file.arrayBuffer(), file.name),
	analyze,
	toMappingInputs,
	aiAvailability: () => getAiAvailability(),
	async interpret(model, sheets, signal) {
		const request = buildInterpretationRequest(model, sheets);
		const sent = request.sheets.map((sheet) => sheet.name);
		// Sampling can leave nothing worth sending (e.g. every triggered sheet is empty); skip the request then.
		if (sent.length === 0) return { sent, result: { tables: [], rejected: [] } };
		const interpretation = await createHttpInterpreter().interpret(request, signal);
		return { sent, result: verifyInterpretation(model, request, interpretation) };
	}
};

export type AiRun = {
	status: 'running' | 'done' | 'error';
	/** Names of the sheets sent for interpretation. */
	sheets: string[];
	result: VerificationResult | null;
	error: string | null;
};

const aiPreferenceKey = 'nsn-upload-interview-task:ai-assistance';

export class ImportSession {
	phase = $state<ImportPhase>('idle');
	fileName = $state('');
	error = $state('');
	// Raw state: the model holds functions and Sets, and an analysis can hold thousands of records,
	// so deep proxies would only cost time. Both are replaced wholesale, never mutated.
	model = $state.raw<WorkbookModel | null>(null);
	overrides = $state.raw<Overrides>({});
	analysis = $state.raw<WorkbookAnalysis | null>(null);
	importedCount = $state(0);

	aiEnabled = $state(false);
	/** Null until the availability check returns. */
	aiAvailability = $state.raw<AiAvailability | null>(null);
	aiRun = $state.raw<AiRun | null>(null);

	busy = $derived(
		this.phase === 'reading' || this.phase === 'analyzing' || this.phase === 'importing'
	);

	#engine: ImportEngine;
	#existing: MappingInput[] = [];
	#aiAbort: AbortController | null = null;

	constructor(engine: ImportEngine = pipelineEngine) {
		this.#engine = engine;
	}

	/** Restores the AI preference and checks availability once. Browser only. */
	async initAi() {
		if (!browser || this.aiAvailability) return;
		this.aiEnabled = localStorage.getItem(aiPreferenceKey) === 'on';
		try {
			this.aiAvailability = await this.#engine.aiAvailability();
		} catch {
			this.aiAvailability = { available: false, reason: 'The AI service could not be reached.' };
		}
		void this.#interpretIfNeeded();
	}

	async load(file: File, existing: MappingInput[]) {
		this.reset();
		this.fileName = file.name;
		this.#existing = existing;
		this.phase = 'reading';
		try {
			const model = await this.#engine.read(file);
			this.model = model;
			this.phase = 'analyzing';
			// analyze() is synchronous; let the "Analyzing" state paint before it blocks the main thread.
			await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
			this.analysis = this.#engine.analyze(model, existing, this.overrides);
			this.phase = 'ready';
		} catch (error) {
			this.error =
				error instanceof WorkbookReadError
					? error.message
					: `This workbook could not be analyzed: ${error instanceof Error ? error.message : String(error)}`;
			this.phase = 'error';
			return;
		}
		void this.#interpretIfNeeded();
	}

	reset() {
		this.#aiAbort?.abort();
		this.phase = 'idle';
		this.fileName = '';
		this.error = '';
		this.model = null;
		this.overrides = {};
		this.analysis = null;
		this.importedCount = 0;
		this.aiRun = null;
	}

	/** Maps a column to a field, or to null to ignore it. The pipeline unmaps any other column using that field. */
	setColumn(tableId: string, col: number, field: Field | null) {
		const columns = this.overrides.columns ?? {};
		this.#apply({
			...this.overrides,
			columns: { ...columns, [tableId]: { ...columns[tableId], [col]: field } }
		});
	}

	resetColumn(tableId: string, col: number) {
		const { [col]: _, ...rest } = this.overrides.columns?.[tableId] ?? {};
		this.#apply({ ...this.overrides, columns: { ...this.overrides.columns, [tableId]: rest } });
	}

	choose(decisionId: string, option: string) {
		this.#apply({ ...this.overrides, decisions: { ...this.overrides.decisions, [decisionId]: option } });
	}

	/** Drops the user's choice so the decision falls back to its policy (auto) or back to pending. */
	resetDecision(decisionId: string) {
		const { [decisionId]: _, ...rest } = this.overrides.decisions ?? {};
		this.#apply({ ...this.overrides, decisions: rest });
	}

	acceptAllSuggestions() {
		const pending = this.analysis?.decisions.filter((decision) => decision.state === 'pending') ?? [];
		if (pending.length === 0) return;
		const decisions = { ...this.overrides.decisions };
		for (const decision of pending) decisions[decision.id] = decision.suggested;
		this.#apply({ ...this.overrides, decisions });
	}

	setAiEnabled(enabled: boolean) {
		this.aiEnabled = enabled;
		if (browser) localStorage.setItem(aiPreferenceKey, enabled ? 'on' : 'off');
		if (enabled) {
			void this.#interpretIfNeeded();
			return;
		}
		// Off means deterministic only: stop any request and drop tables the AI proposed.
		this.#aiAbort?.abort();
		this.aiRun = null;
		if (this.overrides.aiTables) {
			const { aiTables: _, ...rest } = this.overrides;
			this.#apply(rest);
		}
	}

	async import(onImport: (inputs: MappingInput[]) => number) {
		if (!this.analysis) return;
		this.phase = 'importing';
		this.importedCount = onImport(this.#engine.toMappingInputs(this.analysis));
		this.phase = 'done';
	}

	#apply(overrides: Overrides) {
		if (!this.model) return;
		this.overrides = overrides;
		this.analysis = this.#engine.analyze(this.model, this.#existing, overrides);
	}

	/** Sends sheets with an aiTrigger once per file, and only while the user has AI assistance on. */
	async #interpretIfNeeded() {
		const { model, analysis } = this;
		if (!this.aiEnabled || !this.aiAvailability?.available || !model || !analysis || this.aiRun) return;
		const triggered = analysis.sheets.filter((sheet) => sheet.aiTrigger && sheet.status !== 'hidden');
		if (triggered.length === 0) return;

		const abort = new AbortController();
		this.#aiAbort = abort;
		const run: AiRun = {
			status: 'running',
			sheets: triggered.map((sheet) => sheet.name),
			result: null,
			error: null
		};
		this.aiRun = run;
		try {
			const { sent, result } = await this.#engine.interpret(model, analysis.sheets, abort.signal);
			if (abort.signal.aborted) return;
			this.aiRun = { ...run, status: 'done', sheets: sent, result };
			this.#apply({ ...this.overrides, aiTables: result.tables });
		} catch (error) {
			if (abort.signal.aborted) return;
			this.aiRun = {
				...run,
				status: 'error',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
}
