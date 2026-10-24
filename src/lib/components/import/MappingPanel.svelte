<script lang="ts">
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import { FIELDS, type ColumnMapping, type Field, type SheetAnalysis, type SheetModel } from '$lib/import/model';
	import { colLetter, rangeToA1 } from '$lib/import/refs';
	import InfoTip from './InfoTip.svelte';
	import { CONFIDENCE_STYLE, FIELD_LABEL, SHEET_STATUS, SKIP_REASON, plural } from './labels';

	type Props = {
		sheet: SheetAnalysis;
		/** Source sheet, when the reader has run; used to flag hidden columns. */
		model: SheetModel | undefined;
		recordCount: number;
		/** Explains a side effect of the last remap, e.g. which column lost its field. */
		notice: string;
		onDismissNotice: () => void;
		onSetColumn: (column: ColumnMapping, field: Field | null) => void;
		onResetColumn: (column: ColumnMapping) => void;
	};

	let { sheet, model, recordCount, notice, onDismissNotice, onSetColumn, onResetColumn }: Props = $props();

	const table = $derived(sheet.tables[0]);
	const skipped = $derived(
		table
			? Object.entries(Object.groupBy(table.skippedRows, (skip) => SKIP_REASON[skip.reason])).map(
					([reason, rows]) => `${rows!.length} ${reason}`
				)
			: []
	);

	/** Current field and the column's alternatives first, then the remaining fields. */
	function fieldGroups(column: ColumnMapping) {
		const suggested = [...new Set([...(column.field ? [column.field] : []), ...column.alternatives])];
		return { suggested, other: FIELDS.filter((field) => !suggested.includes(field)) };
	}
</script>

<section
	aria-labelledby="mapping-heading"
	class="rounded-lg border border-slate-200 bg-white shadow-sm"
>
	<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3">
		<div class="min-w-0">
			<h3 id="mapping-heading" class="text-sm font-semibold text-slate-950">
				Column mapping <span class="font-normal text-slate-400">·</span> {sheet.name}
			</h3>
			{#if table}
				<p class="mt-0.5 text-xs text-slate-500">
					Range <span class="font-mono text-slate-700">{rangeToA1(table.range)}</span> · header row{table.headerRows.length > 1
						? 's'
						: ''}
					<span class="font-mono text-slate-700">{table.headerRows.join(', ')}</span> · {plural(table.dataRows.length, 'data row')}
					· {plural(recordCount, 'record')}{#if skipped.length}
						· skipped {skipped.join(', ')}{/if}
				</p>
			{/if}
		</div>
		{#if table}
			<div class="flex flex-wrap items-center gap-1.5">
				{#if table.source === 'ai'}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
					>
						<Sparkles size={11} /> Proposed by AI
					</span>
				{/if}
				<span
					class={[
						'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
						SHEET_STATUS[table.status].style
					]}
				>
					{SHEET_STATUS[table.status].label}
				</span>
				<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CONFIDENCE_STYLE[table.confidence]]}>
					{table.confidence[0].toUpperCase() + table.confidence.slice(1)} confidence
				</span>
			</div>
		{/if}
	</div>

	{#if !table}
		<div class="px-4 py-6 text-sm text-slate-600">
			<p class="font-medium text-slate-800">
				{sheet.status === 'hidden' ? 'This sheet is hidden in the workbook and is not read.' : 'No importable table was found on this sheet.'}
			</p>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
				{#each sheet.reasons as reason, i (i)}
					<li>{reason}</li>
				{/each}
			</ul>
		</div>
	{:else}
		{#if table.reasons.length}
			<ul class="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs text-slate-600">
				{#each table.reasons as reason, i (i)}
					<li>{reason}</li>
				{/each}
			</ul>
		{/if}
		{#if notice}
			<div
				class="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900"
				role="status"
			>
				<TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<p class="flex-1">{notice}</p>
				<button
					type="button"
					class="rounded p-0.5 text-amber-700 hover:bg-amber-100"
					aria-label="Dismiss"
					onclick={onDismissNotice}
				>
					<X size={14} />
				</button>
			</div>
		{/if}

		<div
			class="hidden grid-cols-[3.25rem_minmax(0,1fr)_11rem_7.5rem] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid"
			aria-hidden="true"
		>
			<span>Column</span>
			<span>Header</span>
			<span>Maps to</span>
			<span>Confidence</span>
		</div>
		<ul class="divide-y divide-slate-100">
			{#each table.columns as column (column.col)}
				{@const letter = colLetter(column.col)}
				{@const hidden = model?.hiddenCols.has(column.col) ?? false}
				{@const groups = fieldGroups(column)}
				<li
					class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-2.5 md:grid-cols-[3.25rem_minmax(0,1fr)_11rem_7.5rem]"
				>
					<span class="font-mono text-xs font-medium text-slate-500">{letter}</span>
					<div class="min-w-0">
						<p class="flex items-center gap-1.5 text-sm text-slate-900">
							<span class="truncate" title={column.header}>{column.header || '(no header)'}</span>
							{#if hidden}
								<EyeOff size={13} class="shrink-0 text-slate-400" />
								<span class="sr-only">(hidden column)</span>
							{/if}
						</p>
						<p class="truncate text-xs text-slate-500" title={column.reasons.join('\n')}>{column.reasons.at(-1)}</p>
					</div>
					<div class="col-start-2 md:col-start-auto">
						<select
							class={[
								'w-full rounded-md border bg-white py-1.5 pl-2.5 pr-8 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
								column.field ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-500'
							]}
							aria-label={`Column ${letter} (${column.header || 'no header'}) maps to`}
							value={column.field ?? ''}
							onchange={(event) => onSetColumn(column, (event.currentTarget.value || null) as Field | null)}
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
					</div>
					<div class="col-start-2 flex items-center gap-1.5 md:col-start-auto">
						{#if column.overridden}
							<span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
								Set by you
							</span>
							<button
								type="button"
								class="rounded p-0.5 text-slate-400 transition hover:text-slate-700"
								aria-label={`Undo mapping change for column ${letter}`}
								title="Undo"
								onclick={() => onResetColumn(column)}
							>
								<RotateCcw size={14} />
							</button>
						{:else if column.field}
							<span class={['inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', CONFIDENCE_STYLE[column.confidence]]}>
								{column.confidence[0].toUpperCase() + column.confidence.slice(1)}
							</span>
						{:else}
							<span class="text-xs text-slate-400">Not imported</span>
						{/if}
						<InfoTip label={`Why column ${letter} is mapped this way`} lines={column.reasons} />
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
