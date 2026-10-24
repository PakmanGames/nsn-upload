<script lang="ts">
	import Boxes from '@lucide/svelte/icons/boxes';
	import CheckCircle from '@lucide/svelte/icons/circle-check-big';
	import CloudUpload from '@lucide/svelte/icons/cloud-upload';
	import Database from '@lucide/svelte/icons/database';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import { onMount } from 'svelte';
	import ImportReviewWindow from './import/ImportReviewWindow.svelte';
	import { demoMappings } from '$lib/demo-data';
	import type { MappingInput, MappingRecord } from '$lib/types';

	const storageKey = 'nsn-upload-interview-task:mappings';
	const pageSize = 8;

	let mappings = $state<MappingRecord[]>(demoMappings.map((mapping) => ({ ...mapping })));
	let searchTerm = $state('');
	let currentPage = $state(0);
	let showUpload = $state(false);
	let hydrated = $state(false);

	const filteredMappings = $derived(
		mappings.filter((mapping) => {
			const query = searchTerm.trim().toLowerCase();
			if (!query) return true;
			return [mapping.part, mapping.description, mapping.nsn, mapping.niin, mapping.cage]
				.filter(Boolean)
				.some((value) => value?.toLowerCase().includes(query));
		})
	);
	const pageCount = $derived(Math.max(1, Math.ceil(filteredMappings.length / pageSize)));
	const visibleMappings = $derived(
		filteredMappings.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
	);

	onMount(() => {
		const saved = localStorage.getItem(storageKey);
		if (saved) {
			try {
				mappings = JSON.parse(saved) as MappingRecord[];
			} catch {
				localStorage.removeItem(storageKey);
			}
		}
		hydrated = true;
	});

	function save(next: MappingRecord[]) {
		mappings = next;
		if (hydrated) localStorage.setItem(storageKey, JSON.stringify(next));
	}

	function resetDemo() {
		save(demoMappings.map((mapping) => ({ ...mapping })));
		searchTerm = '';
		currentPage = 0;
	}

	/** Duplicates against saved records were already resolved in the review window, so every input is added. */
	function importMappings(inputs: MappingInput[]): number {
		const createdAt = new Date().toISOString();
		const added: MappingRecord[] = inputs.map((input) => ({
			...input,
			id: crypto.randomUUID(),
			createdAt,
			status: 'Ready'
		}));
		save([...added, ...mappings]);
		searchTerm = '';
		currentPage = 0;
		return added.length;
	}

	function statusStyle(status: MappingRecord['status']) {
		if (status === 'Enriched') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
		if (status === 'Processing') return 'bg-amber-50 text-amber-700 ring-amber-600/20';
		return 'bg-blue-50 text-blue-700 ring-blue-600/20';
	}
</script>

<div class="min-h-screen bg-[#f6f7f9]">
	<header class="border-b border-slate-200 bg-slate-950 text-white">
		<div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 lg:px-8">
			<div class="flex items-center gap-3">
				<div class="grid size-8 place-items-center rounded-md bg-white/10">
					<Boxes size={18} />
				</div>
				<span class="text-sm font-semibold tracking-wide">Supplier Intelligence</span>
			</div>
			<div class="flex items-center gap-2 text-xs text-slate-300">
				<span class="size-2 rounded-full bg-emerald-400"></span>
				Local demo
			</div>
		</div>
	</header>

	<div class="mx-auto max-w-7xl px-5 py-5 lg:px-8 lg:py-7">
		<nav class="flex items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
			<Settings size={15} />
			<span>Settings</span>
			<span class="text-slate-300">/</span>
			<span class="font-medium text-slate-800">NSNs</span>
		</nav>

		<div class="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight text-slate-950">NSNs & Part Numbers</h1>
				<p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
					Manage identifiers used to discover matching supplier opportunities and enrich part records.
				</p>
			</div>
			<button
				type="button"
				class="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-800"
				onclick={() => (showUpload = true)}
			>
				<CloudUpload size={17} />
				Smart Upload
			</button>
		</div>

		<div class="mt-6 grid gap-3 sm:grid-cols-3">
			<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium uppercase tracking-wide text-slate-500">Total mappings</span>
					<Database size={17} class="text-slate-400" />
				</div>
				<p class="mt-2 text-2xl font-semibold text-slate-950">{mappings.length}</p>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium uppercase tracking-wide text-slate-500">Enriched</span>
					<CheckCircle size={17} class="text-emerald-600" />
				</div>
				<p class="mt-2 text-2xl font-semibold text-slate-950">
					{mappings.filter((mapping) => mapping.status === 'Enriched').length}
				</p>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium uppercase tracking-wide text-slate-500">Storage</span>
					<span class="size-2 rounded-full bg-emerald-500"></span>
				</div>
				<p class="mt-2 text-sm font-semibold text-slate-950">Browser only</p>
				<p class="mt-1 text-xs text-slate-500">No database or network connection</p>
			</div>
		</div>

		<section class="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
			<div class="flex flex-col justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center">
				<div>
					<h2 class="text-sm font-semibold text-slate-950">Input mappings</h2>
					<p class="mt-0.5 text-xs text-slate-500">Part, NSN, NIIN, CAGE, and description inputs</p>
				</div>
				<div class="flex items-center gap-2">
					<label class="relative block">
						<Search class="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
						<input
							class="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-64"
							type="search"
							placeholder="Search mappings…"
							bind:value={searchTerm}
							oninput={() => (currentPage = 0)}
						/>
					</label>
					<button
						type="button"
						class="rounded-md border border-slate-300 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
						aria-label="Reset demo data"
						title="Reset demo data"
						onclick={resetDemo}
					>
						<RefreshCw size={17} />
					</button>
				</div>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full min-w-5xl border-collapse text-left text-sm">
					<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
						<tr>
							<th class="px-4 py-3 font-medium">Part number</th>
							<th class="px-4 py-3 font-medium">Description</th>
							<th class="px-4 py-3 font-medium">NSN</th>
							<th class="px-4 py-3 font-medium">NIIN</th>
							<th class="px-4 py-3 font-medium">CAGE</th>
							<th class="px-4 py-3 font-medium">Status</th>
							<th class="px-4 py-3 font-medium">Added</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each visibleMappings as mapping (mapping.id)}
							<tr class="transition hover:bg-slate-50/80">
								<td class="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{mapping.part ?? '—'}</td>
								<td class="max-w-72 truncate px-4 py-3 text-slate-600">{mapping.description ?? '—'}</td>
								<td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{mapping.nsn ?? '—'}</td>
								<td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{mapping.niin ?? '—'}</td>
								<td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{mapping.cage ?? '—'}</td>
								<td class="px-4 py-3">
									<span class={['inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset', statusStyle(mapping.status)]}>
										{mapping.status}
									</span>
								</td>
								<td class="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
									{mapping.createdAt.slice(0, 10)}
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="7" class="px-4 py-12 text-center">
									<p class="text-sm font-medium text-slate-700">No mappings found</p>
									<p class="mt-1 text-xs text-slate-500">Try a different search or upload a workbook.</p>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
				<p class="text-xs text-slate-500">
					Showing {visibleMappings.length} of {filteredMappings.length} mappings
				</p>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
						disabled={currentPage === 0}
						onclick={() => (currentPage -= 1)}
					>
						Previous
					</button>
					<span class="text-xs text-slate-500">Page {currentPage + 1} of {pageCount}</span>
					<button
						type="button"
						class="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
						disabled={currentPage >= pageCount - 1}
						onclick={() => (currentPage += 1)}
					>
						Next
					</button>
				</div>
			</div>
		</section>

		<p class="mt-4 text-center text-xs text-slate-400">
			Standalone interview environment · Uploads persist in localStorage
		</p>
	</div>
</div>

<ImportReviewWindow
	open={showUpload}
	existing={mappings}
	onClose={() => (showUpload = false)}
	onImport={importMappings}
/>
