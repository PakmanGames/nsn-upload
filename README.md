# NSN Smart Upload — Standalone Interview Project

This is a self-contained extraction of the **Settings → NSNs** smart-upload workflow. It
keeps the page context, Excel upload modal, header detection, normalization, validation,
preview, import results, search, and mappings table.

The candidate-facing extension brief is in [`TASK_SPEC.md`](./TASK_SPEC.md). It covers
multi-sheet discovery, complex headers, unstructured workbooks, multiline identifiers,
provenance, and an optional AI-assisted interpretation boundary.

It deliberately has no application backend:

- no Supabase client or query
- no tRPC client or firm identifier
- no authentication, analytics, or application-wide UI dependencies
- imported rows are stored in browser `localStorage`

## Run it

```bash
pnpm install
pnpm run dev
```

Then open the local URL printed by Vite. The upload modal can generate its own sample
`.xlsx` workbook.

## Useful checks

```bash
pnpm test
pnpm check
pnpm build
```

## Project map

- `src/lib/components/NsnSettingsTab.svelte` — settings-page context and local repository
- `src/lib/components/SmartUploadModal.svelte` — upload, analysis, preview, and results UI
- `src/lib/smart-upload.ts` — Excel parsing, header detection, normalization, and validation
- `src/lib/smart-upload.test.ts` — focused parser tests
- `src/lib/demo-data.ts` — hardcoded NSN table seed data

## Current behavior

The first worksheet of an `.xlsx` file is read in the browser with ExcelJS. Column names
such as `Part Number`, `P/N`, `NSN`, `NIIN`, `CAGE Code`, `Description`, and
`Nomenclature` are recognized. NSNs and NIINs are normalized by removing spaces and
hyphens, and dashes by themselves are interpreted as empty cells.

A row needs at least one of Part, NSN, or NIIN. Description and CAGE are retained when
present and shown as warnings when missing. Invalid and duplicate rows remain visible in
the preview, but only valid rows are imported.
