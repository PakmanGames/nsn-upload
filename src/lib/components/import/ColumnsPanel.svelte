<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import { FIELDS, type ColumnMapping, type Field, type SheetAnalysis, type TableCandidate, type WorkbookModel } from '$lib/import/model';
	import { colLetter, rangeToA1 } from '$lib/import/refs';
	import InfoTip from './InfoTip.svelte';
	import { CONFIDENCE_STYLE, FIELD_LABEL, SKIP_REASON, plural } from './labels';
	import { partColumnChoices, tableLabel } from './summary';

	type Props = {
		sheets: SheetAnalysis[];
		/** Source workbook, to flag hidden columns. */
		model: WorkbookModel | null;
		/** Tables whose records do not import as things stand. */
		heldBack: Set<string>;
		/** Per table id: what the last remap did to another column, e.g. which column lost its field. */
		notices: Record<string, string>;
		onDismissNotice: (tableId: string) => void;
		onSetColumn: (table: TableCandidate, column: ColumnMapping, field: Field | null) => void;
		onResetColumn: (table: TableCandidate, column: ColumnMapping) => void;
	};

	let { sheets, model, heldBack, notices, onDismissNotice, onSetColumn, onResetColumn }: Props = $props();

	const tables = $derived(sheets.flatMap((sheet) => sheet.tables));

	/** Current field and the column's alternatives first, then the remaining fields. */
	function fieldGroups(column: ColumnMapping) {
		const suggested = [...new Set([...(column.field ? [column.field] : []), ...column.alternatives])];
		return { suggested, other: FIELDS.filter((field) => !suggested.includes(field)) };
	}

	const skipped = (table: TableCandidate) =>
		Object.entries(Object.groupBy(table.skippedRows, (skip) => SKIP_REASON[skip.reason])).map(
			([reason, rows]) => `${plural(rows!.length, 'row')} (${reason})`
		);
	const capitalized = (text: string) => text[0].toUpperCase() + text.slice(1);

	/** "Columns A and F both", "Columns A, C and F all". */
	function choiceSubject(columns: ColumnMapping[]): string {
		const letters = columns.map((column) => colLetter(column.col));
		return letters.length === 2
			? `Columns ${letters[0]} and ${letters[1]} both`
			: `Columns ${letters.slice(0, -1).join(', ')} and ${letters.at(-1)} all`;
	}
</script>

{#snippet picker(table: TableCandidate, column: ColumnMapping)}
	{@const groups = fieldGroups(column)}
	<select
		class={[
			'w-full min-w-0 rounded-md border bg-white py-1.5 pl-2.5 pr-8 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
			column.field ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-500'
		]}
		aria-label={`Column ${colLetter(column.col)} (${column.header || 'no header'}) maps to`}
		value={column.field ?? ''}
		onchange={(event) => onSetColumn(table, column, (event.currentTarget.value || null) as Field | null)}
	>
		<option value="">Ignore column</option>
		{#if groups.suggested.length}
			<optgroup label="Suggested">
				{#each groups.suggested as field (field)}
					<option value={field}>{FIELD_LABEL[field]}</option>
				{/each}
			</optgroup>
		{/if}
		<optgroup label={groups.suggested.length ? 'Other fields' : 'Fields'}>
			{#each groups.other as field (field)}
				<option value={field}>{FIELD_LABEL[field]}</option>
			{/each}
		</optgroup>
	</select>
{/snippet}

{#snippet state(table: TableCandidate, column: ColumnMapping)}
	<div class="flex shrink-0 items-center gap-1">
		{#if column.overridden}
			<span class="inline-flex whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
				Set by you
			</span>
			<button
				type="button"
				class="rounded p-0.5 text-slate-400 transition hover:text-slate-700"
				aria-label={`Undo mapping change for column ${colLetter(column.col)}`}
				title="Undo"
				onclick={() => onResetColumn(table, column)}
			>
				<RotateCcw size={14} />
			</button>
		{:else if column.field}
			<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CONFIDENCE_STYLE[column.confidence]]}>
				{capitalized(column.confidence)}
			</span>
		{/if}
		<InfoTip label={`Why column ${colLetter(column.col)} is mapped this way`} lines={column.reasons} />
	</div>
{/snippet}

{#snippet header(column: ColumnMapping, sheet: string)}
	{@const hidden = model?.sheets.find((candidate) => candidate.name === sheet)?.hiddenCols.has(column.col) ?? false}
	<span class="font-mono text-xs text-slate-500">{colLetter(column.col)}</span>
	{#if column.header}
		<span class="text-slate-700 [overflow-wrap:anywhere]">"{column.header}"</span>
	{:else}
		<span class="text-slate-500">(no header)</span>
	{/if}
	{#if hidden}
		<EyeOff size={13} class="inline shrink-0 text-slate-400" />
		<span class="sr-only">(hidden column)</span>
	{/if}
{/snippet}

<div class="space-y-5">
	{#each tables as table (table.id)}
		{@const mapped = table.columns.filter((column) => column.field)}
		{@const unmapped = table.columns.filter((column) => !column.field)}
		{@const partChoices = partColumnChoices(table)}
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{tableLabel(table, sheets)}</h4>
				{#if table.source === 'ai'}
					<span class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
						<Sparkles size={11} /> Proposed by AI
					</span>
				{/if}
				{#if heldBack.has(table.id)}
					<span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
						Held back
					</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-slate-500">
				Range <span class="font-mono text-slate-700">{rangeToA1(table.range)}</span>
				{`· ${table.headerRows.length ? `header ${table.headerRows.length > 1 ? 'rows' : 'row'} ${table.headerRows.join(', ')}` : 'no header row'} · ${plural(table.dataRows.length, 'data row')}`}
				{#if skipped(table).length}{`· skipped ${skipped(table).join(', ')}`}{/if}
			</p>

			{#if notices[table.id]}
				<div class="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
					<TriangleAlert size={14} class="mt-0.5 shrink-0" />
					<p class="flex-1">{notices[table.id]}</p>
					<button type="button" class="rounded p-0.5 text-amber-700 hover:bg-amber-100" aria-label="Dismiss" onclick={() => onDismissNotice(table.id)}>
						<X size={14} />
					</button>
				</div>
			{/if}

			{#if partChoices.length}
				<!-- Nothing is mapped to Part because the values fit several columns: the user picks, so the table is never stuck. -->
				<div class="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-950" role="group" aria-label="Choose the part number column">
					<p>{choiceSubject(partChoices)} look like part numbers, and no header says which one holds them. Pick the one that holds part numbers:</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each partChoices as column (column.col)}
							<button
								type="button"
								class="inline-flex min-w-0 max-w-full items-center rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-sm font-medium text-blue-800 shadow-sm transition hover:bg-blue-100"
								onclick={() => onSetColumn(table, column, 'part')}
							>
								<span class="truncate">Use column {colLetter(column.col)}{column.header ? ` "${column.header}"` : ''}</span>
							</button>
						{/each}
					</div>
					{#if !heldBack.has(table.id)}
						<p class="mt-2 text-xs text-blue-900">Until you pick one, these rows import without a part number.</p>
					{/if}
				</div>
			{/if}

			{#if mapped.length}
				<ul class="mt-2 grid gap-2 sm:grid-cols-2">
					{#each mapped as column (column.col)}
						<li class="rounded-lg border border-slate-200 px-3 py-2">
							<p class="text-sm">
								<span class="font-medium text-slate-900">{FIELD_LABEL[column.field!]}</span>
								<span class="text-slate-400">←</span>
								{@render header(column, table.sheet)}
							</p>
							<p class="truncate text-xs text-slate-500" title={column.reasons.join('\n')}>{column.reasons.at(-1)}</p>
							<div class="mt-2 flex items-center gap-2">
								{@render picker(table, column)}
								{@render state(table, column)}
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-sm text-slate-500">No column is mapped.</p>
			{/if}

			{#if unmapped.length}
				<details class="group/more mt-2">
					<summary
						class="flex cursor-pointer list-none items-center gap-1.5 rounded py-1 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden"
					>
						<ChevronRight size={14} class="transition group-open/more:rotate-90" />
						{unmapped.length} more {unmapped.length === 1 ? 'column' : 'columns'} not imported
					</summary>
					<ul class="ml-5 divide-y divide-slate-100">
						{#each unmapped as column (column.col)}
							<li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
								<div class="min-w-0 flex-1 basis-56">
									<p class="text-sm">{@render header(column, table.sheet)}</p>
									<p class="truncate text-xs text-slate-500" title={column.reasons.join('\n')}>{column.reasons.at(-1)}</p>
								</div>
								<div class="flex w-full items-center gap-2 sm:w-56">
									{@render picker(table, column)}
									{@render state(table, column)}
								</div>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	{/each}
</div>
