/**
 * The shape Braid was written for: one canonical product list that has to be
 * enriched with how two storefronts and a channel manager see the same items.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/basic.ts
 */

import { Braid } from "../main.ts";

interface Product {
	id: number;
	sku: string;
	title: string;
}

interface BcProduct {
	sku: string;
	bcId: number;
	price: number;
}

interface ShopifyProduct {
	sku: string;
	handle: string;
}

interface Variation {
	productId: number;
	option: string;
	stock: number;
}

const products: Product[] = [
	{ id: 1, sku: "TEE-BLK", title: "Black tee" },
	{ id: 2, sku: "MUG-RED", title: "Red mug" },
	{ id: 3, sku: "CAP-GRN", title: "Green cap" },
];

const bcProducts: BcProduct[] = [
	{ sku: "TEE-BLK", bcId: 101, price: 19 },
	{ sku: "MUG-RED", bcId: 102, price: 9 },
];

const shopifyProducts: ShopifyProduct[] = [
	{ sku: "TEE-BLK", handle: "black-tee" },
	{ sku: "CAP-GRN", handle: "green-cap" },
];

const variations: Variation[] = [
	{ productId: 1, option: "S", stock: 4 },
	{ productId: 1, option: "M", stock: 0 },
	{ productId: 2, option: "default", stock: 12 },
];

const stitched = new Braid()
	.main({
		name: "product",
		source: products,
		// Most detail sources key off the SKU, so that's the default for the braid.
		key: (product) => product.sku,
	})
	.join({
		name: "bigcommerce",
		source: bcProducts,
		on: (bc) => bc.sku,
		type: "single",
	})
	.join({
		name: "shopify",
		source: shopifyProducts,
		on: (sp) => sp.sku,
		type: "single",
	})
	.join({
		name: "variations",
		source: variations,
		on: (variation) => variation.productId,
		// The channel manager keys off the internal id, not the SKU, so this join
		// overrides which field on the main row it matches against.
		key: (product) => product.id,
		type: "many",
	})
	.run();

for (const row of stitched) {
	// `bigcommerce` and `shopify` are `T | null`; `variations` is always an array.
	const listings = [
		row.bigcommerce
			? `bc#${row.bigcommerce.bcId} @ £${row.bigcommerce.price}`
			: "not on BigCommerce",
		row.shopify ? `shopify/${row.shopify.handle}` : "not on Shopify",
	];

	console.log(
		`${row.sku.padEnd(8)} ${row.title.padEnd(11)} ${listings.join(", ").padEnd(45)} ${
			row.variations.length
		} variation(s)`,
	);
}

const inStock = stitched.filter((row) =>
	row.variations.some((variation) => variation.stock > 0),
);
console.log(
	`\n${inStock.length} of ${stitched.length} products have stock somewhere.`,
);
