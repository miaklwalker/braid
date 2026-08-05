import { groupBy, indexBy, isJoinableKey } from "./indexing.ts";
import {
	type BraidKey,
	type BraidResult,
	type BraidRow,
	type BraidSource,
	BraidError,
	type DetailOf,
	type IsAsyncSource,
	type JoinConfig,
	type JoinSpec,
	type JoinType,
	type JoinValue,
	type MainConfig,
	type RejectDuplicateJoinName,
	type RejectMainAliasCollision,
} from "./types.ts";

/** The main collection with its generics erased, as stored on the builder. */
interface MainSpec {
	readonly name?: string;
	// biome-ignore lint/suspicious/noExplicitAny: erased internal storage — the typed facade on .main() is what consumers see
	readonly source: BraidSource<any>;
	// biome-ignore lint/suspicious/noExplicitAny: as above
	readonly key: (item: any) => BraidKey;
	readonly as?: string;
}

/** Renders a key for an error message without throwing on symbols. */
function describeKey(key: BraidKey): string {
	return typeof key === "string" ? JSON.stringify(key) : String(key);
}

/** Anything with a `then` — a promise, or another braid. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof (value as { then?: unknown } | null | undefined)?.then === "function"
	);
}

/** Whether a value could be a source at all: an array, a fetcher, or a thenable. */
function isSourceLike(value: unknown): boolean {
	return (
		Array.isArray(value) || typeof value === "function" || isThenable(value)
	);
}

/**
 * Stitches one main collection together with any number of detail collections.
 *
 * Each `.join()` indexes its source once into a `Map` and then does a single
 * lookup per main row, so a braid of one main collection and three details is
 * O(n + m₁ + m₂ + m₃) rather than the O(n × m) you get from `.find()` inside
 * `.map()`.
 *
 * The chain also accumulates types: `.main()` fixes the row and key types, and
 * every `.join()` widens the output row with its own property while recording
 * its name, so a duplicate name or a mismatched key type is a compile error
 * rather than a shape surprise downstream.
 *
 * ```ts
 * const stitched = new Braid()
 * 	.main({ source: products, key: (p) => p.sku })
 * 	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
 * 	.join({
 * 		name: "variations",
 * 		source: variations,
 * 		on: (v) => v.productId,
 * 		key: (p) => p.id,
 * 		type: "many",
 * 	})
 * 	.run();
 * // Array<Product & { bigcommerce: BcProduct | null; variations: Variation[] }>
 * ```
 *
 * Pass `as` to nest the main row instead of spreading it, which is what lets
 * braids compose: a braid is itself a valid source, so two braids can be
 * stitched together by a third without their fields colliding.
 *
 * ```ts
 * const listings = new Braid().main({ source: listRows, key: (l) => l.sku, as: "listing" });
 * const catalogue = new Braid().main({ source: products, key: (p) => p.sku, as: "product" });
 *
 * const combined = await new Braid()
 * 	.main({ source: listings, key: (row) => row.listing.sku, as: "listing" })
 * 	.join({ name: "catalogue", source: catalogue, on: (row) => row.product.sku, type: "single" })
 * 	.run();
 * ```
 */
export class Braid<
	TMain = never,
	TKey extends BraidKey = never,
	TJoined = Record<never, never>,
	TNames extends string = never,
	TAsync extends boolean = false,
	TAs extends string | undefined = undefined,
> {
	#main: MainSpec | undefined;
	readonly #joins: JoinSpec[] = [];

	/**
	 * Declares the driving collection. One output row is produced per item here,
	 * in source order, and `key` becomes the default extractor for every join
	 * that doesn't bring its own.
	 *
	 * By default the main row is spread across the top level of each output row.
	 * Give `as` a property name to nest it there instead — necessary when two
	 * collections share field names, and the basis for composing braids.
	 *
	 * Only one main collection may be set: a second call is both a compile error
	 * and a throw, because silently replacing it would invalidate every join
	 * already configured against the old row type.
	 */
	main<
		TSource extends BraidSource<object>,
		TRowKey extends BraidKey,
		TMainAs extends string | undefined = undefined,
	>(
		this: Braid<never, never, TJoined, TNames, TAsync, TAs>,
		config: MainConfig<TSource, TRowKey, TMainAs>,
	): Braid<
		DetailOf<TSource>,
		TRowKey,
		TJoined,
		TNames,
		TAsync extends true ? true : IsAsyncSource<TSource>,
		TMainAs
	> {
		if (this.#main !== undefined) {
			throw new BraidError(
				"A main collection is already defined. Call .main() once per Braid instance.",
			);
		}
		if (!isSourceLike(config?.source)) {
			throw new BraidError(
				".main() requires a `source` array, promise, braid, or a function returning one.",
			);
		}
		if (typeof config.key !== "function") {
			throw new BraidError(
				".main() requires a `key` function, e.g. { key: (row) => row.id }.",
			);
		}
		if (
			config.as !== undefined &&
			(typeof config.as !== "string" || config.as.length === 0)
		) {
			throw new BraidError(
				".main() was given an `as` that is not a non-empty string.",
			);
		}
		if (
			config.as !== undefined &&
			this.#joins.some((join) => join.name === config.as)
		) {
			throw new BraidError(
				`A join named "${config.as}" is already defined, so the main collection can't also be attached as "${config.as}".`,
			);
		}

		this.#main = {
			name: config.name,
			source: config.source,
			key: config.key,
			as: config.as,
		};
		return this as unknown as Braid<
			DetailOf<TSource>,
			TRowKey,
			TJoined,
			TNames,
			TAsync extends true ? true : IsAsyncSource<TSource>,
			TMainAs
		>;
	}

	/**
	 * Adds a detail collection, attached to each output row under `name`.
	 *
	 * Joins are independent and each is indexed exactly once, so adding a fourth
	 * join costs one more pass over one more collection — not another scan per
	 * main row. Configuration mistakes throw here rather than at `.run()`, so a
	 * typo surfaces at the call that made it.
	 */
	join<
		TName extends string,
		TSource extends BraidSource<unknown>,
		TType extends JoinType,
		TRequired extends boolean = false,
		TDefault = TType extends "many" ? DetailOf<TSource>[] : null,
		TJoinKey extends BraidKey = TKey,
	>(
		config: JoinConfig<
			TMain,
			TSource,
			TName,
			TType,
			TRequired,
			TDefault,
			TJoinKey
		> &
			RejectDuplicateJoinName<TName, TNames> &
			RejectMainAliasCollision<TName, TAs>,
	): Braid<
		TMain,
		TKey,
		TJoined & {
			[K in TName]: JoinValue<DetailOf<TSource>, TType, TRequired, TDefault>;
		},
		TNames | TName,
		TAsync extends true ? true : IsAsyncSource<TSource>,
		TAs
	> {
		const spec = config as unknown as JoinConfig<
			TMain,
			TSource,
			string,
			TType,
			TRequired,
			TDefault,
			TJoinKey
		>;

		if (typeof spec?.name !== "string" || spec.name.length === 0) {
			throw new BraidError(".join() requires a non-empty `name` string.");
		}
		if (this.#joins.some((existing) => existing.name === spec.name)) {
			throw new BraidError(
				`A join named "${spec.name}" is already defined. Join names become properties on the output row, so they must be unique.`,
			);
		}
		if (this.#main?.as === spec.name) {
			throw new BraidError(
				`The main collection is already attached as "${spec.name}", so a join can't use that name too.`,
			);
		}
		if (!isSourceLike(spec.source)) {
			throw new BraidError(
				`Join "${spec.name}" requires a \`source\` array, promise, braid, or a function returning one.`,
			);
		}
		if (typeof spec.on !== "function") {
			throw new BraidError(
				`Join "${spec.name}" requires an \`on\` function, e.g. { on: (row) => row.productId }.`,
			);
		}
		if (spec.key !== undefined && typeof spec.key !== "function") {
			throw new BraidError(
				`Join "${spec.name}" was given a \`key\` that is not a function.`,
			);
		}
		if (spec.type !== "single" && spec.type !== "many") {
			throw new BraidError(
				`Join "${spec.name}" requires \`type\` to be "single" or "many", got ${describeKey(
					spec.type as BraidKey,
				)}.`,
			);
		}
		if (spec.required !== undefined && typeof spec.required !== "boolean") {
			throw new BraidError(
				`Join "${spec.name}" was given a \`required\` that is not a boolean.`,
			);
		}

		this.#joins.push({
			name: spec.name,
			source: spec.source as JoinSpec["source"],
			on: spec.on as JoinSpec["on"],
			key: spec.key as JoinSpec["key"],
			type: spec.type,
			hasDefault: Object.hasOwn(spec, "default"),
			default: spec.default,
			required: spec.required === true,
		});

		return this as unknown as Braid<
			TMain,
			TKey,
			TJoined & {
				[K in TName]: JoinValue<DetailOf<TSource>, TType, TRequired, TDefault>;
			},
			TNames | TName,
			TAsync extends true ? true : IsAsyncSource<TSource>,
			TAs
		>;
	}

	/**
	 * The join names configured so far, typed as the accumulated union so
	 * consumers can build their own arrays and lookups against it.
	 */
	get joinNames(): TNames[] {
		return this.#joins.map((spec) => spec.name) as TNames[];
	}

	/**
	 * Runs the braid. Returns the stitched array directly when every source is an
	 * array, and a promise when any source is a fetcher — the return type follows
	 * the sources, so there's nothing to remember at the call site.
	 */
	run(): BraidResult<TMain, TJoined, TAsync, TAs> {
		const result = this.#hasAsyncSource()
			? this.#runAsync()
			: this.#stitch(
					this.#requireMain().source as readonly object[],
					this.#joins.map((spec) => spec.source as unknown[]),
				);
		return result as unknown as BraidResult<TMain, TJoined, TAsync, TAs>;
	}

	/**
	 * Makes the builder itself awaitable, so `await new Braid()...` works whether
	 * or not any source turned out to be async.
	 */
	// biome-ignore lint/suspicious/noThenProperty: a thenable builder is the point — it lets `await braid` stand in for `.run()`, and lets a braid be used directly as another braid's source
	then<TFulfilled = BraidRow<TMain, TJoined, TAs>[], TRejected = never>(
		onfulfilled?:
			| ((
					value: BraidRow<TMain, TJoined, TAs>[],
			  ) => TFulfilled | PromiseLike<TFulfilled>)
			| null,
		onrejected?:
			| ((reason: unknown) => TRejected | PromiseLike<TRejected>)
			| null,
	): Promise<TFulfilled | TRejected> {
		return this.#runAsync().then(
			onfulfilled as (value: Record<string, unknown>[]) => TFulfilled,
			onrejected,
		) as Promise<TFulfilled | TRejected>;
	}

	/** A braid is synchronous only if every source, main included, is already an array. */
	#hasAsyncSource(): boolean {
		return (
			(this.#main !== undefined && !Array.isArray(this.#main.source)) ||
			this.#joins.some((spec) => !Array.isArray(spec.source))
		);
	}

	#requireMain(): MainSpec {
		const main = this.#main;
		if (main === undefined) {
			throw new BraidError(
				"No main collection defined. Call .main({ source, key }) before running the braid.",
			);
		}
		return main;
	}

	/** Resolves one source, whatever wrapper it arrived in. */
	static async #resolve(
		source: BraidSource<unknown>,
		label: string,
	): Promise<unknown[]> {
		const rows = typeof source === "function" ? await source() : await source;
		if (!Array.isArray(rows)) {
			throw new BraidError(`${label} did not resolve to an array.`);
		}
		return rows;
	}

	async #runAsync(): Promise<Record<string, unknown>[]> {
		const main = this.#requireMain();
		const [mainRows, joinRows] = await Promise.all([
			Braid.#resolve(
				main.source,
				`The ${main.name ?? "main"} collection's \`source\``,
			),
			Promise.all(
				this.#joins.map((spec) =>
					Braid.#resolve(spec.source, `Join "${spec.name}"'s \`source\``),
				),
			),
		]);
		return this.#stitch(mainRows as readonly object[], joinRows);
	}

	#stitch(
		mainRows: readonly object[],
		resolved: readonly unknown[][],
	): Record<string, unknown>[] {
		const main = this.#requireMain();

		const indexes = this.#joins.map((spec, position) => {
			const rows = resolved[position] ?? [];
			return spec.type === "many"
				? groupBy(rows, spec.on)
				: indexBy(rows, spec.on);
		});

		const stitched: Record<string, unknown>[] = [];
		for (const row of mainRows) {
			// `as` nests the main row instead of spreading it, so two collections
			// with overlapping field names can share an output row.
			const output: Record<string, unknown> =
				main.as === undefined ? { ...row } : { [main.as]: row };

			for (let position = 0; position < this.#joins.length; position += 1) {
				const spec = this.#joins[position];
				const index = indexes[position];
				if (spec === undefined || index === undefined) continue;

				const key = (spec.key ?? main.key)(row);
				const match = isJoinableKey(key) ? index.get(key) : undefined;

				if (match !== undefined) {
					output[spec.name] = match;
					continue;
				}
				if (spec.required) {
					throw new BraidError(
						`Join "${spec.name}" is required, but no match was found for ${
							main.name ?? "main"
						} row with key ${describeKey(key)}.`,
					);
				}
				output[spec.name] = spec.hasDefault
					? spec.default
					: spec.type === "many"
						? []
						: null;
			}

			stitched.push(output);
		}

		return stitched;
	}
}

/**
 * The output row type of a configured braid, for annotating a function's return
 * type without restating every join by hand.
 *
 * ```ts
 * const builder = new Braid().main({ source: products, key: (p) => p.sku });
 * type Row = InferBraidRow<typeof builder>;
 * ```
 */
export type InferBraidRow<TBraid> =
	TBraid extends Braid<
		infer TMain,
		infer _TKey,
		infer TJoined,
		infer _TNames,
		infer _TAsync,
		infer TAs
	>
		? BraidRow<TMain, TJoined, TAs>
		: never;
