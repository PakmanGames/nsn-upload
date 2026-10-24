<script lang="ts">
	import type { CandidateRecord, Decision, Field, StoredMapping } from '$lib/import/model';
	import { FIELD_LABEL } from './labels';

	type Props = {
		decision: Decision;
		records: Map<string, CandidateRecord>;
		/** Saved records by id, for storage conflicts. */
		saved: Map<string, StoredMapping>;
	};

	let { decision, records, saved }: Props = $props();

	// Part number and NSN are the identity both sides share, and the stage title already names them.
	const COMPARE: Field[] = ['niin', 'description', 'cage'];
	type Column = { label: string; values: Partial<Record<Field, string>> };

	const describe = (record: CandidateRecord) =>
		`${record.sheet} row ${record.sourceRow}${record.split ? ` (${record.split.index}/${record.split.total})` : ''}`;
	const valuesOf = (record: CandidateRecord): Column['values'] =>
		Object.fromEntries(Object.entries(record.fields).map(([field, value]) => [field, value.value]));
	/** Same comparison the validation stage uses: case and whitespace do not make values differ. */
	const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

	const own = $derived(decision.recordIds.flatMap((id) => records.get(id) ?? []));

	/** Side-by-side values when a decision weighs records against each other or against a saved record. */
	const columns = $derived.by((): Column[] => {
		if (decision.kind === 'resolve-conflict') return own.map((record) => ({ label: describe(record), values: valuesOf(record) }));
		if (decision.kind !== 'resolve-storage-conflict') return [];
		const savedColumns = (decision.existingIds ?? []).flatMap((id) => {
			const mapping = saved.get(id);
			return mapping ? [{ label: 'Saved', values: mapping }] : [];
		});
		return [...savedColumns, ...own.map((record) => ({ label: `This file, ${describe(record)}`, values: valuesOf(record) }))];
	});

	type IdentifierCell = { cell: string; value: string; original: string };

	/** The row's own NSN, NIIN, and FSC cells: source values, or the rejected original once a choice moved one aside. */
	const identifiers = $derived.by(() => {
		const record = decision.kind === 'resolve-identifier-conflict' ? own[0] : undefined;
		if (!record) return null;
		const read = (field: Field): IdentifierCell | null => {
			const value = record.fields[field];
			if (value?.provenance.origin === 'source') {
				return { cell: value.provenance.cell, value: value.value, original: value.provenance.original };
			}
			const rejected = record.rejected[field];
			return rejected ? { cell: rejected.cell, value: rejected.original, original: rejected.original } : null;
		};
		return { nsn: read('nsn'), niin: read('niin'), fsc: read('fsc') };
	});

	const cellClass = 'px-3 py-2 align-top [overflow-wrap:anywhere]';
	const highlight = 'bg-amber-50 font-medium text-amber-900';
</script>

{#if columns.length}
	<div class="mt-3 rounded-lg border border-slate-200">
		<table class="w-full table-fixed border-collapse text-left text-sm">
			<thead class="bg-slate-50 text-xs text-slate-500">
				<tr>
					<th class="w-[5.5rem] px-3 py-2 font-medium sm:w-32"><span class="sr-only">Field</span></th>
					{#each columns as column, i (i)}
						<th class={['font-medium', cellClass]}>{column.label}</th>
					{/each}
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each COMPARE.filter((field) => columns.some((column) => column.values[field])) as field (field)}
					{@const values = columns.map((column) => column.values[field])}
					{@const differs = new Set(values.filter((value) => value !== undefined).map(normalize)).size > 1}
					<tr>
						<th scope="row" class="px-3 py-2 align-top font-normal text-slate-500">{FIELD_LABEL[field]}</th>
						{#each values as value, i (i)}
							<td class={[cellClass, differs ? highlight : 'text-slate-800']}>{value ?? '—'}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if identifiers}
	{@const nsn = identifiers.nsn?.value.replace(/\D/g, '')}
	{@const nsnFsc = nsn?.length === 13 ? nsn.slice(0, 4) : undefined}
	{@const nsnNiin = nsn?.length === 13 ? nsn.slice(4) : undefined}
	{@const fscDiffers = !!identifiers.fsc && !!nsnFsc && identifiers.fsc.value !== nsnFsc}
	{@const niinDiffers = !!identifiers.niin && !!nsnNiin && identifiers.niin.value !== nsnNiin}
	<!-- An NSN is its FSC followed by its NIIN, so lining the parts up shows which cell disagrees. -->
	<div class="mt-3 rounded-lg border border-slate-200">
		<table class="w-full table-fixed border-collapse text-left text-sm">
			<thead class="bg-slate-50 text-xs text-slate-500">
				<tr>
					<th class="w-16 px-3 py-2 font-medium"><span class="sr-only">Field</span></th>
					<th class="px-3 py-2 font-medium">Cell</th>
					<th class="w-20 px-3 py-2 font-medium">FSC</th>
					<th class="px-3 py-2 font-medium">NIIN</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 font-mono text-[13px]">
				{#each [['nsn', 'NSN'], ['niin', 'NIIN'], ['fsc', 'FSC']] as const as [field, name] (field)}
					{@const cell = identifiers[field]}
					{#if cell}
						<tr>
							<th scope="row" class="px-3 py-2 align-top font-sans font-normal text-slate-500">{name}</th>
							<td class={[cellClass, 'text-slate-800']}>
								{cell.cell}
								{#if cell.original !== cell.value}
									<span class="block font-sans text-xs text-slate-400">"{cell.original}"</span>
								{/if}
							</td>
							<td class={[cellClass, fscDiffers && field !== 'niin' ? highlight : 'text-slate-800']}>
								{field === 'nsn' ? nsnFsc : field === 'fsc' ? cell.value : ''}
							</td>
							<td class={[cellClass, niinDiffers && field !== 'fsc' ? highlight : 'text-slate-800']}>
								{field === 'nsn' ? nsnNiin : field === 'niin' ? cell.value : ''}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}
