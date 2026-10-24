# AI1 - AI assistance on by default

Product owner decision (D23): AI assistance is the fallback when the importer cannot read a sheet by itself, so it starts on.
The switch stays, and turning it off is remembered.
Read the Wave 2 rules in `docs/PLAN.md` first, including the UX bar.

## Today

- `ImportSession.aiEnabled` starts `false` (`src/lib/import/session.svelte.ts`). `initAi()` turns it on only when the saved preference (`localStorage` key `nsn-upload-interview-task:ai-assistance`) is `on`.
- Nothing is requested, not even the availability check on our own `/api/interpret` route, until the user turns the switch on. `session.test.ts` pins this: "makes no AI request, not even the availability check, until AI assistance is turned on".
- `Just NSNs`-style sheets and PENCOM's `Search Log` therefore wait for the user to find a switch in a collapsed section.

## Spec note

TASK_SPEC says "Network transmission must be disabled unless AI parsing is explicitly enabled."
The product owner accepted that this deviates from a literal reading (D23).
Keep the deviation as small and as visible as possible:

- Nothing goes to the AI provider when the server has no key (`/api/interpret` reports unavailable, as today); parsing works without a key.
- Only sheets with an `aiTrigger` are sent, as sampled cells, as today. Hidden sheets and metadata columns never are.
- The AI section says, while on, what is sent and to whom, and the switch turns it off for good on this browser.

## Build

1. **Default on.** On load, AI assistance is on unless the saved preference is `off`. Run the availability check, then interpret triggered sheets, through the existing `setAiEnabled(true)` path. A saved `off` makes no request of any kind. Turning the switch on or off saves the preference, as today.
2. **Unavailable server.** When the availability check says unavailable, the switch shows off with the reason (as today) and the saved preference is left alone, so the next deployment with a key turns it on again.
3. **Say when AI is working.** The deterministic analysis still renders at once. While a request runs, the summary bar says so ("AI is reading Sheet1...") and the waiting sheet's line in Sheets says the same, so the counts changing a few seconds later is not a surprise. When it finishes, the existing AI section result shows.
4. **Copy.** The AI section summary while on reads like "On · sheets the importer cannot read are sent to the AI provider as sampled cells". The switch's description says it is on by default and that turning it off keeps everything in the browser.
5. **README.** Update the AI section: on by default when the server has a key, how to turn it off, what is sent, and the D23 note.

M1 (plain-language messages) sends its explanation requests under the same switch, so once M1 merges those also run by default. Do not hard-code "interpretation only" anywhere that M1 will extend.

## Tests

- Session (`src/lib/components/import/session.test.ts`): default on runs the availability check and interprets triggered sheets on load; a saved `off` makes no request at all; unavailable turns the switch off with the reason and does not interpret; turning it off aborts a running request and drops AI tables (existing test). Replace the "no request until turned on" test with the saved-`off` version.
- E2E: Playwright runs with `AI_PROVIDER=mock` (`playwright.config.ts`), so with AI on by default every upload now calls the mock, and PENCOM's `Search Log` gets an AI table. Existing specs that assert the deterministic flow (the PENCOM decision steps in `tests/e2e/review-window.spec.ts`, among others) must turn AI off first: add a helper in `tests/e2e/helpers.ts` that sets the saved preference to `off` through `page.addInitScript`, and use it there.
- New E2E `tests/e2e/ai-default.spec.ts`: a fresh visitor uploading PENCOM sees "AI is reading Search Log" and then the AI result without touching the switch; turning the switch off and reloading keeps it off and makes no `/api/interpret` POST.

## Done when

- A fresh browser with the server key set reads PENCOM's `Search Log` through AI without any click.
- A browser that turned AI off never sends a request again until it is turned on.
- No key on the server: no provider call, a clear reason, deterministic results unchanged.
- `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm test:e2e` pass.

## Owns

The AI default and `initAi` in `session.svelte.ts`, `AiAssist.svelte`, the AI line in `src/lib/components/import/summary.ts`, the "AI is reading" note in `ImportReviewWindow.svelte` and `SheetsPanel.svelte`, `tests/e2e/helpers.ts`, the session tests, and the README's AI section.
M1 edits `AiAssist.svelte` and `session.svelte.ts`, E3 the summary sentence in `summary.ts`, E1 and V1 other parts of `session.svelte.ts`; keep their changes when you rebase.
