<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import type { CandidateRecord, Decision, DecisionKind } from '$lib/import/model';
	import type { ImportSession } from '$lib/import/session.svelte';
	import ExplanationText from './ExplanationText.svelte';
	import TechnicalDetails from './TechnicalDetails.svelte';
	import { DECISION_KIND_LABEL, plural, recordLabel } from './labels';

	type Props = {
		session: ImportSession;
		/** Decisions a policy made, in force or overridden by the user; the decision stage owns the rest. */
		decisions: Decision[];
		records: Map<string, CandidateRecord>;
		onOpenRecord: (recordId: string) => void;
	};

	let { session, decisions, records, onOpenRecord }: Props = $props();

	let collapsed = $state<Record<string, boolean>>({});
	let showAll = $state<Record<string, boolean>>({});

	// A re-uploaded workbook can produce hundreds of storage drops; big groups start closed and list a page at a time.
	const OPEN_UP_TO = 5;
	const LIST_UP_TO = 25;

	const changed = $derived(decisions.filter((decision) => decision.state === 'user'));
	const automatic = $derived(
		Object.entries(Object.groupBy(decisions.filter((decision) => decision.state === 'auto'), (decision) => decision.kind)) as Array<
			[DecisionKind, Decision[]]
		>
	);

	const label = (decision: Decision) =>
		decision.options.find((option) => option.id === decision.chosen)?.label ?? decision.chosen ?? '';
	const recordsOf = (decision: Decision) => decision.recordIds.flatMap((id) => records.get(id) ?? []);
</script>

<!-- Nothing above an item names its sheet, so its links (or its table line) do. -->
{#snippet recordLinks(decision: Decision)}
	{#if decision.kind === 'include-table'}
		{@const sheet = recordsOf(decision)[0]?.sheet}
		<p class="mt-1 text-xs text-slate-500">{sheet ? `${sheet} · ` : ''}{plural(decision.recordIds.length, 'record')}</p>
	{:else if decision.recordIds.length}
		<p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
			{#each recordsOf(decision) as record (record.id)}
				<button type="button" class="text-blue-700 hover:text-blue-900 hover:underline" onclick={() => onOpenRecord(record.id)}>
					{recordLabel(record, { sheet: true })}
				</button>
			{/each}
		</p>
	{/if}
{/snippet}

{#snippet explanation(decision: Decision)}
	{@const plain = session.plainExplanations.get(decision.id)}
	<div class="mt-0.5">
		{#if plain}
			<ExplanationText {plain} shown={session.explanations.get(decision.id)} reserveMarker={session.aiEnabled} compact />
		{/if}
	</div>
	{@render recordLinks(decision)}
	<div class="mt-1"><TechnicalDetails text={decision.reason} /></div>
{/snippet}

<div class="space-y-3">
	{#if changed.length}
		<div class="rounded-lg border border-slate-200">
			<p class="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-800">Changed by you</p>
			<ul class="divide-y divide-slate-100">
				{#each changed as decision (decision.id)}
					<li class="flex items-start justify-between gap-3 px-3 py-2.5">
						<div class="min-w-0">
							<p class="text-xs font-medium text-slate-500">{DECISION_KIND_LABEL[decision.kind]} · {label(decision)}</p>
							{@render explanation(decision)}
						</div>
						<button
							type="button"
							class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
							onclick={() => session.resetDecision(decision.id)}
						>
							<RotateCcw size={13} /> Revert
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if automatic.length === 0 && changed.length === 0}
		<p class="text-sm text-slate-500">Nothing was applied automatically.</p>
	{/if}
	{#each automatic as [kind, group] (kind)}
		{@const isCollapsed = collapsed[kind] ?? group.length > OPEN_UP_TO}
		{@const shown = showAll[kind] ? group : group.slice(0, LIST_UP_TO)}
		<div class="rounded-lg border border-slate-200">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
				aria-expanded={!isCollapsed}
				onclick={() => (collapsed[kind] = !isCollapsed)}
			>
				<span class="flex items-center gap-1.5">
					<ChevronDown size={14} class={['text-slate-400 transition', isCollapsed && '-rotate-90']} />
					{DECISION_KIND_LABEL[kind]}
				</span>
				<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-600">{group.length}</span>
			</button>
			{#if !isCollapsed}
				<ul class="divide-y divide-slate-100 border-t border-slate-100">
					{#each shown as decision (decision.id)}
						{@const others = decision.options.filter((option) => option.id !== decision.chosen)}
						<li class="flex items-start justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<p class="text-xs font-medium text-slate-500">{label(decision)}</p>
								{@render explanation(decision)}
							</div>
							{#if others.length === 1}
								<button
									type="button"
									class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
									title={others[0].label}
									aria-label={`Undo: ${others[0].label}`}
									onclick={() => session.choose(decision.id, others[0].id)}
								>
									<Undo2 size={13} /> Undo
								</button>
							{:else}
								<select
									class="max-w-36 shrink-0 rounded-md border border-slate-300 bg-white py-1 pl-2 pr-7 text-xs text-slate-700"
									aria-label="Change"
									value=""
									onchange={(event) => session.choose(decision.id, event.currentTarget.value)}
								>
									<option value="" disabled>Change…</option>
									{#each others as option (option.id)}
										<option value={option.id}>{option.label}</option>
									{/each}
								</select>
							{/if}
						</li>
					{/each}
					{#if shown.length < group.length}
						<li class="px-3 py-2">
							<button type="button" class="text-xs font-medium text-blue-700 hover:text-blue-900" onclick={() => (showAll[kind] = true)}>
								Show all {group.length}
							</button>
						</li>
					{/if}
				</ul>
			{/if}
		</div>
	{/each}
</div>
