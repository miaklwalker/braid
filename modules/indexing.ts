import type { BraidKey } from "./types.ts";

/**
 * A key of `null` or `undefined` means "this row has nothing to join on".
 *
 * Indexing nullish keys like any other value is the more literal behaviour, but
 * it quietly braids every keyless row on one side onto every keyless row on the
 * other — the kind of join that looks fine in a small fixture and produces
 * nonsense in production. Braid skips them instead: a nullish key never
 * matches, so the row takes its default (or trips `required`).
 */
export function isJoinableKey(key: BraidKey): boolean {
	return key !== null && key !== undefined;
}

/**
 * Indexes a detail collection for a `single` join, in one pass.
 *
 * When several rows share a key the last one wins. That's a real ambiguity in
 * the data rather than something Braid can resolve, so v1 picks the simple,
 * documented rule instead of throwing — use `type: "many"` if the duplicates
 * are meaningful.
 */
export function indexBy<TDetail>(
	source: readonly TDetail[],
	on: (item: TDetail) => BraidKey,
): Map<BraidKey, TDetail> {
	const index = new Map<BraidKey, TDetail>();
	for (const item of source) {
		const key = on(item);
		if (!isJoinableKey(key)) continue;
		index.set(key, item);
	}
	return index;
}

/**
 * Indexes a detail collection for a `many` join, in one pass, preserving the
 * source order within each group.
 */
export function groupBy<TDetail>(
	source: readonly TDetail[],
	on: (item: TDetail) => BraidKey,
): Map<BraidKey, TDetail[]> {
	const index = new Map<BraidKey, TDetail[]>();
	for (const item of source) {
		const key = on(item);
		if (!isJoinableKey(key)) continue;
		const group = index.get(key);
		if (group === undefined) {
			index.set(key, [item]);
		} else {
			group.push(item);
		}
	}
	return index;
}
