<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { SheetModel, WorkbookAnalysis, WorkbookModel } from '$lib/import/model';
	import type { SheetFocus } from '$lib/import/session.svelte';
	import { plural } from '../labels';
	import { cellFocus } from './focus';
	import { buildOverlay, EMPTY_OVERLAY, tableAt, type TableTone } from './overlay';
	import SheetGrid from './SheetGrid.svelte';

	type Props = {
		model: WorkbookModel;
		analysis: WorkbookAnalysis;
		focus: SheetFocus | null;
		/** The grid's cursor moved. */
		onFocus: (focus: SheetFocus) => void;
		onOpenRecord: (recordId: string) => void;
		/** Set where the spreadsheet replaces the review, to go back to it. */
		onBack?: () => void;
	};

	let { model, analysis, focus, onFocus, onOpenRecord, onBack }: Props = $props();
	const uid = $props.id();

	// Hidden sheets stay hidden, as in Excel.
	const sheets = $derived(model.sheets.filter((sheet) => sheet.visibility === 'visible'));
	const overlays = $derived(buildOverlay(analysis));
	const byName = (name: string | undefined) => sheets.find((sheet) => sheet.name === name);
	const tones = (sheet: SheetModel): TableTone[] => (overlays.get(sheet.name)?.tables ?? []).map((table) => table.tone);

	/**
	 * Where the view opens without a focus: a table that imports, else one waiting on a decision, else the first
	 * sheet with values, so a workbook with nothing to import opens where the user can see why, not on a blank sheet.
	 */
	const opening = $derived(
		sheets.find((sheet) => tones(sheet).includes('included')) ??
			sheets.find((sheet) => tones(sheet).includes('pending')) ??
			sheets.find((sheet) => sheet.valueExtent) ??
			sheets[0]
	);

	/**
	 * A tab the user picked, and the focus at that moment: the pick holds until a newer focus moves the view to
	 * its sheet, so a row selected in the review always shows even after the user browsed other tabs.
	 */
	let picked = $state<{ name: string; focus: SheetFocus | null } | null>(null);
	const current = $derived.by((): SheetModel | undefined => {
		if (picked && picked.focus === focus && byName(picked.name)) return byName(picked.name);
		return byName(focus?.sheet) ?? byName(picked?.name) ?? opening;
	});
	const tabId = (sheet: SheetModel) => `${uid}-tab-${sheet.index}`;
	const pending = $derived(analysis.decisions.filter((decision) => decision.state === 'pending').length);

	/** Why nothing on the current sheet imports, when that is so; null for a sheet with a table that imports. */
	const notice = $derived.by((): { tone: 'quiet' | 'waiting'; text: string; detail?: string } | null => {
		if (!current) return null;
		if (!current.valueExtent) return { tone: 'quiet', text: 'This sheet is empty.' };
		const sheetTones = tones(current);
		if (sheetTones.includes('included')) return null;
		const sheet = analysis.sheets.find((candidate) => candidate.name === current.name);
		const waiting = overlays.get(current.name)?.tables.find((table) => table.tone === 'pending');
		if (waiting) {
			// A table's last reason is its status reason: why it is not ready.
			const detail = sheet?.tables.find((table) => table.id === waiting.id)?.reasons.at(-1);
			return { tone: 'waiting', text: 'This table waits for your decision before it imports.', detail };
		}
		if (sheetTones.includes('excluded')) return { tone: 'quiet', text: 'This table is left out of the import.' };
		return { tone: 'quiet', text: 'Nothing on this sheet will be imported.', detail: sheet?.reasons[0] };
	});

	function pick(sheet: SheetModel) {
		picked = { name: sheet.name, focus };
	}

	/** Arrow keys move between tabs and show each, as tabs in a tab list do. */
	function onTabKeydown(event: KeyboardEvent, index: number) {
		const last = sheets.length - 1;
		const next =
			event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
			: event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
			: event.key === 'Home' ? 0
			: event.key === 'End' ? last
			: null;
		if (next === null) return;
		event.preventDefault();
		pick(sheets[next]);
		document.getElementById(tabId(sheets[next]))?.focus();
	}

	function activate(sheet: SheetModel, row: number, col: number) {
		const recordId = tableAt(overlays.get(sheet.name) ?? EMPTY_OVERLAY, row, col)?.records.get(row);
		if (recordId) onOpenRecord(recordId);
	}
</script>

<section class="flex h-full min-h-0 flex-col bg-white" aria-label="Spreadsheet">
	{#if onBack}
		<!-- Here the spreadsheet covers the review, so say what waits there. -->
		<div class="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-slate-200 px-2 py-1.5">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
				onclick={onBack}
			>
				<ArrowLeft size={16} /> Back to review
			</button>
			{#if pending}
				<span class="text-sm text-amber-800">{plural(pending, 'decision')} {pending === 1 ? 'needs' : 'need'} you</span>
			{/if}
		</div>
	{/if}

	{#if current}
		{#key current.name}
			<div role="tabpanel" id={`${uid}-panel`} aria-labelledby={tabId(current)} class="flex min-h-0 flex-1 flex-col">
				{#if notice}
					{@const Icon = notice.tone === 'waiting' ? TriangleAlert : Info}
					<div
						class={[
							'flex shrink-0 gap-2 border-b px-3 py-2 text-[13px] leading-5',
							notice.tone === 'waiting' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'
						]}
					>
						<Icon size={15} class={['mt-0.5 shrink-0', notice.tone === 'waiting' ? 'text-amber-600' : 'text-slate-400']} />
						<p class="min-w-0">
							<span class="font-medium">{notice.text}</span>
							{#if notice.detail}<span class={notice.tone === 'waiting' ? 'text-amber-800/80' : 'text-slate-500'}> {notice.detail}</span>{/if}
						</p>
					</div>
				{/if}
				<SheetGrid
					sheet={current}
					overlay={overlays.get(current.name) ?? EMPTY_OVERLAY}
					focus={focus?.sheet === current.name ? focus : null}
					tabId={tabId(current)}
					onSelect={(row, col) => onFocus(cellFocus(current.name, row, col))}
					onActivate={(row, col) => activate(current, row, col)}
				/>
			</div>
		{/key}
	{/if}

	<!-- Excel's sheet tabs: every visible sheet, scrolling sideways when there are many. -->
	<div class="flex shrink-0 overflow-x-auto border-t border-slate-200 bg-slate-50 pl-2" role="tablist" aria-label="Sheets">
		{#each sheets as sheet, i (sheet.name)}
			{@const selected = sheet === current}
			<button
				type="button"
				role="tab"
				id={tabId(sheet)}
				aria-selected={selected}
				aria-controls={selected ? `${uid}-panel` : undefined}
				tabindex={selected ? 0 : -1}
				class={[
					'relative shrink-0 whitespace-nowrap px-3.5 py-1.5 text-[13px] transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600',
					selected ? 'bg-white font-semibold text-[#107c41] shadow-[inset_1px_0_0_#e2e8f0,inset_-1px_0_0_#e2e8f0]' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
				]}
				onclick={() => pick(sheet)}
				onkeydown={(event) => onTabKeydown(event, i)}
			>
				{sheet.name}
				{#if selected}<span class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#107c41]"></span>{/if}
			</button>
		{/each}
	</div>

	<p class="sr-only" aria-live="polite">{focus?.reason ? `Showing ${focus.reason} in the spreadsheet` : ''}</p>
</section>
