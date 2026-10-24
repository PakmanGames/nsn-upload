<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check-big';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { tick } from 'svelte';
	import type { CandidateRecord, Decision, SheetAnalysis, StoredMapping } from '$lib/import/model';
	import type { ImportSession } from '$lib/import/session.svelte';
	import DecisionComparison from './DecisionComparison.svelte';
	import { decisionHeading, type DecisionHeading } from './summary';

	type Props = {
		session: ImportSession;
		/** Every decision that has needed the user in this file, pending or already chosen, in workbook order. */
		stage: Decision[];
		records: Map<string, CandidateRecord>;
		saved: Map<string, StoredMapping>;
		sheets: SheetAnalysis[];
		aiTables: Set<string>;
		onOpenRecord: (recordId: string) => void;
	};

	let { session, stage, records, saved, sheets, aiTables, onOpenRecord }: Props = $props();

	/** Reviewing walks through decisions already made, with their current choices preselected. */
	let reviewing = $state(false);
	let currentId = $state<string | null>(null);
	/** Options picked but not applied yet; a decision without one shows its choice or its suggestion. */
	let picks = $state<Record<string, string>>({});
	let headingEl = $state<HTMLElement>();
	let doneEl = $state<HTMLElement>();

	const pending = $derived(stage.filter((decision) => decision.state === 'pending'));
	const list = $derived(reviewing ? stage : pending);
	const current = $derived(list.find((decision) => decision.id === currentId) ?? list[0]);
	const index = $derived(current ? list.indexOf(current) : -1);
	const heading = $derived(current ? decisionHeading(current, records, sheets) : undefined);
	const pick = $derived(current ? (picks[current.id] ?? current.chosen ?? current.suggested) : '');

	const BADGE: Record<DecisionHeading['tone'], string> = {
		conflict: 'bg-orange-50 text-orange-800 ring-orange-600/25',
		review: 'bg-amber-50 text-amber-800 ring-amber-600/25',
		saved: 'bg-blue-50 text-blue-700 ring-blue-600/20'
	};
	const label = (decision: Decision) =>
		decision.options.find((option) => option.id === decision.chosen)?.label ?? decision.chosen ?? '';
	const describe = (id: string) => {
		const record = records.get(id);
		return record ? `${record.sheet} row ${record.sourceRow}${record.split ? ` (${record.split.index}/${record.split.total})` : ''}` : id;
	};

	function move(step: number) {
		currentId = list[(index + step + list.length) % list.length].id;
	}

	async function apply() {
		if (!current) return;
		const decision = current;
		// The next one to show: the following decision, wrapping around the pending ones; reviewing stops at the end.
		const next = reviewing
			? (list[index + 1]?.id ?? null)
			: ([...list.slice(index + 1), ...list.slice(0, index)][0]?.id ?? null);
		if (reviewing && next === null) reviewing = false;
		session.choose(decision.id, pick);
		delete picks[decision.id];
		currentId = next;
		await tick();
		(current ? headingEl : doneEl)?.focus();
	}

	async function review() {
		reviewing = true;
		currentId = stage[0]?.id ?? null;
		await tick();
		headingEl?.focus();
	}
</script>

{#if current && heading}
	<section aria-labelledby="decision-stage-label" class="rounded-xl border-2 border-amber-300 bg-white shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2 rounded-t-[10px] border-b border-amber-200 bg-amber-50 px-4 py-2.5">
			<p id="decision-stage-label" class="text-xs font-semibold uppercase tracking-wide text-amber-800">
				{reviewing ? 'Your decision' : 'Needs your decision'} · {stage.indexOf(current) + 1} of {stage.length}
			</p>
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1" aria-hidden="true">
					{#each stage as decision (decision.id)}
						<span
							class={[
								'size-2 rounded-full',
								decision === current ? 'bg-amber-600' : decision.state === 'user' ? 'bg-emerald-500' : 'bg-amber-300'
							]}
						></span>
					{/each}
				</div>
				{#if reviewing}
					<button type="button" class="text-xs font-medium text-blue-700 hover:text-blue-900" onclick={() => (reviewing = false)}>
						Done reviewing
					</button>
				{/if}
			</div>
		</div>
		<div class="p-4">
			<div class="flex flex-wrap items-center gap-2">
				<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[heading.tone]]}>
					{heading.badge}
				</span>
				{#if heading.kind}<span class="text-xs font-medium text-slate-500">{heading.kind}</span>{/if}
				{#if current.tableId && aiTables.has(current.tableId)}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
					>
						<Sparkles size={11} /> AI
					</span>
				{/if}
			</div>
			<h3 bind:this={headingEl} tabindex="-1" class="mt-1.5 font-semibold text-slate-950 outline-none [overflow-wrap:anywhere]">
				{heading.title}
			</h3>
			<p class="mt-1 text-sm text-slate-600">{current.reason}</p>
			{#if current.kind !== 'include-table' && current.recordIds.length}
				<p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
					{#each current.recordIds as id (id)}
						<button type="button" class="text-blue-700 hover:text-blue-900 hover:underline" onclick={() => onOpenRecord(id)}>
							{describe(id)}
						</button>
					{/each}
				</p>
			{/if}

			<DecisionComparison decision={current} {records} {saved} />

			<fieldset class="mt-3 space-y-1.5">
				<legend class="sr-only">Choose an option</legend>
				{#each current.options as option (option.id)}
					<label
						class={[
							'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition',
							pick === option.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'
						]}
					>
						<input
							type="radio"
							class="mt-0.5 accent-blue-700"
							name={`decision-${current.id}`}
							value={option.id}
							checked={pick === option.id}
							onchange={() => (picks[current.id] = option.id)}
						/>
						<span class="min-w-0 flex-1 font-medium text-slate-900">{option.label}</span>
						{#if option.id === current.suggested}
							<span class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
								Suggested
							</span>
						{/if}
					</label>
				{/each}
			</fieldset>

			<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
						disabled={list.length < 2}
						onclick={() => move(-1)}
					>
						Previous
					</button>
					<button
						type="button"
						class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
						disabled={list.length < 2}
						onclick={() => move(1)}
					>
						{reviewing ? 'Next' : 'Skip for now'}
					</button>
				</div>
				<button
					type="button"
					class="ml-auto rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800"
					onclick={apply}
				>
					Apply and continue
				</button>
			</div>
		</div>
	</section>
{:else if stage.length}
	<section aria-labelledby="decisions-made" class="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
		<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
			<h3 id="decisions-made" bind:this={doneEl} tabindex="-1" class="flex items-center gap-2 font-medium text-emerald-800 outline-none">
				<CircleCheck size={16} />
				{stage.length === 1 ? '1 decision made' : `All ${stage.length} decisions made`}
			</h3>
			<button type="button" class="font-medium text-blue-700 hover:text-blue-900" onclick={review}>Review my choices</button>
		</div>
		<ul class="mt-1.5 space-y-0.5 text-sm text-emerald-900/90">
			{#each stage as decision (decision.id)}
				<li class="[overflow-wrap:anywhere]">
					{decisionHeading(decision, records, sheets).title}: <span class="font-medium">{label(decision)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
