/**
 * Plain-language explanations of decisions and issues, written for the person importing rather than for
 * the importer. Pure and deterministic: no AI, no network, so they are always shown and can be tested.
 *
 * Every fact is computed from the records, decisions, and tables, never parsed from the pipeline's own
 * `reason` and `message` strings, which stay unchanged as the technical details behind each explanation.
 * An optional AI pass (`ai/explain*.ts`) may reword an explanation from its facts; it is checked against them.
 */
import type { CandidateRecord, Decision, Issue, StoredMapping, WorkbookAnalysis } from '../model';
import { Context, Draft } from './context';
import { DECISION_TEMPLATES } from './decisions';
import { ISSUE_TEMPLATES } from './issues';
import type { Explanation } from './types';

export type { Explanation, Fact } from './types';
export { recordLabel } from './context';
export { copyProblems, formatNsn, wordingOnly } from './text';
export { explainColumn, explainSheetWithoutTable, tableNotes } from './structure';

/** `saved`: the records already in the browser, which storage conflicts are explained against. */
export function explainDecision(
	decision: Decision,
	analysis: WorkbookAnalysis,
	saved: readonly StoredMapping[] = []
): Explanation {
	const ctx = new Context(analysis, saved);
	const d = new Draft();
	const { headline, body } = DECISION_TEMPLATES[decision.kind](d, decision, ctx.records(decision.recordIds), ctx);
	return d.done(headline, body);
}

export function explainIssue(
	issue: Issue,
	record: CandidateRecord,
	analysis: WorkbookAnalysis,
	saved: readonly StoredMapping[] = []
): Explanation {
	const ctx = new Context(analysis, saved);
	const d = new Draft();
	const { headline, body } = ISSUE_TEMPLATES[issue.code](d, issue, record, ctx);
	return d.done(headline, body);
}
