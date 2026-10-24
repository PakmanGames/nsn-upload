<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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
		selected: string | null;
		onSelect: (sheet: string) => void;
		onInclude: (decisionId: string, include: boolean) => void;
	};

	let { sheets, decisions, recordCounts, selected, onSelect, onInclude }: Props = $props();
	let expanded = $state<Record<string, boolean>>({});

	const includeDecisions = $derived(
		new Map(
			decisions
				.filter((decision) => decision.kind === 'include-table' && decision.tableId)
				.map((decision) => [decision.tableId!, decision])
		)
	);

	function details(sheet: SheetAnalysis): string[] {
		const table = sheet.tables[0];
		if (!table) return sheet.reasons;
		const skipped = Object.entries(
			Object.groupBy(table.skippedRows, (skip) => SKIP_REASON[skip.reason])
		).map(([reason, rows]) => `Skipped ${plural(rows!.length, 'row')} (${reason}): ${rows!.map((r) => r.row).join(', ')}`);
		return [...sheet.reasons, ...table.reasons.filter((reason) => !sheet.reasons.includes(reason)), ...skipped];
	}
</script>

<section aria-labelledby="sheets-heading">
	<h3 id="sheets-heading" class="text-xs font-semibold uppercase tracking-wide text-slate-500">
		Sheets <span class="font-normal normal-case tracking-normal text-slate-400">({sheets.length})</span>
	</h3>
	<ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
		{#each sheets as sheet (sheet.name)}
			{@const table = sheet.tables[0]}
			{@const decision = table && includeDecisions.get(table.id)}
			{@const status = SHEET_STATUS[sheet.status]}
			{@const isOpen = expanded[sheet.name] ?? false}
			<li
				class={[
					'rounded-lg border bg-white transition',
					selected === sheet.name ? 'border-blue-400 ring-1 ring-blue-400' : 'border-slate-200',
					sheet.status === 'hidden' && 'bg-slate-50'
				]}
			>
				<div class="flex items-start gap-2 p-3">
					<button
						type="button"
						class="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
						aria-current={selected === sheet.name}
						onclick={() => onSelect(sheet.name)}
					>
						<span
							class={[
								'block truncate text-sm font-medium',
								sheet.status === 'hidden' ? 'text-slate-500' : 'text-slate-900'
							]}
						>
							{sheet.name}
						</span>
						<span class="mt-1.5 flex flex-wrap items-center gap-1.5">
							<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', status.style]}>
								{status.label}
							</span>
							{#if table?.source === 'ai'}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
								>
									<Sparkles size={11} /> AI
								</span>
							{/if}
						</span>
						<span class="mt-1.5 block text-xs text-slate-500">
							{#if table}
								{plural(recordCounts.get(table.id) ?? 0, 'record')} · {rangeToA1(table.range)}
							{:else if sheet.status === 'hidden'}
								Not read
							{:else}
								Nothing to import
							{/if}
						</span>
					</button>
					{#if decision}
						<div class="flex flex-col items-end gap-1 pt-0.5">
							<Switch
								checked={decision.chosen === 'include'}
								label={`Include ${sheet.name}`}
								onchange={(include) => onInclude(decision.id, include)}
							/>
							<span class="text-[11px] text-slate-500">
								{decision.state === 'pending' ? 'Pending' : decision.chosen === 'include' ? 'Included' : 'Excluded'}
							</span>
						</div>
					{/if}
				</div>
				<button
					type="button"
					class="flex w-full items-center gap-1 border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
					aria-expanded={isOpen}
					onclick={() => (expanded[sheet.name] = !isOpen)}
				>
					<ChevronDown size={13} class={['transition', !isOpen && '-rotate-90']} />
					Why this classification
				</button>
				{#if isOpen}
					<ul class="list-disc space-y-1 px-3 pb-3 pl-7 text-xs leading-5 text-slate-600">
						{#each details(sheet) as reason, i (i)}
							<li>{reason}</li>
						{/each}
						{#if sheet.aiTrigger}
							<li class="text-violet-700">AI could help: {sheet.aiTrigger}</li>
						{/if}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</section>
