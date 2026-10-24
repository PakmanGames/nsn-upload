<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check-big';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { tick } from 'svelte';
	import type { CandidateRecord, Decision, SheetAnalysis, StoredMapping } from '$lib/import/model';
	import type { ImportSession } from '$lib/import/session.svelte';
	import DecisionComparison from './DecisionComparison.svelte';
	import ExplanationText from './ExplanationText.svelte';
	import TechnicalDetails from './TechnicalDetails.svelte';
	import { FIELD_LABEL, recordLabel } from './labels';
	import { describeGroup, shapeOf, similarDecisions } from './similar';
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
	/** The decision whose "Also apply" box is checked; any other decision starts unchecked. */
	let alsoFor = $state<string | null>(null);
	/** Read by screen readers after each step, since focus stays on the button that was pressed. */
	let announcement = $state('');
	let headingEl = $state<HTMLElement>();
	let applyEl = $state<HTMLButtonElement>();
	let doneEl = $state<HTMLElement>();

	const pending = $derived(stage.filter((decision) => decision.state === 'pending'));
	const list = $derived(reviewing ? stage : pending);
	const current = $derived(list.find((decision) => decision.id === currentId) ?? list[0]);
	const index = $derived(current ? list.indexOf(current) : -1);
	const heading = $derived(current ? decisionHeading(current, records, sheets) : undefined);
	const pick = $derived(current ? (picks[current.id] ?? current.chosen ?? current.suggested) : '');
	const pickLabel = $derived(current?.options.find((option) => option.id === pick)?.label ?? '');
	/** Pending decisions the picked option can settle the same way; recomputed when the pick changes. */
	const similar = $derived(current ? similarDecisions(current, pick, stage, records) : []);
	const alsoSimilar = $derived(!!current && alsoFor === current.id && similar.length > 0);

	/** Decisions applied together and still sharing that choice show as one line; the rest one line each. */
	const doneLines = $derived.by(() => {
		const byId = new Map(stage.map((decision) => [decision.id, decision]));
		const lineOf = new Map<string, Decision[]>();
		for (const group of session.decisionGroups) {
			const members = group.ids.flatMap((id) => byId.get(id) ?? []).filter((d) => d.state === 'user' && d.chosen === group.option);
			if (members.length > 1) for (const member of members) lineOf.set(member.id, members);
		}
		// A group's line sits where its first decision is.
		return stage.flatMap((decision) => {
			const members = lineOf.get(decision.id);
			if (members && members[0] !== decision) return [];
			const text = members ? capitalize(describeGroup(decision, members.length, records)) : decisionHeading(decision, records, sheets).title;
			return [{ key: decision.id, ids: (members ?? [decision]).map(({ id }) => id), text, label: label(decision) }];
		});
	});

	const BADGE: Record<DecisionHeading['tone'], string> = {
		conflict: 'bg-orange-50 text-orange-800 ring-orange-600/25',
		review: 'bg-amber-50 text-amber-800 ring-amber-600/25',
		saved: 'bg-blue-50 text-blue-700 ring-blue-600/20'
	};
	const label = (decision: Decision) =>
		decision.options.find((option) => option.id === decision.chosen)?.label ?? decision.chosen ?? '';
	const own = $derived(current ? current.recordIds.flatMap((id) => records.get(id) ?? []) : []);
	// A link names its sheet unless the heading already does: records on different sheets each need theirs,
	// and a storage conflict's heading names the item, not where it is.
	const linkSheets = $derived(
		new Set(own.map((record) => record.sheet)).size > 1 || current?.kind === 'resolve-storage-conflict'
	);
	const plainText = $derived(current && session.plainExplanations.get(current.id));
	const shownText = $derived(current && session.explanations.get(current.id));
	const suggestion = $derived(current?.options.find((option) => option.id === current.suggested)?.label);
	const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
	const ROW_KINDS = new Set<Decision['kind']>(['resolve-identifier-conflict', 'split-cell', 'ambiguous-multi-value', 'import-valid-portion', 'resolve-storage-conflict']);

	/** A similar decision in the "Show rows" list: similar decisions share the current one's table, so "Row 11" is enough. */
	function memberLabel(decision: Decision): string {
		const first = records.get(decision.recordIds[0]);
		if (!first || !ROW_KINDS.has(decision.kind)) return decisionHeading(decision, records, sheets).title;
		const part = first.fields.part?.value;
		return `Row ${first.sourceRow}${part ? ` · ${part}` : ''}`;
	}

	/** "Decision 2 of 28: row 11, NSN disagrees with FSC". */
	function spoken(decision: Decision): string {
		const position = `Decision ${stage.indexOf(decision) + 1} of ${stage.length}`;
		const first = records.get(decision.recordIds[0]);
		if (decision.kind === 'resolve-identifier-conflict' && first) {
			const fields = shapeOf(decision, records).map((field) => FIELD_LABEL[field]);
			return `${position}: row ${first.sourceRow}, NSN disagrees with ${fields.join(' and ')}`;
		}
		const { title, kind } = decisionHeading(decision, records, sheets);
		return `${position}: ${title}${kind ? `, ${kind.toLowerCase()}` : ''}`;
	}

	/** After a step, keeps focus where the user is (Apply), or on the done list once nothing is left. */
	async function settle(prefix = '') {
		await tick();
		if (current) {
			// preventScroll: focusing must never move the card under the pointer.
			applyEl?.focus({ preventScroll: true });
			announcement = `${prefix}${spoken(current)}`;
		} else {
			doneEl?.focus();
			announcement = `${prefix}${stage.length === 1 ? '1 decision made' : `All ${stage.length} decisions made`}`;
		}
	}

	function move(step: number) {
		currentId = list[(index + step + list.length) % list.length].id;
		void settle();
	}

	/**
	 * Applies the pick to the current decision, or to it and its similar decisions, then shows the next one.
	 * Everything is read and applied synchronously, so a click queued behind a slow analysis lands on the
	 * next decision's own button and applies exactly that decision.
	 */
	function apply() {
		if (!current) return;
		const decision = current;
		const group = alsoSimilar ? [decision, ...similar] : [decision];
		const covered = new Set(group.map(({ id }) => id));
		// The next one to show: the following decision, wrapping around the pending ones; reviewing stops at the end.
		const next = reviewing
			? (list[index + 1]?.id ?? null)
			: ([...list.slice(index + 1), ...list.slice(0, index)].find(({ id }) => !covered.has(id))?.id ?? null);
		if (reviewing && next === null) reviewing = false;
		if (group.length > 1) session.chooseMany([...covered], pick);
		else session.choose(decision.id, pick);
		const applied = group.length > 1 ? `Applied "${pickLabel}" to ${group.length} decisions. ` : '';
		for (const { id } of group) delete picks[id];
		alsoFor = null;
		currentId = next;
		void settle(applied);
	}

	/** Brings the line's decisions back to pending and shows the first of them. */
	function revert(ids: string[]) {
		session.resetDecisions(ids);
		currentId = ids[0];
		void settle();
	}

	async function review() {
		reviewing = true;
		currentId = stage[0]?.id ?? null;
		await tick();
		headingEl?.focus();
	}

	async function doneReviewing() {
		reviewing = false;
		await tick();
		doneEl?.focus();
	}
</script>

<p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

{#if current && heading}
	<!--
		A fixed height keeps the action row, and "Apply and continue" with it, at the same place for every decision:
		a longer explanation or a larger comparison scrolls inside the card instead of pushing the buttons down.
	-->
	<section
		aria-labelledby="decision-stage-label"
		class="flex h-[clamp(25rem,calc(100dvh-20rem),36rem)] flex-col rounded-xl border-2 border-amber-300 bg-white shadow-sm sm:h-[clamp(25rem,calc(100dvh-13rem),36rem)]"
	>
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-t-[10px] border-b border-amber-200 bg-amber-50 px-4 py-2.5">
			<p id="decision-stage-label" class="text-xs font-semibold uppercase tracking-wide text-amber-800">
				{reviewing ? 'Your decision' : 'Needs your decision'} · {stage.indexOf(current) + 1} of {stage.length}
			</p>
			<div class="flex items-center gap-3">
				<div class="flex flex-wrap items-center gap-1" aria-hidden="true">
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
					<button type="button" class="shrink-0 text-xs font-medium text-blue-700 hover:text-blue-900" onclick={doneReviewing}>
						Done reviewing
					</button>
				{/if}
			</div>
		</div>
		<!-- Keyed, so each decision starts scrolled to the top with its disclosures closed. -->
		{#key current.id}
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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
				<div class="mt-1.5 text-sm">
					{#if plainText}
						<ExplanationText plain={plainText} shown={shownText} reserveMarker={session.aiEnabled} />
					{:else}
						<p class="text-slate-600">{current.reason}</p>
					{/if}
					{#if suggestion}
						<p class="mt-1.5 text-slate-700">Suggested: <span class="font-medium text-slate-900">{suggestion}</span></p>
					{/if}
					{#if current.kind !== 'include-table' && own.length}
						<p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
							{#each own as record (record.id)}
								<button type="button" class="text-blue-700 hover:text-blue-900 hover:underline" onclick={() => onOpenRecord(record.id)}>
									{recordLabel(record, { sheet: linkSheets })}
								</button>
							{/each}
						</p>
					{/if}
					<div class="mt-1.5"><TechnicalDetails text={current.reason} /></div>
				</div>

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

				{#if similar.length}
					<div class="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
						<label class="flex cursor-pointer items-start gap-2.5">
							<input
								type="checkbox"
								class="mt-0.5 accent-blue-700"
								checked={alsoSimilar}
								onchange={(event) => (alsoFor = event.currentTarget.checked ? current.id : null)}
							/>
							<span class="min-w-0 text-slate-800 [overflow-wrap:anywhere]">
								Also apply "{pickLabel}" to the {describeGroup(current, similar.length, records, true)}
							</span>
						</label>
						<details class="group mt-1.5 pl-6">
							<summary class="cursor-pointer text-xs font-medium text-blue-700 hover:text-blue-900">
								<span class="group-open:hidden">Show {current.kind === 'include-table' ? 'tables' : 'rows'}</span>
								<span class="hidden group-open:inline">Hide {current.kind === 'include-table' ? 'tables' : 'rows'}</span>
							</summary>
							<ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
								{#each similar as decision (decision.id)}
									<li>
										{#if decision.kind === 'include-table'}
											<span class="text-slate-600">{memberLabel(decision)}</span>
										{:else}
											<button
												type="button"
												class="text-blue-700 hover:text-blue-900 hover:underline"
												onclick={() => onOpenRecord(decision.recordIds[0])}
											>
												{memberLabel(decision)}
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						</details>
					</div>
				{/if}
			</div>
		{/key}

		<!-- On phones Apply takes its own full-width row on top, so the three buttons never wrap unevenly. -->
		<div class="flex shrink-0 flex-col-reverse gap-2 rounded-b-[10px] border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
				bind:this={applyEl}
				type="button"
				class="w-full rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 sm:ml-auto sm:w-auto"
				onclick={apply}
			>
				Apply and continue
			</button>
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
			{#each doneLines as line (line.key)}
				<li class="flex items-start justify-between gap-3">
					<span class="min-w-0 [overflow-wrap:anywhere]">{line.text}: <span class="font-medium">{line.label}</span></span>
					<button
						type="button"
						class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
						aria-label={`Revert ${line.text}`}
						onclick={() => revert(line.ids)}
					>
						<RotateCcw size={12} /> Revert
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
