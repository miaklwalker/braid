---
title: "Single vs many"
description: "The match table behind type: \"single\" and type: \"many\", and why the type is explicit rather than guessed."
---

Every join declares `type: "single"` or `type: "many"`. There's no default
and no inference. You say which one you mean.

## Why it's explicit

Guessing `single` vs `many` from whether keys repeat in the data you happen
to have is fragile: a genuine one-to-many relationship looks one-to-one in
any dataset where the keys are unique, and the output shape would silently
change the day it isn't. A products table with one variation each looks
exactly like a one-to-one join — until a second variation shows up and the
property that used to be an object is suddenly an array, breaking every
caller that read it as one. Declaring `type` up front makes the shape a
decision, not an accident of the current dataset.

## What lands on the row

| situation                                 | `single`                     | `many`                            |
| ------------------------------------------ | ----------------------------- | ----------------------------------- |
| one match                                  | the detail row                | `[row]`                             |
| several matches                            | the **last** one wins         | all of them, in source order        |
| no match                                   | `default` (default `null`)    | `default` (default a fresh `[]`)    |
| no match, `required: true`                 | throws                        | throws                              |
| main key is `null` or `undefined`          | treated as no match           | treated as no match                 |

Three behaviors here are worth knowing about in advance rather than
discovering in production:

- **Last write wins** for `single` joins when several detail rows share a
  key. That ambiguity lives in the data, not in Braid, so it takes the
  simple, documented rule rather than trying to be clever about it. Use
  `type: "many"` if the duplicates are meaningful and you need all of them.
- **Nullish keys never match.** A row whose key is `null` or `undefined` has
  nothing to join on, so it takes the default. See
  [Key equality and nullish keys](key-equality) for why Braid skips nullish
  keys entirely rather than matching them to each other.
- **Keys match strictly**, through `Map` lookups: no `==`-style coercion
  anywhere. See [Key equality and nullish keys](key-equality) for the exact
  rules and the two-platform failure mode that strict matching produces.

## `single`

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
	})
	.run();
```

`row.bigcommerce` is `BcProduct | null` by default: one detail row, or the
default if nothing matched. If two `bcProducts` rows share a `sku`, the
second one in source order is what ends up on the row.

## `many`

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		key: (product) => product.id,
		type: "many",
	})
	.run();
```

`row.variations` is `Variation[]`, always an array, in source order. A
product with no variations gets `[]`, not `null`. See
[Defaults and required joins](defaults-and-required) for why each unmatched
row gets its own fresh array rather than sharing one.
