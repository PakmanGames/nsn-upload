<script lang="ts">
	import NsnSettingsTab from '$lib/components/NsnSettingsTab.svelte';

	const title = 'NSNs · Settings';
</script>

<svelte:head>
	<title>{title}</title>
	<meta
		name="description"
		content="Standalone NSN and part-number smart upload workflow."
	/>
</svelte:head>

<NsnSettingsTab />
