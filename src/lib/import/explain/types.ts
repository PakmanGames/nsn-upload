/** A value an explanation rests on. `cell` is a bare A1 ref ("B10"); the heading around it names the sheet. */
export type Fact = { label: string; value: string; cell?: string };

/**
 * A decision or issue in the user's words. The text may mention only what is in `facts`, which is also
 * everything the AI is shown when it rewords an explanation.
 */
export type Explanation = {
	/** What is wrong, in about 60 characters, without the sheet name. */
	headline: string;
	/** One or two sentences: the problem and, when not obvious, why it matters. Never what to do about it. */
	body: string;
	facts: Fact[];
	source: 'rules' | 'ai';
};
