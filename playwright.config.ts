import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * One port per checkout, stable for that checkout. With a single shared port, parallel worktrees on one machine
 * raced for it, and a run could test another checkout's build or time out while it started.
 */
const PORT = 4173 + (createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 1000);

/**
 * E2E against the production build, so the tests see the same lazy chunks and server route users get.
 * AI_PROVIDER=mock wins over any OPENROUTER_API_KEY in .env, so these runs never call OpenRouter.
 */
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		env: { AI_PROVIDER: 'mock' },
		// Never reuse: a preview started by hand may lack AI_PROVIDER=mock and would fail the AI test confusingly.
		reuseExistingServer: false,
		timeout: 120_000
	}
});
