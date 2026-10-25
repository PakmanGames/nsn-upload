# Demo workbooks

Four small workbooks for a live demo of Smart Upload.
Each shows one behavior the example files in `example-excel-uploads/` do not, or packs several messy cases into one sheet.
`tests/acceptance/demo-workbooks.test.ts` checks that the committed files still behave exactly as described below.

To rebuild them after editing the script (run from the repository root):

```bash
node docs/demo-workbooks/build.mjs
```

The part numbers differ from the example files, so the demos can run in any order, except (c), which needs PENCOM imported first.
To start from a clean mappings table, use the reset button next to the mappings search box.

## (a) `a-ai-unfamiliar-header.xlsx` - the AI path

A stock list whose NSN column is headed "National Stock No.", below a title, with no header the rules recognize.

Start the app with the mock AI provider (or with a real `OPENROUTER_API_KEY` in `.env`):

```bash
AI_PROVIDER=mock pnpm dev
```

What to expect:

1. The sheet "Stock List" needs review: the header is found on row 4, column B is recognized as NSNs from its values alone (6 of 6 are valid), and column A "Ref" as part numbers from its values alone (6 of 6 look like part numbers), but neither header names its field, so confidence is only medium.
2. AI assistance is on by default when the server has a key (with `AI_PROVIDER=mock` it works offline), so the summary says AI is reading Stock List. Only a sample of that sheet is sent. With AI switched off, nothing imports yet ("Import 0 records"), no workbook data is sent, and the AI section offers to help with Stock List.
3. The proposal is verified against the workbook ("Accepted 1 table"), and the sheet gets an AI badge.
4. The mock's confidence is below the auto-apply bar, so the AI table still waits for you. Include it, and 6 records import, each with its NSN and the NIIN derived from it.

With a real model, the proposal may also map the "Ref" or "Item" column; it is still verified the same way.

## (b) `b-identifier-conflict.xlsx` - an NSN that contradicts its NIIN

Row 2 has NSN `5305-01-658-2565` (whose NIIN is `016582565`) but NIIN `016698021` in its own NIIN column.

What to expect:

1. One decision needs you: an identifier conflict on row 2, naming the NSN cell B2 and the NIIN cell D2. The suggestion is "Keep the NSN", so nothing from the file is lost: the NIIN is worked out from the NSN and the disagreeing NIIN cell stays listed on the row.
2. The other 3 rows import ("Import 3 records").
3. "Keep the NSN" imports row 2 with NSN `5305016582565` and a NIIN derived from it (`016582565`); the NIIN cell is listed as rejected, and the row imports with a warning about it.
4. "Keep the NIIN and FSC" imports row 2 with NIIN `016698021` and the NSN derived from FSC + NIIN (`5305016698021`); the NSN cell is listed as rejected.
5. "Exclude row" leaves row 2 out. "Accept all suggestions" keeps the NSN, so 4 records import.

## (c) `c-pencom-changed-copy.xlsx` - a conflict with a saved record

Two PENCOM records again: the machine screw with a new description, and SE5826 unchanged.

First import PENCOM: upload `example-excel-uploads/PENCOM_Government_Procurement_Database (2).xlsx`, click "Accept all suggestions", and import the 2 records.
Then upload this file.

What to expect:

1. SE5826 is skipped automatically as already imported (listed under the automatic decisions, with an undo).
2. The screw needs a decision: same part and NSN as a saved record, but the description differs ("Screw, machine, pan head, SEMS" here, "Screw, Machine" saved). The suggestion is "Keep the saved record", so nothing imports yet.
3. "Replace the saved record" imports 1 record that overwrites the saved screw in the mappings table; "Keep both records" adds it as a second mapping.

## (d) `d-messy-showcase.xlsx` - many messy cases in one sheet

What to expect:

1. **Title rows:** two merged title rows sit above the table; the header is found on row 4.
2. **Merged header:** "Nomenclature" spans E:F; column E is the description, and F is not mapped.
3. **Metadata columns:** "(Do Not Modify) Part" holds UUIDs and "(Do Not Modify) Modified On" holds timestamps. Neither is imported, even though the first one says "Part"; "Part Number" (column C) wins because its values look like part numbers.
4. **Repeated header:** row 8 is blank and row 9 repeats the header; both are skipped and listed.
5. **Multi-line part cell:** C6 holds `KIT-100` and `KIT-100A` on two lines and becomes 2 records with the same NSN and description.
6. **Malformed NSN:** row 11's NSN `12663107` is the part number pasted into the NSN column. It is rejected ("same value as part number in Active Parts!C11"), and the part still imports.
7. **Part punctuation kept:** `10931023*92`, `BH011-HT REV 000`, `457985-1 B`, and `2132981-2  C` import exactly as written.

The summary: 11 source rows become 12 records (11 valid, 1 warning, 2 from the split cell), and all 12 import with no decision needed.
