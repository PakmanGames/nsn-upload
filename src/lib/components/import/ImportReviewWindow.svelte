<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Layers from '@lucide/svelte/icons/layers';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import X from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { CandidateRecord, ColumnMapping, Field, ImportPlan, StoredMapping, TableCandidate } from '$lib/import/model';
	import { colLetter } from '$lib/import/refs';
	import { ImportSession } from '$lib/import/session.svelte';
	import AiAssist from './AiAssist.svelte';
	import AppliedDecisions from './AppliedDecisions.svelte';
	import ColumnsPanel from './ColumnsPanel.svelte';
	import DecisionStage from './DecisionStage.svelte';
	import PreviewPanel from './PreviewPanel.svelte';
	import ProvenanceDrawer from './ProvenanceDrawer.svelte';
	import Section from './Section.svelte';
	import SheetsPanel from './SheetsPanel.svelte';
	import { CHIP_STYLE, FIELD_LABEL, plural, type RecordFilter } from './labels';
	import {
		activeRecords,
		aiOpenByDefault,
		aiSummary,
		columnsOpenByDefault,
		columnsSummary,
		heldBackGroups,
		heldBackTables,
		rowsSummary,
		rowsTitle,
		sheetsSummary,
		statusChips,
		summaryParts,
		worthALook
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
	let isDragActive = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let drawerOpener: HTMLElement | null = null;

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
	const sectionDefaults = $derived<Record<SectionId, boolean>>({
		sheets: false,
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
			? `Column ${colLetter(evicted.col)} ("${evicted.header}") is no longer mapped: column ${colLetter(column.col)} now maps to ${FIELD_LABEL[field]}.`
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

	function describeRecord(id: string) {
		const record = recordsById.get(id);
		return record ? `${record.sheet} row ${record.sourceRow}` : null;
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
					<div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div class="min-w-0">
							<p id="import-summary" class="text-sm text-slate-700">
								{`${parts.sheets} · ${parts.rows} · `}<span class={['font-semibold', parts.pending ? 'text-slate-950' : 'text-emerald-700']}>{parts.needs}</span>
							</p>
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
				<div class="relative min-h-0 flex-1">
					<div class="h-full overflow-y-auto">
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
									onInclude={(id, include) => session.choose(id, include ? 'include' : 'exclude')}
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
									sheetNames={analysis.sheets.filter((sheet) => sheet.tables.some((table) => !heldTables.has(table.id))).map((sheet) => sheet.name)}
									bind:filter
									bind:scope={previewScope}
									heldBack={heldBackIds}
									activeRecordId={drawerRecordId}
									onOpen={(record) => openRecord(record.id)}
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

					{#if drawerRecord}
						<button
							type="button"
							class="absolute inset-0 z-10 cursor-default bg-slate-950/20"
							aria-label="Close details"
							tabindex="-1"
							onclick={closeDrawer}
						></button>
						<ProvenanceDrawer
							record={drawerRecord}
							fileName={analysis.fileName}
							decisions={analysis.decisions}
							describe={describeRecord}
							onOpenRecord={openRecord}
							onClose={closeDrawer}
						/>
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
									<span>You review mappings, duplicates, and conflicts before anything is saved. Nothing leaves this browser.</span>
								</li>
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
