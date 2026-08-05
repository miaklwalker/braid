import { groupBy, indexBy, isJoinableKey } from "./indexing.ts";
import {
	type BraidKey,
	type BraidResult,
	type BraidRow,
	BraidError,
	type DetailOf,
	type IsAsyncSource,
	type JoinConfig,
	type JoinSpec,
	type JoinType,
	type JoinValue,
	type MainConfig,
	type RejectDuplicateJoinName,
} from "./types.ts";

/** The main collection with its generics erased, as stored on the builder. */
interface MainSpec {
	readonly name?: string;
	readonly source: readonly object[];
	// biome-ignore lint/suspicious/noExplicitAny: erased internal storage — the typed facade on .main() is what consumers see
	readonly key: (item: any) => BraidKey;
}

/** Renders a key for an error message without throwing on symbols. */
function describeKey(key: BraidKey): string {
	return typeof key === "string" ? JSON.stringify(key) : String(key);
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
 */
export class Braid<
	TMain extends object = never,
	TKey extends BraidKey = never,
	TJoined = Record<never, never>,
	TNames extends string = never,
	TAsync extends boolean = false,
> {
	#main: MainSpec | undefined;
	readonly #joins: JoinSpec[] = [];

	/**
	 * Declares the driving collection. One output row is produced per item here,
	 * in source order, and `key` becomes the default extractor for every join
	 * that doesn't bring its own.
	 *
	 * Only one main collection may be set: a second call is both a compile error
	 * and a throw, because silently replacing it would invalidate every join
	 * already configured against the old row type.
	 */
	main<TRow extends object, TRowKey extends BraidKey>(
		this: Braid<never, never, TJoined, TNames, TAsync>,
		config: MainConfig<TRow, TRowKey>,
	): Braid<TRow, TRowKey, TJoined, TNames, TAsync> {
		if (this.#main !== undefined) {
			throw new BraidError(
				"A main collection is already defined. Call .main() once per Braid instance.",
			);
		}
		if (!Array.isArray(config?.source)) {
			throw new BraidError(".main() requires a `source` array.");
		}
		if (typeof config.key !== "function") {
			throw new BraidError(
				".main() requires a `key` function, e.g. { key: (row) => row.id }.",
			);
		}

		this.#main = { name: config.name, source: config.source, key: config.key };
		return this as unknown as Braid<TRow, TRowKey, TJoined, TNames, TAsync>;
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
		TSource extends
			| readonly unknown[]
			| (() => readonly unknown[] | Promise<readonly unknown[]>),
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
			RejectDuplicateJoinName<TName, TNames>,
	): Braid<
		TMain,
		TKey,
		TJoined & {
			[K in TName]: JoinValue<DetailOf<TSource>, TType, TRequired, TDefault>;
		},
		TNames | TName,
		TAsync extends true ? true : IsAsyncSource<TSource>
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
		if (!Array.isArray(spec.source) && typeof spec.source !== "function") {
			throw new BraidError(
				`Join "${spec.name}" requires a \`source\` array or a function returning one.`,
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
			TAsync extends true ? true : IsAsyncSource<TSource>
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
	run(): BraidResult<TMain, TJoined, TAsync> {
		const result = this.#hasAsyncSource()
			? this.#runAsync()
			: this.#stitch(this.#resolveSync());
		return result as unknown as BraidResult<TMain, TJoined, TAsync>;
	}

	/**
	 * Makes the builder itself awaitable, so `await new Braid()...` works whether
	 * or not any source turned out to be async.
	 */
	// biome-ignore lint/suspicious/noThenProperty: a thenable builder is the point — it lets `await braid` stand in for `.run()`
	then<TFulfilled = BraidRow<TMain, TJoined>[], TRejected = never>(
		onfulfilled?:
			| ((
					value: BraidRow<TMain, TJoined>[],
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

	#hasAsyncSource(): boolean {
		return this.#joins.some((spec) => typeof spec.source === "function");
	}

	#resolveSync(): readonly unknown[][] {
		return this.#joins.map((spec) => spec.source as unknown[]);
	}

	async #runAsync(): Promise<Record<string, unknown>[]> {
		const resolved = await Promise.all(
			this.#joins.map(async (spec) => {
				const rows =
					typeof spec.source === "function" ? await spec.source() : spec.source;
				if (!Array.isArray(rows)) {
					throw new BraidError(
						`Join "${spec.name}" has a \`source\` function that did not resolve to an array.`,
					);
				}
				return rows as unknown[];
			}),
		);
		return this.#stitch(resolved);
	}

	#stitch(resolved: readonly unknown[][]): Record<string, unknown>[] {
		const main = this.#main;
		if (main === undefined) {
			throw new BraidError(
				"No main collection defined. Call .main({ source, key }) before running the braid.",
			);
		}

		const indexes = this.#joins.map((spec, position) => {
			const rows = resolved[position] ?? [];
			return spec.type === "many"
				? groupBy(rows, spec.on)
				: indexBy(rows, spec.on);
		});

		const stitched: Record<string, unknown>[] = [];
		for (const row of main.source) {
			const output: Record<string, unknown> = { ...row };

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
		infer _TAsync
	>
		? BraidRow<TMain, TJoined>
		: never;
