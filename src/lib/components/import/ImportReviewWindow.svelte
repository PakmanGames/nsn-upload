<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import Layers from '@lucide/svelte/icons/layers';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TableProperties from '@lucide/svelte/icons/table-properties';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import X from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/environment';
	import type { CandidateRecord, ColumnMapping, Field, ImportPlan, StoredMapping, TableCandidate } from '$lib/import/model';
	import { colLetter } from '$lib/import/refs';
	import { ImportSession, type SheetFocus } from '$lib/import/session.svelte';
	import AiAssist from './AiAssist.svelte';
	import AppliedDecisions from './AppliedDecisions.svelte';
	import ColumnsPanel from './ColumnsPanel.svelte';
	import DecisionStage from './DecisionStage.svelte';
	import PreviewPanel from './PreviewPanel.svelte';
	import ProvenanceDrawer from './ProvenanceDrawer.svelte';
	import Section from './Section.svelte';
	import SheetsPanel from './SheetsPanel.svelte';
	import SheetView from './sheet-view/SheetView.svelte';
	import SplitDivider from './sheet-view/SplitDivider.svelte';
	import Switch from './Switch.svelte';
	import { CHIP_STYLE, FIELD_LABEL, plural, recordLabel, type RecordFilter } from './labels';
	import { skippedGroups } from './skipped';
	import {
		activeRecords,
		aiActivity,
		aiOpenByDefault,
		aiSummary,
		columnsOpenByDefault,
		columnsSummary,
		heldBackGroups,
		heldBackTables,
		nothingToImport,
		rowsSummary,
		rowsTitle,
		sheetsSummary,
		statusChips,
		summaryParts,
		worthALook,
		type NextStep
	} from './summary';

	type Props = {
		open: boolean;
		/** Records already saved, so the analysis can flag duplicates against them. */
		existing: StoredMapping[];
		onClose: () => void;
		/** Adds the plan's new records and replaces the saved records it names. */
		onImport: (plan: ImportPlan) => void;
	};

	let { open, existing, onClose, onImport }: Props = $props();

	// The session outlives the dialog, so closing mid-review and reopening keeps the user's corrections.
	const session = new ImportSession();

	type SectionId = 'sheets' | 'columns' | 'rows' | 'auto' | 'ai';
	const SECTIONS: SectionId[] = ['sheets', 'columns', 'rows', 'auto', 'ai'];

	let previewScope = $state('all');
	let filter = $state<RecordFilter>('all');
	let drawerRecordId = $state<string | null>(null);
	/** Per table id: what the last remap did to another column. */
	let remapNotices = $state<Record<string, string>>({});
	/** Sections the user opened or closed; the others follow their open-by-default rule. Kept while the window is open. */
	let sectionOpen = $state<Partial<Record<SectionId, boolean>>>({});
	/** Decisions that needed the user at some point; once chosen they stay with the decision stage, not "Applied automatically". */
	const seenPending = new SvelteSet<string>();
	/** The sheet whose table is being set up by hand, shared with Sheets so the summary can open the setup. */
	let settingUp = $state<string | null>(null);
	let isDragActive = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let drawerOpener: HTMLElement | null = null;

	/** Wide enough for the spreadsheet beside the review (at least 560 px for the review); narrower, it replaces it. */
	const SPLIT_QUERY = 'min-width: 1280px';
	const REVIEW_MIN = 560;
	const SHEET_MIN = 400;
	const sheetPreferenceKey = 'nsn-upload-interview-task:spreadsheet-view';
	const wide = new MediaQuery(SPLIT_QUERY);
	let sheetOpen = $state(restoreSheetView());
	/** The review's share of the width in the split view; CSS keeps both panes above their minimum. */
	let reviewShare = $state(0.45);
	let bodyWidth = $state(0);
	let sheetPane = $state<HTMLElement>();
	const split = $derived(sheetOpen && wide.current);
	const replaced = $derived(sheetOpen && !wide.current);
	const shareMin = $derived(bodyWidth ? Math.min(0.5, REVIEW_MIN / bodyWidth) : 0.3);
	const shareMax = $derived(bodyWidth ? Math.max(shareMin, 1 - SHEET_MIN / bodyWidth) : 0.7);

	/**
	 * The spreadsheet choice is remembered per browser, but restored only where it opens beside the review:
	 * on a narrow screen it would hide the review the user came for.
	 */
	function restoreSheetView(): boolean {
		if (!browser) return false;
		try {
			return localStorage.getItem(sheetPreferenceKey) === 'on' && matchMedia(`(${SPLIT_QUERY})`).matches;
		} catch {
			return false;
		}
	}

	function setSheetView(open: boolean) {
		sheetOpen = open;
		try {
			localStorage.setItem(sheetPreferenceKey, open ? 'on' : 'off');
		} catch {
			// Blocked storage: the choice lasts until the page reloads.
		}
	}

	/** A cell reference in the details: show it in the spreadsheet, opening the spreadsheet for this review if needed. */
	async function showCells(focus: SheetFocus) {
		session.focus = focus;
		sheetOpen = true;
		if (wide.current) return;
		// Narrow, the details would cover the cell: close them and keep the keyboard in the grid. Clicking the cell reopens them.
		drawerRecordId = null;
		drawerOpener = null;
		await tick();
		sheetPane?.querySelector<HTMLElement>('[role="grid"]')?.focus();
	}

	const analysis = $derived(session.analysis);
	const reviewing = $derived(!!analysis && (session.phase === 'ready' || session.phase === 'importing'));
	const recordsById = $derived(new Map(analysis?.records.map((record) => [record.id, record]) ?? []));
	const excludedTables = $derived(
		new Set(
			analysis?.decisions
				.filter((decision) => decision.kind === 'include-table' && decision.chosen === 'exclude')
				.map((decision) => decision.tableId) ?? []
		)
	);
	const heldTables = $derived(analysis ? heldBackTables(analysis) : new Set<string>());
	const recordCounts = $derived(
		(analysis?.records ?? []).reduce((counts, record) => counts.set(record.tableId, (counts.get(record.tableId) ?? 0) + 1), new Map<string, number>())
	);
	const aiTables = $derived(
		new Set(analysis?.sheets.flatMap((sheet) => sheet.tables.filter((table) => table.source === 'ai').map((table) => table.id)) ?? [])
	);
	/** Records held back until a pending decision is made, whether the decision names them or their table. */
	const heldBack = $derived.by(() => {
		const pending = analysis?.decisions.filter((decision) => decision.state === 'pending') ?? [];
		const ids = new Set(pending.flatMap((decision) => decision.recordIds));
		const tables = new Set(pending.filter((decision) => decision.kind === 'include-table').map((decision) => decision.tableId));
		return (analysis?.records ?? []).filter((record) => !record.approved && (ids.has(record.id) || tables.has(record.tableId)));
	});
	const heldBackIds = $derived(new Set(heldBack.map((record) => record.id)));
	/** Saved records by id, so a storage conflict can show the saved values next to the new ones. */
	const savedById = $derived(new Map(existing.map((mapping) => [mapping.id, mapping])));
	const drawerRecord = $derived(drawerRecordId ? recordsById.get(drawerRecordId) : undefined);

	/**
	 * The decision stage, in the order decisions first needed the user. The analysis lists pending decisions first,
	 * so a decision just made would otherwise jump to the end and "2 of 3" would read "1 of 3".
	 */
	const stage = $derived.by(() => {
		const decisions = analysis?.decisions ?? [];
		const byId = new Map(decisions.map((decision) => [decision.id, decision]));
		const seen = [...seenPending].flatMap((id) => {
			const decision = byId.get(id);
			return decision && decision.state !== 'auto' ? [decision] : [];
		});
		return [...seen, ...decisions.filter((decision) => decision.state === 'pending' && !seenPending.has(decision.id))];
	});
	const applied = $derived(analysis?.decisions.filter((decision) => !stage.includes(decision)) ?? []);
	const triggeredSheets = $derived(
		analysis?.sheets.filter((sheet) => sheet.aiTrigger && sheet.status !== 'hidden').map((sheet) => sheet.name) ?? []
	);
	/** Sheets the AI is reading right now; their counts change when it answers. */
	const aiReading = $derived(new Set(session.aiRun?.status === 'running' ? session.aiRun.sheets : []));
	const aiNote = $derived(aiActivity(session.aiRun));
	const sectionDefaults = $derived<Record<SectionId, boolean>>({
		// With no table anywhere, Sheets is where the user can set one up by hand.
		sheets: analysis ? analysis.sheets.every((sheet) => sheet.tables.length === 0) : false,
		columns: analysis ? columnsOpenByDefault(analysis) : false,
		rows: false,
		auto: false,
		ai: analysis ? aiOpenByDefault(analysis, !!session.aiRun?.result) : false
	});
	const isOpen = (id: SectionId) => sectionOpen[id] ?? sectionDefaults[id];
	const allOpen = $derived(SECTIONS.every(isOpen));

	$effect(() => {
		for (const decision of analysis?.decisions ?? []) if (decision.state === 'pending') seenPending.add(decision.id);
	});
	$effect(() => {
		if (open) session.initAi();
	});

	function close() {
		if (session.busy) return;
		if (session.phase === 'done' || session.phase === 'error') reset();
		onClose();
	}

	function reset() {
		session.reset();
		previewScope = 'all';
		filter = 'all';
		drawerRecordId = null;
		remapNotices = {};
		sectionOpen = {};
		settingUp = null;
		seenPending.clear();
	}

	/** Escape closes the innermost layer first, and never interrupts reading or importing. */
	function dismiss() {
		if (drawerRecordId) closeDrawer();
		else close();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		// Let a search box clear itself first.
		if (event.target instanceof HTMLInputElement && event.target.type === 'search' && event.target.value) return;
		// Handled on keydown: the dialog's own cancel event is not cancelable without a fresh user activation,
		// so preventing it there could still close the whole window when only the drawer should close.
		event.preventDefault();
		dismiss();
	}

	function selectFile(file: File | undefined) {
		if (!file || session.busy) return;
		reset();
		void session.load(file, existing);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		isDragActive = false;
		selectFile(event.dataTransfer?.files[0]);
	}

	function setColumn(table: TableCandidate, column: ColumnMapping, field: Field | null) {
		const evicted = field && table.columns.find((other) => other.col !== column.col && other.field === field);
		remapNotices[table.id] = evicted
			? `Column ${colLetter(evicted.col)}${evicted.header ? ` ("${evicted.header}")` : ''} is no longer mapped: column ${colLetter(column.col)} now maps to ${FIELD_LABEL[field]}.`
			: '';
		session.setColumn(table.id, column.col, field);
	}

	/** Chips and "Show these rows": open Rows with that filter and bring it into view. */
	async function showRows(next: RecordFilter) {
		filter = next;
		previewScope = 'all';
		sectionOpen.rows = true;
		await tick();
		document.getElementById('section-rows')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** The next steps the summary offers when nothing will import. */
	const NEXT_STEP: Record<NextStep, { label: string; icon: typeof Sparkles }> = {
		'set-up': { label: 'Set up a table by hand', icon: TableProperties },
		ai: { label: 'Turn on AI assistance', icon: Sparkles },
		sheets: { label: 'Review sheets', icon: Layers },
		rows: { label: 'Show rows', icon: Rows3 }
	};

	async function takeStep(step: NextStep, setupSheet: string | null) {
		if (step === 'rows') return showRows('all');
		const section = step === 'ai' ? 'ai' : 'sheets';
		sectionOpen[section] = true;
		// The setup form takes focus when it opens, which brings it into view.
		if (step === 'set-up') settingUp = setupSheet;
		if (step === 'ai') void session.setAiEnabled(true);
		await tick();
		if (step !== 'set-up') document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function toggleAll() {
		const open = !allOpen;
		for (const id of SECTIONS) sectionOpen[id] = open;
	}

	function openRecord(id: string) {
		if (!drawerRecordId) drawerOpener = document.activeElement as HTMLElement | null;
		drawerRecordId = id;
	}

	function closeDrawer() {
		drawerRecordId = null;
		drawerOpener?.focus();
		drawerOpener = null;
	}

	/** A related record's link in the drawer; it names the sheet only when that differs from the drawer's record. */
	function describeRecord(id: string) {
		const record = recordsById.get(id);
		return record ? recordLabel(record, { sheet: record.sheet !== drawerRecord?.sheet }) : null;
	}

	/** Why each record that will not be imported stays out, for the result screen. */
	function notImported(records: CandidateRecord[]) {
		const reasons = { review: 0, invalid: 0, duplicate: 0, excluded: 0 };
		for (const record of records) {
			if (record.approved) continue;
			if (excludedTables.has(record.tableId)) reasons.excluded++;
			else if (heldBackIds.has(record.id)) reasons.review++;
			else if (record.status === 'invalid') reasons.invalid++;
			else if (record.status === 'duplicate') reasons.duplicate++;
			else reasons.excluded++;
		}
		return reasons;
	}

</script>

{#if open}
	<dialog
		{@attach (dialog: HTMLDialogElement) => dialog.showModal()}
		class="m-0 h-dvh max-h-none w-full max-w-none overflow-clip bg-transparent p-0 backdrop:bg-slate-950/55 backdrop:backdrop-blur-[2px] sm:p-4"
		aria-labelledby="import-title"
		onkeydown={onKeydown}
		oncancel={(event) => {
			event.preventDefault();
			dismiss();
		}}
		onclose={onClose}
		ondragover={(event) => event.preventDefault()}
		ondrop={(event) => event.preventDefault()}
	>
		<!-- overflow-clip, not hidden: a hidden container still scrolls for scrollIntoView and would shift the header away. -->
		<div class="relative flex h-full flex-col overflow-clip bg-[#f6f7f9] sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-2xl">
			<header class="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
				<div class="flex items-start justify-between gap-3">
					<div class="flex min-w-0 gap-3">
						<div class="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
							<FileSpreadsheet size={21} />
						</div>
						<div class="min-w-0">
							<h2 id="import-title" class="text-lg font-semibold text-slate-950">Smart Upload</h2>
							<p class={['mt-0.5 text-sm text-slate-500', session.fileName && 'truncate']}>
								{#if session.fileName}
									{session.fileName}
								{:else}
									Upload an Excel workbook. Every sheet is checked for importable tables.
								{/if}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						{#if reviewing}
							<button
								type="button"
								class={[
									'inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium transition sm:px-3',
									sheetOpen ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
								]}
								aria-label="Spreadsheet"
								aria-pressed={sheetOpen}
								onclick={() => setSheetView(!sheetOpen)}
							>
								<Grid3x3 size={17} />
								<span class="hidden sm:inline">Spreadsheet</span>
							</button>
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 sm:px-3"
								aria-label="Choose another file"
								disabled={session.busy}
								onclick={reset}
							>
								<FileUp size={17} class="sm:hidden" />
								<span class="hidden sm:inline">Choose another file</span>
							</button>
						{/if}
						<button
							type="button"
							class="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:text-slate-200"
							aria-label="Close Smart Upload"
							disabled={session.busy}
							onclick={close}
						>
							<X size={19} />
						</button>
					</div>
				</div>

				{#if reviewing && analysis}
					{@const parts = summaryParts(analysis)}
					{@const chips = statusChips(analysis)}
					{@const nothing = nothingToImport(analysis, session.model, !session.aiEnabled && session.aiAvailability?.available !== false)}
					<div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<p id="import-summary" class="text-sm text-slate-700">
									{`${parts.sheets} · ${parts.rows} · `}<span class={['font-semibold', parts.done ? 'text-emerald-700' : 'text-slate-950']}>{parts.needs}</span>
								</p>
								<!-- Always rendered, so screen readers hear the AI start and finish. Flex, so the pill alone sets
								     the height and the line does not grow when it appears. -->
								<p class="flex" role="status">
									{#if aiNote}
										<span class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
											{#if aiReading.size}
												<LoaderCircle size={12} class="animate-spin" />
											{:else if session.aiRun?.status === 'error'}
												<CircleAlert size={12} />
											{:else}
												<Sparkles size={12} />
											{/if}
											{aiNote}
										</span>
									{/if}
								</p>
							</div>
							{#if nothing}
								<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
									<p class="flex items-start gap-1.5 text-amber-900">
										<CircleAlert size={15} class="mt-0.5 shrink-0" />
										{nothing.reason}.
									</p>
									{#each nothing.steps as step (step)}
										{@const { label, icon: Icon } = NEXT_STEP[step]}
										<button
											type="button"
											class="inline-flex items-center gap-1 rounded font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600"
											onclick={() => takeStep(step, nothing.setupSheet)}
										>
											<Icon size={15} />
											{label}
										</button>
									{/each}
								</div>
							{/if}
							{#if chips.length}
								<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Summary">
									{#each chips as chip (chip.tone)}
										<li>
											<button
												type="button"
												class={['rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition hover:brightness-95', CHIP_STYLE[chip.tone]]}
												onclick={() => showRows(chip.filter)}
											>
												{chip.label}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						<!-- Stacked on phones so each button keeps its label on one line. -->
						<div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
							{#if parts.pending}
								<button
									type="button"
									class="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
									onclick={() => session.acceptAllSuggestions()}
								>
									<WandSparkles size={16} /> Accept all suggestions
								</button>
							{/if}
							<button
								type="button"
								class="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500"
								disabled={analysis.summary.toImport === 0 || session.busy}
								onclick={() => session.import(onImport)}
							>
								{#if session.phase === 'importing'}<LoaderCircle class="animate-spin" size={16} />{/if}
								<span aria-live="polite">Import {plural(analysis.summary.toImport, 'record')}</span>
								{#if heldBack.length}
									<span class="font-normal opacity-80">({heldBack.length} need review)</span>
								{/if}
							</button>
						</div>
					</div>
				{/if}
			</header>

			{#if session.phase === 'done' && analysis}
				{@const reasons = notImported(analysis.records)}
				{@const bySheet = Object.entries(Object.groupBy(analysis.records.filter((record) => record.approved), (record) => record.sheet))}
				<div class="flex flex-1 flex-col overflow-y-auto px-4 py-10 sm:justify-center sm:pb-24">
					<div class="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
						<div class="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
							<CircleCheckBig size={24} />
						</div>
						<h3 class="mt-4 text-lg font-semibold text-slate-950">
							{plural(session.imported?.add.length ?? 0, 'record')} added to your NSN table
						</h3>
						{#if session.imported?.replace.length}
							<p class="mt-1 text-sm font-medium text-slate-700">
								{plural(session.imported.replace.length, 'saved record')} replaced with values from this file
							</p>
						{/if}
						<p class="mt-1 text-sm text-slate-500">Saved in this browser.</p>
						<dl class="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200 text-left text-sm">
							{#each bySheet as [sheet, records] (sheet)}
								<div class="flex justify-between gap-3 px-4 py-2">
									<dt class="text-slate-600">From {sheet}</dt>
									<dd class="font-medium tabular-nums text-slate-900">{records!.length}</dd>
								</div>
							{/each}
						</dl>
						{#if reasons.review + reasons.invalid + reasons.duplicate + reasons.excluded}
							<p class="mt-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Not imported</p>
							<dl class="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-left text-sm">
								{#each [['Held back for review', reasons.review], ['Invalid', reasons.invalid], ['Duplicates skipped', reasons.duplicate], ['Excluded', reasons.excluded]] as const as [label, count] (label)}
									{#if count}
										<div class="flex justify-between gap-3 px-4 py-2">
											<dt class="text-slate-600">{label}</dt>
											<dd class="tabular-nums text-slate-600">{count}</dd>
										</div>
									{/if}
								{/each}
							</dl>
						{/if}
						<button
							type="button"
							class="mt-6 inline-flex items-center justify-center rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-800"
							onclick={close}
						>
							Back to mappings
						</button>
					</div>
				</div>
			{:else if reviewing && analysis}
				{@const worth = worthALook(analysis)}
				<!--
					One grid cell holds the review; the split view adds the divider and the spreadsheet beside it. The review
					element is never re-created or removed, so its scroll position, open sections, and search survive the
					spreadsheet opening and closing. Where the spreadsheet replaces it, it stays laid out underneath, invisible.
				-->
				<div
					class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
					style:grid-template-columns={split
						? `clamp(${REVIEW_MIN}px, ${reviewShare * 100}%, calc(100% - ${SHEET_MIN}px)) 1px minmax(0, 1fr)`
						: 'minmax(0, 1fr)'}
					bind:clientWidth={bodyWidth}
				>
					<div id="review-pane" class={['col-start-1 row-start-1 overflow-y-auto', replaced && 'invisible']}>
						<div class="mx-auto max-w-5xl space-y-3 p-3 sm:p-5">
							<DecisionStage
								{session}
								{stage}
								records={recordsById}
								saved={savedById}
								sheets={analysis.sheets}
								{aiTables}
								onOpenRecord={openRecord}
							/>

							{#if worth.length}
								<div class="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
									<div class="flex items-start gap-2 text-sm text-amber-900">
										<TriangleAlert size={16} class="mt-0.5 shrink-0 text-amber-600" />
										<div class="min-w-0">
											<p class="font-medium">Worth a look before importing. These still import.</p>
											<ul class="mt-1 space-y-0.5">
												{#each worth as line (line.title)}
													<li>
														<span class="font-medium">{line.title}</span>
														<span class="text-amber-800/80">· {line.detail}</span>
													</li>
												{/each}
											</ul>
											<button
												type="button"
												class="mt-1.5 text-sm font-medium text-amber-800 underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
												onclick={() => showRows('warning')}
											>
												Show these rows
											</button>
										</div>
									</div>
								</div>
							{/if}

							<div class="flex items-center justify-between gap-2 pt-1">
								<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
								<button type="button" class="text-xs font-medium text-blue-700 hover:text-blue-900" onclick={toggleAll}>
									{allOpen ? 'Collapse all' : 'Expand all'}
								</button>
							</div>

							<Section
								id="sheets"
								title={`Sheets (${analysis.sheets.length})`}
								summary={sheetsSummary(analysis.sheets)}
								icon={Layers}
								open={isOpen('sheets')}
								onToggle={(open) => (sectionOpen.sheets = open)}
							>
								<SheetsPanel
									sheets={analysis.sheets}
									decisions={analysis.decisions}
									{recordCounts}
									model={session.model}
									explanations={session.explanations}
									bind:settingUp
									{aiReading}
									onInclude={(id, include) => session.choose(id, include ? 'include' : 'exclude')}
									onSetManualTable={(sheet, spec) => session.setManualTable(sheet, spec)}
									onRemoveManualTable={(sheet) => session.removeManualTable(sheet)}
								/>
							</Section>
							<Section
								id="columns"
								title="Columns"
								summary={columnsSummary(analysis)}
								icon={Columns3}
								open={isOpen('columns')}
								onToggle={(open) => (sectionOpen.columns = open)}
							>
								<ColumnsPanel
									sheets={analysis.sheets}
									model={session.model}
									heldBack={heldTables}
									notices={remapNotices}
									onDismissNotice={(tableId) => (remapNotices[tableId] = '')}
									onSetColumn={setColumn}
									onResetColumn={(table, column) => {
										remapNotices[table.id] = '';
										session.resetColumn(table.id, column.col);
									}}
								/>
							</Section>
							<Section
								id="rows"
								title={rowsTitle(analysis)}
								summary={rowsSummary(analysis)}
								icon={Rows3}
								open={isOpen('rows')}
								onToggle={(open) => (sectionOpen.rows = open)}
							>
								<PreviewPanel
									records={activeRecords(analysis)}
									held={heldBackGroups(analysis)}
									skipped={skippedGroups(analysis, session.model)}
									sheetNames={analysis.sheets.filter((sheet) => sheet.tables.some((table) => !heldTables.has(table.id))).map((sheet) => sheet.name)}
									bind:filter
									bind:scope={previewScope}
									heldBack={heldBackIds}
									excluded={new Set(session.overrides.excludedRecords)}
									activeRecordId={drawerRecordId}
									onOpen={(record) => openRecord(record.id)}
									onFocus={(focus) => (session.focus = focus)}
									onToggle={(record, include) => session.setRecordExcluded(record.id, !include)}
									explainIssue={session.issueExplanation}
								/>
							</Section>
							<Section
								id="auto"
								title={`Applied automatically (${applied.length})`}
								summary={applied.length ? 'Certain cases handled by policy; each can be undone' : 'Nothing was applied automatically'}
								icon={CircleCheck}
								open={isOpen('auto')}
								onToggle={(open) => (sectionOpen.auto = open)}
							>
								<AppliedDecisions {session} decisions={applied} records={recordsById} onOpenRecord={openRecord} />
							</Section>
							<Section
								id="ai"
								title="AI assistance"
								summary={aiSummary({ enabled: session.aiEnabled, availability: session.aiAvailability, run: session.aiRun, triggered: triggeredSheets })}
								icon={Sparkles}
								open={isOpen('ai')}
								onToggle={(open) => (sectionOpen.ai = open)}
							>
								<AiAssist {session} />
							</Section>
						</div>
					</div>

					{#if split}
						<SplitDivider
							share={Math.min(shareMax, Math.max(shareMin, reviewShare))}
							min={shareMin}
							max={shareMax}
							controls="review-pane"
							onResize={(share) => (reviewShare = share)}
						/>
					{/if}
					{#if sheetOpen && session.model}
						<div bind:this={sheetPane} class={['row-start-1 min-h-0', split ? 'col-start-3' : 'col-start-1']}>
							<SheetView
								model={session.model}
								{analysis}
								focus={session.focus}
								onFocus={(focus) => (session.focus = focus)}
								onOpenRecord={openRecord}
								onBack={replaced ? () => setSheetView(false) : undefined}
							/>
						</div>
					{/if}

					<!-- The details open over the review's cell: beside the spreadsheet when split, over it when it replaces the review. -->
					{#if drawerRecord}
						<div class="relative col-start-1 row-start-1 min-h-0">
							<button
								type="button"
								class="absolute inset-0 z-10 cursor-default bg-slate-950/20"
								aria-label="Close details"
								tabindex="-1"
								onclick={closeDrawer}
							></button>
							<ProvenanceDrawer
								{session}
								record={drawerRecord}
								fileName={analysis.fileName}
								decisions={analysis.decisions}
								describe={describeRecord}
								onOpenRecord={openRecord}
								onFocus={showCells}
								onClose={closeDrawer}
							/>
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:justify-center sm:px-6 sm:pb-24">
					<div class="mx-auto grid w-full max-w-4xl gap-4 lg:grid-cols-[1fr_1.15fr]">
						<div class="rounded-lg border border-slate-200 bg-white p-4">
							<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">What happens</p>
							<ul class="mt-3 space-y-2 text-sm text-slate-700">
								<li class="flex gap-2">
									<CircleCheckBig class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>Every visible sheet is checked; hidden sheets and empty formatted rows are ignored.</span>
								</li>
								<li class="flex gap-2">
									<CircleCheckBig class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>Headers can sit below titles. Part number, NSN, NIIN, CAGE, and description columns are matched by header and values.</span>
								</li>
								<li class="flex gap-2">
									<CircleCheckBig class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>
										You review mappings, duplicates, and conflicts before anything is saved.
										{#if session.aiAvailability?.available === false}Nothing leaves this browser.{/if}
									</span>
								</li>
								<!-- AI is on by default (D23), so it can be turned off here, before the first file is sent. -->
								{#if session.aiAvailability?.available !== false}
									<li class="flex gap-2">
										<Sparkles class="mt-0.5 shrink-0 text-violet-600" size={16} />
										<div class="flex min-w-0 flex-1 items-start justify-between gap-3">
											<span id="upload-ai-description">
												{#if session.aiEnabled}
													AI assistance is on: sheets the importer cannot read are sent to its AI provider as sampled cells. Turn
													it off to keep everything in this browser.
												{:else}
													AI assistance is off, so nothing leaves this browser.
												{/if}
											</span>
											<Switch
												checked={session.aiEnabled}
												label="AI assistance"
												describedby="upload-ai-description"
												disabled={session.busy}
												onchange={(enabled) => void session.setAiEnabled(enabled)}
											/>
										</div>
									</li>
								{/if}
							</ul>
						</div>

						<button
							type="button"
							class={[
								'group/drop flex min-h-52 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition disabled:cursor-progress',
								isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40'
							]}
							disabled={session.busy}
							ondragenter={(event) => {
								event.preventDefault();
								isDragActive = true;
							}}
							ondragover={(event) => event.preventDefault()}
							ondragleave={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget as Node)) isDragActive = false;
							}}
							ondrop={onDrop}
							onclick={() => fileInput?.click()}
						>
							<div class="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600 group-hover/drop:bg-blue-100 group-hover/drop:text-blue-700">
								{#if session.busy}
									<LoaderCircle class="animate-spin" size={21} />
								{:else}
									<Upload size={21} />
								{/if}
							</div>
							<p class="mt-3 text-sm font-medium text-slate-800" aria-live="polite">
								{#if session.phase === 'reading'}
									Reading workbook…
								{:else if session.phase === 'analyzing'}
									Analyzing sheets…
								{:else}
									Drop an Excel workbook here
								{/if}
							</p>
							<p class="mt-1 text-xs text-slate-500">
								{session.busy ? 'Step ' + (session.phase === 'reading' ? '1' : '2') + ' of 2' : 'or click to browse · .xlsx only'}
							</p>
							{#if session.fileName}
								<span class="mt-3 max-w-full truncate rounded bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
									{session.fileName}
								</span>
							{/if}
						</button>
						<input
							class="sr-only"
							bind:this={fileInput}
							type="file"
							accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
							tabindex="-1"
							onchange={(event) => {
								selectFile(event.currentTarget.files?.[0]);
								event.currentTarget.value = '';
							}}
						/>
					</div>

					{#if session.phase === 'error'}
						<div class="mx-auto mt-4 flex w-full max-w-4xl gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
							<CircleAlert class="mt-0.5 shrink-0" size={17} />
							<div>
								<p class="font-medium">This workbook could not be read</p>
								<p class="mt-0.5 text-red-700">{session.error}</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</dialog>
{/if}
