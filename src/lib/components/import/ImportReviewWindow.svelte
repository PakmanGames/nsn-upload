<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check-big';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileUp from '@lucide/svelte/icons/file-up';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Upload from '@lucide/svelte/icons/upload';
	import X from '@lucide/svelte/icons/x';
	import type { CandidateRecord, ColumnMapping, Field, ImportPlan, StoredMapping } from '$lib/import/model';
	import { colLetter } from '$lib/import/refs';
	import { ImportSession } from '$lib/import/session.svelte';
	import AiAssist from './AiAssist.svelte';
	import DecisionsPanel from './DecisionsPanel.svelte';
	import MappingPanel from './MappingPanel.svelte';
	import PreviewPanel from './PreviewPanel.svelte';
	import ProvenanceDrawer from './ProvenanceDrawer.svelte';
	import SheetsPanel from './SheetsPanel.svelte';
	import { FIELD_LABEL, plural, type RecordFilter } from './labels';

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

	let selectedSheet = $state<string | null>(null);
	let previewScope = $state('all');
	let filter = $state<RecordFilter>('all');
	let drawerRecordId = $state<string | null>(null);
	let remapNotice = $state('');
	let isDragActive = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let drawerOpener: HTMLElement | null = null;

	const analysis = $derived(session.analysis);
	const reviewing = $derived(!!analysis && (session.phase === 'ready' || session.phase === 'importing'));
	const recordsById = $derived(new Map(analysis?.records.map((record) => [record.id, record]) ?? []));
	const activeSheet = $derived(
		analysis?.sheets.find((sheet) => sheet.name === selectedSheet) ??
			analysis?.sheets.find((sheet) => sheet.tables.length > 0) ??
			analysis?.sheets[0]
	);
	const excludedTables = $derived(
		new Set(
			analysis?.decisions
				.filter((decision) => decision.kind === 'include-table' && decision.chosen === 'exclude')
				.map((decision) => decision.tableId) ?? []
		)
	);
	// Same scope as the summary: excluded tables keep their records, but they are not counted or previewed.
	const previewRecords = $derived(analysis?.records.filter((record) => !excludedTables.has(record.tableId)) ?? []);
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
		selectedSheet = null;
		previewScope = 'all';
		filter = 'all';
		drawerRecordId = null;
		remapNotice = '';
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

	function selectSheet(name: string) {
		selectedSheet = name;
		remapNotice = '';
		if (analysis?.sheets.find((sheet) => sheet.name === name)?.tables.length) previewScope = name;
	}

	function setColumn(column: ColumnMapping, field: Field | null) {
		const table = activeSheet?.tables[0];
		if (!table) return;
		const evicted = field && table.columns.find((other) => other.col !== column.col && other.field === field);
		remapNotice = evicted
			? `Column ${colLetter(evicted.col)} ("${evicted.header}") is no longer mapped: column ${colLetter(column.col)} now maps to ${FIELD_LABEL[field]}.`
			: '';
		session.setColumn(table.id, column.col, field);
	}

	function showStatus(next: RecordFilter) {
		filter = next;
		previewScope = 'all';
		document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

	const CHIPS: Array<{ key: keyof NonNullable<typeof analysis>['summary']; label: string; filter: RecordFilter; dot: string }> = [
		{ key: 'candidates', label: 'candidates', filter: 'all', dot: 'bg-slate-400' },
		{ key: 'valid', label: 'valid', filter: 'valid', dot: 'bg-emerald-500' },
		{ key: 'warnings', label: 'warnings', filter: 'warning', dot: 'bg-amber-500' },
		{ key: 'invalid', label: 'invalid', filter: 'invalid', dot: 'bg-red-500' },
		{ key: 'duplicates', label: 'duplicates', filter: 'duplicate', dot: 'bg-slate-500' },
		{ key: 'conflicts', label: 'conflicts', filter: 'conflict', dot: 'bg-orange-500' },
		{ key: 'splitRecords', label: 'split', filter: 'split', dot: 'bg-blue-500' }
	];
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
									{#if analysis}
										<span class="text-slate-400">
											{`· ${plural(analysis.summary.sheets, 'sheet')}, ${plural(analysis.summary.tablesIncluded, 'table')} included`}
										</span>
									{/if}
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
					<div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<!-- One scrolling row on phones keeps the fixed header short. -->
						<ul
							class="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>li]:shrink-0"
							aria-label="Summary"
						>
							{#each CHIPS as chip (chip.key)}
								{@const value = analysis.summary[chip.key]}
								<li>
									<button
										type="button"
										class={[
											'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:border-slate-300 hover:bg-slate-50',
											value ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-100 bg-white text-slate-400'
										]}
										onclick={() => showStatus(chip.filter)}
									>
										<span class={['size-1.5 rounded-full', value ? chip.dot : 'bg-slate-300']}></span>
										<span class="font-semibold tabular-nums">{value.toLocaleString()}</span>
										{chip.label}
									</button>
								</li>
							{/each}
							<li>
								<a
									href="#decisions"
									class={[
										'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
										analysis.summary.pendingDecisions
											? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
											: 'border-slate-100 bg-white text-slate-400'
									]}
								>
									<span class={['size-1.5 rounded-full', analysis.summary.pendingDecisions ? 'bg-amber-500' : 'bg-slate-300']}></span>
									<span class="font-semibold tabular-nums">{analysis.summary.pendingDecisions}</span>
									pending {analysis.summary.pendingDecisions === 1 ? 'decision' : 'decisions'}
								</a>
							</li>
						</ul>
						<button
							type="button"
							class="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-800 disabled:bg-slate-300"
							disabled={analysis.summary.toImport === 0 || session.busy}
							onclick={() => session.import(onImport)}
						>
							{#if session.phase === 'importing'}<LoaderCircle class="animate-spin" size={16} />{/if}
							Import {plural(analysis.summary.toImport, 'record')}
							{#if heldBack.length}
								<span class="font-normal opacity-80">({heldBack.length} need review)</span>
							{/if}
						</button>
					</div>
				{/if}
			</header>

			{#if session.phase === 'done' && analysis}
				{@const reasons = notImported(analysis.records)}
				{@const bySheet = Object.entries(Object.groupBy(analysis.records.filter((record) => record.approved), (record) => record.sheet))}
				<div class="flex flex-1 flex-col overflow-y-auto px-4 py-10 sm:justify-center sm:pb-24">
					<div class="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
						<div class="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
							<CircleCheck size={24} />
						</div>
						<h3 class="mt-4 text-lg font-semibold text-slate-950">
							{plural(session.imported?.add.length ?? 0, 'record')} added to your NSN table
						</h3>
						<p class="mt-1 text-sm text-slate-500">Saved in this browser.</p>
						<dl class="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200 text-left text-sm">
							{#each bySheet as [sheet, records] (sheet)}
								<div class="flex justify-between gap-3 px-4 py-2">
									<dt class="text-slate-600">From {sheet}</dt>
									<dd class="font-medium tabular-nums text-slate-900">{records!.length}</dd>
								</div>
							{/each}
						</dl>
						{#if session.imported?.replace.length}
							<p class="mt-1 text-sm font-medium text-slate-700">
								{plural(session.imported.replace.length, 'saved record')} replaced with values from this file
							</p>
						{/if}
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
				<div class="relative min-h-0 flex-1">
					<div class="h-full overflow-y-auto xl:grid xl:grid-cols-[18rem_minmax(0,1fr)_24rem] xl:overflow-clip">
						<div class="space-y-4 border-b border-slate-200 p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r">
							<SheetsPanel
								sheets={analysis.sheets}
								decisions={analysis.decisions}
								{recordCounts}
								selected={activeSheet?.name ?? null}
								onSelect={selectSheet}
								onInclude={(id, include) => session.choose(id, include ? 'include' : 'exclude')}
							/>
							<AiAssist {session} />
						</div>
						<div
							id="decisions"
							class="scroll-mt-4 border-b border-slate-200 p-4 xl:col-start-3 xl:row-start-1 xl:overflow-y-auto xl:border-b-0 xl:border-l"
						>
							<DecisionsPanel
								{session}
								decisions={analysis.decisions}
								records={recordsById}
								saved={savedById}
								{aiTables}
								onOpenRecord={openRecord}
							/>
						</div>
						<div class="min-w-0 space-y-4 p-4 xl:col-start-2 xl:row-start-1 xl:overflow-y-auto">
							{#if activeSheet}
								<MappingPanel
									sheet={activeSheet}
									model={session.model?.sheets.find((sheet) => sheet.name === activeSheet.name)}
									recordCount={recordCounts.get(activeSheet.tables[0]?.id ?? '') ?? 0}
									notice={remapNotice}
									onDismissNotice={() => (remapNotice = '')}
									onSetColumn={setColumn}
									onResetColumn={(column) => {
										remapNotice = '';
										session.resetColumn(activeSheet.tables[0].id, column.col);
									}}
								/>
							{/if}
							<PreviewPanel
								records={previewRecords}
								sheetNames={analysis.sheets.filter((sheet) => sheet.tables.length && !excludedTables.has(sheet.tables[0].id)).map((sheet) => sheet.name)}
								bind:filter
								bind:scope={previewScope}
								heldBack={heldBackIds}
								activeRecordId={drawerRecordId}
								onOpen={(record) => openRecord(record.id)}
							/>
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
									<CircleCheck class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>Every visible sheet is checked; hidden sheets and empty formatted rows are ignored.</span>
								</li>
								<li class="flex gap-2">
									<CircleCheck class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>Headers can sit below titles. Part number, NSN, NIIN, CAGE, and description columns are matched by header and values.</span>
								</li>
								<li class="flex gap-2">
									<CircleCheck class="mt-0.5 shrink-0 text-emerald-600" size={16} />
									<span>You review mappings, duplicates, and conflicts before anything is saved. Nothing leaves this browser.</span>
								</li>
							</ul>
						</div>

						<button
							type="button"
							class={[
								'group flex min-h-52 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition disabled:cursor-progress',
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
							<div class="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700">
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
