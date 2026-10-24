<script lang="ts">
	type Props = {
		checked: boolean;
		label: string;
		disabled?: boolean;
		onchange: (checked: boolean) => void;
	};

	let { checked, label, disabled = false, onchange }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	class={[
		'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50',
		checked ? 'bg-blue-700' : 'bg-slate-300'
	]}
	onclick={() => onchange(!checked)}
>
	<span
		class={[
			'inline-block size-4 rounded-full bg-white shadow-sm transition',
			checked ? 'translate-x-4.5' : 'translate-x-0.5'
		]}
	></span>
</button>
