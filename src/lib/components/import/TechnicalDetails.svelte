<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	/** The pipeline's own wording behind a plain-language explanation, for whoever wants the exact terms. */
	let { text }: { text: string | string[] } = $props();
	const lines = $derived(Array.isArray(text) ? text : [text]);
	const id = $props.id();
	let open = $state(false);
</script>

<!-- A button disclosure like "Why this classification", not <details>: sections treat their <details> as folds. -->
<button
	type="button"
	class="flex items-center gap-1 rounded text-xs text-slate-500 transition hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
	aria-expanded={open}
	aria-controls={id}
	onclick={() => (open = !open)}
>
	<ChevronRight size={13} class={['transition', open && 'rotate-90']} />
	Technical details
</button>
<ul {id} hidden={!open} class="mt-1 space-y-0.5 pl-4 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
	{#each lines as line, i (i)}
		<li>{line}</li>
	{/each}
</ul>
