<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Component, Snippet } from 'svelte';

	type Props = {
		id: string;
		title: string;
		/** One line that stands in for the body while the section is closed. */
		summary: string;
		icon: Component<{ size?: number }>;
		open: boolean;
		onToggle: (open: boolean) => void;
		children: Snippet;
	};

	let { id, title, summary, icon: Icon, open, onToggle, children }: Props = $props();
</script>

<!-- Native details: keyboard and screen readers get expand and collapse without extra wiring. -->
<details
	id={`section-${id}`}
	{open}
	ontoggle={(event) => onToggle(event.currentTarget.open)}
	class="group scroll-mt-3 rounded-xl border border-slate-200 bg-white shadow-sm"
>
	<summary
		class="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 group-open:rounded-b-none [&::-webkit-details-marker]:hidden"
	>
		<ChevronRight size={16} class="shrink-0 text-slate-400 transition group-open:rotate-90" />
		<span class="grid size-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600"><Icon size={16} /></span>
		<span class="min-w-0 flex-1">
			<span class="block text-sm font-semibold text-slate-900">{title}</span>
			<span class="block text-xs text-slate-500 [overflow-wrap:anywhere]">{summary}</span>
		</span>
	</summary>
	<div class="border-t border-slate-100 px-4 py-3">
		{@render children()}
	</div>
</details>
