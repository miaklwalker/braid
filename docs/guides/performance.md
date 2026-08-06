---
title: "Performance"
description: "Why indexing each source once into a Map turns O(n × m) nested lookups into O(n + m), with real numbers from examples/performance.ts."
---

## The cost `.find()` inside `.map()` pays

The alternative to a braid is a `.map()` over the main collection with a
`.find()` or `.filter()` per detail source, inlined into each row:

```ts
const rows = listRows.map((listRow) => ({
	...listRow,
	dbProduct: dbProducts.find((product) => product.id === listRow.productId) ?? null,
	dbSkus: dbSkus.filter((sku) => sku.productId === listRow.productId),
}));
```

Each `.find()` or `.filter()` call rescans its entire array for every row of
the main collection. With n main rows and m rows in one detail source, that's
n scans of m rows, or O(n × m) for that one join, and the cost adds per join:
seven joins means seven full rescans per main row.

## Indexing once instead of scanning per row

Braid indexes each join's source exactly once, into a `Map` keyed by that
join's `on` extractor, before it looks at any main row. Looking up a match
is then a single `Map.get()`:

```ts
export function indexBy<TDetail>(source: readonly TDetail[], on: (item: TDetail) => BraidKey) {
	const index = new Map<BraidKey, TDetail>();
	for (const item of source) {
		const key = on(item);
		if (key !== null && key !== undefined) index.set(key, item);
	}
	return index;
}
```

Building the index is one pass over the detail source: O(m). Stitching is
one pass over the main source with a constant-time lookup per join: O(n) per
join. A braid with j joins is O(n·j + Σm) (indexing every detail source
once, plus one lookup per main row per join) rather than O(n · Σm).

## What a fourth join actually costs

Because each join is indexed independently, adding a join costs one more
pass over one more collection, not another scan per main row.
`tests/indexing.test.ts` pins this directly by counting how many times each
extractor runs across a 10,000-row main collection joined against three
detail sources of the same size:

```ts
new Braid()
	.main({ source: MAIN, key: mainKey })
	.join({ name: "a", source: DETAIL, on: detailKey, type: "single" })
	.join({ name: "b", source: DETAIL, on: detailKey, type: "single" })
	.join({ name: "c", source: DETAIL, on: detailKey, type: "many" })
	.run();

// detailKey.calls === 30_000  — three joins × one pass over 10,000 detail rows each
// mainKey.calls   === 30_000  — one extraction per main row per join, never a rescan
```

`detailKey` runs exactly once per detail row per join: 10,000 rows × 3
joins, never more, regardless of how many main rows there are. `mainKey`
runs once per main row per join, to build the lookup key, never once per
`(main row, detail row)` pair. Neither count depends on how many rows the
*other* joins carry.

## Measured: naive vs braid

`examples/performance.ts` builds the same seven joins (five `single`, two
`many`) twice over identical data: once as a braid, once as `.find()` /
`.filter()` inside a `.map()`, asserting the two produce identical output
before measuring either. These numbers are from an actual run on this
machine:

| rows   | detail rows | naive    | braid | speedup     |
| ------ | ----------- | -------- | ----- | ----------- |
| 100    | 1,300       | 0.6ms    | 0.1ms | 5.2× faster |
| 1,000  | 13,000      | 47.8ms   | 0.6ms | 86.0× faster |
| 4,000  | 52,000      | 761.4ms  | 2.0ms | 376.3× faster |
| 8,000  | 104,000     | 1229.0ms | 4.6ms | 265.0× faster |
| 16,000 | 208,000     | —        | 9.6ms | —           |

The naive column is skipped past 10,000 rows: the script gives up on it
rather than waiting out a multi-second run. The absolute numbers are one
machine's and will vary on another; the shape is the point. Braid's time
grows with rows + detail rows; the naive version's grows with rows × detail
rows, so the gap widens every time either side of that product grows. It's
already worth having at a few hundred rows and compounds from there.

Run it yourself, optionally with a starting row count:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/performance.ts 2000
```

`tests/performance.test.ts` turns the same shape into a regression guard
rather than a benchmark: 10,000 main rows across three joins has to finish
in under 1,000ms, which is well inside a quadratic budget but would fail
immediately if a change accidentally reintroduced a per-row scan.

## The memory trade

Braid trades space for time. While `.run()` is executing it holds one `Map`
per join (the index) on top of the output rows both approaches produce
anyway, so its peak heap is higher than the naive version's:

| rows   | naive peak | braid peak | naive held | braid held |
| ------ | ---------- | ---------- | ---------- | ---------- |
| 100    | 116 KB     | 195 KB     | 53 KB      | 60 KB      |
| 1,000  | 1.0 MB     | 1.3 MB     | 524 KB     | 565 KB     |
| 4,000  | 4.1 MB     | 4.8 MB     | 2.0 MB     | 2.2 MB     |
| 8,000  | 4.9 MB     | 9.3 MB     | 4.1 MB     | 4.3 MB     |
| 16,000 | —          | 18.4 MB    | —          | 8.7 MB     |

That memory is transient. The indexes become unreachable the instant
`.run()` returns (nothing holds a reference to them afterwards), so what's
*retained* once the result is the only thing left standing is close between
the two approaches at every scale measured, because by then both are holding
the same output rows. Peak heap is the real cost, not held heap.

If peak memory rather than time is the binding constraint (a
memory-constrained runtime, a very large one-off join), the naive scan is
the cheaper tool for that specific trade-off, and Braid is the wrong one to
reach for.

## Next steps

- [Declaring joins](declaring-joins) covers the fields that shape each
  join's index.
- [Braid API](../reference/api): `groupBy` and `indexBy`, the two indexing
  functions Braid uses internally, are exported directly for when you want
  the `Map` itself rather than a stitched row.
