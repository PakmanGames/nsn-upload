<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TableProperties from '@lucide/svelte/icons/table-properties';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { tick } from 'svelte';
	import type { Decision, SheetAnalysis, TableSpec, WorkbookModel } from '$lib/import/model';
	import { rangeToA1 } from '$lib/import/refs';
	import Switch from './Switch.svelte';
	import TableSetup from './TableSetup.svelte';
	import { SHEET_STATUS, SKIP_REASON, plural } from './labels';
	import { setupSheets } from './summary';

	type Props = {
		sheets: SheetAnalysis[];
		decisions: Decision[];
		/** Candidate records per table id. */
		recordCounts: Map<string, number>;
		/** Source workbook, for setting up a table by hand. */
		model: WorkbookModel | null;
		onInclude: (decisionId: string, include: boolean) => void;
		onSetManualTable: (sheet: string, spec: TableSpec) => void;
		onRemoveManualTable: (sheet: string) => void;
		/** The sheet whose table is being set up by hand, one at a time; the summary bar can open it too. */
		settingUp?: string | null;
	};

	let {
		sheets,
		decisions,
		recordCounts,
		model,
		onInclude,
		onSetManualTable,
		onRemoveManualTable,
		settingUp = $bindable(null)
	}: Props = $props();
	let expanded = $state<Record<string, boolean>>({});
	const uid = $props.id();

	const includeDecisions = $derived(
		new Map(
			decisions
				.filter((decision) => decision.kind === 'include-table' && decision.tableId)
				.map((decision) => [decision.tableId!, decision])
		)
	);
	const withTables = $derived(sheets.filter((sheet) => sheet.status === 'ready' || sheet.status === 'needs-review'));
	const nothing = $derived(sheets.filter((sheet) => sheet.status === 'no-table'));
	const hidden = $derived(sheets.filter((sheet) => sheet.status === 'hidden'));
	const sheetModels = $derived(new Map(model?.sheets.map((sheet) => [sheet.name, sheet]) ?? []));
	const canSetUp = $derived(new Set(setupSheets(sheets, decisions, model)));

	async function focusAction(sheet: SheetAnalysis, action: 'setup' | 'remove') {
		await tick();
		document.getElementById(`${uid}-${action}-${sheet.index}`)?.focus();
	}

	function useTable(sheet: SheetAnalysis, spec: TableSpec) {
		settingUp = null;
		onSetManualTable(sheet.name, spec);
		void focusAction(sheet, 'remove');
	}

	function cancelSetup(sheet: SheetAnalysis) {
		settingUp = null;
		void focusAction(sheet, 'setup');
	}

	function removeTable(sheet: SheetAnalysis) {
		onRemoveManualTable(sheet.name);
		void focusAction(sheet, 'setup');
	}

	function details(sheet: SheetAnalysis): string[] {
		const table = sheet.tables[0];
		if (!table) return sheet.reasons;
		const skipped = Object.entries(
			Object.groupBy(table.skippedRows, (skip) => SKIP_REASON[skip.reason])
		).map(([reason, rows]) => `Skipped ${plural(rows!.length, 'row')} (${reason}): ${rows!.map((r) => r.row).join(', ')}`);
		return [...sheet.reasons, ...table.reasons.filter((reason) => !sheet.reasons.includes(reason)), ...skipped];
	}
</script>

{#snippet badge(sheet: SheetAnalysis)}
	<span class={['inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', SHEET_STATUS[sheet.status].style]}>
		{SHEET_STATUS[sheet.status].label}
	</span>
{/snippet}

{#snippet setupButton(sheet: SheetAnalysis)}
	{#if canSetUp.has(sheet.name) && settingUp !== sheet.name}
		<button
			id={`${uid}-setup-${sheet.index}`}
			type="button"
			class="flex items-center gap-1 rounded text-xs font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600"
			onclick={() => (settingUp = sheet.name)}
		>
			<TableProperties size={13} /> Set up table
		</button>
	{/if}
{/snippet}

{#snippet setup(sheet: SheetAnalysis)}
	{@const sheetModel = sheetModels.get(sheet.name)}
	{#if settingUp === sheet.name && sheetModel}
		<TableSetup
			sheet={sheetModel}
			table={sheet.tables[0]}
			onUse={(spec) => useTable(sheet, spec)}
			onCancel={() => cancelSetup(sheet)}
		/>
	{/if}
{/snippet}

{#snippet fold(label: string, list: SheetAnalysis[], open = false)}
	<details class="group/fold" {open}>
		<summary
			class="flex cursor-pointer list-none items-center gap-1.5 rounded py-1.5 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight size={14} class="transition group-open/fold:rotate-90" />
			{label}
		</summary>
		<ul class="ml-5 divide-y divide-slate-100">
			{#each list as sheet (sheet.name)}
				<li class="py-2">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium text-slate-700">{sheet.name}</span>
						{@render badge(sheet)}
					</div>
					<ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
						{#each sheet.reasons as reason, i (i)}
							<li>{reason}</li>
						{/each}
					</ul>
					<div class="mt-1.5">{@render setupButton(sheet)}</div>
					{@render setup(sheet)}
				</li>
			{/each}
		</ul>
	</details>
{/snippet}

{#if withTables.length}
	<ul class="divide-y divide-slate-100">
		{#each withTables as sheet (sheet.name)}
			{@const table = sheet.tables[0]}
			{@const decision = table && includeDecisions.get(table.id)}
			{@const isOpen = expanded[sheet.name] ?? false}
			{@const reasonsId = `${uid}-${sheet.index}`}
			<li class="py-2 first:pt-0">
				<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
					<p class="min-w-0 text-sm">
						<span class="font-medium text-slate-900">{sheet.name}</span>
						<span class="text-slate-500">
							{`· ${rangeToA1(table.range)} · ${plural(recordCounts.get(table.id) ?? 0, 'record')}`}
						</span>
					</p>
					<div class="flex items-center gap-2">
						{#if table.source === 'ai'}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
							>
								<Sparkles size={11} /> AI
							</span>
						{:else if table.source === 'user'}
							<span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
								Set up by you
							</span>
						{/if}
						{@render badge(sheet)}
						{#if decision}
							<Switch
								checked={decision.chosen === 'include'}
								label={`Include ${sheet.name}`}
								onchange={(include) => onInclude(decision.id, include)}
							/>
						{/if}
					</div>
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
					<button
						type="button"
						class="flex items-center gap-1 rounded text-xs text-slate-500 transition hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
						aria-expanded={isOpen}
						aria-controls={reasonsId}
						onclick={() => (expanded[sheet.name] = !isOpen)}
					>
						<ChevronRight size={13} class={['transition', isOpen && 'rotate-90']} />
						Why this classification
					</button>
					{@render setupButton(sheet)}
					{#if table.source === 'user'}
						<button
							id={`${uid}-remove-${sheet.index}`}
							type="button"
							class="flex items-center gap-1 rounded text-xs font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600"
							onclick={() => removeTable(sheet)}
						>
							<Undo2 size={13} /> Remove table set up by hand
						</button>
					{/if}
				</div>
				<ul id={reasonsId} hidden={!isOpen} class="mt-1 list-disc space-y-1 pl-7 text-xs leading-5 text-slate-600">
					{#each details(sheet) as reason, i (i)}
						<li>{reason}</li>
					{/each}
					{#if sheet.aiTrigger}
						<li class="text-violet-700">AI could help: {sheet.aiTrigger}</li>
					{/if}
				</ul>
				{@render setup(sheet)}
			</li>
		{/each}
	</ul>
{/if}
{#if nothing.length}
	<!-- Open when no sheet has a table, or a table is being set up here, so the setup is in plain view. -->
	{@render fold(
		`${plural(nothing.length, 'sheet')} with nothing to import`,
		nothing,
		withTables.length === 0 || nothing.some((sheet) => sheet.name === settingUp)
	)}
{/if}
{#if hidden.length}
	{@render fold(`${hidden.length} hidden ${hidden.length === 1 ? 'sheet' : 'sheets'}, ignored`, hidden)}
{/if}
