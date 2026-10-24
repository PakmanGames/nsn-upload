/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		// Playwright owns tests/e2e/*.spec.ts; Vitest would fail trying to run them.
		include: ['src/**/*.{test,spec}.ts', 'tests/acceptance/**/*.test.ts']
	}
});
