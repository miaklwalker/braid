---
title: "Composite and derived keys"
description: "Why keys must be primitives, and how to build a composite key when one field isn't enough to match on."
---

## Why not object keys

`BraidKey` is restricted to primitives:

```ts
export type BraidKey = string | number | bigint | boolean | symbol | null | undefined;
```

A `Map` can technically key on anything, including an object, so Braid could
have allowed `key: (row) => row.someObject`. It doesn't, on purpose: object
keys match by reference identity, and the moment the main side and the
detail side come from two different fetches, two structurally identical
objects are never `===` to each other. Every row would silently take its
default, which is exactly the class of bug this library exists to prevent.
Derive a primitive key instead.

## Building a composite key

When no single field uniquely identifies a row (a per-store SKU, a
composite of warehouse and bin, a date plus a category), derive one with a
template literal in the key extractor:

```ts
new Braid()
	.main({
		source: storeProducts,
		key: (row) => `${row.storeId}:${row.sku}`,
	})
	.join({
		name: "inventory",
		source: inventoryRows,
		on: (inventory) => `${inventory.storeId}:${inventory.sku}`,
		type: "single",
	});
```

Both extractors are plain functions, so there's no special composite-key API
to learn: this is the same `key` / `on` mechanism used everywhere else,
just producing a string that happens to encode more than one field.

A few things worth being careful about with derived keys:

- **Use a separator that can't appear inside either field**, or a genuinely
  different id (`"1"` + `"23"` and `"12"` + `"3"` both produce `"1:23"` and
  `"12:3"` respectively if the fields could contain digits adjacent to the
  separator; pick a separator, or a fixed-width encoding, that rules this
  out for your data).
- **Normalize before combining** if either field's representation might
  differ between the main and detail side. See
  [Key equality and nullish keys](key-equality) for the quoted-vs-unquoted
  id problem this causes.
- **A composite key is still just one `BraidKey`.** Braid doesn't have a
  multi-field join mode; the template literal *is* the join key as far as
  the index and the lookup are concerned.

## Derived, non-composite keys

The same mechanism works for any derived key, not only composite ones:
normalizing case, trimming whitespace, or converting a type are all just
transformations inside the extractor function:

```ts
.join({
	name: "dbProduct",
	source: dbProducts,
	on: (p) => String(p.id),
	key: (row) => String(row.productId),
	type: "single",
})
```
