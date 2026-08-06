---
title: "Async sources"
description: "How a source (main or join) can be an array, a promise, a fetcher, or another braid, and exactly what .run() returns in each case."
---

Both `.main()` and every `.join()` accept the same shape of `source`: an
array you already have, or anything that resolves to one.

```ts
type BraidSource<TRow> =
	| readonly TRow[]
	| PromiseLike<readonly TRow[]>
	| (() => readonly TRow[] | PromiseLike<readonly TRow[]>);
```

That's an array, a promise of one, or a function returning either. Because
every `Braid` instance is itself thenable (`PromiseLike`), a configured
braid also satisfies this type: a stitched result can be handed straight to
another braid's `.main()` or `.join()` as its `source`. This page covers
arrays, promises, and fetchers; see the README's "Composing braids" section
and `examples/compose.ts` for using a braid as a source.

Only a plain array keeps a source synchronous. Everything else (a promise,
a fetcher, a braid) has to be awaited, which is what makes `.run()` return
a promise.

## What `.run()` returns

If every source, both the main collection's and every join's, is a plain
array, `.run()` runs synchronously and returns the stitched array directly:

```ts
const rows = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
	.run(); // Row[]
```

If **any** source, main or join, isn't a plain array, `.run()` returns a
`Promise` of the stitched array instead, even if that source is a function
returning a plain array rather than a promise:

```ts
const fetched = await new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: () => bcProducts, // a plain array, wrapped in a function
		on: (bc) => bc.sku,
		type: "single",
	})
	.run(); // still Promise<Row[]>
```

A non-array source makes the whole braid async whether or not it ever
actually awaits anything: the type is decided by the *shape* of `source`
(`IsAsyncSource<TSource>`), not by what it returns at runtime. Once one
source anywhere in the chain is non-array, the whole result stays a promise
even if every other source is a plain array; nothing later in the chain can
undo it.

## The builder is thenable

`.run()` is optional when you're going to `await` the result anyway: the
builder itself implements `.then()`, so this works whether or not any source
turned out to be async:

```ts
const rows = await new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: () => fetchBc(), on: (bc) => bc.sku, type: "single" });
```

This is also exactly what lets a braid be used as another braid's source:
`source: someOtherBraid` works because `someOtherBraid.then` exists, not
because of anything special about the type being a `Braid`.

## How sources are resolved

A `source` function is called once per `.run()`, with no caching or
memoization: fetching and caching are the caller's job, not Braid's. Wrap
the fetcher yourself if you want to reuse a result across calls.

When any source is async, the main collection's source and every join's
source are all resolved together, through the same `Promise.all`, before any
row is stitched:

```ts
const dispatched = await new Braid()
	.main({ name: "order", source: orders, key: (order) => order.reference })
	.join({ name: "shipments", source: fetchShipments, on: (s) => s.orderReference, type: "many" })
	.join({
		name: "customer",
		source: fetchCustomers,
		on: (c) => c.id,
		key: (order) => order.customerId,
		type: "single",
		required: true,
	});
```

`fetchShipments` and `fetchCustomers` are both in flight before either
resolves. This costs one round trip, not two. `tests/async.test.ts` pins
the concurrency directly: two joins backed by 40ms fetchers finish in well
under 75ms total, which would be impossible if the second fetcher only
started once the first had resolved. Plain array sources mixed into the
same braid don't add any artificial delay: they're used as-is once every
async source has resolved.

Rows are only stitched once **every** source (main and joins, sync and
async alike) has resolved. There's no partial or streaming result; `.run()`
either returns the full array or the full promise.

## Errors from an unresolved source

Whatever a source resolves to is still validated as an array. If the main
collection's source resolves to something else, `.run()`'s promise rejects
with a `BraidError` naming the main collection (or the literal words `"main
collection"` if `.main()` wasn't given a `name`):

```text
The product collection's `source` did not resolve to an array.
```

A join's source is checked the same way, naming the join instead:

```text
Join "bigcommerce"'s `source` did not resolve to an array.
```

If the source itself rejects (a network failure, a thrown error inside an
`async` function, a nested braid's own `required` join failing), that
rejection propagates through `.run()`'s promise unchanged. It is **not**
wrapped in a `BraidError`; catching `BraidError` specifically won't catch a
rejected fetcher, only Braid's own validation and `required`-miss failures.
See [Errors](../reference/errors) for the full split between the two.

A `required` join still throws the same `BraidError` it would synchronously,
just by rejecting the promise instead of throwing immediately. See
[Defaults and required joins](defaults-and-required#required-and-async-sources).

## The generic-fetcher inference wrinkle

If you build a fetcher with your own *generic* helper and call it inline
(`source: fetcherFor(rows)`, where `fetcherFor` is a generic function you
wrote, not anything Braid exports), TypeScript's inference can't see through
the call, and the detail type collapses to `unknown`. Assign the fetcher to
a variable first, or pass the type argument explicitly:

```ts
function fetcherFor<T>(rows: readonly T[], delayMs: number): () => Promise<readonly T[]> {
	return () => new Promise((resolve) => setTimeout(() => resolve(rows), delayMs));
}

// Detail type collapses to `unknown`:
.join({ name: "bigcommerce", source: fetcherFor(bcProducts, 60), on: (bc) => bc.sku, type: "single" })

// Assign first — inference sees the concrete function type:
const fetchBc = fetcherFor(bcProducts, 60);
.join({ name: "bigcommerce", source: fetchBc, on: (bc) => bc.sku, type: "single" })
```

Plain arrows (`source: () => fetchBc()`) and direct function references
(`source: fetchBc`) are unaffected: the wrinkle is specific to calling a
generic function and handing its result straight to `source` in the same
expression.

## Next steps

- [Type safety](type-safety) covers how `TAsync` accumulates across sources
  in the type system.
- [Braid API](../reference/api) has the full signature of `.run()`, `.then()`,
  and the `BraidSource` type.
