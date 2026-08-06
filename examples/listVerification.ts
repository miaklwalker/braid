/**
 * The full shape: one verification row enriched from six database tables and
 * three channel endpoints, flat on a single object.
 *
 * The graph, and how each hop is keyed:
 *
 *   listRow.product_id
 *     ├─ product            db_product.id                 ← main key
 *     │   ├─ model          db_model.id                   ← from product.model_id
 *     │   │   └─ brand      db_brand.id                   ← from model.brand_id
 *     │   └─ category       db_category.id                ← from product.category_id
 *     ├─ skus               db_skus.product_id (many)     ← main key
 *     ├─ channelOne         channelOne.sku                ← main key, normalised
 *     ├─ channelTwo         channelTwo.ID                 ← main key
 *     └─ channelTwoChildren channelTwoChildren.ID (many)  ← main key
 *
 * Anything reachable from the verification row itself uses the main key. Model,
 * brand and category aren't — their ids live on rows Braid hasn't fetched yet
 * when the chain starts — so those hops use `from`, which reads the row as
 * stitched so far.
 *
 * Every source here is an array, so `.run()` returns the rows directly. Swap any
 * of them for a fetcher — `source: () => fetchChannelOne()` — and the return
 * type becomes a promise on its own; nothing else about the chain changes.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/listVerification.ts
 */

import { Braid } from "../main.ts";

interface ListVerificationRow {
	verification_id: number;
	product_id: number;
	checked_by: string;
}

interface DbProduct {
	id: number;
	model_id: number | null;
	category_id: number;
	title: string;
}

interface DbSku {
	id: number;
	product_id: number;
	code: string;
}

interface DbModel {
	id: number;
	brand_id: number;
	name: string;
}

interface DbBrand {
	id: number;
	name: string;
}

interface DbCategory {
	id: number;
	name: string;
}

/** Channel one stores the product id in a string `sku` field, as channels do. */
interface ChannelOneListing {
	sku: string;
	listing_id: string;
	price: number;
}

interface ChannelTwoListing {
	ID: number;
	listing_ref: string;
	live: boolean;
}

interface ChannelTwoChild {
	ID: number;
	child_ref: string;
	stock: number;
}

const listVerificationRows: ListVerificationRow[] = [
	{ verification_id: 1, product_id: 501, checked_by: "sam" },
	{ verification_id: 2, product_id: 502, checked_by: "sam" },
	{ verification_id: 3, product_id: 503, checked_by: "ali" },
	{ verification_id: 4, product_id: 999, checked_by: "ali" },
];

// 503 has no model at all; 999 isn't in the table.
const dbProducts: DbProduct[] = [
	{ id: 501, model_id: 301, category_id: 401, title: "Black tee" },
	{ id: 502, model_id: 302, category_id: 401, title: "Red tee" },
	{ id: 503, model_id: null, category_id: 402, title: "Green mug" },
];

const dbSkus: DbSku[] = [
	{ id: 6001, product_id: 501, code: "TEE-BLK-S" },
	{ id: 6002, product_id: 501, code: "TEE-BLK-M" },
	{ id: 6003, product_id: 501, code: "TEE-BLK-L" },
	{ id: 6004, product_id: 502, code: "TEE-RED-S" },
];

// Model 302 points at a brand that isn't in the table.
const dbModels: DbModel[] = [
	{ id: 301, brand_id: 201, name: "Classic tee" },
	{ id: 302, brand_id: 9999, name: "Slim tee" },
];

const dbBrands: DbBrand[] = [{ id: 201, name: "Threadline" }];

const dbCategories: DbCategory[] = [
	{ id: 401, name: "Apparel" },
	{ id: 402, name: "Homeware" },
];

const channelOneListings: ChannelOneListing[] = [
	{ sku: "501", listing_id: "C1-501", price: 19 },
	{ sku: "502", listing_id: "C1-502", price: 21 },
];

const channelTwoListings: ChannelTwoListing[] = [
	{ ID: 501, listing_ref: "C2-501", live: true },
	{ ID: 503, listing_ref: "C2-503", live: false },
];

const channelTwoChildren: ChannelTwoChild[] = [
	{ ID: 501, child_ref: "C2-501-A", stock: 4 },
	{ ID: 501, child_ref: "C2-501-B", stock: 0 },
	{ ID: 503, child_ref: "C2-503-A", stock: 7 },
];

const rows = new Braid()
	.main({
		name: "listVerification",
		source: listVerificationRows,
		key: (listRow) => listRow.product_id,
		// Nest the verification row so its own fields stay in their own
		// namespace, rather than spreading `id`-ish columns across the top level.
		as: "listRow",
	})
	.join({
		name: "product",
		source: dbProducts,
		on: (product) => product.id,
		type: "single",
	})
	// model_id lives on the product, not on the verification row, so this hop
	// reaches through what the previous join attached. `row.product` is
	// `DbProduct | null`, so the optional chain is required rather than defensive.
	.join({
		name: "model",
		source: dbModels,
		on: (model) => model.id,
		from: (row) => row.product?.model_id,
		type: "single",
	})
	.join({
		name: "brand",
		source: dbBrands,
		on: (brand) => brand.id,
		from: (row) => row.model?.brand_id,
		type: "single",
	})
	.join({
		name: "category",
		source: dbCategories,
		on: (category) => category.id,
		from: (row) => row.product?.category_id,
		type: "single",
	})
	// Back to the main key: db_skus.product_id is the same id the verification
	// row carries. (`from: (row) => row.product?.id` would tie these to the
	// product join instead, so orphaned skus wouldn't be reported.)
	.join({
		name: "skus",
		source: dbSkus,
		on: (dbSku) => dbSku.product_id,
		type: "many",
	})
	// Channel one keys on a *string* sku. A string never matches a number in
	// Braid, and the mismatch is a compile error rather than a silent miss — so
	// normalise one side. `key` reads the raw verification row even though the
	// main row is nested under `listRow`.
	.join({
		name: "channelOne",
		source: channelOneListings,
		on: (listing) => listing.sku,
		key: (listRow) => String(listRow.product_id),
		type: "single",
	})
	.join({
		name: "channelTwo",
		source: channelTwoListings,
		on: (listing) => listing.ID,
		type: "single",
	})
	.join({
		name: "channelTwoChildren",
		source: channelTwoChildren,
		on: (child) => child.ID,
		type: "many",
	})
	.run();

// One flat object per verification row:
// { listRow, product, model, brand, category, skus, channelOne, channelTwo, channelTwoChildren }

const header = [
	"prod id".padEnd(8),
	"product".padEnd(10),
	"model".padEnd(12),
	"brand".padEnd(11),
	"category".padEnd(9),
	"skus".padEnd(5),
	"ch1".padEnd(8),
	"ch2".padEnd(8),
	"ch2 kids",
].join(" ");
console.log(header);
console.log("-".repeat(header.length));

for (const row of rows) {
	console.log(
		[
			String(row.listRow.product_id).padEnd(8),
			(row.product?.title ?? "—").padEnd(10),
			(row.model?.name ?? "—").padEnd(12),
			(row.brand?.name ?? "—").padEnd(11),
			(row.category?.name ?? "—").padEnd(9),
			String(row.skus.length).padEnd(5),
			(row.channelOne?.listing_id ?? "—").padEnd(8),
			(row.channelTwo?.listing_ref ?? "—").padEnd(8),
			String(row.channelTwoChildren.length),
		].join(" "),
	);
}

console.log("\nEverything matched:");
console.log(JSON.stringify(rows[0], null, 1));

console.log(
	"\nBroken mid-chain — model found, but its brand isn't in the table:",
);
console.log(JSON.stringify(rows[1], null, 1));

console.log("\nNo product at all — every hop below it is null or empty:");
console.log(JSON.stringify(rows[3], null, 1));

// The row type is flat and each field is nullable exactly where the data says.
// `skus` and `channelTwoChildren` are arrays rather than `T[] | null`, because a
// `many` join with no matches is an empty array, not a miss.
const first = rows[0];
if (first !== undefined) {
	const checkedBy: string = first.listRow.checked_by;
	const modelName: string | undefined = first.model?.name;
	const skuCodes: string[] = first.skus.map((dbSku) => dbSku.code);
	const price: number | undefined = first.channelOne?.price;
	console.log("\ntyped access:", { checkedBy, modelName, skuCodes, price });
}
