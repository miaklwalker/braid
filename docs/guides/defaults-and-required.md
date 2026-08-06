---
title: "Defaults and required joins"
description: "What a join falls back to when nothing matches, and how required turns a miss into a thrown error."
---

## `default`

`default` is the value used when a main row's key finds no match. It defaults
to `null` for `single` joins and a fresh `[]` for `many` joins. You don't
need to pass it just to get ordinary null-safety.

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
		default: { sku: "", bcId: -1, price: 0 },
	})
	.run();
```

Passing an explicit `default` widens the join's type to include it:
`row.bigcommerce` becomes `BcProduct | { sku: string; bcId: number; price:
number }` (which TypeScript collapses to `BcProduct` here since the shapes
match, but a differently-shaped default, like a string sentinel, shows up as
its own member of the union). See
[Type safety](type-safety#defaults-in-the-type) for how that's tracked.

### Sharing vs. fresh values

For `many` joins specifically, the default you get without passing one
matters: **when you don't supply a `default`, each unmatched row gets its own
empty array**, so mutating one row's result can't affect another:

```ts
const rows = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "variations",
		source: [],
		on: (v) => v.productId,
		key: (p) => p.id,
		type: "many",
	})
	.run();

rows[0].variations.push({ productId: 1, option: "added", stock: 1 });
rows[1].variations.length; // 0 — unaffected
```

When you *do* supply a `default`, that exact value is reused for every
miss: every unmatched row gets a reference to the same array or object.
Share it only if you mean to; if callers might mutate the result, pass a
fresh value per call or freeze it.

## `required`

`required: true` turns a miss into a thrown `BraidError` instead of falling
back to the default. Use it where a missing match means the data is wrong,
not where a missing match is an expected, handleable case:

```ts
new Braid()
	.main({ name: "order", source: orders, key: (order) => order.reference })
	.join({
		name: "customer",
		source: customers,
		on: (customer) => customer.id,
		key: (order) => order.customerId,
		type: "single",
		// Every order must belong to a customer; a miss here is a data bug worth
		// failing on rather than a null to handle downstream.
		required: true,
	});
```

The thrown error names the join and the offending key, which is usually
enough to find the row on its own:

```text
Join "customer" is required, but no match was found for order row with key 7.
```

(If `.main()` didn't set a `name`, the message says `"main row"` instead of
naming the collection.)

`required` also changes the join's type: it drops the default from the
union, so a required `single` join is typed as `D` rather than `D | null`,
and a required `many` join is typed as `D[]` with no alternate default,
because a required join either matched or the call already threw. See
[Type safety](type-safety#required-narrows-the-type).

### `required` and async sources

`required` throws through the async path the same way: a rejected
`.run()` promise, not a differently-shaped error:

```ts
try {
	await new Braid()
		.main({ name: "order", source: orders, key: (order) => order.reference })
		.join({
			name: "shipments",
			source: fetchShipments,
			on: (shipment) => shipment.orderReference,
			type: "many",
			required: true,
		});
} catch (error) {
	if (!(error instanceof BraidError)) throw error;
	console.log(`Caught as expected: ${error.message}`);
}
```
