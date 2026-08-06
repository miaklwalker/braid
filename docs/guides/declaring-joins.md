---
title: "Declaring joins"
description: "Every field .join() accepts, and how joins compose independently on the builder."
---

`.join()` adds a detail collection, attached to every output row under
`name`. Joins are independent of each other and chainable: declaring a
fourth join doesn't change how the first three behave.

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
	})
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		key: (product) => product.id,
		type: "many",
	});
```

## Fields

| field      | type                                          | required | default                              | description                                                     |
| ---------- | ---------------------------------------------- | -------- | ------------------------------------- | ----------------------------------------------------------------- |
| `name`     | `string`                                       | yes      | —                                     | Property name the result is attached under on each output row.    |
| `source`   | `BraidSource<D>`                               | yes      | —                                     | Detail collection: an array, a promise, another braid, or a function returning either. |
| `on`       | `(item: D) => BraidKey`                        | yes      | —                                     | Key extractor for the detail rows.                                 |
| `key`      | `(item: T) => BraidKey`                        | no       | the main collection's `key`           | Overrides which key on the main row this join matches against.     |
| `type`     | `"single"` \| `"many"`                         | yes      | —                                     | One matching row, or an array of them.                             |
| `default`  | `D` \| `D[]` \| `null`                         | no       | `null` for `single`, `[]` for `many`  | Value used when nothing matches.                                   |
| `required` | `boolean`                                      | no       | `false`                               | Throw if any main row finds no match.                              |

`type` has no default and is never inferred. See
[Single vs many](single-vs-many) for why. `default` and `required` are
covered in full in [Defaults and required joins](defaults-and-required).
`source` also accepts a promise or another `Braid` instance, not only an
array or a fetcher. See [Async sources](async-sources) for the mechanics
and [Composing braids](composing-braids) for joining against another
braid's result.

## Indexing, not scanning

Each join's `source` is indexed exactly once into a `Map`, before any main
row is processed. Adding a fourth join costs one more pass over one more
collection, not another scan per main row. See
[Performance and indexing](performance) for the mechanics and measured
numbers.

## Overriding the key

By default, a join matches against the main collection's own `key`. Pass
`key` on the join config to match against a different field instead, useful
when different detail sources reference the main row differently:

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		// The channel manager keys off the internal id, not the SKU.
		key: (product) => product.id,
		type: "many",
	});
```

`key` must produce the same primitive type as `on`. See
[Type safety](type-safety) for what happens when it doesn't.

## Validation

Like `.main()`, `.join()` validates its config at the call that made it, not
at `.run()`:

```ts
withMain().join({ source: bcProducts, on: (bc) => bc.sku, type: "single" });
// BraidError: .join() requires a non-empty `name` string.

withMain().join({ name: "bigcommerce", on: (bc) => bc.sku, type: "single" });
// BraidError: Join "bigcommerce" requires a `source` array, promise, braid,
// or a function returning one.

withMain().join({ name: "bigcommerce", source: bcProducts, type: "single" });
// BraidError: Join "bigcommerce" requires an `on` function, e.g.
// { on: (row) => row.productId }.

withMain().join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku });
// BraidError: Join "bigcommerce" requires `type` to be "single" or "many",
// got undefined.

withMain().join({
	name: "bigcommerce",
	source: bcProducts,
	on: (bc) => bc.sku,
	key: "sku",
	type: "single",
});
// BraidError: Join "bigcommerce" was given a `key` that is not a function.
```

A reused join name throws too, because join names become properties on the
output row and two joins sharing a name would silently overwrite each other:

```ts
withMain()
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" });
// BraidError: A join named "bigcommerce" is already defined. Join names
// become properties on the output row, so they must be unique.
```

This one is also a compile error. See
[Type safety](type-safety#duplicate-join-names).

The same restriction applies to the property the main row is nested under,
if `.main()` was given an `as`: a join can't take that name either, for the
same reason. See [Composing braids](composing-braids#the-alias-collision-compile-error).
