---
title: "The main collection"
description: "What .main() declares, why only one is allowed, and how key extraction works."
---

`.main()` declares the driving collection. One output row is produced per
item in it, in source order, and each output row is a shallow copy: Braid
never mutates your input arrays or their elements.

```ts
new Braid().main({
	name: "product",
	source: products,
	key: (product) => product.sku,
});
```

## Fields

| field    | type                     | required | description                                                              |
| -------- | ------------------------ | -------- | ------------------------------------------------------------------------- |
| `name`   | `string`                 | no       | Informational label used in error messages. Doesn't affect the output shape. |
| `source` | `BraidSource<T>`         | yes      | The driving collection: an array, a promise, another braid, or a function returning either. |
| `key`    | `(item: T) => BraidKey`  | yes      | Default key extractor, used by any `.join()` that doesn't specify its own. |
| `as`     | `string`                 | no       | Nests the main row under this property instead of spreading it across the top level. |

`name` shows up in `required`-join error messages (`"no match was found for
product row with key ..."`) so it's worth setting on any braid where you'll
be reading those messages later. It defaults to the word `"main"` if you
leave it out.

`source` accepts more than a plain array: a promise, another braid, or a
function returning either all work too. See [Async sources](async-sources)
for when each of those keeps `.run()` synchronous, and
[Composing braids](composing-braids) for using another braid as `source`.
`as` is covered in full, including why it's what lets braids compose, in
[Configuration](../reference/configuration#as-spread-or-nested) and
[Composing braids](composing-braids).

## Only one main collection

A second `.main()` call throws, rather than replacing the first:

```ts
const builder = new Braid().main({ source: products, key: (p) => p.sku });

builder.main({ source: otherProducts, key: (p) => p.id });
// BraidError: A main collection is already defined. Call .main() once per
// Braid instance.
```

This is also a compile error: `.main()`'s `this` type only accepts a builder
that has no main collection yet, so a second call doesn't type-check before
it ever runs. Silently replacing the main collection would invalidate every
join already configured against the old row type, so Braid rejects it
outright instead of guessing which behavior you meant.

## Keys must be primitives

```ts
export type BraidKey = string | number | bigint | boolean | symbol | null | undefined;
```

Joining on object references would technically work (`Map` can key on
anything), but it matches by identity, which silently fails the moment the
two sides come from different fetches: two structurally identical objects
from two different API calls are never `===` to each other. Derive a
primitive key instead, including for composite keys built from more than one
field. See [Composite and derived keys](composite-and-derived-keys).

## Validation

`.main()` validates its config immediately, so a mistake surfaces at the call
that made it rather than later at `.run()`:

```ts
new Braid().main({ source: "not an array", key: (p) => p });
// BraidError: .main() requires a `source` array, promise, braid, or a
// function returning one.

new Braid().main({ source: products });
// BraidError: .main() requires a `key` function, e.g. { key: (row) => row.id }.
```

## Empty and no-join cases

An empty `source` array yields an empty result, and a braid with no `.join()`
calls at all is just a shallow copy of the main collection:

```ts
new Braid().main({ source: products, key: (p) => p.sku }).run();
// [{ id: 1, sku: "TEE-BLK", title: "Black tee" }, ...] — same shape as
// `products`, but new objects.
```
