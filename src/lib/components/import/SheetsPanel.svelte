<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import TableProperties from '@lucide/svelte/icons/table-properties';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { tick } from 'svelte';
	import type { Decision, SheetAnalysis, SheetStatus, TableCandidate, TableSpec, WorkbookModel } from '$lib/import/model';
	import { colLetter, rangeToA1 } from '$lib/import/refs';
	import { explainSheetWithoutTable, tableNotes, type Explanation } from '$lib/import/explain';
	import Switch from './Switch.svelte';
	import TableSetup from './TableSetup.svelte';
	import TechnicalDetails from './TechnicalDetails.svelte';
	import { SHEET_STATUS, plural } from './labels';
	import { heldBackNote, setupSheets, tableLabel, tableRows } from './summary';

	type Props = {
		sheets: SheetAnalysis[];
		decisions: Decision[];
		/** Candidate records per table id. */
		recordCounts: Map<string, number>;
		/** Source workbook, for setting up a table by hand, what a sheet without a table holds, and what lies outside a table. */
		model: WorkbookModel | null;
		/** Wording of each decision by id; a table's include decision says why it is ready or needs review. */
		explanations: Map<string, Explanation>;
		/** Names of the sheets the AI is reading right now. */
		aiReading: Set<string>;
		onInclude: (decisionId: string, include: boolean) => void;
		onSetManualTable: (sheet: string, spec: TableSpec) => void;
		onRemoveManualTable: (sheet: string) => void;
		/** The sheet whose table is being set up by hand, one at a time; the summary bar can open it too. */
		settingUp?: string | null;
		/** Hidden sheets the user included anyway (Overrides.includedHiddenSheets). */
		includedHidden: string[];
		onHiddenSheet: (name: string, included: boolean) => void;
	};

	let {
		sheets,
		decisions,
		recordCounts,
		aiReading,
		model,
		explanations,
		onInclude,
		onSetManualTable,
		onRemoveManualTable,
		settingUp = $bindable(null),
		includedHidden,
		onHiddenSheet
	}: Props = $props();
	let expanded = $state<Record<string, boolean>>({});
	const uid = $props.id();

	const includeDecisions = $derived(
		new Map(
			decisions
				.filter((decision) => decision.kind === 'include-table' && decision.tableId)
				.map((decision) => [decision.tableId!, decision])
		)
	);
	const withTables = $derived(sheets.filter((sheet) => sheet.status === 'ready' || sheet.status === 'needs-review'));
	const nothing = $derived(sheets.filter((sheet) => sheet.status === 'no-table'));
	const hidden = $derived(sheets.filter((sheet) => sheet.status === 'hidden'));
	const sheetModels = $derived(new Map(model?.sheets.map((sheet) => [sheet.name, sheet]) ?? []));
	const canSetUp = $derived(new Set(setupSheets(sheets, decisions, model)));

	async function focusAction(sheet: SheetAnalysis, action: 'setup' | 'remove') {
		await tick();
		document.getElementById(`${uid}-${action}-${sheet.index}`)?.focus();
	}

	function useTable(sheet: SheetAnalysis, spec: TableSpec) {
		settingUp = null;
		onSetManualTable(sheet.name, spec);
		void focusAction(sheet, 'remove');
	}

	function cancelSetup(sheet: SheetAnalysis) {
		settingUp = null;
		void focusAction(sheet, 'setup');
	}

	function removeTable(sheet: SheetAnalysis) {
		onRemoveManualTable(sheet.name);
		void focusAction(sheet, 'setup');
	}

	const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
	/** "columns E-K", or "column E" for a one-column table. */
	const columnsOf = ({ range }: TableCandidate) =>
		range.left === range.right ? `column ${colLetter(range.left)}` : `columns ${colLetter(range.left)}-${colLetter(range.right)}`;

	/**
	 * Why a table got its status. A sheet's own reasons describe its one table; on a sheet of several tables they
	 * cover all of them, so each table lists its own reasons instead. A table's reasons already name its skipped rows.
	 */
	function details(sheet: SheetAnalysis, table: TableCandidate): string[] {
		if (sheet.tables.length > 1) return table.reasons;
		return [...sheet.reasons, ...table.reasons.filter((reason) => !sheet.reasons.includes(reason))];
	}
</script>

{#snippet badge(status: SheetStatus)}
	<span class={['inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', SHEET_STATUS[status].style]}>
		{SHEET_STATUS[status].label}
	</span>
{/snippet}

{#snippet setupButton(sheet: SheetAnalysis)}
	{#if canSetUp.has(sheet.name) && settingUp !== sheet.name}
		<button
			id={`${uid}-setup-${sheet.index}`}
			type="button"
			class="flex items-center gap-1 rounded text-xs font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600"
			onclick={() => (settingUp = sheet.name)}
		>
			<TableProperties size={13} /> Set up table
		</button>
	{/if}
{/snippet}

{#snippet setup(sheet: SheetAnalysis)}
	{@const sheetModel = sheetModels.get(sheet.name)}
	{#if settingUp === sheet.name && sheetModel}
		<TableSetup
			sheet={sheetModel}
			table={sheet.tables[0]}
			onUse={(spec) => useTable(sheet, spec)}
			onCancel={() => cancelSetup(sheet)}
		/>
	{/if}
{/snippet}

{#snippet tableLine(sheet: SheetAnalysis, table: TableCandidate, index: number)}
	{@const several = sheet.tables.length > 1}
	{@const decision = includeDecisions.get(table.id)}
	{@const isOpen = expanded[table.id] ?? false}
	{@const reasonsId = `${uid}-${sheet.index}-${index}`}
	{@const count = recordCounts.get(table.id) ?? 0}
	{@const records = plural(count, 'record')}
	<!-- A table on a hidden sheet waits because the sheet is hidden, not because its columns are in doubt. -->
	{@const note =
		includedHidden.includes(sheet.name) && decision?.chosen === null
			? `Not imported yet: this sheet is hidden in Excel. Switch it on to import its ${records}.`
			: heldBackNote(table, decision, count)}
	{@const text = decision && explanations.get(decision.id)}
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
		<p class="min-w-0 text-sm">
			{#if several}
				<span class="font-medium text-slate-800">{capitalized(tableRows(table))}</span>
				<span class="text-slate-500">{`· ${columnsOf(table)} · ${records}`}</span>
			{:else}
				<span class="font-medium text-slate-900">{sheet.name}</span>
				<span class="text-slate-500">
					{`· ${rangeToA1(table.range)} · ${records}`}
					{includedHidden.includes(sheet.name) ? '· hidden in Excel' : ''}
				</span>
			{/if}
		</p>
		<div class="flex items-center gap-2">
			<!-- The AI reads the whole sheet, so a sheet of several tables says so once, on its heading. -->
			{#if !several && aiReading.has(sheet.name)}
				{@render reading()}
			{/if}
			{#if !several && includedHidden.includes(sheet.name)}
				{@render hiddenToggle(sheet, true)}
			{/if}
			{#if table.source === 'ai'}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20"
				>
					<Sparkles size={11} /> AI
				</span>
			{:else if table.source === 'user'}
				<span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
					Set up by you
				</span>
			{/if}
			{@render badge(table.status)}
			{#if decision}
				<Switch
					checked={decision.chosen === 'include'}
					label={several ? `Include ${tableLabel(table, sheets)}` : `Include ${sheet.name}`}
					onchange={(include) => onInclude(decision.id, include)}
				/>
			{/if}
		</div>
	</div>
	{#if note}
		<p class="mt-1 text-xs leading-5 text-slate-600">{note}</p>
	{/if}
	<div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
		<button
			type="button"
			class="flex items-center gap-1 rounded text-xs text-slate-500 transition hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
			aria-expanded={isOpen}
			aria-controls={reasonsId}
			onclick={() => (expanded[table.id] = !isOpen)}
		>
			<ChevronRight size={13} class={['transition', isOpen && 'rotate-90']} />
			Why this classification
		</button>
		<!-- A table set up by hand replaces detection on the whole sheet, so a sheet of several tables offers it once. -->
		{#if !several}
			{@render setupButton(sheet)}
		{/if}
		{#if table.source === 'user'}
			<button
				id={`${uid}-remove-${sheet.index}`}
				type="button"
				class="flex items-center gap-1 rounded text-xs font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-blue-600"
				onclick={() => removeTable(sheet)}
			>
				<Undo2 size={13} /> Remove table set up by hand
			</button>
		{/if}
	</div>
	<div id={reasonsId} hidden={!isOpen} class="mt-1 space-y-1 pl-4 text-xs leading-5 text-slate-600">
		{#if text}
			<p><span class="font-medium text-slate-700">{text.headline}.</span> {text.body}</p>
		{/if}
		{#each tableNotes(table, sheetModels.get(sheet.name), sheet.tables) as line, i (i)}
			<p>{line}</p>
		{/each}
		{#if sheet.aiTrigger}
			<p class="text-violet-700">AI could help read this sheet.</p>
		{/if}
		<TechnicalDetails text={[...details(sheet, table), ...(sheet.aiTrigger ? [`AI could help: ${sheet.aiTrigger}`] : [])]} />
	</div>
{/snippet}

{#snippet reading()}
	<span class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
		<LoaderCircle size={11} class="animate-spin" /> AI is reading…
	</span>
{/snippet}

{#snippet hiddenToggle(sheet: SheetAnalysis, included: boolean)}
	<button
		type="button"
		class="rounded px-1.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600"
		aria-label={included ? `Hide ${sheet.name} again` : `Include ${sheet.name} anyway`}
		onclick={() => onHiddenSheet(sheet.name, !included)}
	>
		{included ? 'Hide again' : 'Include anyway'}
	</button>
{/snippet}

{#snippet fold(label: string, list: SheetAnalysis[], open = false)}
	<details class="group/fold" {open}>
		<summary
			class="flex cursor-pointer list-none flex-wrap items-center gap-1.5 rounded py-1.5 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight size={14} class="transition group-open/fold:rotate-90" />
			{label}
			<!-- A folded sheet the AI is reading still says so while the fold is closed. -->
			{#if list.some((sheet) => aiReading.has(sheet.name))}{@render reading()}{/if}
		</summary>
		<ul class="ml-5 divide-y divide-slate-100">
			{#each list as sheet (sheet.name)}
				{@const plain = explainSheetWithoutTable(sheet, sheetModels.get(sheet.name))}
				<li class="py-2">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium text-slate-700">{sheet.name}</span>
						{#if aiReading.has(sheet.name)}{@render reading()}{/if}
						{@render badge(sheet.status)}
						{#if sheet.status === 'hidden'}
							{@render hiddenToggle(sheet, false)}
						{:else if includedHidden.includes(sheet.name)}
							{@render hiddenToggle(sheet, true)}
						{/if}
					</div>
					<p class="mt-1 text-xs font-medium leading-5 text-slate-700">{plain.headline}</p>
					{#each plain.lines as line, i (i)}
						<p class="text-xs leading-5 text-slate-600">{line}</p>
					{/each}
					<div class="mt-1"><TechnicalDetails text={sheet.reasons} /></div>
					<div class="mt-1.5">{@render setupButton(sheet)}</div>
					{@render setup(sheet)}
				</li>
			{/each}
		</ul>
	</details>
{/snippet}

{#if withTables.length}
	<ul class="divide-y divide-slate-100">
		{#each withTables as sheet (sheet.name)}
			<li class="py-2 first:pt-0">
				{#if sheet.tables.length === 1}
					{@render tableLine(sheet, sheet.tables[0], 0)}
				{:else}
					<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
						<p class="min-w-0 text-sm">
							<span class="font-medium text-slate-900">{sheet.name}</span>
							<span class="text-slate-500">
								{`· ${plural(sheet.tables.length, 'table')}`}
								{includedHidden.includes(sheet.name) ? '· hidden in Excel' : ''}
							</span>
							{#if aiReading.has(sheet.name)}{@render reading()}{/if}
						</p>
						{#if includedHidden.includes(sheet.name)}
							{@render hiddenToggle(sheet, true)}
						{/if}
					</div>
					<ul class="mt-2 space-y-3 border-l-2 border-slate-100 pl-3">
						{#each sheet.tables as table, index (table.id)}
							<li>{@render tableLine(sheet, table, index)}</li>
						{/each}
					</ul>
					<div class="mt-1.5 empty:hidden">{@render setupButton(sheet)}</div>
				{/if}
				{@render setup(sheet)}
			</li>
		{/each}
	</ul>
{/if}
{#if nothing.length}
	<!-- Open when no sheet has a table, or a table is being set up here, so the setup is in plain view. -->
	{@render fold(
		`${plural(nothing.length, 'sheet')} with nothing to import`,
		nothing,
		withTables.length === 0 || nothing.some((sheet) => sheet.name === settingUp)
	)}
{/if}
{#if hidden.length}
	{@render fold(`${hidden.length} hidden ${hidden.length === 1 ? 'sheet' : 'sheets'}, ignored`, hidden)}
{/if}
