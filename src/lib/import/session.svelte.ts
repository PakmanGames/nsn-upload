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
import { createHttpExplainer, hashText } from './ai/explain-client';
import { EXPLAIN_LIMITS, boundedItem } from './ai/explain-schema';
import { verifyExplanations, type ExplanationVerification, type VerifiableItem } from './ai/explain-verify';
import { analyze } from './analyze';
import { explainDecision, explainIssue, type Explanation } from './explain';
import {
	WorkbookReadError,
	type CellRange,
	type CandidateRecord,
	type Field,
	type ImportPlan,
	type Issue,
	type Overrides,
	type SheetAnalysis,
	type StoredMapping,
	type TableSpec,
	type VerificationResult,
	type WorkbookAnalysis,
	type WorkbookModel
} from './model';
import { readWorkbook } from './reader';
import { tableId } from './structure/table';
import { toImportPlan } from './validate';

export type ImportPhase = 'idle' | 'reading' | 'analyzing' | 'ready' | 'importing' | 'done' | 'error';

/** Pipeline entry points the session drives. */
export type ImportEngine = {
	read(file: File): Promise<WorkbookModel>;
	analyze(model: WorkbookModel, existing: StoredMapping[], overrides: Overrides): WorkbookAnalysis;
	toImportPlan(analysis: WorkbookAnalysis): ImportPlan;
	aiAvailability(): Promise<AiAvailability>;
	/** Sends the sheets that asked for help to the interpreter and verifies its answer against the workbook. */
	interpret(
		model: WorkbookModel,
		sheets: SheetAnalysis[],
		signal: AbortSignal
	): Promise<{ sent: string[]; result: VerificationResult }>;
	/** Asks for clearer wording of decisions from their facts, and checks each answer against those facts. */
	explain(items: VerifiableItem[], signal: AbortSignal): Promise<ExplanationVerification>;
};

export const pipelineEngine: ImportEngine = {
	read: async (file) => readWorkbook(await file.arrayBuffer(), file.name),
	analyze,
	toImportPlan,
	aiAvailability: () => getAiAvailability(),
	async interpret(model, sheets, signal) {
		const request = buildInterpretationRequest(model, sheets);
		const sent = request.sheets.map((sheet) => sheet.name);
		// Sampling can leave nothing worth sending (e.g. every triggered sheet is empty); skip the request then.
		if (sent.length === 0) return { sent, result: { tables: [], rejected: [] } };
		const interpretation = await createHttpInterpreter().interpret(request, signal);
		return { sent, result: verifyInterpretation(model, request, interpretation) };
	},
	async explain(items, signal) {
		// Option labels stay in the browser: the verifier needs them, the model does not.
		const request = { items: items.map(({ options: _, ...item }) => item) };
		return verifyExplanations(items, await createHttpExplainer().explain(request, signal));
	}
};

/** Decisions one option was applied to at once ("Also apply ... to the 11 other rows"). */
export type DecisionGroup = { ids: string[]; option: string };

export type AiRun = {
	status: 'running' | 'done' | 'error';
	/** Names of the sheets sent for interpretation. */
	sheets: string[];
	result: VerificationResult | null;
	error: string | null;
};

/**
 * Cells on one sheet that the spreadsheet view brings into view and highlights. Anything in the review that refers
 * to cells can set it; the view only reads it.
 */
export type SheetFocus = {
	sheet: string;
	/** In reading order; the view scrolls to the first, or to all of them when they fit. */
	ranges: CellRange[];
	/** What the cells are, e.g. "Active Parts row 136", announced to screen readers. */
	reason?: string;
};

/** The latest request for AI wording of decision explanations. */
export type ExplainRun = {
	/** failed: the request did not complete; the plain wording stays and nothing is retried for this file. */
	status: 'running' | 'done' | 'failed';
	/** Decisions in the request. */
	sent: number;
};

const aiPreferenceKey = 'nsn-upload-interview-task:ai-assistance';

/** The overrides without the column choices stored for one table. */
function withoutColumns(overrides: Overrides, id: string): Overrides {
	if (!overrides.columns?.[id]) return overrides;
	const { [id]: _, ...columns } = overrides.columns;
	return { ...overrides, columns };
}

/** Cache key of an explanation: the decision and everything the wording was written from. */
const explanationKey = (decisionId: string, { facts, headline, body }: Explanation) =>
	`${decisionId}#${hashText(JSON.stringify([facts, headline, body]))}`;

export class ImportSession {
	phase = $state<ImportPhase>('idle');
	fileName = $state('');
	error = $state('');
	// Raw state: the model holds functions and Sets, and an analysis can hold thousands of records,
	// so deep proxies would only cost time. Both are replaced wholesale, never mutated.
	model = $state.raw<WorkbookModel | null>(null);
	overrides = $state.raw<Overrides>({});
	analysis = $state.raw<WorkbookAnalysis | null>(null);
	/** What the last import added and replaced; null until an import ran. */
	imported = $state.raw<ImportPlan | null>(null);
	/** Cells the spreadsheet should bring into view and highlight; null shows nothing extra. */
	focus = $state.raw<SheetFocus | null>(null);
	/**
	 * Decisions applied together by chooseMany, so the review window can show and revert each set as one.
	 * A decision belongs to the last set it was applied with; one changed on its own keeps its place here.
	 */
	decisionGroups = $state.raw<DecisionGroup[]>([]);

	aiEnabled = $state(false);
	/** Null until checked, and it is only checked once the user has AI assistance on. */
	aiAvailability = $state.raw<AiAvailability | null>(null);
	aiRun = $state.raw<AiRun | null>(null);
	explainRun = $state.raw<ExplainRun | null>(null);

	busy = $derived(
		this.phase === 'reading' || this.phase === 'analyzing' || this.phase === 'importing'
	);

	/** AI wording by explanationKey(); null where the answer failed verification, so the plain wording stays. */
	#aiWording = $state.raw<ReadonlyMap<string, Explanation | null>>(new Map());
	/** The plain-language explanation of every decision, by decision id. */
	plainExplanations = $derived.by(
		() =>
			new Map(
				(this.analysis?.decisions ?? []).map((decision) => [
					decision.id,
					explainDecision(decision, this.analysis!, this.#existing)
				])
			)
	);

	/** What the review window shows for each decision: AI wording that passed its checks while AI is on, else the plain wording. */
	explanations = $derived.by(() => {
		if (!this.aiEnabled) return this.plainExplanations;
		const shown = new Map(this.plainExplanations);
		for (const [id, plain] of this.plainExplanations) {
			const wording = this.#aiWording.get(explanationKey(id, plain));
			if (wording) shown.set(id, wording);
		}
		return shown;
	});

	/** Current decisions that were sent for AI wording: how many show it, and how many kept the plain wording. */
	explainStats = $derived.by(() => {
		let ai = 0;
		let plain = 0;
		for (const [id, explanation] of this.plainExplanations) {
			const wording = this.#aiWording.get(explanationKey(id, explanation));
			if (wording) ai++;
			else if (wording === null) plain++;
		}
		return { ai, plain };
	});

	#engine: ImportEngine;
	#existing: StoredMapping[] = [];
	#aiAbort: AbortController | null = null;
	#aiChecked: Promise<AiAvailability> | null = null;
	#aiRestored = false;
	#explainAbort: AbortController | null = null;
	/** An analysis changed while a request was out; check again for new decisions once it is back. */
	#explainAgain = false;

	constructor(engine: ImportEngine = pipelineEngine) {
		this.#engine = engine;
	}

	/** Restores the saved AI preference once. Browser only, and no request unless the preference is on. */
	initAi() {
		if (!browser || this.#aiRestored) return;
		this.#aiRestored = true;
		if (localStorage.getItem(aiPreferenceKey) === 'on') void this.setAiEnabled(true);
	}

	async load(file: File, existing: StoredMapping[]) {
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
		void this.#interpretIfNeeded().then(() => this.#explainIfNeeded());
	}

	reset() {
		this.#aiAbort?.abort();
		this.#stopExplaining();
		this.explainRun = null;
		this.#aiWording = new Map();
		this.phase = 'idle';
		this.fileName = '';
		this.error = '';
		this.model = null;
		this.overrides = {};
		this.analysis = null;
		this.imported = null;
		this.focus = null;
		this.decisionGroups = [];
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

	/**
	 * Replaces detection on the sheet with a table the user set up by hand; it is included without a decision.
	 * Column choices stored under the same table id belonged to the table it replaces, so they are dropped.
	 */
	setManualTable(sheet: string, spec: TableSpec) {
		const manualTables = (this.overrides.manualTables ?? []).filter((table) => table.sheet !== sheet);
		this.#apply({
			...withoutColumns(this.overrides, tableId(sheet, spec)),
			manualTables: [...manualTables, { ...spec, sheet }]
		});
	}

	/** Drops the sheet's table set up by hand, with the column changes made to it, so detection takes over again. */
	removeManualTable(sheet: string) {
		const removed = this.overrides.manualTables?.find((table) => table.sheet === sheet);
		if (!removed) return;
		const { manualTables: _, ...rest } = withoutColumns(this.overrides, tableId(sheet, removed));
		const manualTables = this.overrides.manualTables!.filter((table) => table !== removed);
		this.#apply(manualTables.length > 0 ? { ...rest, manualTables } : rest);
	}

	choose(decisionId: string, option: string) {
		this.#apply({ ...this.overrides, decisions: { ...this.overrides.decisions, [decisionId]: option } });
	}

	/** Applies one option to several decisions in a single re-analysis, and remembers them as a group. */
	chooseMany(decisionIds: string[], option: string) {
		const decisions = { ...this.overrides.decisions };
		for (const id of decisionIds) decisions[id] = option;
		this.decisionGroups = [...this.#ungroup(decisionIds), { ids: decisionIds, option }];
		this.#apply({ ...this.overrides, decisions });
	}

	/** Unchecking a row in the preview keeps that record out of the import; checking it again brings it back. */
	setRecordExcluded(recordId: string, excluded: boolean) {
		const ids = new Set(this.overrides.excludedRecords);
		if (excluded) ids.add(recordId);
		else ids.delete(recordId);
		this.#apply({ ...this.overrides, excludedRecords: [...ids] });
	}

	/** Drops the user's choice so the decision falls back to its policy (auto) or back to pending. */
	/** Plain-language explanation of an issue on a record. Issues keep the rules wording: they can number in the hundreds. */
	issueExplanation = (issue: Issue, record: CandidateRecord): Explanation =>
		explainIssue(issue, record, this.analysis!, this.#existing);

	resetDecision(decisionId: string) {
		const { [decisionId]: _, ...rest } = this.overrides.decisions ?? {};
		this.#apply({ ...this.overrides, decisions: rest });
	}

	/** resetDecision for several decisions in a single re-analysis, e.g. reverting a group; they leave their groups. */
	resetDecisions(decisionIds: string[]) {
		const drop = new Set(decisionIds);
		const rest = Object.entries(this.overrides.decisions ?? {}).filter(([id]) => !drop.has(id));
		this.decisionGroups = this.#ungroup(decisionIds);
		this.#apply({ ...this.overrides, decisions: Object.fromEntries(rest) });
	}

	acceptAllSuggestions() {
		const pending = this.analysis?.decisions.filter((decision) => decision.state === 'pending') ?? [];
		if (pending.length === 0) return;
		const decisions = { ...this.overrides.decisions };
		for (const decision of pending) decisions[decision.id] = decision.suggested;
		this.#apply({ ...this.overrides, decisions });
	}

	async setAiEnabled(enabled: boolean) {
		this.aiEnabled = enabled;
		if (browser) localStorage.setItem(aiPreferenceKey, enabled ? 'on' : 'off');
		if (enabled) {
			// The availability check is a request too, so it waits until the user turns AI on (no transmission before).
			this.#aiChecked ??= this.#engine.aiAvailability();
			this.aiAvailability = await this.#aiChecked;
			// Unavailable: the switch goes back off and shows the reason; the saved preference stays as the user set it.
			if (!this.aiAvailability.available) this.aiEnabled = false;
			else {
				// A request that failed earlier gets one more try now that the user turned AI on again.
				if (this.explainRun?.status === 'failed') this.explainRun = null;
				await this.#interpretIfNeeded();
				void this.#explainIfNeeded();
			}
			return;
		}
		// Off means deterministic only: stop any request and drop tables the AI proposed. AI wording stays
		// cached for this file, unused until AI is on again.
		this.#aiAbort?.abort();
		this.aiRun = null;
		this.#stopExplaining();
		this.explainRun = null;
		if (this.overrides.aiTables) {
			const { aiTables: _, ...rest } = this.overrides;
			this.#apply(rest);
		}
	}

	/** Hands the plan to the caller, which adds new records and replaces the saved ones the user chose to overwrite. */
	import(onImport: (plan: ImportPlan) => void) {
		if (!this.analysis) return;
		this.phase = 'importing';
		const plan = this.#engine.toImportPlan(this.analysis);
		onImport(plan);
		this.imported = plan;
		this.phase = 'done';
	}

	/** The groups without these decisions; a group left with one decision is no group. */
	#ungroup(decisionIds: string[]): DecisionGroup[] {
		const drop = new Set(decisionIds);
		return this.decisionGroups
			.map((group) => ({ ...group, ids: group.ids.filter((id) => !drop.has(id)) }))
			.filter((group) => group.ids.length > 1);
	}

	#apply(overrides: Overrides) {
		if (!this.model) return;
		this.overrides = overrides;
		this.analysis = this.#engine.analyze(this.model, this.#existing, overrides);
		void this.#explainIfNeeded();
	}

	#stopExplaining() {
		this.#explainAbort?.abort();
		this.#explainAbort = null;
		this.#explainAgain = false;
	}

	/**
	 * One bounded request for AI wording of the decisions that have none cached: the first EXPLAIN_LIMITS.maxItems
	 * decisions, pending ones first. Waits for an interpretation in flight, since its tables change the decisions.
	 * Cached by decision and facts, so a re-analysis sends only what changed. Failure is quiet: the plain wording
	 * stays, the AI section notes it once, and nothing is retried for this file unless AI is turned off and on.
	 */
	async #explainIfNeeded() {
		const { analysis } = this;
		if (!this.aiEnabled || !this.aiAvailability?.available || !analysis || this.aiRun?.status === 'running') return;
		if (this.#explainAbort) {
			this.#explainAgain = true;
			return;
		}
		if (this.explainRun?.status === 'failed') return;
		const missing = analysis.decisions.slice(0, EXPLAIN_LIMITS.maxItems).flatMap((decision) => {
			const plain = this.plainExplanations.get(decision.id);
			return plain && !this.#aiWording.has(explanationKey(decision.id, plain)) ? [{ decision, plain }] : [];
		});
		if (missing.length === 0) return;

		const items: VerifiableItem[] = missing.map(({ decision, plain }, i) => ({
			...boundedItem(`d${i + 1}`, decision.kind, plain.facts, plain),
			options: decision.options.map((option) => option.label)
		}));
		const abort = new AbortController();
		this.#explainAbort = abort;
		this.explainRun = { status: 'running', sent: items.length };
		try {
			const result = await this.#engine.explain(items, abort.signal);
			if (abort.signal.aborted) return;
			const wording = new Map(this.#aiWording);
			missing.forEach(({ decision, plain }, i) => {
				const answer = result.explained.get(items[i].id);
				wording.set(explanationKey(decision.id, plain), answer ? { ...answer, facts: plain.facts, source: 'ai' } : null);
			});
			this.#aiWording = wording;
			this.explainRun = { status: 'done', sent: items.length };
		} catch {
			if (abort.signal.aborted) return;
			this.explainRun = { status: 'failed', sent: items.length };
		} finally {
			// Only the current request manages the queue; an aborted one may settle after a newer one started.
			if (this.#explainAbort === abort) {
				this.#explainAbort = null;
				if (this.#explainAgain) {
					this.#explainAgain = false;
					void this.#explainIfNeeded();
				}
			}
		}
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
