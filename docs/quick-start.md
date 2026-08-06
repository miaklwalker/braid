---
title: "Quick Start"
description: "A complete worked example: one product list stitched against two storefronts and a channel manager."
---

This walks through a full braid end to end. It's the shape Braid was written
for: one canonical product list that needs enriching with how two storefronts
and a channel manager see the same items.

## The data

```ts
interface Product {
	id: number;
	sku: string;
	title: string;
}

interface BcProduct {
	sku: string;
	bcId: number;
	price: number;
}

interface ShopifyProduct {
	sku: string;
	handle: string;
}

interface Variation {
	productId: number;
	option: string;
	stock: number;
}

const products: Product[] = [
	{ id: 1, sku: "TEE-BLK", title: "Black tee" },
	{ id: 2, sku: "MUG-RED", title: "Red mug" },
	{ id: 3, sku: "CAP-GRN", title: "Green cap" },
];

const bcProducts: BcProduct[] = [
	{ sku: "TEE-BLK", bcId: 101, price: 19 },
	{ sku: "MUG-RED", bcId: 102, price: 9 },
];

const shopifyProducts: ShopifyProduct[] = [
	{ sku: "TEE-BLK", handle: "black-tee" },
	{ sku: "CAP-GRN", handle: "green-cap" },
];

const variations: Variation[] = [
	{ productId: 1, option: "S", stock: 4 },
	{ productId: 1, option: "M", stock: 0 },
	{ productId: 2, option: "default", stock: 12 },
];
```

Notice the fixtures are deliberately imperfect: `CAP-GRN` has no BigCommerce
row, `MUG-RED` has no Shopify row, and `CAP-GRN` has no variations at all.
That's the normal case for multi-platform data, and it's what the `single`
vs `many` behavior below is for.

## The braid

```ts
import { Braid } from "@michaelrwalker/braid";

const stitched = new Braid()
	.main({
		name: "product",
		source: products,
		// Most detail sources key off the SKU, so that's the default for the braid.
		key: (product) => product.sku,
	})
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
	})
	.join({
		name: "shopify",
		source: shopifyProducts,
		on: (sp) => sp.sku,
		type: "single",
	})
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		// The channel manager keys off the internal id, not the SKU, so this join
		// overrides which field on the main row it matches against.
		key: (product) => product.id,
		type: "many",
	})
	.run();
```

`.main()` declares the driving collection and its default key. Each `.join()`
attaches one detail source under `name`, and the `variations` join overrides
the main-side key with its own `key` because the channel manager's rows
reference the product's internal id, not its SKU.

Every source here is a plain array, so `.run()` returns the stitched array
directly, with no `await` needed. See [Async sources](guides/async-sources) for
what changes when a source is a fetcher instead.

## Using the result

```ts
for (const row of stitched) {
	// `bigcommerce` and `shopify` are `T | null`; `variations` is always an array.
	const listings = [
		row.bigcommerce
			? `bc#${row.bigcommerce.bcId} @ £${row.bigcommerce.price}`
			: "not on BigCommerce",
		row.shopify ? `shopify/${row.shopify.handle}` : "not on Shopify",
	];

	console.log(
		`${row.sku} ${row.title} ${listings.join(", ")} ${row.variations.length} variation(s)`,
	);
}
```

Running this prints:

```text
TEE-BLK  Black tee   bc#101 @ £19, shopify/black-tee               2 variation(s)
MUG-RED  Red mug     bc#102 @ £9, not on Shopify                   1 variation(s)
CAP-GRN  Green cap   not on BigCommerce, shopify/green-cap         0 variation(s)
```

`row.bigcommerce` and `row.shopify` are typed as `BcProduct | null` and
`ShopifyProduct | null`: the compiler already knows a miss is possible,
because `single` joins default to `null` unless you say otherwise.
`row.variations` is typed as `Variation[]`, never `null`, because unmatched
`many` joins default to an empty array rather than a missing value:

```ts
const inStock = stitched.filter((row) =>
	row.variations.some((variation) => variation.stock > 0),
);
```

## Next steps

- [The main collection](guides/main-collection) covers `.main()` in full.
- [Declaring joins](guides/declaring-joins) covers every `.join()` field.
- [Single vs many](guides/single-vs-many) explains the match table behind
  `row.bigcommerce` being nullable and `row.variations` never being.
- [Type safety](guides/type-safety) covers what the compiler catches before
  any of this runs.
