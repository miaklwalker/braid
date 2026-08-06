/**
 * Every rule this package enforces in the type system is also enforced at
 * runtime, and every runtime failure throws this class. Consumers can catch it
 * to separate "I configured Braid wrong" from "my data was wrong" — the
 * message always names the join and, where one exists, the offending key.
 */
export class BraidError extends Error {
	override name = "BraidError";
}

/**
 * Values Braid will index on. Restricted to primitives on purpose: joining on
 * object references works, but silently matches nothing the moment two
 * structurally identical objects come from different fetches, which is exactly
 * the bug this library exists to avoid. Derive a primitive key instead.
 */
export type BraidKey =
	| string
	| number
	| bigint
	| boolean
	| symbol
	| null
	| undefined;

/** Whether a join expects at most one detail row, or an array of them. */
export type JoinType = "single" | "many";

/**
 * Anything Braid will treat as a collection: an array in hand, something that
 * will resolve to one (a promise, or another `Braid` — every braid is
 * thenable), or a function returning either.
 *
 * Only a plain array keeps the braid synchronous. Everything else has to be
 * awaited, which is what makes `.run()` return a promise.
 */
export type BraidSource<TRow> =
	| readonly TRow[]
	| PromiseLike<readonly TRow[]>
	| (() => readonly TRow[] | PromiseLike<readonly TRow[]>);

/** A detail collection for one join. */
export type JoinSource<TDetail> = BraidSource<TDetail>;

/** The element type behind a {@link BraidSource}, however deeply it's wrapped. */
export type DetailOf<TSource> = TSource extends readonly (infer TDetail)[]
	? TDetail
	: TSource extends () => infer TReturn
		? Awaited<TReturn> extends readonly (infer TDetail)[]
			? TDetail
			: never
		: Awaited<TSource> extends readonly (infer TDetail)[]
			? TDetail
			: never;

/**
 * `false` only for a plain array. A fetcher, a promise, or a nested braid
 * anywhere in the chain turns the whole result into a promise, which is the
 * only honest answer once one source has to be awaited.
 */
export type IsAsyncSource<TSource> = TSource extends readonly unknown[]
	? false
	: true;

/** Flattens an intersection into a single, readable object type. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Rejects a reused join name — two joins sharing a name would silently
 * overwrite each other's property on the output row.
 *
 * The check demands a phantom property that no real config has, so a duplicate
 * surfaces as a single error on the config object whose text spells out the
 * problem. Putting the check on `name` itself reads better but poisons
 * inference for every other field, burying the reason under a pile of
 * "not assignable to never".
 */
export type RejectDuplicateJoinName<
	TName extends string,
	TUsed extends string,
> = TName extends TUsed
	? {
			readonly __braid_duplicate_join_name: `a join named "${TName}" is already defined`;
		}
	: unknown;

/**
 * The type attached to each output row for one join. `required: true` removes
 * the default from the union, because a required join either matched or threw.
 */
export type JoinValue<
	TDetail,
	TType extends JoinType,
	TRequired extends boolean,
	TDefault,
> = TType extends "many"
	? [TRequired] extends [true]
		? TDetail[]
		: TDetail[] | TDefault
	: [TRequired] extends [true]
		? TDetail
		: TDetail | TDefault;

/**
 * How the main row lands on the output: spread across the top level by
 * default, or nested under its own property when `.main()` is given an `as`.
 *
 * Nesting is what makes braids composable — braid two collections separately,
 * give each an `as`, and a third braid can join their results without the two
 * sets of fields colliding at the top level.
 */
export type MainContribution<TMain, TAs> = [TAs] extends [string]
	? { [K in TAs & string]: TMain }
	: TMain;

/** One stitched output row: the main row (spread or nested) plus every join's property. */
export type BraidRow<TMain, TJoined, TAs = undefined> = Prettify<
	MainContribution<TMain, TAs> & TJoined
>;

/** `.run()`'s return type — an array, or a promise of one if any source has to be awaited. */
export type BraidResult<
	TMain,
	TJoined,
	TAsync extends boolean,
	TAs = undefined,
> = [TAsync] extends [true]
	? Promise<BraidRow<TMain, TJoined, TAs>[]>
	: BraidRow<TMain, TJoined, TAs>[];

/**
 * Rejects a join whose name is already taken by the main collection's `as`.
 * Same phantom-property trick as {@link RejectDuplicateJoinName}, and the same
 * reason: the join would overwrite the nested main row.
 */
export type RejectMainAliasCollision<
	TName extends string,
	TAs,
> = TName extends TAs
	? {
			readonly __braid_main_alias_collision: `the main collection is already attached as "${TName}"`;
		}
	: unknown;

/** Configuration for {@link Braid.main}. */
export interface MainConfig<
	TSource,
	TRowKey extends BraidKey,
	TAs extends string | undefined,
> {
	/** Informational label used in error messages. It does not affect the output shape. */
	readonly name?: string;
	/** The driving collection: one output row is produced per item, in order. */
	readonly source: TSource;
	/** Default key extractor, used by every join that doesn't override it. */
	readonly key: (item: DetailOf<TSource>) => TRowKey;
	/**
	 * Nests the main row under this property instead of spreading it across the
	 * top level of the output row. Key extractors still receive the raw main
	 * row — the alias only affects the shape of the result.
	 */
	readonly as?: TAs;
}

/**
 * Configuration for {@link Braid.join}.
 *
 * `TJoinKey` is inferred from `key` alone — `on` is wrapped in `NoInfer` so a
 * mismatched key type is reported against the detail extractor instead of
 * quietly widening both sides to a union.
 */
export interface JoinConfig<
	TMain,
	TSource,
	TName extends string,
	TType extends JoinType,
	TRequired extends boolean,
	TDefault,
	TJoinKey extends BraidKey,
	TRowSoFar,
> {
	/** Property name this join's result is attached under on each output row. */
	readonly name: TName;
	/** Detail array, or a function returning one (see {@link JoinSource}). */
	readonly source: TSource;
	/** Key extractor for the detail rows. Must produce the same key type as the main side. */
	readonly on: (item: DetailOf<TSource>) => NoInfer<TJoinKey>;
	/** Overrides which key on the main row this join matches against. */
	readonly key?: (item: TMain) => TJoinKey;
	/**
	 * Keys off the row as stitched *so far* rather than the main row, which is
	 * how you follow a chain: join the product, then reach through it for the
	 * model, then through the model for the brand — all flat on one row.
	 *
	 * The parameter is typed as the accumulated row at this point in the chain,
	 * so reaching for a join that hasn't been declared yet is a compile error,
	 * and reaching through an optional one is correctly nullable. A nullish key
	 * means no match, so a miss upstream propagates as a miss here rather than
	 * throwing.
	 *
	 * Mutually exclusive with `key`.
	 */
	readonly from?: (row: TRowSoFar) => TJoinKey;
	/** Explicit, never inferred: see the README on why `single` vs `many` isn't guessed. */
	readonly type: TType;
	/** Value used when no detail row matches. Defaults to `null` for `single`, a fresh `[]` for `many`. */
	readonly default?: TDefault;
	/** When `true`, a main row with no match throws instead of taking the default. */
	readonly required?: TRequired;
}

/**
 * A join with its generics erased, as stored on the builder. The extractors
 * were written against many different row types, so the list that holds them
 * can't be typed against any one of them.
 */
export interface JoinSpec {
	readonly name: string;
	// biome-ignore lint/suspicious/noExplicitAny: the erased list holds extractors written against each join's own detail type
	readonly source: BraidSource<any>;
	// biome-ignore lint/suspicious/noExplicitAny: as above — checked at the typed facade, erased here
	readonly on: (item: any) => BraidKey;
	// biome-ignore lint/suspicious/noExplicitAny: as above — checked at the typed facade, erased here
	readonly key?: (item: any) => BraidKey;
	// biome-ignore lint/suspicious/noExplicitAny: as above — the row-so-far type differs at every position in the chain
	readonly from?: (row: any) => BraidKey;
	readonly type: JoinType;
	readonly hasDefault: boolean;
	readonly default: unknown;
	readonly required: boolean;
}
