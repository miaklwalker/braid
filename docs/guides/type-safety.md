---
title: "Type safety"
description: "How the builder accumulates types across the chain, exactly which misuses are compile errors, and why every one of them is checked again at runtime."
---

`.main()` and `.join()` don't just validate their config at runtime: they
also carry types through the chain, so a whole category of mistakes fails to
compile rather than surfacing later as a wrong shape in the output.

## How types accumulate

`Braid` carries six type parameters, threaded through every `.main()` and
`.join()` call: the main row type, the main key type, the joined-properties
type built up so far, the union of join names used so far, whether any
source has made the result async, and the property name the main row is
nested under (if any).

`.main()` fixes the first two (the row and key types) from the collection
you pass it. Every `.join()` after that widens the joined-properties type
with one more property (`TJoined & { [name]: JoinValue<...> }`) and adds its
`name` to the union of names in use, without touching what earlier joins
already established:

```ts
const builder = new Braid()
	.main({ source: products, key: (p) => p.sku })
	// TMain = Product, TKey = string, TJoined = {}

	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" });
	// TJoined = { bigcommerce: BcProduct | null }, TNames = "bigcommerce"
```

`.run()`'s return type is read straight off this accumulated state: the
main row (spread across the top level, or nested under a property if
`.main()` was given an `as`) intersected with every join's property,
flattened. So annotating a function's return type never means restating
every join by hand. See [`InferBraidRow`](../reference/api#inferbraidrow)
for pulling that type off a configured builder directly.

The sixth parameter, the `as` name, matters beyond typing the output shape:
it's also what a duplicate-name check runs against. A join can't be given
the same `name` the main row is nested under, for the same reason two joins
can't share a name. See
[Reserved: the main row's `as` name](#reserved-the-main-rows-as-name).

## Compile errors

Four mistakes are the core set that fails to compile, plus one more that
follows the same pattern once a main row has an `as` name to protect. Each
is demonstrated in `tests/types.test.ts`, `tests/braid.test.ts`, or
`tests/compose.test.ts` with a `@ts-expect-error` comment pinning the exact
line that fails, and each also throws a `BraidError` at runtime. See
[Runtime re-checks](#runtime-re-checks) for why both exist.

### Duplicate join names

Reusing a `name` across two `.join()` calls on the same builder is a compile
error. `RejectDuplicateJoinName<TName, TUsed>` intersects an impossible
property onto the config type whenever `TName` is already in the accumulated
name union, so the object literal you pass fails to satisfy the parameter
type:

```ts
builder
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
	// @ts-expect-error "bigcommerce" is already defined
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" });
```

The check is deliberately attached to the config object as a whole rather
than to `name` itself: putting it directly on `name`'s type reads better in
theory, but it poisons inference for every other field on the same config,
burying the real error under a pile of "not assignable to `never`" noise.

### Mismatched key types

A join's `on` extractor has to return the same key type the join matches
against on the main side: the main collection's `key`, or the join's own
`key` override if it has one. If it doesn't, the mismatch is reported on
`on`:

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku }) // string
	.join({
		name: "variations",
		source: variations,
		// @ts-expect-error productId is a number, but the main key is a string
		on: (v) => v.productId,
		type: "many",
	});
```

This is why a join's own `key` override matters for typing, not just for
runtime matching: `on`'s expected return type is wrapped in `NoInfer`, so
TypeScript infers the join's key type from `key` alone and then checks `on`
against it: a mismatched `key` re-types which key `on` has to agree with,
rather than the two silently widening to a shared union.

### Joining before a main collection exists

Calling `.join()` before `.main()` has been called can't type-check. With no
main collection yet, the builder's key type is `never`, and a join's key
type defaults to the main key type when no `key` override is given, so `on`
is required to return `never`, which no real function can do:

```ts
new Braid()
	.join({
		name: "bigcommerce",
		source: bcProducts,
		// @ts-expect-error there is no main collection yet, so no key type to match
		on: (bc) => bc.sku,
		type: "single",
	});
```

### A second main collection

`.main()` declares its own `this` type as only accepting a builder whose
main row type is still unset. Once `.main()` has been called, the builder's
`this` no longer matches that type, so a second call fails before it runs:

```ts
const builder = new Braid().main({ source: products, key: (p) => p.sku });

// @ts-expect-error a main collection is already defined
builder.main({ source: otherProducts, key: (p) => p.id });
```

Silently replacing the main collection on a second call would invalidate
every join already configured against the first row type, so this is
rejected outright rather than guessed at.

### Reserved: the main row's as name

If `.main()` was given an `as`, no `.join()` on the same builder can reuse
that name: `RejectMainAliasCollision<TName, TAs>` applies the same
phantom-property trick `RejectDuplicateJoinName` uses, just checked against
the main row's alias instead of the other join names:

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku, as: "product" })
	// @ts-expect-error "product" is already the main alias
	.join({ name: "product", source: bcProducts, on: (bc) => bc.sku, type: "single" });
```

The reason is the same one duplicate join names get rejected for: the join
would silently overwrite the nested main row on the output object instead of
sitting alongside it.

## What's tracked but isn't an error

Two other things the type system tracks are worth knowing, though neither
one is a compile error: they change what a later expression is allowed to
do rather than blocking the `.join()` call itself.

### Defaults in the type

Passing an explicit `default` widens the join's property type to include it.
`row.bigcommerce` becomes `BcProduct | "missing"` if you pass
`default: "missing" as const`, rather than the implicit `BcProduct | null`:

```ts
new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single", default: "missing" as const })
	.run();
// row.bigcommerce: BcProduct | "missing"
```

See [Defaults and required joins](defaults-and-required) for the runtime
behavior behind the type.

### Required narrows the type

`required: true` removes the default from the union entirely: a required
`single` join is typed `D` rather than `D | null`, and a required `many`
join is `D[]` with no alternate default, because by the time you have a
row, a required join either matched or the call already threw:

```ts
new Braid()
	.main({ source: products.slice(0, 2), key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single", required: true })
	.run();
// row.bigcommerce: BcProduct — never null
```

## `joinNames` is typed too

`builder.joinNames` is typed as the union of names actually configured, not
as a plain `string[]`:

```ts
const builder = new Braid()
	.main({ source: products, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku, type: "single" })
	.join({ name: "shopify", source: shopifyProducts, on: (sp) => sp.sku, type: "single" });

type Names = (typeof builder.joinNames)[number];
// "bigcommerce" | "shopify"
```

That's useful for building a lookup keyed on the joins you know exist,
without a plain `string` losing the specific names at the type level.

## Runtime re-checks

Every one of the compile errors above is checked again at runtime, and
throws the same `BraidError` a genuine misconfiguration would:

- A duplicate join name throws `A join named "..." is already defined. Join
  names become properties on the output row, so they must be unique.`
- A second `.main()` throws `A main collection is already defined. Call
  .main() once per Braid instance.`
- A join name colliding with the main row's `as` throws `The main collection
  is already attached as "...", so a join can't use that name too.`

That duplication is intentional rather than incomplete coverage. Types are
erased at build time: the compiled code that actually runs has no idea
`TJoinKey` or `RejectDuplicateJoinName` ever existed, and data arrives from
the network, config files, or `any`-typed layers the compiler never saw. A
mismatched key type between two platforms' JSON payloads, for instance, is
invisible to the compiler the moment either side is typed loosely; see
[Key equality and nullish keys](key-equality) for exactly that failure mode.
The compile-time checks catch mistakes as you write the braid; the runtime
checks catch the same mistakes (and the ones the compiler structurally
can't see) once the code is actually running.

## Next steps

- [Declaring joins](declaring-joins) and
  [The main collection](main-collection) cover the fields these checks
  guard.
- [Errors](../reference/errors) has the exact message for every throw,
  compile-error-backed or not.
