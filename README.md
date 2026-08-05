# @michaelrwalker/braid

Braid stitches one main collection together with any number of related detail
collections. You declare what each detail source is and how it joins; Braid
indexes each source once into a `Map` and does a single lookup per row, so the
work is O(n + m) instead of the O(n × m) you get from calling `.find()` inside
a `.map()`.

It exists because the alternative — three nested `.find()` / `.filter()` calls
stacked on one object literal — is copy-pasted into every project that pulls a
product list from more than one platform, is quietly quadratic, and gets harder
to read with each source added.

```ts
import { Braid } from "@michaelrwalker/braid";

const stitched = new Braid()
	.main({ name: "product", source: products, key: (product) => product.sku })
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
		default: null,
	})
	.join({
		name: "shopify",
		source: () => fetchShopifyProducts(),
		on: (sp) => sp.sku,
		type: "single",
	})
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		key: (product) => product.id,
		type: "many",
		required: false,
	})
	.run();
```

The chain accumulates types as it goes: `.main()` fixes the row and key types,
and each `.join()` widens the output row with its own property while recording
its name — so a reused join name, a detail key whose type doesn't match the main
key's, a join declared before there's a main collection to join it to, or a
second `.main()` are all compile errors rather than runtime surprises. Each is
checked again at runtime, because types are erased and data arrives from the
network.

## Install

```bash
npm install @michaelrwalker/braid
```

No runtime dependencies. The package ships as TypeScript source — `main` and
`types` both point at `main.ts`, so your build compiles it alongside your own
code and you get real source in your editor rather than a `.d.ts` shadow.

## `.main(config)`

Declares the driving collection. One output row is produced per item, in source
order, and each output row is a shallow copy — Braid never mutates your input.

| field    | type                   | required | description                                                                    |
| -------- | ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `name`   | `string`               | no       | Informational label used in error messages. Doesn't affect the output shape.    |
| `source` | `T[]`                  | yes      | The driving array.                                                              |
| `key`    | `(item: T) => BraidKey`| yes      | Default key extractor, used by any `.join()` that doesn't specify its own.      |

Only one main collection may be set per builder. A second `.main()` is a compile
error and throws, because silently replacing it would invalidate every join
already configured against the old row type.

Keys must be primitives (`string`, `number`, `bigint`, `boolean`, `symbol`, or
nullish). Joining on object references is technically possible with a `Map` but
matches by identity, which silently fails the moment the two sides come from
different fetches — derive a primitive key instead, including for composite keys
(`` key: (row) => `${row.storeId}:${row.sku}` ``).

## `.join(config)`

Adds a detail collection, attached to every output row under `name`.

| field      | type                            | required | default                              | description                                                            |
| ---------- | ------------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `name`     | `string`                        | yes      | —                                    | Property name the result is attached under.                            |
| `source`   | `D[]` \| `() => D[] \| Promise<D[]>` | yes | —                                    | Detail array, or a fetcher returning one.                              |
| `on`       | `(item: D) => BraidKey`         | yes      | —                                    | Key extractor for the detail rows.                                     |
| `key`      | `(item: T) => BraidKey`         | no       | the main `key`                       | Overrides which key on the main row this join matches against.         |
| `type`     | `"single"` \| `"many"`          | yes      | —                                    | One matching row, or an array of them.                                 |
| `default`  | `D` \| `D[]` \| `null`          | no       | `null` for `single`, `[]` for `many` | Value used when nothing matches.                                       |
| `required` | `boolean`                       | no       | `false`                              | Throw if any main row finds no match.                                  |

Joins are independent and chainable. Each source is indexed exactly once, so a
fourth join costs one more pass over one more collection — not another scan per
main row.

`type` is explicit rather than inferred on purpose. Guessing `single` vs `many`
from whether keys repeat in the data you happen to have is fragile: a genuine
one-to-many relationship looks one-to-one in any dataset where the keys are
unique, and the shape silently changes the day it isn't.

### What lands on the row

| situation                                     | `single`                    | `many`                          |
| --------------------------------------------- | --------------------------- | ------------------------------- |
| one match                                     | the detail row              | `[row]`                         |
| several matches                               | the **last** one wins       | all of them, in source order    |
| no match                                      | `default` (default `null`)  | `default` (default a fresh `[]`)|
| no match, `required: true`                    | throws                      | throws                          |
| main key is `null` or `undefined`             | treated as no match         | treated as no match             |

Three behaviours are worth knowing about rather than discovering:

- **Last write wins** for `single` joins when several detail rows share a key.
  That ambiguity lives in the data, not in Braid, so v1 takes the simple
  documented rule. Use `type: "many"` if the duplicates are meaningful.
- **Nullish keys never match.** A row whose key is `null` or `undefined` has
  nothing to join on, so it takes the default. Indexing nullish keys literally
  would braid every keyless row on one side onto every keyless row on the other,
  which looks fine in a fixture and is nonsense in production.
- **Keys match strictly.** Lookups go through a `Map`, so `"2"` never matches
  `2`, `2n`, or `true` — there is no `==`-style coercion anywhere in the
  library. See [Key equality](#key-equality) for when that bites and what to do
  about it.

When you don't supply a `default`, each unmatched `many` row gets its own empty
array, so mutating one row's result can't affect another. When you do supply
one, that exact value is used for every miss — share it only if you mean to.

### Key equality

Keys are compared the way `Map` compares them — SameValueZero, which is `===`
with one deliberate difference. There is no loose comparison anywhere in Braid:

| main key | detail key | matches? |                                            |
| -------- | ---------- | -------- | ------------------------------------------ |
| `"2"`    | `2`        | no       | no coercion, unlike `==`                   |
| `2`      | `2n`       | no       | a bigint is not a number                    |
| `1`      | `true`     | no       |                                            |
| `NaN`    | `NaN`      | **yes**  | SameValueZero, unlike `===`                 |
| `0`      | `-0`       | **yes**  | SameValueZero, unlike `Object.is`           |

When both sides are properly typed, a `"2"`/`2` mismatch is a compile error —
that's what the key-type check on `on` is for. The case to watch is data that
arrives as `string | number` or `any`, typically JSON from two platforms that
disagree about whether ids are quoted: nothing fails, every row just takes its
default. Two ways to catch it:

```ts
// Normalise in the extractors — they're functions, so this is the natural place.
.join({ name: "dbProduct", source: dbProducts, on: (p) => String(p.id), key: (row) => String(row.productId), type: "single" })

// Or make the mismatch loud instead of silent.
.join({ name: "dbProduct", source: dbProducts, on: (p) => p.id, type: "single", required: true })
```

`required: true` turns a wholesale miss into a throw naming the first key that
found nothing, which is usually enough to spot that one side is quoted:

```
Join "dbProduct" is required, but no match was found for listing row with key "2".
```

## `.run()` and async sources

If every source is an array, `.run()` returns the stitched array directly. If any
source is a function, all the fetchers are started concurrently and `.run()`
returns a promise — the return type follows the sources, so there's nothing to
remember at the call site:

```ts
const rows = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
	.run(); // Row[]

const fetched = await new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: () => fetchBc(), on: (bc) => bc.sku, type: "single" })
	.run(); // Promise<Row[]>
```

The builder is also thenable, so `.run()` is optional when you're awaiting
anyway — this works whether or not any source turned out to be async:

```ts
const rows = await new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: () => fetchBc(), on: (bc) => bc.sku, type: "single" });
```

Fetching and caching are the caller's job, not Braid's. A `source` function is
called once per `.run()`, with no memoisation — wrap it if you want caching.

One TypeScript wrinkle: if you build a fetcher with a *generic* helper and call
it inline (`source: fetcherFor(rows)`), inference can't see through it and the
detail type collapses to `unknown`. Assign it to a variable first, or pass the
type argument explicitly. Plain arrows (`source: () => fetchBc()`) and direct
function references are unaffected.

## Types

`.run()`'s element type is the main row intersected with every join's property,
flattened for readability. `InferBraidRow` reads that type off a configured
builder when you'd rather not restate it:

```ts
import { Braid, type InferBraidRow } from "@michaelrwalker/braid";

const builder = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" });

type ProductRow = InferBraidRow<typeof builder>;
// { id: number; sku: string; title: string; bigcommerce: BcProduct | null }
```

`required: true` drops the default from the union, so a required `single` join
is typed as `D` rather than `D | null`. `builder.joinNames` is typed as the union
of the names actually configured, which is useful for building lookups against
the joins you know exist.

## Performance

`examples/performance.ts` runs the same seven joins — five `single`, two `many`
— twice over identical data: once as a braid, once as `.find()` / `.filter()`
inside a `.map()`, asserting the two produce the same output before measuring
either.

| rows   | detail rows | naive    | braid  | naive peak | braid peak | naive held | braid held |
| ------ | ----------- | -------- | ------ | ---------- | ---------- | ---------- | ---------- |
| 100    | 1,300       | 0.5ms    | 0.1ms  | 116 KB     | 189 KB     | 53 KB      | 54 KB      |
| 1,000  | 13,000      | 48.7ms   | 0.6ms  | 1.0 MB     | 1.3 MB     | 524 KB     | 565 KB     |
| 4,000  | 52,000      | 781.3ms  | 2.1ms  | 4.1 MB     | 4.8 MB     | 2.0 MB     | 2.2 MB     |
| 8,000  | 104,000     | 1239.2ms | 4.8ms  | 4.9 MB     | 9.3 MB     | 4.1 MB     | 4.3 MB     |
| 16,000 | 208,000     | —        | 9.5ms  | —          | 18.4 MB    | —          | 8.7 MB     |

The absolute numbers are one laptop's; the shape is the point. Braid's time
grows with rows + detail rows, the naive version's with rows × detail rows, and
the gap is already worth having at a few hundred SKUs.

Braid does trade space for that. It holds one `Map` per join while it runs, so
peak heap is roughly 1.2–1.9× the naive version's — the cost of an index over
every detail row. That memory is transient: the indexes are unreachable the
moment `.run()` returns, and what's still held afterwards is within a few
percent either way, because by then both approaches are holding the same output
rows. If peak memory is the binding constraint rather than time, the naive scan
is the cheaper tool and Braid is the wrong one.

Set the row count on the command line to try your own scale:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/performance.ts 2000
```

## Indexing helpers

The two functions Braid uses internally are exported, for the cases where you
want the index itself rather than a stitched row:

```ts
import { groupBy, indexBy } from "@michaelrwalker/braid";

const bySku = indexBy(bcProducts, (bc) => bc.sku); // Map<BraidKey, BcProduct>
const byProduct = groupBy(variations, (v) => v.productId); // Map<BraidKey, Variation[]>
```

Both skip rows with a nullish key, and `indexBy` keeps the last row when a key
repeats — the same rules the joins follow.

## Errors

Everything throws `BraidError`, and every message names the join it came from.
Configuration mistakes throw at the call that made them, so a typo surfaces
immediately rather than at `.run()`:

| when                                                    | thrown by |
| ------------------------------------------------------- | --------- |
| `.main()` called twice                                  | `.main()` |
| `source` isn't an array, or `key` isn't a function      | `.main()` |
| `name`, `source`, `on`, or `type` missing or malformed  | `.join()` |
| a join name is reused                                   | `.join()` |
| `.run()` with no main collection                        | `.run()`  |
| a `required` join finds no match for some row           | `.run()`  |
| a `source` function doesn't resolve to an array         | `.run()`  |

The `required` message includes the offending key, which is usually enough to
find the row on its own:

```
Join "shipments" is required, but no match was found for order row with key "SH-2003".
```

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npx biome format --write . && npx biome lint --write .
```

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/basic.ts
```
