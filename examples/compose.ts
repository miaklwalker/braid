/**
 * Braiding braids.
 *
 * Two concerns are stitched separately — what the sales channels know about a
 * listing, and what the database knows about the product behind it — and then a
 * third braid stitches those two results together.
 *
 * The `as` option is what makes this work. Both inner braids produce rows with
 * their own fields; nesting each one under a name keeps them from colliding
 * when the outer braid puts them on the same row.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/compose.ts
 */

import { Braid } from "../main.ts";

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

/** Stands in for the two storefront APIs. */
async function fetchChannelOne(): Promise<ChannelItem[]> {
	return [
		{ sku: "TEE-BLK", listingId: "C1-1", price: 19 },
		{ sku: "MUG-RED", listingId: "C1-2", price: 9 },
	];
}

async function fetchChannelTwo(): Promise<ChannelItem[]> {
	return [{ sku: "TEE-BLK", listingId: "C2-1", price: 21 }];
}

// Braid one: the listing as the channels see it. Nested under "listRow" so its
// `sku` and `title` don't have to share a namespace with the catalogue's.
const listings = new Braid()
	.main({
		name: "listRow",
		source: listRows,
		key: (row) => row.sku,
		as: "listRow",
	})
	.join({
		name: "channelOne",
		source: () => fetchChannelOne(),
		on: (item) => item.sku,
		type: "single",
	})
	.join({
		name: "channelTwo",
		source: () => fetchChannelTwo(),
		on: (item) => item.sku,
		type: "single",
	});

// Braid two: the product as the database sees it, with its variant rows.
const catalogue = new Braid()
	.main({
		name: "product",
		source: dbProducts,
		key: (product) => product.id,
		as: "product",
	})
	.join({
		name: "skus",
		source: dbSkus,
		on: (dbSku) => dbSku.productId,
		type: "many",
	});

// Braid three: the two results, joined on SKU. Neither inner braid has been run
// yet — passing them as sources is what runs them, concurrently.
const combined = await new Braid()
	.main({ source: listings, key: (row) => row.listRow.sku, as: "listing" })
	.join({
		name: "catalogue",
		source: catalogue,
		on: (row) => row.product.sku,
		type: "single",
	})
	.run();

for (const row of combined) {
	const channels = [row.listing.channelOne, row.listing.channelTwo]
		.filter((item) => item !== null)
		.map((item) => `${item.listingId} @ ${item.price}`);

	const stock =
		row.catalogue?.skus.reduce((total, dbSku) => total + dbSku.stock, 0) ?? 0;

	console.log(
		`${row.listing.listRow.sku.padEnd(8)} ${row.listing.listRow.title.padEnd(11)}` +
			` channels: ${(channels.join(", ") || "none").padEnd(28)}` +
			` catalogue: ${row.catalogue === null ? "unlisted" : `${row.catalogue.skus.length} skus, ${stock} in stock`}`,
	);
}

// The types survive the whole trip: each inner braid's shape is preserved under
// its own key, so this is checked rather than an `any` in a trench coat.
const first = combined[0];
if (first !== undefined) {
	const sku: string = first.listing.listRow.sku;
	const price: number | undefined = first.listing.channelOne?.price;
	const code: string | undefined = first.catalogue?.skus[0]?.code;
	console.log("\ntyped access:", { sku, price, code });
}
