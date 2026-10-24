<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Minus from '@lucide/svelte/icons/minus';
	import Search from '@lucide/svelte/icons/search';
	import type { Explanation } from '$lib/import/explain';
	import type { CandidateRecord, Field, Issue, TableCandidate } from '$lib/import/model';
	import { qualifiedRef } from '$lib/import/refs';
	import type { SheetFocus } from '$lib/import/session.svelte';
	import { RECORD_STATUS, SKIP_REASON, plural, type RecordFilter } from './labels';
	import { recordsFocus } from './sheet-view/focus';
	import type { SkippedGroup } from './skipped';

	type Props = {
		/** Records of tables that are not held back; held-back tables fold into one line each below the table. */
		records: CandidateRecord[];
		/** `label` names the table: its sheet, plus its rows when the sheet has several tables. */
		held: Array<{ table: TableCandidate; label: string; records: CandidateRecord[] }>;
		/** Rows each table left out (repeated headers, rows below the table, ...), so the user can check nothing was lost. */
		skipped: SkippedGroup[];
		sheetNames: string[];
		filter: RecordFilter;
		/** 'all' or a sheet name. */
		scope: string;
		/** Ids of records held back until a pending decision is made; the Pending tab lists them. */
		heldBack: Set<string>;
		/** Ids of records the user unchecked; they keep their checkbox so they can be checked again. */
		excluded: Set<string>;
		activeRecordId: string | null;
		onOpen: (record: CandidateRecord) => void;
		/** Shows a record's cells in the spreadsheet. */
		onFocus: (focus: SheetFocus | null) => void;
		onToggle: (record: CandidateRecord, include: boolean) => void;
		/** Plain-language wording of an issue, for the status column. */
		explainIssue: (issue: Issue, record: CandidateRecord) => Explanation;
	};

	let {
		records,
		held,
		skipped,
		sheetNames,
		filter = $bindable(),
		scope = $bindable(),
		heldBack,
		excluded,
		activeRecordId,
		onOpen,
		onFocus,
		onToggle,
		explainIssue
	}: Props = $props();

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

	function matches(record: CandidateRecord, id: RecordFilter) {
		if (id === 'all') return true;
		if (id === 'split') return !!record.split;
		// Pending covers every record waiting on a decision, e.g. a conflict or a table that needs review.
		if (id === 'pending') return record.status === 'pending' || heldBack.has(record.id);
		return record.status === id;
	}

	const scoped = $derived(scope === 'all' ? records : records.filter((record) => record.sheet === scope));
	// A field no record has (CAGE in most files) only costs width, so its column is left out.
	const columns = $derived(
		COLUMNS.filter(({ field }) => scoped.some((record) => record.fields[field] || record.rejected[field]))
	);

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

	const rowName = (record: CandidateRecord) =>
		`${record.sheet} row ${record.sourceRow}${record.split ? `, value ${record.split.index} of ${record.split.total}` : ''}`;

	/** Selecting a row opens its details and shows where it came from in the spreadsheet. */
	function select(record: CandidateRecord) {
		onOpen(record);
		onFocus(recordsFocus([record]));
	}

	function firstIssue(record: CandidateRecord) {
		return record.issues.find((issue) => issue.severity === 'error') ?? record.issues.find((issue) => issue.severity === 'warning') ?? record.issues[0];
	}
</script>

<div>
	<div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
		<!-- Only statuses that occur get a tab; tabs wrap rather than scroll so none is hidden in a narrow pane. -->
		<div class="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
			{#each FILTERS.filter((option) => option.id === 'all' || option.id === filter || counts[option.id] > 0) as option (option.id)}
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
		<div class="flex flex-col gap-2 sm:flex-row">
			{#if sheetNames.length > 1}
				<select
					class="rounded-md border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
					aria-label="Sheet"
					bind:value={scope}
				>
					<option value="all">All sheets</option>
					{#each sheetNames as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</select>
			{/if}
			<label class="relative block">
				<span class="sr-only">Search values and cell references, such as D136</span>
				<Search class="pointer-events-none absolute left-3 top-2 text-slate-400" size={16} />
				<input
					class="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-60"
					type="search"
					placeholder="Search values or cells"
					bind:value={query}
				/>
			</label>
		</div>
	</div>
	<p class="mt-2 text-xs text-slate-500">Select a row to see where each value came from. Uncheck a row to leave it out of the import.</p>

	<div class="mt-2 overflow-x-auto rounded-lg border border-slate-200">
		<table class="w-full min-w-[44rem] border-collapse text-left text-sm">
			<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
				<tr>
					<th class="w-10 px-3 py-2.5 font-medium"><span class="sr-only">Imports</span></th>
					<th class="px-3 py-2.5 font-medium">Source</th>
					<th class="px-3 py-2.5 font-medium">Status</th>
					{#each columns as column (column.field)}
						<th class="px-3 py-2.5 font-medium">{column.label}</th>
					{/each}
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
						onclick={(event) => {
							// The checkbox cell only toggles the import; anywhere else on the row opens the details.
							if (!(event.target as Element).closest('[data-import-toggle]')) select(record);
						}}
					>
						<td class="p-0">
							{#if record.approved || excluded.has(record.id)}
								<!-- A native checkbox drawn as the light check this column always showed, so 100 rows stay quiet. -->
								<label class="relative flex cursor-pointer px-3 py-2.5" data-import-toggle>
									<input
										type="checkbox"
										class="peer size-4 cursor-pointer appearance-none rounded border border-slate-300 bg-white transition checked:border-emerald-300 checked:bg-emerald-50 hover:border-slate-400 checked:hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
										checked={record.approved}
										aria-label={`Import ${rowName(record)}`}
										onchange={(event) => onToggle(record, event.currentTarget.checked)}
									/>
									<Check
										size={12}
										strokeWidth={3}
										class="pointer-events-none absolute left-3.5 top-3 hidden text-emerald-600 peer-checked:block"
									/>
								</label>
							{:else}
								<span class="flex px-3 py-2.5">
									<Minus size={15} class="text-slate-400" />
									<span class="sr-only">Not imported</span>
								</span>
							{/if}
						</td>
						<td class="whitespace-nowrap px-3 py-2.5">
							<button
								type="button"
								class="rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
								aria-label={`Details for ${rowName(record)}`}
								onclick={(event) => {
									event.stopPropagation();
									select(record);
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
						<td class="px-3 py-2.5">
							<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', status.style]}>
								{status.label}
							</span>
							{#if excluded.has(record.id) && !record.approved}
								<span class="mt-1 block text-xs text-slate-500">Excluded by you</span>
							{:else if issue}
								{@const text = explainIssue(issue, record)}
								<span class="mt-1 block max-w-44 truncate text-xs text-slate-500" title={text.body}>
									{text.headline}
								</span>
								{#if record.issues.length > 1}
									<span class="block text-[11px] text-slate-400">+{record.issues.length - 1} more</span>
								{/if}
							{/if}
						</td>
						{#each columns as column (column.field)}
							{@const value = record.fields[column.field]}
							{@const rejected = record.rejected[column.field]}
							<td class={['px-3 py-2.5', column.field === 'description' ? 'min-w-40 max-w-64' : 'whitespace-nowrap']}>
								{#if value}
									<span
										class={[
											'block',
											column.mono && 'font-mono text-xs',
											// Part numbers never wrap at their hyphens; a kept multi-line cell shows its lines.
											column.field === 'part' && 'max-w-52 truncate whitespace-pre',
											column.field === 'description' && 'line-clamp-2 whitespace-pre-line',
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
									<span
										class="block max-w-40 truncate font-mono text-xs text-red-700 line-through decoration-red-400"
										title={`Rejected: ${rejected.original}`}
									>
										{rejected.original || 'Excel error'}
									</span>
									<span class="mt-0.5 block text-[11px] text-red-700">rejected · {rejected.cell}</span>
								{:else}
									<span class="text-slate-300">—</span>
								{/if}
							</td>
						{/each}
					</tr>
				{:else}
					<tr>
						<td colspan={columns.length + 3} class="px-4 py-12 text-center">
							<p class="text-sm font-medium text-slate-700">No records match</p>
							<p class="mt-1 text-xs text-slate-500">Try another status, sheet, or search.</p>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
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

	{#each held as group (group.table.id)}
		<details class="group/held mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
			<summary
				class="flex cursor-pointer list-none items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden"
			>
				<ChevronRight size={14} class="shrink-0 transition group-open/held:rotate-90" />
				{group.label} · {plural(new Set(group.records.map((record) => record.sourceRow)).size, 'row')} held back, not importing
			</summary>
			<ul class="mt-1 divide-y divide-slate-100 text-sm text-slate-600">
				{#each group.records as record (record.id)}
					<li>
						<button type="button" class="flex w-full flex-wrap gap-x-2 py-1 text-left hover:text-slate-900" onclick={() => select(record)}>
							<span>Row {record.sourceRow}</span>
							{#each [record.fields.part?.value, record.fields.nsn?.value].filter(Boolean) as value, i (i)}
								<span class="font-mono text-xs leading-5">· {value}</span>
							{/each}
						</button>
					</li>
				{/each}
			</ul>
		</details>
	{/each}

	{#each skipped as group (group.table.id)}
		<details class="group/skipped mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
			<summary
				class="flex cursor-pointer list-none items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden"
			>
				<ChevronRight size={14} class="shrink-0 transition group-open/skipped:rotate-90" />
				{group.label} · {plural(group.rows.length, 'row')} skipped, not importing
			</summary>
			<ul class="mt-1 divide-y divide-slate-100 text-sm text-slate-600">
				{#each group.rows as line (line.row)}
					<li class="flex flex-wrap items-baseline gap-x-2 py-1">
						<span class="shrink-0">Row {line.row}</span>
						<span class="min-w-0 flex-1 basis-40 truncate text-slate-700" title={line.preview}>{line.preview}</span>
						<span class="shrink-0 text-xs text-slate-500">{SKIP_REASON[line.reason]}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/each}
</div>
