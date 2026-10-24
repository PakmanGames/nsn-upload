<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { ImportSession } from '$lib/import/session.svelte';
	import Switch from './Switch.svelte';
	import { plural } from './labels';

	let { session }: { session: ImportSession } = $props();
	const uid = $props.id();
	const explanationId = `${uid}-how`;
	const descriptionId = `${uid}-description`;
	let explained = $state(false);

	const availability = $derived(session.aiAvailability);
	const run = $derived(session.aiRun);
	const explainRun = $derived(session.explainRun);
	const triggered = $derived(
		session.analysis?.sheets.filter((sheet) => sheet.aiTrigger && sheet.status !== 'hidden') ?? []
	);
</script>

<div>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 text-sm leading-6">
			<div aria-live="polite">
				{#if session.aiEnabled && availability === null}
					<p class="flex items-center gap-1.5 text-slate-500">
						<LoaderCircle size={14} class="animate-spin" /> Checking the AI service…
					</p>
				{:else if availability?.available === false}
					<p class="flex gap-1.5 text-slate-500">
						<CircleAlert size={14} class="mt-1 shrink-0" />
						<span>
							Unavailable: {availability.reason ?? 'the AI service is not configured'}. The importer works without it.
						</span>
					</p>
				{:else if run?.status === 'running'}
					<p class="flex items-center gap-1.5 text-violet-700">
						<LoaderCircle size={14} class="animate-spin" /> AI is reading {run.sheets.join(', ')}…
					</p>
				{:else if run?.status === 'error'}
					<p class="flex gap-1.5 text-red-700">
						<CircleAlert size={14} class="mt-1 shrink-0" />
						<span>
							AI request failed: {run.error}. What the importer found on its own is shown.
							<button
								type="button"
								class="rounded font-medium underline decoration-red-300 underline-offset-2 hover:text-red-900 focus-visible:outline-2 focus-visible:outline-blue-600"
								onclick={() => session.retryAi()}
							>
								Try again
							</button>
						</span>
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
						{#if !session.aiEnabled}It is off, so nothing is sent.{/if}
					</p>
				{:else if session.aiEnabled}
					<p class="text-slate-500">AI is on. Every sheet was read without help, so no sheet was sent.</p>
				{:else}
					<p class="text-slate-500">Every sheet was read without help. Turned on, AI would only reword the explanations of decisions.</p>
				{/if}
				{#if session.aiEnabled && availability?.available}
					{@const stats = session.explainStats}
					{#if explainRun?.status === 'running'}
						<p class="flex items-center gap-1.5 text-violet-700">
							<LoaderCircle size={14} class="animate-spin" /> Rewording {plural(explainRun.sent, 'decision')} in plain language…
						</p>
					{:else if explainRun?.status === 'failed'}
						<!-- Quiet on purpose: the standard wording is complete on its own, so this is a note, not an error. -->
						<p class="text-slate-500">The AI did not answer for the explanations, so the standard wording is shown.</p>
					{:else if stats.ai + stats.plain > 0}
						<p class="text-slate-700">
							Explained {plural(stats.ai + stats.plain, 'decision')}{#if stats.plain}; {stats.plain} used the standard wording{/if}.
						</p>
					{/if}
				{/if}
			</div>
			<!-- What is sent and to whom stays in view, since AI is on without asking (D23). -->
			<p id={descriptionId} class="mt-1 text-xs leading-5 text-slate-500">
				{#if session.aiEnabled}
					On by default. Sheets the importer cannot read are sent as sampled cells, and each decision's facts to word its
					explanation, through this app's server to its AI provider; hidden sheets and metadata columns never are. Turn it
					off to keep everything in this browser; this browser remembers the choice.
				{:else}
					Off, so everything stays in this browser. When on, which is the default, sheets the importer cannot read are
					sent as sampled cells, and each decision's facts to word its explanation, through this app's server to its AI
					provider.
				{/if}
			</p>
		</div>
		<Switch
			checked={session.aiEnabled}
			label="AI assistance"
			describedby={descriptionId}
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
		The AI proposes structure only: which rows and columns form a table. It never supplies values, and every proposal
		is checked against the workbook before it is used.
		It also rewords the explanations of decisions from their facts, never from sheet samples; wording that mentions a
		cell or number not in those facts is not shown.
	</p>
</div>
