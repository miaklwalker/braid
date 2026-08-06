---
title: "Key equality and nullish keys"
description: "How Braid compares keys, why nullish keys never match, and how to catch a quoted-vs-unquoted id mismatch."
---

## SameValueZero

Keys are compared the way `Map` compares them: SameValueZero, which is
`===` with one deliberate difference. There is no loose comparison anywhere
in Braid:

| main key | detail key | matches? |                                     |
| -------- | ---------- | -------- | ------------------------------------ |
| `"2"`    | `2`        | no       | no coercion, unlike `==`             |
| `2`      | `2n`       | no       | a bigint is not a number             |
| `1`      | `true`     | no       |                                       |
| `NaN`    | `NaN`      | **yes**  | SameValueZero, unlike `===`          |
| `0`      | `-0`       | **yes**  | SameValueZero, unlike `Object.is`    |

Falsy-but-real keys like `0` and `""` still match normally: they're valid
keys, not nullish ones:

```ts
new Braid()
	.main({ source: [{ id: 0, title: "zero" }], key: (p) => p.id })
	.join({ name: "detail", source: [{ ref: 0, label: "hit" }], on: (d) => d.ref, type: "single" })
	.run();
// [{ id: 0, title: "zero", detail: { ref: 0, label: "hit" } }]
```

## When both sides are typed, mismatches are compile errors

When both sides are properly typed, a `"2"`/`2` mismatch is a compile
error: that's what the key-type check on `on` is for. See
[Type safety](type-safety#mismatched-key-types). The case to watch is data
that arrives as `string | number` or `any`, typically JSON from two
platforms that disagree about whether ids are quoted. Nothing fails at
compile time or at runtime: every affected row just silently takes its
default.

Two ways to catch it:

```ts
// Normalize in the extractors — they're functions, so this is the natural place.
.join({
	name: "dbProduct",
	source: dbProducts,
	on: (p) => String(p.id),
	key: (row) => String(row.productId),
	type: "single",
})

// Or make the mismatch loud instead of silent.
.join({ name: "dbProduct", source: dbProducts, on: (p) => p.id, type: "single", required: true })
```

`required: true` turns a wholesale miss into a throw naming the first key
that found nothing, which is usually enough to spot that one side is quoted:

```text
Join "dbProduct" is required, but no match was found for listing row with key "2".
```

## Nullish keys never match

A key of `null` or `undefined` means "this row has nothing to join on."
Braid skips nullish keys on both sides rather than indexing them like any
other value:

```ts
new Braid()
	.main({ source: [{ sku: undefined, title: "orphan" }], key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: [{ sku: undefined, bcId: 7 }],
		on: (bc) => bc.sku,
		type: "single",
	})
	.run();
// [{ sku: undefined, title: "orphan", bigcommerce: null }]
```

Even though both the main row and the detail row have `sku: undefined`, they
don't match: the row takes the `single` default of `null` instead.

Indexing nullish keys literally (treating `undefined` as just another key
value) is the more obvious behavior, but it braids every keyless row on one
side onto every keyless row on the other. That looks fine in a
small fixture with one or two nullish rows and produces nonsense in
production, where "no id yet" or "id not synced" rows can number in the
hundreds. Skipping nullish keys means a row with nothing to join on
predictably takes its default (or trips `required`) instead.

This applies to `groupBy` and `indexBy` too, since the joins are built on
top of them. See [Performance and indexing](performance).
