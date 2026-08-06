---
title: "Errors"
description: "Every way Braid throws, when each one fires, and the exact message format, quoted from the source."
---

Braid has exactly one exported error type:

```ts
class BraidError extends Error {
	override name = "BraidError";
}
```

Every validation failure and every `required`-join miss throws or rejects
with a `BraidError`, and every message names the join it came from (or
`.main()` / `.run()` directly, for errors that aren't join-specific).
Configuration mistakes throw at the call that made them (`.main()` or
`.join()`) rather than waiting for `.run()`, so a typo surfaces immediately.

## `.main()`

Checked in this order: the first failing check is the one that throws:

| when                                       | message |
| --------------------------------------------- | ------- |
| `.main()` called a second time                | `A main collection is already defined. Call .main() once per Braid instance.` |
| `source` isn't an array, promise, braid, or function | `.main() requires a \`source\` array, promise, braid, or a function returning one.` |
| `key` is not a function                       | `.main() requires a \`key\` function, e.g. { key: (row) => row.id }.` |
| `as` is provided and is not a non-empty string | `.main() was given an \`as\` that is not a non-empty string.` |
| `as` is already used by a join on this builder | `A join named "${as}" is already defined, so the main collection can't also be attached as "${as}".` |

```ts
new Braid().main({ source: products, key: (p) => p.sku });
// call it again on the same builder:
builder.main({ source: otherProducts, key: (p) => p.id });
// BraidError: A main collection is already defined. Call .main() once per
// Braid instance.
```

The last row is only reachable if a join was somehow added to the builder
before `.main()` was called: normally impossible through valid TypeScript,
since `.join()`'s types require a main collection first (see
[Type safety](../guides/type-safety#joining-before-a-main-collection-exists)).
It exists as a runtime backstop, the same way every compile-time check has
one.

## `.join()`

Checked in this order: the first failing check is the one that throws:

| when                                          | message |
| ------------------------------------------------ | ------- |
| `name` missing, not a string, or empty            | `.join() requires a non-empty \`name\` string.` |
| `name` already used by an earlier join            | `A join named "${name}" is already defined. Join names become properties on the output row, so they must be unique.` |
| `name` is the name the main row is nested under (its `as`) | `The main collection is already attached as "${name}", so a join can't use that name too.` |
| `source` isn't an array, promise, braid, or function | `Join "${name}" requires a \`source\` array, promise, braid, or a function returning one.` |
| `on` is not a function                            | `Join "${name}" requires an \`on\` function, e.g. { on: (row) => row.productId }.` |
| `key` is provided and is not a function           | `Join "${name}" was given a \`key\` that is not a function.` |
| `type` is not `"single"` or `"many"`              | `Join "${name}" requires \`type\` to be "single" or "many", got ${type}.` |
| `required` is provided and is not a boolean       | `Join "${name}" was given a \`required\` that is not a boolean.` |

```ts
withMain().join({ name: "bigcommerce", source: bcProducts, on: (bc) => bc.sku });
// BraidError: Join "bigcommerce" requires `type` to be "single" or "many",
// got undefined.
```

The `${type}` placeholder is rendered with `JSON.stringify` for strings and
`String()` for everything else, so a missing `type` reads as `got
undefined.` and a wrong string reads quoted, e.g. `got "one".`.

Duplicate join names, a second `.main()` call, and a join name colliding
with the main row's `as` are also compile errors. See
[Type safety](../guides/type-safety) for what the type system catches
before any of these runtime checks ever run.

## `.run()`

| when                                                        | message |
| -------------------------------------------------------------- | ------- |
| no `.main()` call has been made                                | `No main collection defined. Call .main({ source, key }) before running the braid.` |
| the main collection's source resolves to a non-array            | `The ${mainName} collection's \`source\` did not resolve to an array.` |
| a join's source resolves to a non-array                         | `Join "${name}"'s \`source\` did not resolve to an array.` |
| a `required` join finds no match for some main row               | `Join "${name}" is required, but no match was found for ${mainName} row with key ${key}.` |

```ts
new Braid()
	.main({ name: "product", source: Promise.resolve({ not: "an array" }), key: (p) => p.sku })
	.run();
// BraidError: The product collection's `source` did not resolve to an array.
```

`${mainName}` is always the `name` passed to `.main()`, or the literal word
`main` if none was given, but the surrounding wording differs by message,
so an unnamed main collection reads `The main collection's \`source\` did
not resolve to an array.` in one case and `... no match was found for main
row with key ...` in the other. `${key}` is the offending main row's key,
rendered the same way as `${type}` above (quoted for strings, plain for
everything else), which is usually enough on its own to spot the row.

```ts
new Braid()
	.main({ name: "product", source: PRODUCTS, key: (p) => p.sku })
	.join({ name: "bigcommerce", source: BC_PRODUCTS, on: (bc) => bc.sku, type: "single", required: true })
	.run();
// BraidError: Join "bigcommerce" is required, but no match was found for
// product row with key "CAP-GRN".
```

In the async case, all three of the `.run()` failures above become a
rejected promise rather than a synchronous throw, but the error is the same
`BraidError` with the same message. See
[Async sources](../guides/async-sources).

## Fetcher rejections are not wrapped

If a source itself rejects (a fetcher's network failure, a thrown error
inside an `async` function, a rejected promise passed directly as `source`,
or a nested braid's own `required` join failing), that rejection propagates
through `.run()`'s promise exactly as produced. It is **not** converted into
a `BraidError`. This applies equally to the main collection's `source` and
to any join's:

```ts
new Braid()
	.main({ source: PRODUCTS, key: (p) => p.sku })
	.join({
		name: "bigcommerce",
		source: (): Promise<readonly BcProduct[]> => Promise.reject(new Error("storefront unreachable")),
		on: (bc) => bc.sku,
		type: "single",
	})
	.run();
// rejects with Error: storefront unreachable — not a BraidError
```

Catching `BraidError` specifically separates "I configured Braid wrong" (or
"a required join found nothing") from "my data source failed": a fetcher's
own error is yours to catch and handle on its own terms, typically alongside
whatever other error handling that fetcher's caller already does.

## Catching `BraidError`

```ts
import { Braid, BraidError } from "@michaelrwalker/braid";

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

Re-throwing anything that isn't a `BraidError` keeps this catch block scoped
to Braid's own failures: a fetcher's rejection or an unrelated bug further
down the chain still propagates normally rather than being silently
swallowed.
