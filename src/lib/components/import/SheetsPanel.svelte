<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import type { Decision, SheetAnalysis } from '$lib/import/model';
	import { rangeToA1 } from '$lib/import/refs';
	import Switch from './Switch.svelte';
	import { SHEET_STATUS, SKIP_REASON, plural } from './labels';

	type Props = {
		sheets: SheetAnalysis[];
		decisions: Decision[];
		/** Candidate records per table id. */
		recordCounts: Map<string, number>;
		onInclude: (decisionId: string, include: boolean) => void;
	};

	let { sheets, decisions, recordCounts, onInclude }: Props = $props();
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

{#snippet fold(label: string, list: SheetAnalysis[])}
	<details class="group/fold">
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
				<button
					type="button"
					class="mt-1 flex items-center gap-1 rounded text-xs text-slate-500 transition hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
					aria-expanded={isOpen}
					aria-controls={reasonsId}
					onclick={() => (expanded[sheet.name] = !isOpen)}
				>
					<ChevronRight size={13} class={['transition', isOpen && 'rotate-90']} />
					Why this classification
				</button>
				<ul id={reasonsId} hidden={!isOpen} class="mt-1 list-disc space-y-1 pl-7 text-xs leading-5 text-slate-600">
					{#each details(sheet) as reason, i (i)}
						<li>{reason}</li>
					{/each}
					{#if sheet.aiTrigger}
						<li class="text-violet-700">AI could help: {sheet.aiTrigger}</li>
					{/if}
				</ul>
			</li>
		{/each}
	</ul>
{/if}
{#if nothing.length}
	{@render fold(`${plural(nothing.length, 'sheet')} with nothing to import`, nothing)}
{/if}
{#if hidden.length}
	{@render fold(`${hidden.length} hidden ${hidden.length === 1 ? 'sheet' : 'sheets'}, ignored`, hidden)}
{/if}
