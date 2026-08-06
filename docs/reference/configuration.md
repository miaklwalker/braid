---
title: "Configuration"
description: "Every field on .main() and .join(), table by table, plus what lands on each output row for single and many joins."
---

This page is the field-by-field reference. For the reasoning behind each
field, see [The main collection](../guides/main-collection) and
[Declaring joins](../guides/declaring-joins).

## `.main()` config

| field    | type                              | required | default    | description                                                                 |
| -------- | ---------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------- |
| `name`   | `string`                           | no       | `"main"`   | Informational label used in `required`-join and unresolved-source error messages. Doesn't affect the output shape. |
| `source` | `BraidSource<T>`                   | yes      | —          | The driving collection: an array, a promise, another braid, or a function returning either. One output row is produced per item, in source order. |
| `key`    | `(item: T) => BraidKey`            | yes      | —          | Default key extractor, used by any `.join()` that doesn't specify its own `key`. |
| `as`     | `string`                           | no       | —          | Nests the main row under this property instead of spreading it across the top level. |

`source` accepts more than an array. See
[Async and composed sources](#async-and-composed-sources) below.

Calling `.main()` a second time on the same builder throws rather than
replacing the first collection. See [Errors](errors) for the exact message.

### `as`: spread or nested

By default the main row is spread across the top level of each output row:
`row.sku`, `row.title`, and so on sit alongside each join's property. Give
`.main()` an `as` and the main row is nested under that property instead:

```ts
new Braid().main({ source: products, key: (p) => p.sku, as: "product" });
// row.product.sku, row.product.title — main row's own fields moved off the top level
```

Two things behave differently once `as` is set:

- **Key extractors still receive the raw main row**, not the nested
  wrapper: `key: (p) => p.id` reads the same whether or not `as` is set.
- **Spreading copies each main row; nesting doesn't.** `row[as]` is the
  original source object by reference, the same treatment a joined detail
  row already gets. Braid still never writes to it, but a mutation of
  `row.product` under `as` is a mutation of your source data.

Nesting is required to compose braids without field collisions. See
[Async sources](../guides/async-sources) and the README's "Composing
braids" section. It's also useful any time the main collection and a join
share field names and spreading them onto one object would mean one
silently overwriting the other.

A join can't reuse the name the main row is nested under. See
[Type safety](../guides/type-safety#reserved-the-main-rows-as-name).

## `.join()` config

| field      | type                                              | required | default                              | description                                                            |
| ---------- | -------------------------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `name`     | `string`                                           | yes      | —                                     | Property name the result is attached under on each output row.            |
| `source`   | `BraidSource<D>`                                   | yes      | —                                     | Detail collection: an array, a promise, another braid, or a function returning either. |
| `on`       | `(item: D) => BraidKey`                            | yes      | —                                     | Key extractor for the detail rows.                                        |
| `key`      | `(item: T) => BraidKey`                            | no       | the main collection's `key`           | Overrides which key on the main row this join matches against.            |
| `type`     | `"single"` \| `"many"`                             | yes      | —                                     | One matching row, or an array of them. Never inferred, always explicit.  |
| `default`  | `D` \| `D[]` \| `null` \| any value                | no       | `null` for `single`, `[]` for `many`  | Value used when nothing matches.                                          |
| `required` | `boolean`                                          | no       | `false`                               | Throw instead of falling back to `default` if any main row finds no match.|

`name` must be unique across all joins on the same builder, and can't be the
name the main row is nested under (its `as`, if any), either one throws
(and fails to compile; see
[Type safety](../guides/type-safety#duplicate-join-names)).

`on` and `key` must produce the same primitive type: `BraidKey`, meaning
`string | number | bigint | boolean | symbol | null | undefined`. A mismatch
between them is caught at compile time when both sides are properly typed;
see [Key equality and nullish keys](../guides/key-equality) for the case
where it isn't (loosely typed data).

`default`, if provided, is used verbatim for every unmatched row: the same
reference or value each time. If omitted, `many` joins give each unmatched
row its own fresh `[]`, so mutating one row's result can't leak into
another's; `single` joins fall back to `null`. See
[Defaults and required joins](../guides/defaults-and-required).

## What lands on the row

The full match table, for both join types:

| situation                          | `single`                    | `many`                            |
| ----------------------------------- | ---------------------------- | ------------------------------------ |
| one match                           | the detail row                | `[row]`                              |
| several matches                     | the **last** one wins         | all of them, in source order         |
| no match                            | `default` (default `null`)    | `default` (default a fresh `[]`)     |
| no match, `required: true`          | throws `BraidError`           | throws `BraidError`                  |
| main row's key is `null`/`undefined`| treated as no match            | treated as no match                  |
| detail row's key is `null`/`undefined` | that detail row is skipped entirely; it can never match anything | same |

A nullish key on *either* side is never indexed and never matches. See
[Key equality and nullish keys](../guides/key-equality) for why Braid skips
nullish keys rather than matching them to each other.

"Several matches" only applies within one join's own detail source: if two
different detail rows in the *same* array share a key, `single` keeps the
last one in source order and `many` keeps all of them, also in source order.

## Async and composed sources

`source` on both `.main()` and `.join()` accepts any `BraidSource<T>`: an
array, a promise, a function, or another `Braid` (every braid is thenable,
so it satisfies the promise case directly):

| `source` shape                     | that source is | whole braid's `.run()`      |
| ------------------------------------ | --------------- | ------------------------------ |
| an array                             | sync             | stays sync if every source is  |
| a promise                            | async            | becomes a promise              |
| a function returning an array        | async            | becomes a promise               |
| a function returning a promise       | async            | becomes a promise               |
| another `Braid`                      | async            | becomes a promise               |

One non-array source anywhere in the chain (main collection or any
join) makes `.run()` return a `Promise` for the whole braid, regardless of
which source it was. See [Async sources](../guides/async-sources) for the
mechanics, what "async" means for a source that doesn't actually await
anything, and using a braid as another braid's source.

## Validation timing

Both `.main()` and `.join()` validate their own config at the call that made
it, not later at `.run()`: a typo in a field name or a wrong type surfaces
immediately. The only checks deferred to `.run()` are the ones that need
resolved data to evaluate: whether a source resolved to an array once
awaited, and whether every `required` join actually found a match. See
[Errors](errors) for the complete list of what throws where.
