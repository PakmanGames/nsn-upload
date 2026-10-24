<script lang="ts">
	import AlertCircle from '@lucide/svelte/icons/circle-alert';
	import CheckCircle from '@lucide/svelte/icons/circle-check-big';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Download from '@lucide/svelte/icons/download';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Upload from '@lucide/svelte/icons/upload';
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { analyzeWorkbook, downloadSampleWorkbook } from '$lib/smart-upload';
	import type { ImportResult, UploadAnalysis, UploadRow } from '$lib/types';

	type Props = {
		open: boolean;
		onClose: () => void;
		onImport: (rows: UploadRow[]) => Promise<ImportResult>;
	};

	let { open, onClose, onImport }: Props = $props();
	let selectedFile = $state<File | null>(null);
	let analysis = $state<UploadAnalysis | null>(null);
	let parseError = $state('');
	let isParsing = $state(false);
	let isImporting = $state(false);
	let isDragActive = $state(false);
	let importResult = $state<ImportResult | null>(null);
	let fileInput = $state<HTMLInputElement>();

	const validRows = $derived(analysis?.rows.filter((row) => !row.error) ?? []);
	const invalidRows = $derived(analysis?.rows.filter((row) => row.error) ?? []);
	const detectedFields = $derived(
		analysis
			? Object.entries(analysis.columns)
					.filter(([, column]) => column >= 0)
					.map(([field]) => field)
			: []
	);

	onMount(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (open && event.key === 'Escape' && !isParsing && !isImporting) close();
		};
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	function reset() {
		selectedFile = null;
		analysis = null;
		parseError = '';
		importResult = null;
		isDragActive = false;
	}

	function close() {
		if (isParsing || isImporting) return;
		reset();
		onClose();
	}

	async function selectFile(file: File | undefined) {
		if (!file) return;
		selectedFile = file;
		analysis = null;
		importResult = null;
		parseError = '';
		isParsing = true;

		try {
			analysis = await analyzeWorkbook(file);
		} catch (error) {
			parseError = error instanceof Error ? error.message : 'Failed to parse the workbook.';
		} finally {
			isParsing = false;
		}
	}

	function onFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		void selectFile(input.files?.[0]);
		input.value = '';
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		isDragActive = false;
		void selectFile(event.dataTransfer?.files[0]);
	}

	async function importRows() {
		if (!analysis || validRows.length === 0) return;
		isImporting = true;
		try {
			importResult = await onImport(validRows);
		} finally {
			isImporting = false;
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && close()}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="upload-title"
		>
			<header class="flex items-start justify-between border-b border-slate-200 px-6 py-5">
				<div class="flex gap-3">
					<div class="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
						<FileSpreadsheet size={21} />
					</div>
					<div>
						<h2 id="upload-title" class="text-lg font-semibold text-slate-950">
							Smart Upload — Parts & NSNs
						</h2>
						<p class="mt-1 text-sm text-slate-500">
							Upload an Excel workbook. Column headers are detected automatically.
						</p>
					</div>
				</div>
				<button
					type="button"
					class="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
					aria-label="Close upload modal"
					onclick={close}
					disabled={isParsing || isImporting}
				>
					<X size={19} />
				</button>
			</header>

			<div class="overflow-y-auto px-6 py-5">
				<div class="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Workbook requirements</p>
						<ul class="mt-3 space-y-2 text-sm text-slate-700">
							<li class="flex gap-2">
								<CheckCircle class="mt-0.5 shrink-0 text-emerald-600" size={16} />
								<span>Use an <strong>.xlsx</strong> file; the first worksheet is read.</span>
							</li>
							<li class="flex gap-2">
								<CheckCircle class="mt-0.5 shrink-0 text-emerald-600" size={16} />
								<span>Include Part, NSN, or NIIN. Description and CAGE are recommended.</span>
							</li>
							<li class="flex gap-2">
								<CheckCircle class="mt-0.5 shrink-0 text-emerald-600" size={16} />
								<span>Commas and formatted Excel cells are handled without CSV conversion.</span>
							</li>
						</ul>
						<button
							type="button"
							class="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
							onclick={() => void downloadSampleWorkbook()}
						>
							<Download size={15} />
							Download sample workbook
						</button>
					</div>

					<button
						type="button"
						class={[
							'group flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition',
							isDragActive
								? 'border-blue-500 bg-blue-50'
								: 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40'
						]}
						ondragenter={(event) => {
							event.preventDefault();
							isDragActive = true;
						}}
						ondragover={(event) => event.preventDefault()}
						ondragleave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node)) isDragActive = false;
						}}
						ondrop={onDrop}
						onclick={() => fileInput?.click()}
					>
						<div class="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700">
							{#if isParsing}
								<LoaderCircle class="animate-spin" size={21} />
							{:else}
								<Upload size={21} />
							{/if}
						</div>
						<p class="mt-3 text-sm font-medium text-slate-800">
							{isParsing ? 'Analyzing workbook…' : 'Drop an Excel workbook here'}
						</p>
						<p class="mt-1 text-xs text-slate-500">or click to browse · .xlsx only</p>
						{#if selectedFile}
							<span class="mt-3 max-w-full truncate rounded bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
								{selectedFile.name}
							</span>
						{/if}
					</button>
					<input
						class="sr-only"
						bind:this={fileInput}
						type="file"
						accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						onchange={onFileInput}
					/>
				</div>

				{#if parseError}
					<div class="mt-4 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
						<AlertCircle class="mt-0.5 shrink-0" size={17} />
						<div>
							<p class="font-medium">This workbook could not be analyzed</p>
							<p class="mt-0.5 text-red-700">{parseError}</p>
						</div>
					</div>
				{/if}

				{#if analysis}
					<div class="mt-5 overflow-hidden rounded-lg border border-slate-200">
						<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
							<div>
								<p class="text-sm font-medium text-slate-900">
									{analysis.sheetName} · {analysis.rows.length} data rows
								</p>
								<p class="mt-0.5 text-xs text-slate-500">
									Detected: {detectedFields.join(', ')}
								</p>
							</div>
							<div class="flex gap-2 text-xs font-medium">
								<span class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
									{validRows.length} ready
								</span>
								{#if invalidRows.length}
									<span class="rounded-full bg-red-100 px-2.5 py-1 text-red-800">
										{invalidRows.length} invalid
									</span>
								{/if}
							</div>
						</div>
						<div class="max-h-72 overflow-auto">
							<table class="w-full min-w-3xl border-collapse text-left text-xs">
								<thead class="sticky top-0 bg-white text-slate-500 shadow-[0_1px_0_#e2e8f0]">
									<tr>
										<th class="px-4 py-2.5 font-medium">Row</th>
										<th class="px-4 py-2.5 font-medium">Part</th>
										<th class="px-4 py-2.5 font-medium">Description</th>
										<th class="px-4 py-2.5 font-medium">NSN / NIIN</th>
										<th class="px-4 py-2.5 font-medium">CAGE</th>
										<th class="px-4 py-2.5 font-medium">Validation</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each analysis.rows.slice(0, 20) as row}
										<tr class={row.error ? 'bg-red-50/50' : ''}>
											<td class="px-4 py-2.5 text-slate-500">{row.line}</td>
											<td class="px-4 py-2.5 font-medium text-slate-800">{row.input.part ?? '—'}</td>
											<td class="max-w-64 truncate px-4 py-2.5 text-slate-600">
												{row.input.description ?? '—'}
											</td>
											<td class="px-4 py-2.5 font-mono text-slate-600">
												{row.input.nsn ?? row.input.niin ?? '—'}
											</td>
											<td class="px-4 py-2.5 font-mono text-slate-600">{row.input.cage ?? '—'}</td>
											<td class="px-4 py-2.5">
												{#if row.error}
													<span class="text-red-700">{row.error}</span>
												{:else if row.warnings.length}
													<span class="text-amber-700">{row.warnings.join(' · ')}</span>
												{:else}
													<span class="text-emerald-700">Ready</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if analysis.rows.length > 20}
							<p class="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
								Showing the first 20 rows. All valid rows will be imported.
							</p>
						{/if}
					</div>
				{/if}

				{#if importResult}
					<div
						class={[
							'mt-4 rounded-lg border p-4',
							importResult.failed.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
						]}
					>
						<div class="flex items-start gap-3">
							<CheckCircle
								class={importResult.failed.length ? 'text-amber-700' : 'text-emerald-700'}
								size={19}
							/>
							<div>
								<p class="text-sm font-semibold text-slate-900">
									{importResult.success} {importResult.success === 1 ? 'row' : 'rows'} added locally
								</p>
								<p class="mt-0.5 text-xs text-slate-600">
									{importResult.failed.length
										? `${importResult.failed.length} duplicate rows were skipped.`
										: 'The NSN table has been updated. No network request was made.'}
								</p>
							</div>
						</div>
						{#if importResult.failed.length}
							<details class="mt-3 text-xs text-slate-700">
								<summary class="flex cursor-pointer items-center gap-1 font-medium">
									<ChevronDown size={14} /> Show skipped rows
								</summary>
								<ul class="mt-2 space-y-1 pl-5">
									{#each importResult.failed as failed}
										<li>Row {failed.line}: {failed.identifier} — {failed.error}</li>
									{/each}
								</ul>
							</details>
						{/if}
					</div>
				{/if}
			</div>

			<footer class="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
				<p class="text-xs text-slate-500">
					Demo mode · data stays in this browser
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
						onclick={close}
					>
						{importResult ? 'Done' : 'Cancel'}
					</button>
					{#if !importResult}
						<button
							type="button"
							class="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:bg-slate-300"
							disabled={!analysis || validRows.length === 0 || isParsing || isImporting}
							onclick={() => void importRows()}
						>
							{#if isImporting}<LoaderCircle class="animate-spin" size={16} />{/if}
							{isImporting ? 'Importing…' : `Import ${validRows.length || ''} valid rows`}
						</button>
					{/if}
				</div>
			</footer>
		</div>
	</div>
{/if}
