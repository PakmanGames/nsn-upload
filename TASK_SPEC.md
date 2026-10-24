# Technical Exercise: Robust Multi-Sheet NSN Importer

## Context

The current application allows a user to upload an Excel workbook containing part
numbers, National Stock Numbers (NSNs), National Item Identification Numbers (NIINs),
descriptions, and CAGE codes.

The starter implementation handles a conventional first worksheet with a single header
row. Real customer workbooks are less predictable. They may contain several sheets,
title rows, repeated headers, administrative columns, formatted empty rows, multiple
identifiers in one cell, and sheets that mention NSNs without containing importable NSN
records.

Your task is to make the smart-upload flow reliable for these real-world workbooks
without requiring the user to manually restructure them before upload.

## Running the project

```bash
pnpm install
pnpm run dev
```

The project is intentionally standalone. It has no database, authentication, or firm
context. Imported records should continue to be stored locally in the browser.

Example workbooks are available in `example-excel-uploads/`.

## Goal

Given an `.xlsx` workbook, the application should:

1. Discover importable tables across all relevant worksheets.
2. Infer how source columns map to the target data model.
3. Normalize identifiers without corrupting meaningful part-number data.
4. Explain uncertain decisions and allow the user to correct them.
5. Preview valid, invalid, duplicate, and ambiguous rows before importing.
6. Preserve enough provenance to explain where every imported value came from.

The implementation must generalize beyond the supplied example filenames and sheet
names. Hardcoded rules for a specific fixture are not acceptable.

## Target data model

Each imported record may contain:

```ts
type MappingInput = {
  part?: string;
  description?: string;
  nsn?: string;
  niin?: string;
  cage?: string;
};
```

A record requires at least one valid primary identifier:

- `part`
- `nsn`
- `niin`

Description and CAGE are optional but useful. Missing optional values should normally
produce warnings, not block an otherwise valid record.

## Core requirements

### 1. Workbook and worksheet discovery

- Inspect every worksheet in the workbook, not only the first one.
- Ignore hidden and very-hidden worksheets by default.
- Do not treat styled but empty rows as data.
- Distinguish likely data tables from dashboards, instructions, notes, search logs, and
  other sheets that merely mention terms such as “NSN” or “part number.”
- Support more than one importable worksheet.
- Show every worksheet in the UI with a classification such as:
  - ready
  - needs review
  - no importable table found
  - ignored because hidden
- Let the user choose which discovered tables or sheets to import.
- Do not silently import a low-confidence sheet.

A worksheet may contain:

- a title or explanatory text above its table;
- blank rows before or inside the table;
- a repeated header later in the sheet;
- multiple separate table regions;
- merged title or header cells;
- formulas and rich-text cells.

At minimum, repeated instances of the same table header must be recognized and skipped
rather than imported as records. Supporting multiple genuinely different tables within
one worksheet is strongly preferred.

### 2. Header detection and column mapping

Do not assume that the header is row 1 or that one exact spelling will be used.

The importer should recognize common variants, including:

| Target field | Representative source headers |
| --- | --- |
| Part | `Part`, `Part Number`, `Part No.`, `P/N`, `G & B P/N`, `PENCOM Part Number` |
| Description | `Description`, `Nomenclature`, `Item Name`, `Government Item Name` |
| NSN | `NSN`, `National Stock Number` |
| NIIN | `NIIN`, `National Item Identification Number` |
| CAGE | `CAGE`, `CAGE Code`, `Manufacturer CAGE` |

Header matching should tolerate differences in:

- case;
- punctuation;
- whitespace;
- abbreviations;
- vendor prefixes;
- line breaks;
- a header distributed across two adjacent rows.

Header text alone is insufficient. Use representative values below a candidate header
to determine whether a column actually contains plausible values for the proposed
field.

For example, a column called `(Do Not Modify) Part` containing UUIDs must not win over a
nearby `Part Number` column containing actual part numbers.

The UI must:

- display the inferred header row or table range;
- display the inferred column mapping;
- show a confidence or review state;
- allow the user to change a mapping or exclude a column;
- prevent the same source column from being silently mapped to conflicting target
  fields.

### 3. Value normalization

Retain both the original source value and its normalized value during analysis.

Apply field-specific normalization:

| Field | Required behavior |
| --- | --- |
| NSN | Trim whitespace, remove spaces and hyphens, and validate exactly 13 digits. The NSN can be a deduced value - the first 4 digits of the NSN are called the FSC, the latter 9 digits being the NIIN. If you don't have an NSN, but have both the FSC and NIIN the NSN should be deduced from both values. |
|  |  |
| NIIN | Trim whitespace, remove spaces and hyphens, and validate exactly 9 digits. |
| Part | Trim surrounding whitespace but preserve meaningful punctuation such as hyphens, slashes, spaces, asterisks, and revision suffixes. |
| CAGE | Trim, uppercase, and validate 5 alphanumeric characters. |
| Description | Trim accidental surrounding whitespace while preserving meaningful internal punctuation and text. |

Additional rules:

- A cell containing only `-` should be interpreted as empty.
- Never apply NSN hyphen stripping to a part number.
- Do not coerce identifiers through JavaScript numbers. Leading zeroes must survive.
- Read formula results and rich-text cell content when available.
- Normalize Windows and Unix line endings consistently.
- A malformed optional field must be reported at the field level. If the row still has
  another valid primary identifier, the UI should let the user import the valid portion
  or exclude the row; it should not silently import the malformed value.
- A valid NSN may be used to derive its 9-digit NIIN. Any derived value must be labeled
  as derived rather than source-provided.

#### Multi-value cells

Line breaks have field-dependent meaning.

- In a description, a line break is normally part of one description.
- In a singular identifier column, a line break may represent multiple identifiers.

For a part-number cell such as:

```text
12669555
RVX08212
```

the importer should recognize two likely part numbers and propose expanding the source
row into two records. This decision must be visible in the preview. The original cell,
source row, and expansion relationship must remain traceable.

Do not split part numbers on ordinary spaces or punctuation. Values such as
`457985-1 B`, `10931023*92`, and `6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P` are individual part
numbers.

### 4. Validation, deduplication, and conflicts

Validation should produce structured row and field issues rather than one generic file
error.

At minimum, distinguish:

- invalid identifier;
- missing primary identifier;
- duplicate within one table;
- duplicate across selected worksheets;
- duplicate against records already in local storage;
- conflicting values;
- ambiguous multi-value cell;
- low-confidence mapping.

Duplicate detection must use normalized values. Do not treat every repeated part number
as a duplicate: one part may legitimately map to multiple different NSNs.

When records from separate sheets appear to describe the same mapping:

- identify the likely duplicate or conflict;
- prefer neither source silently;
- show the source sheets and cells involved;
- let the user choose, merge compatible fields, or exclude one record.

### 5. Provenance

Every analyzed value should be traceable to:

- workbook filename;
- worksheet name;
- source row;
- source cell or column;
- original cell value;
- normalized or derived value;
- transformation applied.

This provenance may remain in analysis state and does not need to be displayed in every
table cell, but the user must be able to inspect it for warnings and conflicts.

### 6. Preview and import experience

Before import, show:

- workbook and worksheet summary;
- discovered tables and ignored sheets;
- inferred column mappings;
- total candidate records;
- valid records;
- warnings;
- invalid records;
- duplicates and conflicts;
- rows created by splitting a multi-value cell.

The user should be able to:

- include or exclude a discovered table;
- correct its column mapping;
- inspect why a row is invalid or ambiguous;
- search or filter the preview by status;
- import only the approved valid records;
- return to the mappings table and see the imported local records.

Changing a column mapping should recompute the preview without rereading the workbook.

## AI-assisted fallback

The default path should be deterministic. Conventional tabular workbooks should not
require an AI request.

Design an explicit interpretation boundary that could use an LLM when deterministic
analysis cannot confidently determine:

- where a table begins and ends;
- whether several header rows form one logical header;
- which of several candidate columns represents the target field;
- whether an unstructured sheet contains records at all;
- how a complex multi-value region should be segmented.

The AI boundary should accept a bounded, serializable representation of the workbook,
such as sheet metadata and sampled cell ranges. It should return structured data, for
example:

```ts
type WorkbookInterpretation = {
  tables: Array<{
    sheetName: string;
    range: string;
    headerRows: number[];
    columns: Partial<Record<keyof MappingInput, number>>;
    confidence: number;
    reasons: string[];
  }>;
};
```

Requirements for an AI-assisted design:

- AI output is a proposal, not trusted data.
- Every proposed range, row, column, and value must be verified against the workbook.
- The model may classify or map existing values but must never invent identifiers.
- Low-confidence proposals require user confirmation.
- Network transmission must be disabled unless AI parsing is explicitly enabled.
- Do not send hidden sheets, checksum columns, or unrelated workbook content by default.
- Parsing must still work without an API key.
- The AI provider should sit behind a small interface so it can be mocked in tests or
  replaced later.

Implementing a live AI provider is a stretch goal. A strong submission should at least
include the interface, trigger conditions, response validation, and a short design note.

## Supplied workbook acceptance cases

These examples are not exhaustive. They are regression fixtures for the required
general behavior.

### PENCOM procurement database

`PENCOM_Government_Procurement_Database (2).xlsx`

The importer should:

- inspect all six visible worksheets;
- identify `NSN Cross-Reference` and `Part Number Intake` as plausible import tables;
- avoid treating `Dashboard`, `Opportunity Matrix`, `Search Log`, or `Sources & Notes`
  as NSN mapping tables merely because they mention NSNs or part numbers;
- find headers on row 2 where applicable;
- ignore hundreds of formatted but empty rows;
- detect potential overlap between records represented on multiple sheets.

### Geier and Bluhm listing

`Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx`

The importer should:

- recognize `G & B P/N` as the part-number column;
- recognize the repeated header at row 34 and skip it;
- import the two data blocks as one logical table;
- find 54 data records;
- normalize all 54 hyphenated NSNs to 13 digits;
- retain cases where one part maps to several distinct NSNs.

### WOW active parts

`WOW NSN list 7-20-26 (2).xlsx`

The importer should:

- ignore the very-hidden metadata worksheet;
- ignore the UUID, checksum, and modified-date columns;
- select `Part Number`, `NSN`, and `Nomenclature` rather than the protected metadata
  fields;
- find 179 candidate data rows;
- normalize 127 valid hyphenated NSNs;
- report the non-NSN values `12663107` and `280-035-330-101F` as malformed NSN fields;
- keep rows that have a valid part number but no NSN;
- handle the two part numbers separated by a newline in cell `D136`;
- preserve punctuation and revision information in part numbers.

## Performance and safety

- Keep the interface responsive while analyzing a large workbook.
- Avoid quadratic scans over rows or cells.
- ExcelJS or another heavy parser should remain lazy-loaded rather than increasing the
  initial page bundle.
- Provide visible progress for workbooks large enough to cause a noticeable delay.
- Define reasonable file-size, worksheet, row, and cell limits and show a useful error
  when they are exceeded.
- Do not make network requests during ordinary parsing or import.
- An uploaded workbook must not execute formulas, macros, or embedded content.

A worker-based parser is encouraged but not mandatory if responsiveness can be
demonstrated another way.

## Testing expectations

Add focused automated tests for:

- header aliases and punctuation;
- headers below title rows;
- repeated headers;
- multiple sheets;
- ignoring hidden and non-tabular sheets;
- metadata-column disambiguation;
- hyphenated NSN and NIIN normalization;
- preservation of part-number punctuation;
- multiline descriptions versus multiline identifiers;
- malformed optional identifiers;
- duplicates and conflicts across sheets;
- provenance and source-cell references;
- AI proposal validation if the AI boundary is implemented.

At least one integration test should parse a real `.xlsx` workbook. The supplied
workbooks should be usable as end-to-end regression fixtures.

## Deliverables

1. The working implementation.
2. Focused automated tests.
3. A brief design note covering:
   - table and header detection;
   - confidence scoring;
   - normalization and deduplication;
   - performance decisions;
   - the AI fallback boundary;
   - important tradeoffs or unsupported cases.
4. Updated run instructions if any commands or environment variables change.

## Out of scope

- Supabase or another persistent backend;
- authentication and authorization;
- enrichment of uploaded identifiers from external databases;
- `.xls`, `.xlsm`, CSV, PDF, or email attachments;
- a production AI provider or API key;
- pixel-perfect reproduction of the source workbooks.

These may be discussed as future extensions but are not required.

## Suggested timebox

The core exercise is intended for approximately 8–12 hours. If timeboxed:

1. prioritize multi-sheet discovery, header mapping, normalization, preview, and the
   supplied regression cases;
2. document incomplete edge cases clearly;
3. treat live AI integration, worker execution, multi-table sheets, and advanced
   conflict merging as stretch work.

## Evaluation criteria

| Area | Weight |
| --- | ---: |
| Correctness on supplied and unseen workbooks | 30% |
| Parsing and normalization design | 20% |
| User experience for ambiguity and errors | 15% |
| Code structure and type safety | 15% |
| Tests and observability | 10% |
| Performance and AI-extension design | 10% |

We value clear decisions, explicit uncertainty, and debuggable behavior more than a
large collection of brittle header aliases.
