---
title: "Overview"
description: "Why Braid exists: replacing nested .find() calls with indexed, O(n + m) joins behind a type-safe fluent builder."
---

Braid stitches one main collection together with any number of related detail
collections. You declare what each detail source is and how it joins to the
main collection; Braid indexes each source once into a `Map` and does a single
lookup per row.

## The problem

The alternative is a `.map()` over the main collection with a `.find()` or
`.filter()` per detail source, inlined into the object literal for each row:

```ts
const rows = products.map((product) => ({
	...product,
	bigcommerce: bcProducts.find((bc) => bc.sku === product.sku) ?? null,
	shopify: shopifyProducts.find((sp) => sp.sku === product.sku) ?? null,
	variations: variations.filter((v) => v.productId === product.id),
}));
```

This shape gets copy-pasted into every project that pulls a record from more
than one source, for a few reasons:

- The cost is quadratic: each `.find()` or `.filter()` rescans its whole
  array for every row of the main collection, so it's O(n × m), n main rows
  times m detail rows, per detail source. On the same shape, measured at
  4,000 main rows against 52,000 detail rows, that's about 761ms naive
  against about 2ms braided; see [Performance and indexing](guides/performance)
  for the full table.
- It gets harder to read with each source added. Three joins means three
  inline lookups competing for space inside one object literal.
- Nothing stops a typo in a key comparison, a copy-pasted `.find()` that
  should have been `.filter()`, or two sources where one treats an id as a
  string and the other as a number. All three show up as bad data, not a
  compile error.

## The indexed-join idea

Braid does the same work with a different shape. Each detail source is
indexed exactly once, into a `Map` keyed by the join's key extractor. Looking
up a match for a given main row is then a single `Map.get()`, so a braid of
one main collection and three detail collections costs O(n + m₁ + m₂ + m₃)
instead of O(n × (m₁ + m₂ + m₃)):

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
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		key: (product) => product.id,
		type: "many",
	})
	.run();
```

The declarative shape also gives the type system something to work with. The
builder accumulates types as it goes: `.main()` fixes the row and key types,
and each `.join()` widens the output row with its own property while
recording its name. A reused join name, a detail key whose type doesn't match
the main key's, or a join declared before there's a main collection to attach
it to are all compile errors rather than shape surprises discovered at
runtime. See [Type safety](guides/type-safety) for the full set.

Braid has zero runtime dependencies and ships as TypeScript source rather
than a compiled `.d.ts` shadow. See [Installation](installation) for what
that means for your build.

## Where to go next

- [Installation](installation) to add the package.
- [Quick Start](quick-start) for a complete worked example.
- [The main collection](guides/main-collection) and
  [Declaring joins](guides/declaring-joins) for the two building blocks.
- [Performance and indexing](guides/performance) for the mechanics behind the
  O(n + m) claim, with numbers.
