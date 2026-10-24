<!--
	Sets up a table by hand on a sheet: pick the header row (or none), then map each column with values.
	It starts from the sheet's detected table, if any, so confirming a held-back table takes one click.
	Nothing is stored until "Use this table"; the result is scored by the same rules as a detected table.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { PRIMARY_FIELDS, type Field, type SheetModel, type TableCandidate, type TableSpec } from '$lib/import/model';
	import { colLetter } from '$lib/import/refs';
	import { readHeader } from '$lib/import/structure/columns';
	import { MAX_COLUMNS } from '$lib/import/structure/detect';
	import { FIELD_LABEL } from './labels';

	type Props = {
		sheet: SheetModel;
		/** The sheet's held-back table, whose header row and mapping are the starting point. */
		table?: TableCandidate;
		onUse: (spec: TableSpec) => void;
		onCancel: () => void;
	};

	let { sheet, table, onUse, onCancel }: Props = $props();

	const FIELD_ORDER: Field[] = ['part', 'nsn', 'niin', 'fsc', 'cage', 'description'];
	/** Non-empty rows from the top offered as the header, as many as detection looks at. */
	const HEADER_CHOICES = 30;
	const SAMPLES = 3;
	const uid = $props.id();

	type Choice = { key: string; rows: number[]; label: string };

	// Offered only for sheets with values, so the extent is never null.
	const extent = $derived(sheet.valueExtent!);
	const right = $derived(Math.min(extent.right, extent.left + MAX_COLUMNS - 1));
	const keyOf = (rows: readonly number[]) => (rows.length ? rows.join('-') : 'none');

	/** "Row 2 · Part Number | NSN | Description", so the user recognizes the row without opening Excel. */
	function rowLabel(rows: number[]): string {
		const texts: string[] = [];
		for (let col = extent.left; col <= right && texts.length < 4; col++) {
			const text = readHeader(sheet, rows, col).text;
			if (text && !sheet.cell(rows[0], col).mergedFrom) texts.push(text.replace(/\s+/g, ' '));
		}
		// Cells often hold commas themselves ("Screw, machine"), so a bar separates them.
		const preview = texts.join(' | ');
		const name = rows.length > 1 ? `Rows ${rows[0]}-${rows.at(-1)}` : `Row ${rows[0]}`;
		return preview ? `${name} · ${preview.length > 60 ? `${preview.slice(0, 59)}…` : preview}` : name;
	}

	/** No header row, a detected header spanning rows, then each non-empty row near the top. */
	const choices = $derived.by(() => {
		const list: Choice[] = [{ key: 'none', rows: [], label: 'No header row' }];
		if (table && table.headerRows.length > 1) list.push({ key: keyOf(table.headerRows), rows: table.headerRows, label: rowLabel(table.headerRows) });
		for (let row = extent.top; row <= extent.bottom && list.length <= HEADER_CHOICES; row++) {
			if (sheet.hiddenRows.has(row)) continue;
			let filled = false;
			for (let col = extent.left; col <= right && !filled; col++) filled = sheet.cell(row, col).kind !== 'empty';
			if (filled) list.push({ key: String(row), rows: [row], label: rowLabel([row]) });
		}
		return list;
	});

	// The form starts from the held-back table once; what the user picks is theirs until they use or cancel it.
	const start = untrack(() => table);
	let headerKey = $state(keyOf(start?.headerRows ?? []));
	let fields = $state<Record<number, Field | null>>(
		Object.fromEntries(start?.columns.flatMap((column) => (column.field ? [[column.col, column.field]] : [])) ?? [])
	);
	/** What the last pick did to another column, so a field never moves silently. */
	let note = $state('');
	let headerSelect = $state<HTMLSelectElement>();

	const headerRows = $derived(choices.find((choice) => choice.key === headerKey)?.rows ?? []);

	/** Visible columns with at least one value below the header, each with its first few values. */
	const columns = $derived.by(() => {
		const start = headerRows.length ? Math.max(...headerRows) + 1 : extent.top;
		const samples = new Map<number, string[]>();
		for (let col = extent.left; col <= right; col++) if (!sheet.hiddenCols.has(col)) samples.set(col, []);
		let open = samples.size;
		for (let row = start; row <= extent.bottom && open > 0; row++) {
			if (sheet.hiddenRows.has(row)) continue;
			for (const [col, values] of samples) {
				if (values.length === SAMPLES) continue;
				const cell = sheet.cell(row, col);
				const text = cell.mergedFrom ? '' : cell.text.trim();
				if (!text) continue;
				values.push(text.split('\n')[0]);
				if (values.length === SAMPLES) open--;
			}
		}
		return [...samples]
			.filter(([, values]) => values.length > 0)
			.map(([col, values]) => ({ col, header: readHeader(sheet, headerRows, col).text, values }));
	});

	const mapped = $derived(columns.flatMap(({ col }) => (fields[col] ? [[col, fields[col]] as const] : [])));
	const canUse = $derived(mapped.some(([, field]) => PRIMARY_FIELDS.includes(field)));

	function pick(col: number, field: Field | null) {
		const other = field ? columns.find((column) => column.col !== col && fields[column.col] === field) : undefined;
		if (other) fields[other.col] = null;
		fields[col] = field;
		note = other && field ? `Column ${colLetter(other.col)} no longer maps to ${FIELD_LABEL[field]}: column ${colLetter(col)} does now.` : '';
	}

	function use(event: SubmitEvent) {
		event.preventDefault();
		if (!canUse) return;
		const cols = columns.map(({ col }) => col);
		onUse({
			headerRows,
			range: { top: headerRows[0] ?? extent.top, left: Math.min(...cols), bottom: extent.bottom, right: Math.max(...cols) },
			columns: Object.fromEntries(mapped)
		});
	}

	onMount(() => headerSelect?.focus());
</script>

<form class="mt-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3" aria-label={`Set up a table on ${sheet.name}`} onsubmit={use}>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
		<label for={`${uid}-header`} class="text-sm font-medium text-slate-800">Header row</label>
		<select
			id={`${uid}-header`}
			bind:this={headerSelect}
			bind:value={headerKey}
			class="min-w-0 max-w-full flex-1 rounded-md border border-slate-300 bg-white py-1.5 pl-2.5 pr-8 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:flex-none"
		>
			{#each choices as choice (choice.key)}
				<option value={choice.key}>{choice.label}</option>
			{/each}
		</select>
	</div>

	<p class="mt-3 text-xs text-slate-600">Map each column to a field. Columns left on Ignore are not imported.</p>
	<ul class="mt-1 divide-y divide-blue-100">
		{#each columns as column (column.col)}
			{@const letter = colLetter(column.col)}
			<li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
				<div class="min-w-0 flex-1 basis-56">
					<p class="text-sm">
						<span class="font-mono text-xs text-slate-500">{letter}</span>
						{#if column.header}
							<span class="text-slate-800 [overflow-wrap:anywhere]">"{column.header}"</span>
						{:else}
							<span class="text-slate-500">no header</span>
						{/if}
					</p>
					<p class="truncate font-mono text-xs text-slate-500" title={column.values.join('\n')}>{column.values.join(' · ')}</p>
				</div>
				<select
					class={[
						'w-full rounded-md border bg-white py-1.5 pl-2.5 pr-8 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-44',
						fields[column.col] ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-500'
					]}
					aria-label={`Column ${letter} (${column.header || 'no header'}) maps to`}
					value={fields[column.col] ?? ''}
					onchange={(event) => pick(column.col, (event.currentTarget.value || null) as Field | null)}
				>
					<option value="">Ignore</option>
					{#each FIELD_ORDER as field (field)}
						<option value={field}>{FIELD_LABEL[field]}</option>
					{/each}
				</select>
			</li>
		{/each}
	</ul>
	<p class="text-xs text-amber-800" role="status">{note}</p>

	<div class="mt-2 flex flex-wrap items-center gap-2">
		<button
			type="submit"
			class="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
			disabled={!canUse}
			aria-describedby={canUse ? undefined : `${uid}-hint`}
		>
			Use this table
		</button>
		<button type="button" class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50" onclick={onCancel}>
			Cancel
		</button>
		{#if !canUse}
			<p id={`${uid}-hint`} class="text-xs text-slate-600">Map at least one Part number, NSN, or NIIN column.</p>
		{/if}
	</div>
</form>
