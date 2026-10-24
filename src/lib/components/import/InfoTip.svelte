<script lang="ts">
	import Info from '@lucide/svelte/icons/info';

	type Props = { label: string; lines: string[] };

	let { label, lines }: Props = $props();
	const id = $props.id();
</script>

<!--
	Shown on hover and on keyboard focus; the text is also wired to the button for screen readers.
	The group is named: an unnamed group-hover would also fire for any ancestor with "group", such as a section.
-->
<span class="group/tip relative inline-flex">
	<button
		type="button"
		class="rounded p-0.5 text-slate-400 transition hover:text-slate-700 focus-visible:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600"
		aria-label={label}
		aria-describedby={id}
	>
		<Info size={14} />
	</button>
	<span
		{id}
		role="tooltip"
		class="pointer-events-none invisible absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] space-y-1 rounded-md bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
	>
		{#each lines as line, i (i)}
			<span class="block">{line}</span>
		{/each}
	</span>
</span>
