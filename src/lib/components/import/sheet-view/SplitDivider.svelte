<script lang="ts">
	type Props = {
		/** The left pane's share of the container's width, 0 to 1. */
		share: number;
		min: number;
		max: number;
		/** Id of the pane the divider resizes. */
		controls: string;
		onResize: (share: number) => void;
	};

	let { share, min, max, controls, onResize }: Props = $props();

	/** Arrow keys move the divider by this share; Home and End jump to the limits (window splitter pattern). */
	const STEP = 0.02;
	let dragging = $state(false);

	const clamp = (value: number) => Math.min(max, Math.max(min, value));

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		// Capture keeps the drag going over the grid and outside the window; preventDefault stops text selection.
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragging = true;
	}

	function onpointermove(event: PointerEvent) {
		if (!dragging) return;
		const container = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
		onResize(clamp((event.clientX - container.left) / container.width));
	}

	function onkeydown(event: KeyboardEvent) {
		const next =
			event.key === 'ArrowLeft' ? share - STEP
			: event.key === 'ArrowRight' ? share + STEP
			: event.key === 'Home' ? min
			: event.key === 'End' ? max
			: null;
		if (next === null) return;
		event.preventDefault();
		onResize(clamp(next));
	}
</script>

<!-- A focusable separator is interactive by the ARIA window splitter pattern. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize the review and the spreadsheet"
	aria-controls={controls}
	aria-valuemin={Math.round(min * 100)}
	aria-valuemax={Math.round(max * 100)}
	aria-valuenow={Math.round(share * 100)}
	tabindex="0"
	class="group relative z-30 w-px cursor-col-resize touch-none bg-slate-200 outline-none col-start-2 row-start-1"
	{onpointerdown}
	{onpointermove}
	onpointerup={() => (dragging = false)}
	onpointercancel={() => (dragging = false)}
	{onkeydown}
>
	<!--
		A wider hit area than the 1 px line, reaching into the spreadsheet's row numbers rather than the review, whose
		scrollbar sits right against the line. And a bar that shows while hovered, focused, or dragged.
	-->
	<span class="absolute inset-y-0 -left-0.5 -right-2"></span>
	<span
		class={[
			'pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-blue-500 transition-opacity',
			dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
		]}
	></span>
</div>
