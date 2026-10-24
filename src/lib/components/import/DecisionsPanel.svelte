<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleCheck from '@lucide/svelte/icons/circle-check-big';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import type { CandidateRecord, Decision, DecisionKind, Field } from '$lib/import/model';
	import type { ImportSession } from '$lib/import/session.svelte';
	import { DECISION_KIND_LABEL, FIELD_LABEL, plural } from './labels';

	type Props = {
		session: ImportSession;
		decisions: Decision[];
		records: Map<string, CandidateRecord>;
		aiTables: Set<string>;
		onOpenRecord: (recordId: string) => void;
	};

	let { session, decisions, records, aiTables, onOpenRecord }: Props = $props();

	/** The option picked in a pending decision's control before it is applied; defaults to the suggestion. */
	let picks = $state<Record<string, string>>({});
	let collapsed = $state<Record<string, boolean>>({});
	let showAll = $state<Record<string, boolean>>({});

	// A re-uploaded workbook can produce hundreds of storage drops; big groups start closed and list a page at a time.
	const OPEN_UP_TO = 5;
	const LIST_UP_TO = 25;

	const pending = $derived(decisions.filter((decision) => decision.state === 'pending'));
	const chosenByUser = $derived(decisions.filter((decision) => decision.state === 'user'));
	const automatic = $derived(
		Object.entries(Object.groupBy(decisions.filter((decision) => decision.state === 'auto'), (decision) => decision.kind)) as Array<
			[DecisionKind, Decision[]]
		>
	);

	const COMPARE: Field[] = ['part', 'nsn', 'description', 'cage'];
	const label = (decision: Decision, option: string | null) =>
		decision.options.find((candidate) => candidate.id === option)?.label ?? option ?? '';
	const describe = (id: string) => {
		const record = records.get(id);
		return record ? `${record.sheet} row ${record.sourceRow}${record.split ? ` (${record.split.index}/${record.split.total})` : ''}` : id;
	};
	/** Records named in a decision, unless it covers a whole table. */
	const listed = (decision: Decision) => (decision.kind === 'include-table' ? [] : decision.recordIds);
</script>

{#snippet recordLinks(decision: Decision)}
	{#if listed(decision).length}
		<p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
			{#each listed(decision) as id (id)}
				<button
					type="button"
					class="text-blue-700 hover:text-blue-900 hover:underline"
					onclick={() => onOpenRecord(id)}
				>
					{describe(id)}
				</button>
			{/each}
		</p>
	{:else if decision.kind === 'include-table'}
		<p class="mt-1 text-xs text-slate-500">{plural(decision.recordIds.length, 'record')}</p>
	{/if}
{/snippet}

{#snippet kindTag(decision: Decision)}
	<span class="flex flex-wrap items-center gap-1.5">
		<span class="text-xs font-medium text-slate-500">{DECISION_KIND_LABEL[decision.kind]}</span>
		{#if decision.tableId && aiTables.has(decision.tableId)}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-px text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
			>
				<Sparkles size={10} /> AI
			</span>
		{/if}
	</span>
{/snippet}

<div class="space-y-6">
	<section aria-labelledby="needs-you-heading">
		<div class="flex items-center justify-between gap-3">
			<h3 id="needs-you-heading" class="flex items-center gap-2 text-sm font-semibold text-slate-950">
				Needs you
				<span
					class={[
						'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
						pending.length ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
					]}
				>
					{pending.length}
				</span>
			</h3>
			{#if pending.length}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
					onclick={() => session.acceptAllSuggestions()}
				>
					<WandSparkles size={14} /> Accept all suggestions
				</button>
			{/if}
		</div>
		<p class="mt-1 text-xs leading-5 text-slate-500">
			{pending.length
				? 'These rows are held back from import until you choose. The suggested option is preselected.'
				: 'Nothing is waiting for you.'}
		</p>

		<ul class="mt-3 space-y-3">
			{#each pending as decision (decision.id)}
				{@const pick = picks[decision.id] ?? decision.suggested}
				{@const compared = decision.kind === 'resolve-conflict' ? decision.recordIds.flatMap((id) => records.get(id) ?? []) : []}
				<li class="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
					{@render kindTag(decision)}
					<p class="mt-1 text-sm text-slate-800">{decision.reason}</p>
					{@render recordLinks(decision)}

					{#if compared.length}
						<div class="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
							<table class="w-full text-left text-xs">
								<thead class="bg-slate-50 text-slate-500">
									<tr>
										<th class="px-2 py-1.5 font-medium"><span class="sr-only">Field</span></th>
										{#each compared as record (record.id)}
											<th class="px-2 py-1.5 font-medium">{describe(record.id)}</th>
										{/each}
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each COMPARE as field (field)}
										{@const values = compared.map((record) => record.fields[field]?.value)}
										{@const differs = new Set(values.filter(Boolean)).size > 1}
										<tr>
											<th scope="row" class="whitespace-nowrap px-2 py-1.5 font-medium text-slate-500">{FIELD_LABEL[field]}</th>
											{#each values as value, i (i)}
												<td class={['px-2 py-1.5 align-top', differs ? 'bg-amber-50 font-medium text-amber-900' : 'text-slate-700']}>
													{value ?? '—'}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					<fieldset class="mt-3">
						<legend class="sr-only">Choose how to resolve</legend>
						<div class="space-y-1">
							{#each decision.options as option (option.id)}
								<label
									class={[
										'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
										pick === option.id ? 'bg-white text-slate-900 ring-1 ring-slate-300' : 'text-slate-700 hover:bg-white/70'
									]}
								>
									<input
										type="radio"
										class="accent-blue-700"
										name={decision.id}
										value={option.id}
										checked={pick === option.id}
										onchange={() => (picks[decision.id] = option.id)}
									/>
									<span class="flex-1">{option.label}</span>
									{#if option.id === decision.suggested}
										<span class="rounded bg-blue-50 px-1.5 py-px text-[11px] font-medium text-blue-700">Suggested</span>
									{/if}
								</label>
							{/each}
						</div>
					</fieldset>
					<div class="mt-2 flex justify-end">
						<button
							type="button"
							class="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-800"
							onclick={() => session.choose(decision.id, pick)}
						>
							Apply
						</button>
					</div>
				</li>
			{/each}
		</ul>
	</section>

	{#if chosenByUser.length}
		<section aria-labelledby="your-choices-heading">
			<h3 id="your-choices-heading" class="text-sm font-semibold text-slate-950">Your choices</h3>
			<ul class="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
				{#each chosenByUser as decision (decision.id)}
					<li class="flex items-start justify-between gap-3 p-3">
						<div class="min-w-0">
							{@render kindTag(decision)}
							<p class="mt-0.5 text-sm font-medium text-slate-900">{label(decision, decision.chosen)}</p>
							<p class="mt-0.5 line-clamp-3 text-xs text-slate-500" title={decision.reason}>{decision.reason}</p>
							{@render recordLinks(decision)}
						</div>
						<button
							type="button"
							class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
							onclick={() => {
								// A decision that goes back to pending starts again from its suggestion.
								delete picks[decision.id];
								session.resetDecision(decision.id);
							}}
						>
							<RotateCcw size={13} /> Revert
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="auto-heading">
		<h3 id="auto-heading" class="flex items-center gap-2 text-sm font-semibold text-slate-950">
			<CircleCheck size={15} class="text-emerald-600" /> Applied automatically
		</h3>
		<p class="mt-1 text-xs leading-5 text-slate-500">Certain cases are handled by policy. Undo any of them.</p>
		{#if automatic.length === 0}
			<p class="mt-2 text-sm text-slate-500">None.</p>
		{/if}
		<div class="mt-2 space-y-2">
			{#each automatic as [kind, group] (kind)}
				{@const isCollapsed = collapsed[kind] ?? group.length > OPEN_UP_TO}
				{@const shown = showAll[kind] ? group : group.slice(0, LIST_UP_TO)}
				<div class="rounded-lg border border-slate-200 bg-white">
					<button
						type="button"
						class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
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
										<p class="text-sm text-slate-800">{label(decision, decision.chosen)}</p>
										<p class="mt-0.5 line-clamp-3 break-words text-xs text-slate-500" title={decision.reason}>
											{decision.reason}
										</p>
										{@render recordLinks(decision)}
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
									<button
										type="button"
										class="text-xs font-medium text-blue-700 hover:text-blue-900"
										onclick={() => (showAll[kind] = true)}
									>
										Show all {group.length}
									</button>
								</li>
							{/if}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	</section>
</div>
