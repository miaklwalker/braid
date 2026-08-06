---
title: "Composing braids"
description: "How `as` nests a braid's own output so it can feed another braid as a main or join source, worked through examples/compose.ts end to end."
---

## What composing means

Braid stitches one main collection with any number of detail collections and
produces an array of stitched rows. Because that array (or, unresolved, the
braid itself) is just another `BraidSource`, a stitched result can be fed
straight into a second braid's `.main()` or `.join()`. Composing means
building small, single-concern braids and then joining their *outputs*
together in a further braid, rather than trying to express every relationship
in one braid with a long list of joins.

Two braids that each stitch one concern (what the sales channels know about
a listing, what the database knows about the product behind it) can be
combined by a third braid that treats each of the first two as a source.
Every braid is `PromiseLike` (see [Async sources](async-sources)), and
`.main()` and `.join()` both accept anything `PromiseLike`, so a configured
`Braid` instance satisfies `BraidSource` directly. There's no separate
compose API: it's the same `.main()` and `.join()` you already use.

## Why `as` makes composition possible

By default a braid spreads its main row across the top level of each output
row: `row.sku`, `row.title`, and every join's own property, side by side.
That's the right shape when the braid is the last stop for a row of data.
It's the wrong shape when the row is going to feed *another* braid, because
the outer braid may be composing two inner braids whose main rows share field
names (`sku`, `id`, `name`) and spreading both onto the same row would mean
one silently overwriting the other, with no compile error or warning.

`.main()`'s `as` option nests the main row under a property instead of
spreading it:

```ts
new Braid().main({ source: listRows, key: (row) => row.sku, as: "listRow" });
// row.listRow.sku, row.listRow.title — not row.sku, row.title
```

Give each inner braid a distinct `as`, and their outputs can sit on the same
outer row without colliding. That's the whole mechanism composition relies
on.

## A worked example

`examples/compose.ts` builds three braids: two independent ones, and a third
that stitches their results together. Run it directly:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/compose.ts
```

### The data

```ts
interface ListRow {
	sku: string;
	title: string;
}

interface ChannelItem {
	sku: string;
	listingId: string;
	price: number;
}

interface DbProduct {
	id: number;
	sku: string;
	name: string;
}

interface DbSku {
	productId: number;
	code: string;
	stock: number;
}

const listRows: ListRow[] = [
	{ sku: "TEE-BLK", title: "Black tee" },
	{ sku: "MUG-RED", title: "Red mug" },
	{ sku: "CAP-GRN", title: "Green cap" },
];

const dbProducts: DbProduct[] = [
	{ id: 1, sku: "TEE-BLK", name: "Black tee" },
	{ id: 2, sku: "MUG-RED", name: "Red mug" },
];

const dbSkus: DbSku[] = [
	{ productId: 1, code: "TEE-BLK-S", stock: 4 },
	{ productId: 1, code: "TEE-BLK-M", stock: 0 },
	{ productId: 2, code: "MUG-RED", stock: 12 },
];

async function fetchChannelOne(): Promise<ChannelItem[]> {
	return [
		{ sku: "TEE-BLK", listingId: "C1-1", price: 19 },
		{ sku: "MUG-RED", listingId: "C1-2", price: 9 },
	];
}

async function fetchChannelTwo(): Promise<ChannelItem[]> {
	return [{ sku: "TEE-BLK", listingId: "C2-1", price: 21 }];
}
```

`CAP-GRN` deliberately has no row in `dbProducts` and no channel listings at
all: the point of the exercise is seeing how the composed braid handles a
main row that's missing from both inner braids at once.

### The two inner braids

Each nests its main row under its own `as`, so their fields can't collide
once a third braid puts them on the same row:

```ts
import { Braid } from "@michaelrwalker/braid";

const listings = new Braid()
	.main({ name: "listRow", source: listRows, key: (row) => row.sku, as: "listRow" })
	.join({ name: "channelOne", source: () => fetchChannelOne(), on: (item) => item.sku, type: "single" })
	.join({ name: "channelTwo", source: () => fetchChannelTwo(), on: (item) => item.sku, type: "single" });

const catalog = new Braid()
	.main({ name: "product", source: dbProducts, key: (product) => product.id, as: "product" })
	.join({ name: "skus", source: dbSkus, on: (dbSku) => dbSku.productId, type: "many" });
```

Neither `listings` nor `catalog` has been run yet. `.main()` and `.join()`
only build up configuration. `listings`'s own output row type is
`{ listRow: ListRow; channelOne: ChannelItem | null; channelTwo: ChannelItem | null }`;
`catalog`'s is `{ product: DbProduct; skus: DbSku[] }`.

### The outer braid

```ts
const combined = await new Braid()
	.main({ source: listings, key: (row) => row.listRow.sku, as: "listing" })
	.join({
		name: "catalog",
		source: catalog,
		on: (row) => row.product.sku,
		type: "single",
	})
	.run();
```

Passing `listings` and `catalog` as sources is what runs them: both start
resolving concurrently, the same way any two async sources on one braid do
(see [Async sources](async-sources)). The outer `.main()` also nests its own
row under `as: "listing"`, so the final shape is `listing` (itself
`{ listRow, channelOne, channelTwo }`) sitting next to `catalog`
(`{ product, skus } | null`, since it's a `single` join without `required`).

### Reading the result

```ts
for (const row of combined) {
	const channels = [row.listing.channelOne, row.listing.channelTwo]
		.filter((item) => item !== null)
		.map((item) => `${item.listingId} @ ${item.price}`);

	const stock =
		row.catalog?.skus.reduce((total, dbSku) => total + dbSku.stock, 0) ?? 0;

	console.log(
		`${row.listing.listRow.sku} ${row.listing.listRow.title} ` +
			`channels: ${channels.join(", ") || "none"} ` +
			`catalog: ${row.catalog === null ? "unlisted" : `${row.catalog.skus.length} skus, ${stock} in stock`}`,
	);
}
```

Running `examples/compose.ts` prints:

```text
TEE-BLK  Black tee   channels: C1-1 @ 19, C2-1 @ 21         catalog: 2 skus, 4 in stock
MUG-RED  Red mug     channels: C1-2 @ 9                     catalog: 1 skus, 12 in stock
CAP-GRN  Green cap   channels: none                         catalog: unlisted

typed access: { sku: 'TEE-BLK', price: 19, code: 'TEE-BLK-S' }
```

`CAP-GRN` has no channel listings and no row in `dbProducts`: `channelOne`
and `channelTwo` are both `null`, and `catalog` is `null` too, without a
single explicit null check beyond what the types already required. Every
field survives the round trip typed: `row.listing.channelOne?.price` is
`number | undefined`, `row.catalog?.skus[0]?.code` is `string | undefined`,
checked exactly the way any other join's output would be.

## How keys work across a composition

Two things are worth being precise about, because they're easy to get
backwards.

**Each braid's own key extractors still see its own raw rows, `as` or not.**
`listings`'s `.main({ key: (row) => row.sku, as: "listRow" })` receives a
plain `ListRow`, never the nested `{ listRow: ... }` wrapper: nesting only
changes the *output* shape, not what a key function is handed. That's true
at every level of a composition, inner or outer.

**A braid used as a source hands the outer braid its already-stitched rows,
not its raw main rows.** The type the outer `.main()`'s `key` extractor
receives is `listings`'s own output row, `{ listRow, channelOne, channelTwo }`,
so `key: (row) => row.listRow.sku` has to reach through the `listRow`
property that `as` created. `key: (row) => row.sku` wouldn't compile, because
by the time the outer braid sees a row, the raw `ListRow` no longer sits at
the top level. The same is true of a join's `on`: `on: (row) => row.product.sku`
reaches into `catalog`'s nested main row the same way.

In short, `as` determines what property name a *later* braid's key
extractors have to read through. Picking a clear `as` for each inner
braid (`listRow`, `product`) is what keeps those extractors readable
instead of guessing at an anonymous shape.

## The alias-collision compile error

Once `.main()` has an `as`, no `.join()` on the same builder can reuse that
name: it would silently overwrite the nested main row instead of sitting
next to it. This is exactly the kind of collision `as` exists to prevent, so
it's rejected the same way a duplicate join name is: at compile time, and
again at runtime.

```ts
new Braid()
	.main({ source: listRows, key: (row) => row.sku, as: "listing" })
	// @ts-expect-error "listing" is already the main row's alias
	.join({ name: "listing", source: dbProducts, on: (p) => p.sku, type: "single" });
```

At runtime this throws:

```text
The main collection is already attached as "listing", so a join can't use
that name too.
```

The reverse order is checked too: giving `.main()` an `as` that a `.join()`
on the same builder already used throws from `.main()` instead, naming the
join. See [Type safety](type-safety#reserved-the-main-rows-as-name) for the
compile-time mechanism (`RejectMainAliasCollision`) and
[Errors](../reference/errors) for both exact messages.

## Composition inherits the rest of Braid

Nothing about being a source changes once a braid is playing that role:

- The outer braid is async, because a `PromiseLike` source always is. See
  [Async sources](async-sources).
- A `required: true` join against a braid source throws the same
  `BraidError` a miss against a plain array would.
- Each inner braid still indexes its own sources exactly once, and
  independent inner braids run concurrently with each other, resolved
  through the same `Promise.all` as any other set of async sources.
- A braid runs once per outer `.run()`, with no memoization. If the same
  configured braid is meant to feed two different outer braids, `await` it
  once and pass the resulting array to both, rather than passing the braid
  itself twice.

## Next steps

- [Async sources](async-sources) covers what makes a source async in the
  first place, including the mechanics a composed braid relies on.
- [Configuration](../reference/configuration#as-spread-or-nested) has the
  full field-by-field behavior of `as`.
- [Braid API](../reference/api#braidsource) has the `BraidSource` type
  signature that makes a braid a valid source.
