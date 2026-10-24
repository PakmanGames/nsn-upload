# T2 - Field normalizers

Owns: `src/lib/import/normalize/`, `src/lib/import/identifiers.ts`.
Implements: `normalizeField(field, cell, sheet): NormalizeResult`.
Read first: `docs/PLAN.md` (rules, messy cases), `docs/ARCHITECTURE.md` (Normalization), `src/lib/import/model.ts`.
No dependency on other tasks: build cells with `makeSheet()` from `src/lib/import/testing.ts` or by hand.

## Requirements (P0)

General, all fields:

- Record every transform in order in `NormalizedValue.transforms`.
- CRLF and CR -> LF (`normalize-line-endings`), then trim (`trim`). A value that is only `-` is empty (`dash-as-empty`).
- `kind: 'empty'` -> `{ kind: 'empty' }`.
- `kind: 'error'` -> `invalid` with message `Excel error value #N/A in <cell>`.
- Issues use `qualifiedRef(sheet, cell.ref)` in `cells` and set `field`.
- Never call `Number()` or `parseInt()` on identifier text.

Per field:

| Field | Rule |
| --- | --- |
| part | Trim only; keep hyphens, slashes, spaces, asterisks, revision suffixes. `kind: 'number'` -> `numeric-to-text` plus `suspicious-value` warning (leading zeros may have been lost). `kind: 'date'` -> `invalid` (Excel turned the part number into a date; original unrecoverable). Parenthetical text such as `12273108 (EATON M144E)` -> kept verbatim plus `suspicious-value` warning. |
| nsn | Strip a leading `NSN` label (`strip-label`), then `stripSeparators` (`strip-separators`). Valid when exactly 13 digits. Invalid messages name what it looks like: 9 digits -> "looks like a NIIN"; letters present -> "contains letters, looks like a part number". |
| niin | Same stripping, exactly 9 digits. A `number` cell with 1-8 digits -> left-pad to 9 (`restore-leading-zeros`) plus a `suspicious-value` warning. 13 digits -> invalid, "looks like an NSN". |
| fsc | Exactly 4 digits after stripping. |
| cage | Trim, uppercase (`uppercase`), exactly 5 alphanumerics. A `number` cell with 1-4 digits -> left-pad to 5 plus a warning. |
| description | Trim; internal line breaks kept as LF; never split. |

Multi-value cells (part, nsn, niin only):

- Split only on newlines. Never on spaces, commas, slashes, or other punctuation.
- Drop empty segments and trim each. Two or more segments -> `values` has one entry per segment, each with `split-multi-value`.
- part: split only when every segment `isPlausiblePart`; otherwise keep as one value with a `suspicious-value` warning.
- nsn / niin: every segment must be valid, otherwise the whole cell is `invalid` with the segments listed in the message.

`identifiers.ts`: you may refine `isPlausiblePart` (T3 also uses it for column scoring); add tests for any change and keep the signature.
Also rewrite the `SEPARATORS` character class with `\u` escapes: T0 copied literal invisible characters from an earlier version of the brief. Behavior must not change; add one test per separator.

## Tests (required, table-driven)

Cover every row above and these exact values:

- Parts kept intact: `457985-1 B`, `10931023*92`, `6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P`, `BH011-HT REV 000`, `2132981-2  C`, `PPIM 21023`, `13211E9213`, `201018858`.
- `12669555\nRVX08212` (part) -> two values; `12669555\r\nRVX08212` gives the same result.
- A multi-line description stays one value.
- NSN `5305-01-658-2565`, `5305 01 658 2565`, `"5305\u201301\u2013658\u20132565"` (en dashes; write separators as `\u` escapes in tests, never as literal characters), NBSP separators -> `5305016582565`.
- NSN `12663107` and `280-035-330-101F` -> invalid with helpful messages.
- NIIN `016582565` text stays; NIIN numeric `16582565` -> `016582565` with `restore-leading-zeros`.
- CAGE `0bwz1` -> `0BWZ1`; `PENCOM` and `Y` invalid.
- `-` -> empty for every field.

## Done when

Tests pass, `pnpm check` passes, merged.
Expected to land first (around 1:30), because T3, T4, and T6 call `normalizeField` at integration.
