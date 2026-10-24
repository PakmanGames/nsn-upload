<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Search from '@lucide/svelte/icons/search';
	import type { CandidateRecord, Field } from '$lib/import/model';
	import { qualifiedRef } from '$lib/import/refs';
	import { RECORD_STATUS, plural, type RecordFilter } from './labels';

	type Props = {
		/** Records of included and pending tables; excluded tables are left out, as in the summary. */
		records: CandidateRecord[];
		sheetNames: string[];
		filter: RecordFilter;
		/** 'all' or a sheet name. */
		scope: string;
		activeRecordId: string | null;
		onOpen: (record: CandidateRecord) => void;
	};

	let { records, sheetNames, filter = $bindable(), scope = $bindable(), activeRecordId, onOpen }: Props = $props();

	const pageSize = 100;
	let query = $state('');
	let page = $state(0);

	const COLUMNS: Array<{ field: Field; label: string; mono: boolean }> = [
		{ field: 'part', label: 'Part number', mono: false },
		{ field: 'description', label: 'Description', mono: false },
		{ field: 'nsn', label: 'NSN', mono: true },
		{ field: 'niin', label: 'NIIN', mono: true },
		{ field: 'cage', label: 'CAGE', mono: true }
	];

	const FILTERS: Array<{ id: RecordFilter; label: string }> = [
		{ id: 'all', label: 'All' },
		{ id: 'valid', label: 'Valid' },
		{ id: 'warning', label: 'Warnings' },
		{ id: 'invalid', label: 'Invalid' },
		{ id: 'duplicate', label: 'Duplicates' },
		{ id: 'conflict', label: 'Conflicts' },
		{ id: 'split', label: 'Split' },
		{ id: 'pending', label: 'Pending' }
	];

	const matches = (record: CandidateRecord, id: RecordFilter) =>
		id === 'all' || (id === 'split' ? !!record.split : record.status === id);

	const scoped = $derived(scope === 'all' ? records : records.filter((record) => record.sheet === scope));

	/** Values, rejected originals, and cell refs (bare and sheet-qualified), lowercased for search. */
	const searchText = $derived(
		new Map(
			scoped.map((record) => {
				const parts: string[] = [record.sheet, `row ${record.sourceRow}`];
				for (const value of Object.values(record.fields)) {
					parts.push(value.value, value.provenance.cell, qualifiedRef(record.sheet, value.provenance.cell));
				}
				for (const rejected of Object.values(record.rejected)) {
					parts.push(rejected.original, rejected.cell, qualifiedRef(record.sheet, rejected.cell));
				}
				return [record.id, parts.join('\n').toLowerCase()];
			})
		)
	);

	const counts = $derived(
		Object.fromEntries(FILTERS.map(({ id }) => [id, scoped.filter((record) => matches(record, id)).length]))
	);
	const visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return scoped.filter(
			(record) => matches(record, filter) && (!needle || searchText.get(record.id)!.includes(needle))
		);
	});
	const pageCount = $derived(Math.max(1, Math.ceil(visible.length / pageSize)));
	const pageRows = $derived(visible.slice(page * pageSize, (page + 1) * pageSize));

	// Any change to what is listed starts again at the first page.
	$effect(() => {
		void [filter, scope, query];
		page = 0;
	});
	$effect(() => {
		if (page >= pageCount) page = pageCount - 1;
	});

	function firstIssue(record: CandidateRecord) {
		return record.issues.find((issue) => issue.severity === 'error') ?? record.issues.find((issue) => issue.severity === 'warning') ?? record.issues[0];
	}
</script>

<section id="preview" aria-labelledby="preview-heading" class="rounded-lg border border-slate-200 bg-white shadow-sm">
	<div class="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
		<div>
			<h3 id="preview-heading" class="text-sm font-semibold text-slate-950">Preview</h3>
			<p class="mt-0.5 text-xs text-slate-500">Select a row to see where each value came from.</p>
		</div>
		<div class="flex flex-col gap-2 sm:flex-row">
			<select
				class="rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
				aria-label="Sheet"
				bind:value={scope}
			>
				<option value="all">All sheets</option>
				{#each sheetNames as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			<label class="relative block">
				<span class="sr-only">Search values and cells</span>
				<Search class="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
				<input
					class="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-60"
					type="search"
					placeholder="Search values or cells (D136)…"
					bind:value={query}
				/>
			</label>
		</div>
	</div>

	<div class="overflow-x-auto border-b border-slate-200">
		<div class="flex min-w-max gap-1 px-3 py-2" role="tablist" aria-label="Filter by status">
			{#each FILTERS as option (option.id)}
				<button
					type="button"
					role="tab"
					aria-selected={filter === option.id}
					class={[
						'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
						filter === option.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
					]}
					onclick={() => (filter = option.id)}
				>
					{option.label}
					<span
						class={[
							'rounded px-1.5 py-px text-[11px] tabular-nums',
							filter === option.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
						]}
					>
						{counts[option.id]}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full min-w-[56rem] border-collapse text-left text-sm">
			<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
				<tr>
					<th class="w-10 px-3 py-2.5 font-medium"><span class="sr-only">Imports</span></th>
					<th class="px-3 py-2.5 font-medium">Source</th>
					{#each COLUMNS as column (column.field)}
						<th class="px-3 py-2.5 font-medium">{column.label}</th>
					{/each}
					<th class="px-3 py-2.5 font-medium">Status</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each pageRows as record (record.id)}
					{@const status = RECORD_STATUS[record.status]}
					{@const issue = firstIssue(record)}
					<tr
						class={[
							'cursor-pointer align-top transition hover:bg-slate-50',
							activeRecordId === record.id && 'bg-blue-50/60 hover:bg-blue-50',
							!record.approved && 'text-slate-500'
						]}
						onclick={() => onOpen(record)}
					>
						<td class="px-3 py-2.5">
							{#if record.approved}
								<Check size={15} class="text-emerald-600" />
								<span class="sr-only">Will be imported</span>
							{:else}
								<Minus size={15} class="text-slate-400" />
								<span class="sr-only">Not imported</span>
							{/if}
						</td>
						<td class="whitespace-nowrap px-3 py-2.5">
							<button
								type="button"
								class="rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
								aria-label={`Details for ${record.sheet} row ${record.sourceRow}${record.split ? `, value ${record.split.index} of ${record.split.total}` : ''}`}
								onclick={(event) => {
									event.stopPropagation();
									onOpen(record);
								}}
							>
								<span class="block max-w-40 truncate text-xs text-slate-500">{record.sheet}</span>
								<span class="block text-xs font-medium text-slate-800">Row {record.sourceRow}</span>
								{#if record.split}
									<span class="mt-0.5 block text-[11px] text-blue-700">
										{record.split.index} of {record.split.total} from {record.split.cell}
									</span>
								{/if}
							</button>
						</td>
						{#each COLUMNS as column (column.field)}
							{@const value = record.fields[column.field]}
							{@const rejected = record.rejected[column.field]}
							<td class={['px-3 py-2.5', column.field === 'description' ? 'max-w-64' : 'whitespace-nowrap']}>
								{#if value}
									<span
										class={[
											'block',
											column.mono ? 'font-mono text-xs' : 'whitespace-pre-line',
											column.field === 'description' && 'line-clamp-2',
											record.approved ? 'text-slate-800' : 'text-slate-500'
										]}
									>
										{value.value}
									</span>
									{#if value.provenance.origin === 'derived'}
										<span class="mt-0.5 block text-[11px] text-slate-500">
											derived from {value.provenance.derivedFrom?.join(', ')}
										</span>
									{/if}
								{:else if rejected}
									<span class="block font-mono text-xs text-red-700 line-through decoration-red-400" title="Rejected value">
										{rejected.original || 'Excel error'}
									</span>
									<span class="mt-0.5 block text-[11px] text-red-700">rejected · {rejected.cell}</span>
								{:else}
									<span class="text-slate-300">—</span>
								{/if}
							</td>
						{/each}
						<td class="px-3 py-2.5">
							<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', status.style]}>
								{status.label}
							</span>
							{#if issue}
								<span class="mt-1 block max-w-64 truncate text-xs text-slate-500" title={issue.message}>
									{issue.message}
								</span>
								{#if record.issues.length > 1}
									<span class="block text-[11px] text-slate-400">+{record.issues.length - 1} more</span>
								{/if}
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan={COLUMNS.length + 3} class="px-4 py-12 text-center">
							<p class="text-sm font-medium text-slate-700">No records match</p>
							<p class="mt-1 text-xs text-slate-500">Try another status, sheet, or search.</p>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
		<p class="text-xs text-slate-500">
			{#if visible.length}
				Showing {page * pageSize + 1}-{page * pageSize + pageRows.length} of {plural(visible.length, 'record')}
			{:else}
				No records
			{/if}
		</p>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
				disabled={page === 0}
				onclick={() => (page -= 1)}
			>
				Previous
			</button>
			<span class="text-xs text-slate-500">Page {page + 1} of {pageCount}</span>
			<button
				type="button"
				class="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
				disabled={page >= pageCount - 1}
				onclick={() => (page += 1)}
			>
				Next
			</button>
		</div>
	</div>
</section>
