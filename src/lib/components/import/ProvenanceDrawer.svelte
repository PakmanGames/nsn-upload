<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import { FIELDS, type CandidateRecord, type Decision, type Field, type Severity } from '$lib/import/model';
	import { qualifiedRef } from '$lib/import/refs';
	import { DECISION_KIND_LABEL, FIELD_LABEL, ISSUE_LABEL, RECORD_STATUS, TRANSFORM_LABEL } from './labels';

	type Props = {
		record: CandidateRecord;
		fileName: string;
		decisions: Decision[];
		/** Resolves related record ids to a readable "Sheet row N" label, or null when not found. */
		describe: (recordId: string) => string | null;
		onOpenRecord: (recordId: string) => void;
		onClose: () => void;
	};

	let { record, fileName, decisions, describe, onOpenRecord, onClose }: Props = $props();

	const SEVERITY: Record<Severity, { icon: typeof Info; style: string }> = {
		error: { icon: CircleAlert, style: 'text-red-600' },
		warning: { icon: TriangleAlert, style: 'text-amber-600' },
		info: { icon: Info, style: 'text-blue-600' }
	};

	const status = $derived(RECORD_STATUS[record.status]);
	const fields = $derived(FIELDS.filter((field) => record.fields[field]));
	const rejected = $derived(FIELDS.filter((field) => record.rejected[field]));
	// Table inclusion covers every record of the table, so it says nothing about this row in particular.
	const related = $derived(
		decisions.filter((decision) => decision.kind !== 'include-table' && decision.recordIds.includes(record.id))
	);
	const issueFor = (field: Field) => record.issues.find((issue) => issue.field === field && issue.code === 'invalid-identifier');
	const chosenLabel = (decision: Decision) =>
		decision.options.find((option) => option.id === decision.chosen)?.label ?? 'Waiting for you';

	let closeButton = $state<HTMLButtonElement>();
	$effect(() => {
		void record.id;
		closeButton?.focus();
	});
</script>

<aside
	class="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
	aria-labelledby="drawer-heading"
>
	<header class="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
		<div class="min-w-0">
			<p class="truncate text-xs text-slate-500">{fileName}</p>
			<h3 id="drawer-heading" class="mt-0.5 text-base font-semibold text-slate-950">
				{record.sheet} · row {record.sourceRow}
			</h3>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
				<span class={['inline-flex rounded-full px-2 py-0.5 font-medium ring-1 ring-inset', status.style]}>{status.label}</span>
				<span class={record.approved ? 'text-emerald-700' : 'text-slate-500'}>
					{record.approved ? 'Will be imported' : 'Not imported'}
				</span>
				{#if record.split}
					<span class="text-blue-700">Value {record.split.index} of {record.split.total} from {record.split.cell}</span>
				{/if}
			</div>
		</div>
		<button
			bind:this={closeButton}
			type="button"
			class="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
			aria-label="Close details"
			onclick={onClose}
		>
			<X size={18} />
		</button>
	</header>

	<div class="flex-1 space-y-6 overflow-y-auto px-5 py-4">
		<section aria-labelledby="drawer-values">
			<h4 id="drawer-values" class="text-xs font-semibold uppercase tracking-wide text-slate-500">Values</h4>
			{#if fields.length === 0}
				<p class="mt-2 text-sm text-slate-500">No valid values in this row.</p>
			{/if}
			<ul class="mt-2 space-y-2">
				{#each fields as field (field)}
					{@const value = record.fields[field]!}
					{@const provenance = value.provenance}
					<li class="rounded-lg border border-slate-200 p-3">
						<div class="flex items-baseline justify-between gap-3">
							<span class="text-xs font-medium text-slate-500">{FIELD_LABEL[field]}</span>
							{#if provenance.origin === 'derived'}
								<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
									derived from {provenance.derivedFrom?.join(', ')}
								</span>
							{/if}
						</div>
						<p class={['mt-1 whitespace-pre-line break-words text-sm text-slate-900', field !== 'description' && 'font-mono']}>
							{value.value}
						</p>
						<dl class="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
							<dt class="text-slate-500">Cell</dt>
							<dd class="font-mono text-slate-800">{qualifiedRef(provenance.sheet, provenance.cell)}</dd>
							<dt class="text-slate-500">Original</dt>
							<dd class="whitespace-pre-wrap break-words font-mono text-slate-800">"{provenance.original}"</dd>
							{#if provenance.transforms.length}
								<dt class="text-slate-500">Changes</dt>
								<dd class="flex flex-wrap gap-1">
									{#each provenance.transforms as transform (transform)}
										<span class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800">{TRANSFORM_LABEL[transform]}</span>
									{/each}
								</dd>
							{/if}
						</dl>
					</li>
				{/each}
			</ul>
		</section>

		{#if rejected.length}
			<section aria-labelledby="drawer-rejected">
				<h4 id="drawer-rejected" class="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected values</h4>
				<ul class="mt-2 space-y-2">
					{#each rejected as field (field)}
						{@const value = record.rejected[field]!}
						<li class="rounded-lg border border-red-200 bg-red-50/50 p-3">
							<div class="flex items-baseline justify-between gap-3">
								<span class="text-xs font-medium text-red-800">{FIELD_LABEL[field]}</span>
								<span class="font-mono text-xs text-red-800">{qualifiedRef(record.sheet, value.cell)}</span>
							</div>
							<p class="mt-1 whitespace-pre-wrap break-words font-mono text-sm text-red-900">
								{value.original ? `"${value.original}"` : 'Excel error (no text)'}
							</p>
							{#if issueFor(field)}
								<p class="mt-1 text-xs text-red-800">{issueFor(field)?.message}</p>
							{/if}
							<p class="mt-1 text-xs text-slate-500">Never imported.</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section aria-labelledby="drawer-issues">
			<h4 id="drawer-issues" class="text-xs font-semibold uppercase tracking-wide text-slate-500">
				Issues ({record.issues.length})
			</h4>
			{#if record.issues.length === 0}
				<p class="mt-2 text-sm text-slate-500">None.</p>
			{/if}
			<ul class="mt-2 space-y-3">
				{#each record.issues as issue, i (i)}
					{@const severity = SEVERITY[issue.severity]}
					<li class="flex gap-2.5">
						<severity.icon size={15} class={['mt-0.5 shrink-0', severity.style]} />
						<div class="min-w-0 text-sm">
							<p class="font-medium text-slate-900">{ISSUE_LABEL[issue.code]}</p>
							<p class="mt-0.5 text-slate-600">{issue.message}</p>
							{#if issue.cells.length}
								<p class="mt-1 font-mono text-xs text-slate-500">{issue.cells.join(', ')}</p>
							{/if}
							{#if issue.relatedRecords?.length}
								<p class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
									{#each issue.relatedRecords as id (id)}
										<button type="button" class="text-blue-700 hover:text-blue-900 hover:underline" onclick={() => onOpenRecord(id)}>
											{describe(id) ?? id}
										</button>
									{/each}
								</p>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>

		{#if related.length}
			<section aria-labelledby="drawer-decisions">
				<h4 id="drawer-decisions" class="text-xs font-semibold uppercase tracking-wide text-slate-500">Decisions</h4>
				<ul class="mt-2 space-y-2">
					{#each related as decision (decision.id)}
						<li class="rounded-lg border border-slate-200 p-3 text-sm">
							<p class="text-xs font-medium text-slate-500">{DECISION_KIND_LABEL[decision.kind]}</p>
							<p class="mt-0.5 text-slate-700">{decision.reason}</p>
							<p class="mt-1 text-xs">
								<span class={decision.state === 'pending' ? 'text-amber-700' : 'text-slate-500'}>
									{decision.state === 'pending' ? 'Needs you' : decision.state === 'user' ? 'Chosen by you' : 'Applied automatically'}:
								</span>
								<span class="font-medium text-slate-800">{chosenLabel(decision)}</span>
							</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</aside>
