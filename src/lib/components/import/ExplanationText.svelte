<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import type { Explanation } from '$lib/import/explain';
	import InfoTip from './InfoTip.svelte';

	type Props = {
		/** The rules wording, always available. */
		plain: Explanation;
		/** What to show: the plain wording, or AI wording written from the same facts. */
		shown?: Explanation;
		/** Keep room for the AI marker, so it can appear without moving the text: true while AI assistance is on. */
		reserveMarker?: boolean;
		compact?: boolean;
	};

	let { plain, shown = plain, reserveMarker = false, compact = false }: Props = $props();
	const ai = $derived(shown.source === 'ai');
	const layers = $derived(ai ? [plain, shown] : [plain]);
</script>

<!--
	Both wordings share one grid cell; the one not shown is invisible but keeps its size, so the block does not
	change height when the AI wording arrives (the verifier keeps AI wording no longer than the plain wording).
-->
<div class="grid">
	{#each layers as explanation, i (i)}
		{@const active = explanation === shown}
		<div class={['col-start-1 row-start-1 min-w-0', !active && 'invisible']} aria-hidden={active ? undefined : 'true'}>
			<p class={['[overflow-wrap:anywhere]', compact ? 'text-sm text-slate-800' : 'font-medium text-slate-900']}>
				{explanation.headline}
				{#if reserveMarker || explanation.source === 'ai'}
					<!-- Zero height, so the marker never changes the line's height when it appears. -->
					<span class={['ml-1 inline-flex h-0 items-center align-middle', explanation.source !== 'ai' && 'invisible']}>
						<span
							class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-px text-[11px] font-medium leading-4 text-violet-700 ring-1 ring-inset ring-violet-600/20"
						>
							<Sparkles size={10} /> AI wording
						</span>
						<InfoTip
							label="About the AI wording"
							lines={[
								'Reworded by AI from the facts of this item, then checked against them: every cell and number it mentions is in your file.',
								'The options and the suggestion come from the importer, not from the AI.'
							]}
						/>
					</span>
				{/if}
			</p>
			<p class={['mt-0.5 text-slate-600 [overflow-wrap:anywhere]', compact ? 'text-xs leading-5' : 'text-sm']}>{explanation.body}</p>
		</div>
	{/each}
</div>
