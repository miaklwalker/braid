/**
 * Following a chain of references onto one flat row.
 *
 * A listing row carries a product id. The product carries a model id. The model
 * carries a brand id. None of those last two keys exist on the listing row, so
 * `key` — which reads the main row — can't reach them.
 *
 * `from` reads the row as stitched *so far*, so each join can key off what the
 * previous one attached. Everything lands flat: no nesting, no post-processing.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/chain.ts
 */

import { Braid } from "../main.ts";

interface ListRow {
	sku: string;
	productId: number;
}

interface DbProduct {
	id: number;
	modelId: number;
	name: string;
}

interface DbModel {
	id: number;
	brandId: number;
	name: string;
}

interface DbBrand {
	id: number;
	name: string;
}

const listRows: ListRow[] = [
	{ sku: "TEE-BLK", productId: 1 },
	{ sku: "MUG-RED", productId: 2 },
	{ sku: "ORPHAN", productId: 99 },
];

const dbProducts: DbProduct[] = [
	{ id: 1, modelId: 10, name: "Black tee" },
	{ id: 2, modelId: 11, name: "Red mug" },
];

// Model 11 points at a brand that isn't in the table, so that chain breaks on
// its last hop rather than its first.
const dbModels: DbModel[] = [
	{ id: 10, brandId: 100, name: "Tee" },
	{ id: 11, brandId: 999, name: "Mug" },
];

const dbBrands: DbBrand[] = [{ id: 100, name: "Threadline" }];

const rows = new Braid()
	.main({ name: "listing", source: listRows, key: (listRow) => listRow.sku })
	// Hop one keys off the main row, so it uses `key`.
	.join({
		name: "dbProduct",
		source: dbProducts,
		on: (product) => product.id,
		key: (listRow) => listRow.productId,
		type: "single",
	})
	// Hop two keys off what hop one attached. `row.dbProduct` is typed as
	// `DbProduct | null`, so the optional chain isn't optional — it's required.
	.join({
		name: "dbModel",
		source: dbModels,
		on: (model) => model.id,
		from: (row) => row.dbProduct?.modelId,
		type: "single",
	})
	// Hop three reaches through hop two the same way.
	.join({
		name: "dbBrand",
		source: dbBrands,
		on: (brand) => brand.id,
		from: (row) => row.dbModel?.brandId,
		type: "single",
	})
	.run();

for (const row of rows) {
	console.log(
		`${row.sku.padEnd(8)} product: ${(row.dbProduct?.name ?? "—").padEnd(11)}` +
			` model: ${(row.dbModel?.name ?? "—").padEnd(5)}` +
			` brand: ${row.dbBrand?.name ?? "—"}`,
	);
}

// The row is flat, and every hop is nullable exactly where the data says it is:
// a break at any point nulls out what's below it and leaves what's above intact.
console.log("\nfirst row:", JSON.stringify(rows[0]));
console.log("broken last hop:", JSON.stringify(rows[1]));
console.log("broken first hop:", JSON.stringify(rows[2]));
