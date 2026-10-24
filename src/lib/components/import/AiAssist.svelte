<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { ImportSession } from '$lib/import/session.svelte';
	import Switch from './Switch.svelte';
	import { plural } from './labels';

	let { session }: { session: ImportSession } = $props();
	const explanationId = $props.id();
	let explained = $state(false);

	const availability = $derived(session.aiAvailability);
	const run = $derived(session.aiRun);
	const triggered = $derived(
		session.analysis?.sheets.filter((sheet) => sheet.aiTrigger && sheet.status !== 'hidden') ?? []
	);
</script>

<div>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 text-sm leading-6" aria-live="polite">
			{#if session.aiEnabled && availability === null}
				<p class="flex items-center gap-1.5 text-slate-500">
					<LoaderCircle size={14} class="animate-spin" /> Checking availability…
				</p>
			{:else if availability?.available === false}
				<p class="flex gap-1.5 text-slate-500">
					<CircleAlert size={14} class="mt-1 shrink-0" />
					<span>Unavailable: {availability.reason ?? 'the AI service is not configured.'}</span>
				</p>
			{:else if run?.status === 'running'}
				<p class="flex items-center gap-1.5 text-violet-700">
					<LoaderCircle size={14} class="animate-spin" /> Interpreting {run.sheets.join(', ')}…
				</p>
			{:else if run?.status === 'error'}
				<p class="flex gap-1.5 text-red-700">
					<CircleAlert size={14} class="mt-1 shrink-0" />
					<span>AI request failed: {run.error}</span>
				</p>
			{:else if run?.status === 'done' && run.result}
				<p class="text-slate-700">
					Sent {run.sheets.join(', ')}. Accepted {plural(run.result.tables.length, 'table')}{#if run.result.rejected.length},
						rejected {run.result.rejected.length}{/if}.
				</p>
				{#if run.result.rejected.length}
					<ul class="mt-1.5 space-y-1.5">
						{#each run.result.rejected as rejection, i (i)}
							<li class="flex gap-1.5 text-slate-600">
								<CircleX size={14} class="mt-1 shrink-0 text-red-600" />
								<span>
									<span class="font-medium text-slate-800">{rejection.sheetName}</span>
									<span class="font-mono">{rejection.range}</span>: {rejection.reason}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if triggered.length}
				<p class="text-slate-600">
					Could help with {triggered.map((sheet) => sheet.name).join(', ')}.
					{#if !session.aiEnabled}Off by default; nothing is sent until you turn it on.{/if}
				</p>
			{:else if session.aiEnabled}
				<p class="text-slate-500">AI is on, but every sheet was read without help, so nothing was sent.</p>
			{:else}
				<p class="text-slate-500">Every sheet was read without help; nothing would be sent.</p>
			{/if}
		</div>
		<Switch
			checked={session.aiEnabled}
			label="AI assistance"
			disabled={availability?.available === false || session.busy}
			onchange={(enabled) => void session.setAiEnabled(enabled)}
		/>
	</div>
	<!-- Same disclosure as "Why this classification" in the Sheets section. -->
	<button
		type="button"
		class="mt-1.5 flex items-center gap-1 rounded text-xs text-slate-500 transition hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
		aria-expanded={explained}
		aria-controls={explanationId}
		onclick={() => (explained = !explained)}
	>
		<ChevronRight size={13} class={['transition', explained && 'rotate-90']} />
		How AI assistance works
	</button>
	<p id={explanationId} class="mt-1 pl-4 text-xs leading-5 text-slate-600" hidden={!explained}>
		Sends sampled cells of sheets the importer could not read confidently. The AI proposes structure only; every
		proposal is checked against the workbook.
	</p>
</div>
