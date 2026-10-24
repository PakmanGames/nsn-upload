/**
 * What templates read from an analysis, and the draft they write into.
 *
 * Lookups go through one index per analysis (kept in a WeakMap), so explaining every decision and every
 * visible issue stays linear in the size of the analysis however often the review window re-renders.
 */
import {
	FIELDS,
	type CandidateRecord,
	type Decision,
	type Field,
	type StoredMapping,
	type TableCandidate,
	type WorkbookAnalysis
} from '../model';
import { stripSeparators } from '../identifiers';
import type { Explanation, Fact } from './types';
import { formatNsn, noun, ordinal, show } from './text';

type Index = {
	records: Map<string, CandidateRecord>;
	/** Records built from one source row, by `${tableId}:r${row}`, in split order. */
	rows: Map<string, CandidateRecord[]>;
	tables: Map<string, TableCandidate>;
	/** Decisions that name a record, by record id. */
	decisions: Map<string, Decision[]>;
};

const indexes = new WeakMap<WorkbookAnalysis, Index>();

function push<T>(map: Map<string, T[]>, key: string, value: T) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

function indexOf(analysis: WorkbookAnalysis): Index {
	let index = indexes.get(analysis);
	if (index) return index;
	index = { records: new Map(), rows: new Map(), tables: new Map(), decisions: new Map() };
	for (const record of analysis.records) {
		index.records.set(record.id, record);
		push(index.rows, rowKey(record), record);
	}
	for (const sheet of analysis.sheets) for (const table of sheet.tables) index.tables.set(table.id, table);
	for (const decision of analysis.decisions) for (const id of decision.recordIds) push(index.decisions, id, decision);
	indexes.set(analysis, index);
	return index;
}

const rowKey = (record: CandidateRecord) => `${record.tableId}:r${record.sourceRow}`;

/** Everything a template may read: the analysis through its index, and the records saved in the browser. */
export class Context {
	readonly #index: Index;
	readonly #saved: Map<string, StoredMapping>;

	constructor(analysis: WorkbookAnalysis, saved: readonly StoredMapping[]) {
		this.#index = indexOf(analysis);
		this.#saved = new Map(saved.map((mapping) => [mapping.id, mapping]));
	}

	records(ids: readonly string[]): CandidateRecord[] {
		return ids.flatMap((id) => this.#index.records.get(id) ?? []);
	}

	/** Every record built from the same source row as `record`, itself included. */
	row(record: CandidateRecord): CandidateRecord[] {
		return this.#index.rows.get(rowKey(record)) ?? [record];
	}

	table(id: string | undefined): TableCandidate | undefined {
		return id === undefined ? undefined : this.#index.tables.get(id);
	}

	decisionsOf(record: CandidateRecord): Decision[] {
		return this.#index.decisions.get(record.id) ?? [];
	}

	saved(ids: readonly string[] = []): StoredMapping[] {
		return ids.flatMap((id) => this.#saved.get(id) ?? []);
	}
}

/** The field whose multi-line cell a split record came from. */
export function splitField(record: CandidateRecord): Field | undefined {
	const { split } = record;
	if (!split) return undefined;
	return FIELDS.find((field) => {
		const provenance = record.fields[field]?.provenance;
		return provenance?.cell === split.cell && provenance.transforms.includes('split-multi-value');
	});
}

/**
 * "row 10", or "row 10, first of 2 NSNs in B10" for a record split from a multi-value cell.
 * `sheet` prefixes the sheet name, for places where nothing around the label names it.
 */
export function recordLabel(record: CandidateRecord, options: { sheet?: boolean } = {}): string {
	const where = options.sheet ? `${record.sheet} row ${record.sourceRow}` : `row ${record.sourceRow}`;
	if (!record.split) return where;
	const field = splitField(record);
	const { index, total, cell } = record.split;
	return `${where}, ${ordinal(index)} of ${total} ${field ? noun(field, total) : 'values'} in ${cell}`;
}

/**
 * The row's own value for a field, as the cell holds it: a value read from the cell, or the original text
 * when the value was rejected or set aside by a decision. Derived values are not the row's own.
 */
export function ownValue(record: CandidateRecord, field: Field): { value: string; cell: string } | null {
	const value = record.fields[field];
	if (value?.provenance.origin === 'source') return { value: value.value, cell: value.provenance.cell };
	const rejected = record.rejected[field];
	return rejected ? { value: rejected.original, cell: rejected.cell } : null;
}

/** Digits of an NSN, NIIN, or FSC value as written, for comparing them. */
export const digitsOf = (value: string) => stripSeparators(value);

/** Collects the facts a template cites while it writes its text. */
export class Draft {
	readonly facts: Fact[] = [];

	/** Records a fact and returns its value, so a template cites and writes in one step. */
	fact(label: string, value: string, cell?: string): string {
		const known = this.facts.some((fact) => fact.label === label && fact.value === value && fact.cell === cell);
		if (!known) this.facts.push(cell === undefined ? { label, value } : { label, value, cell });
		return value;
	}

	/** A field value as written in the text ("1680-01-581-8020", `"Screw, Machine"`), cited with its cell. */
	value(label: string, field: Field | null, value: string, cell?: string): string {
		const shown = show(field, value);
		this.fact(label, shown.replace(/^"(.*)"$/s, '$1'), cell);
		return shown;
	}

	/** A record's label, cited as a fact so a row number in the text is always one the facts hold. */
	record(record: CandidateRecord, options: { sheet?: boolean } = {}): string {
		const label = recordLabel(record, options);
		return this.fact('Row', label, record.split?.cell);
	}

	/** "part number 10931023*92 with NSN 5305-01-658-2565", or whichever of the two the record has. */
	identity(record: CandidateRecord): string {
		const { part, nsn, niin } = record.fields;
		const stock = nsn
			? `NSN ${this.fact('NSN', formatNsn(nsn.value))}`
			: niin
				? `NIIN ${this.fact('NIIN', niin.value)}`
				: undefined;
		const partText = part && `part number ${this.value('Part number', 'part', part.value)}`;
		if (partText && stock) return `${partText} with ${stock}`;
		return partText ?? stock ?? 'the same item';
	}

	/**
	 * "this part number and NSN", for cards whose heading already shows the values. The values are still cited,
	 * so reworded text may name them.
	 */
	sameIdentity(record: CandidateRecord): string {
		this.identity(record);
		const { part, nsn, niin } = record.fields;
		const stock = nsn ? 'NSN' : niin ? 'NIIN' : undefined;
		return `this ${[part && 'part number', stock].filter(Boolean).join(' and ') || 'item'}`;
	}

	done(headline: string, body: string): Explanation {
		return { headline, body, facts: this.facts, source: 'rules' };
	}
}
