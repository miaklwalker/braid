---
title: "Braid API"
description: "The full class surface (.main(), .join(), .run(), and the supporting members) with signatures, parameters, return types, and what each throws."
---

`import { Braid } from "@michaelrwalker/braid";`

`Braid` carries six type parameters that accumulate as you call `.main()`
and `.join()`: the main row type, the main key type, the joined-properties
type, the union of join names in use, whether the result is async, and the
property name the main row is nested under (if `.main()` was given an
`as`). You never write these yourself. They're inferred from the config
objects you pass in. See [Type safety](../guides/type-safety) for how they
accumulate.

## `.main(config)`

```ts
main<
	TSource extends BraidSource<object>,
	TRowKey extends BraidKey,
	TMainAs extends string | undefined = undefined,
>(
	config: MainConfig<TSource, TRowKey, TMainAs>,
): Braid<
	DetailOf<TSource>,
	TRowKey,
	TJoined,
	TNames,
	TAsync extends true ? true : IsAsyncSource<TSource>,
	TMainAs
>
```

Declares the driving collection. Callable only on a builder with no main
collection yet: `this` is typed to reject a second call, see
[Type safety](../guides/type-safety#a-second-main-collection).

**`config: MainConfig<TSource, TRowKey, TMainAs>`**

| field    | type                              | required | description                                                              |
| -------- | ---------------------------------- | -------- | --------------------------------------------------------------------------- |
| `name`   | `string`                           | no       | Informational label used in error messages. Doesn't affect the output.      |
| `source` | `BraidSource<TRow>`                | yes      | The driving collection: an array, a promise, another braid, or a function returning one. |
| `key`    | `(item: DetailOf<TSource>) => TRowKey` | yes  | Default key extractor, used by any `.join()` that doesn't override it.      |
| `as`     | `TMainAs extends string \| undefined` | no  | Nests the main row under this property instead of spreading it.             |

**Returns** the same builder, retyped with `TMain = DetailOf<TSource>`,
`TKey = TRowKey`, `TAsync` flipped to `true` if `TSource` isn't a plain
array, and `TAs = TMainAs`.

**Throws** `BraidError` when:

- `.main()` has already been called on this builder.
- `config.source` isn't an array, a promise, a braid, or a function. See
  [Async sources](../guides/async-sources) for the accepted shapes.
- `config.key` is not a function.
- `config.as` is provided and is not a non-empty string.
- `config.as` is already used by a join on this builder.

Full field-by-field behavior: [The main collection](../guides/main-collection)
covers the fields present since the first release; the [Configuration
reference](configuration) covers `as` and the wider `BraidSource` shape.

## `.join(config)`

```ts
join<
	TName extends string,
	TSource extends BraidSource<unknown>,
	TType extends "single" | "many",
	TRequired extends boolean = false,
	TDefault = TType extends "many" ? DetailOf<TSource>[] : null,
	TJoinKey extends BraidKey = TKey,
>(
	config: JoinConfig<TMain, TSource, TName, TType, TRequired, TDefault, TJoinKey>,
): Braid<
	TMain,
	TKey,
	TJoined & { [K in TName]: JoinValue<DetailOf<TSource>, TType, TRequired, TDefault> },
	TNames | TName,
	TAsync extends true ? true : IsAsyncSource<TSource>,
	TAs
>
```

Adds one detail collection, attached to every output row under `config.name`.

**`config: JoinConfig<...>`**

| field      | type                                    | required | default                              | description                                                    |
| ---------- | ---------------------------------------- | -------- | ------------------------------------- | ---------------------------------------------------------------- |
| `name`     | `TName extends string`                   | yes      | —                                     | Property name the result is attached under.                     |
| `source`   | `TSource`, a `BraidSource` (see below)   | yes      | —                                     | Detail collection: an array, a promise, another braid, or a function returning one. |
| `on`       | `(item: DetailOf<TSource>) => TJoinKey`  | yes      | —                                     | Key extractor for the detail rows.                               |
| `key`      | `(item: TMain) => TJoinKey`              | no       | the main collection's `key`           | Overrides which key on the main row this join matches against.  |
| `type`     | `"single" \| "many"`                     | yes      | —                                     | One matching row, or an array of them.                          |
| `default`  | `TDefault`                               | no       | `null` for `single`, `[]` for `many`  | Value used when nothing matches.                                 |
| `required` | `TRequired extends boolean`              | no       | `false`                               | Throw if any main row finds no match.                            |

`TSource extends BraidSource<unknown>`: an array, a promise, another braid,
or a function returning either. See [Async sources](../guides/async-sources).
`DetailOf<TSource>` extracts the element type from any of those shapes.

Reusing a `name` already configured on this builder fails to compile:
`RejectDuplicateJoinName<TName, TNames>` is intersected onto the parameter
type, before the call ever runs. See
[Type safety](../guides/type-safety#duplicate-join-names). So does giving a
join the same `name` the main row is nested under, via
`RejectMainAliasCollision<TName, TAs>`. See
[Type safety](../guides/type-safety#reserved-the-main-rows-as-name).

**Returns** the same builder, retyped with the new property added to
`TJoined`, `TName` added to the name union, and `TAsync` flipped to `true` if
`TSource` isn't a plain array.

**Throws** `BraidError` when:

- `config.name` is missing, not a string, or an empty string.
- `config.name` is already used by an earlier `.join()` on this builder.
- `config.name` is the name the main row is nested under (its `as`).
- `config.source` isn't an array, a promise, a braid, or a function.
- `config.on` is not a function.
- `config.key` is provided and is not a function.
- `config.type` is not `"single"` or `"many"`.
- `config.required` is provided and is not a boolean.

These are checked in that order: the first that fails is the one that
throws. Full field-by-field behavior: [Declaring joins](../guides/declaring-joins),
[Single vs many](../guides/single-vs-many), and
[Defaults and required joins](../guides/defaults-and-required).

## `.run()`

```ts
run(): BraidResult<TMain, TJoined, TAsync, TAs>
```

Runs the braid. `BraidResult` resolves to `BraidRow<TMain, TJoined, TAs>[]`
when `TAsync` is `false` (i.e. every source, main and joins alike, was a
plain array) and to `Promise<BraidRow<TMain, TJoined, TAs>[]>` when any
source wasn't, regardless of whether that source itself was a promise, a
function, or another braid. See [Async sources](../guides/async-sources)
for exactly what triggers the promise.

**Throws / rejects with** `BraidError` when:

- No `.main()` call has been made on this builder.
- The main collection's source, or any join's source, resolves to something
  that isn't an array (rejects the promise, in the async case).
- A `required` join finds no match for some main row (throws synchronously
  in the sync case, rejects the promise in the async case).

A source's own rejection (a fetcher's network error, a nested braid's own
failure) propagates through `.run()`'s promise unwrapped; it is not
converted into a `BraidError`. See
[Errors](errors#fetcher-rejections-are-not-wrapped).

## `.then()`

```ts
then<TFulfilled = BraidRow<TMain, TJoined, TAs>[], TRejected = never>(
	onfulfilled?: (value: BraidRow<TMain, TJoined, TAs>[]) => TFulfilled | PromiseLike<TFulfilled>,
	onrejected?: (reason: unknown) => TRejected | PromiseLike<TRejected>,
): Promise<TFulfilled | TRejected>
```

Makes the builder itself a thenable, so `await new Braid()...` works as an
alternative to `.run()`, whether or not any source turned out to be async:

```ts
const rows = await new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: () => fetchBc(), on: (bc) => bc.sku, type: "single" });
```

Being thenable is also what makes a braid a valid `source` for another
braid: `.main()` and `.join()` accept anything with a `.then`, and a
configured `Braid` instance has one. See [Async sources](../guides/async-sources).

## `.joinNames`

```ts
get joinNames(): TNames[]
```

The join names configured so far, in the order they were declared. Typed as
the accumulated union of names actually used (`"bigcommerce" | "shopify"`),
not as a plain `string[]`.

## InferBraidRow

```ts
type InferBraidRow<TBraid> = TBraid extends Braid<infer TMain, infer _, infer TJoined, infer _, infer _, infer TAs>
	? BraidRow<TMain, TJoined, TAs>
	: never;
```

Reads the output row type off a configured builder, so a function's return
type doesn't have to restate every join by hand:

```ts
import { Braid, type InferBraidRow } from "@michaelrwalker/braid";

const builder = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" });

type ProductRow = InferBraidRow<typeof builder>;
// { id: number; sku: string; title: string; bigcommerce: BcProduct | null }
```

If `.main()` was given an `as`, the inferred row nests the main type under
that property instead of spreading it, exactly as `.run()`'s actual result
does:

```ts
const nested = new Braid().main({ source: products, key: (p) => p.sku, as: "product" });
type NestedRow = InferBraidRow<typeof nested>;
// { product: Product }
```

## `BraidSource`

```ts
type BraidSource<TRow> =
	| readonly TRow[]
	| PromiseLike<readonly TRow[]>
	| (() => readonly TRow[] | PromiseLike<readonly TRow[]>);
```

The type of both `MainConfig.source` and `JoinConfig.source`: an array, a
promise of one, or a function returning either. Because every `Braid` is
itself `PromiseLike`, this is also what allows a configured braid to be used
directly as another braid's source. `JoinSource<TDetail>` is exported as an
alias of `BraidSource<TDetail>`, kept for the detail-collection-specific
name used elsewhere in these docs. See [Async sources](../guides/async-sources).

## `groupBy` and `indexBy`

```ts
function indexBy<TDetail>(source: readonly TDetail[], on: (item: TDetail) => BraidKey): Map<BraidKey, TDetail>;
function groupBy<TDetail>(source: readonly TDetail[], on: (item: TDetail) => BraidKey): Map<BraidKey, TDetail[]>;
```

The two functions `.join()` uses internally to build its per-join index,
exported directly for when you want the `Map` itself rather than a stitched
row: `indexBy` for a `single`-style index, `groupBy` for a `many`-style one:

```ts
import { groupBy, indexBy } from "@michaelrwalker/braid";

const bySku = indexBy(bcProducts, (bc) => bc.sku); // Map<BraidKey, BcProduct>
const byProduct = groupBy(variations, (v) => v.productId); // Map<BraidKey, Variation[]>
```

Both skip rows with a nullish key, and `indexBy` keeps the last row when a
key repeats: the same rules `.join()` follows. See
[Performance](../guides/performance) for why indexing once is the point.

## `isJoinableKey`

```ts
function isJoinableKey(key: BraidKey): boolean;
```

Returns `false` for `null` and `undefined`, `true` for everything else.
`groupBy`, `indexBy`, and `.run()`'s per-row lookup all use this to decide
whether a key is eligible to match at all. See
[Key equality and nullish keys](../guides/key-equality).

## `BraidError`

```ts
class BraidError extends Error {
	override name = "BraidError";
}
```

The only error type Braid throws. See [Errors](errors) for every message.

## Types

`BraidKey`, `JoinType`, `BraidSource`, `JoinSource`, `MainConfig`,
`JoinConfig`, `BraidRow`, `BraidResult`, `DetailOf`, `IsAsyncSource`,
`JoinValue`, `MainContribution`, `RejectDuplicateJoinName`, and
`RejectMainAliasCollision` are all exported from the package entry point for
annotating your own code, alongside `Braid`, `BraidError`, and
`InferBraidRow`. See [Configuration](configuration) for what each
configuration-facing type means field by field.
