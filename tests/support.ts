/**
 * A miniature version of the shape Braid was written for: one canonical product
 * list, the same products as two storefronts see them, and per-product records
 * from a channel manager.
 *
 * The fixtures are deliberately imperfect — one product exists on neither
 * storefront, one storefront row is an orphan, one product has no variations —
 * because the interesting behaviour is all in the misses.
 */

export interface Product {
	readonly id: number;
	readonly sku: string;
	readonly title: string;
}

export interface BcProduct {
	readonly sku: string;
	readonly bcId: number;
	readonly price: number;
}

export interface ShopifyProduct {
	readonly sku: string;
	readonly handle: string;
}

export interface Variation {
	readonly productId: number;
	readonly option: string;
	readonly stock: number;
}

export const PRODUCTS: readonly Product[] = [
	{ id: 1, sku: "TEE-BLK", title: "Black tee" },
	{ id: 2, sku: "MUG-RED", title: "Red mug" },
	{ id: 3, sku: "CAP-GRN", title: "Green cap" },
];

/** "CAP-GRN" is missing, and "GHOST-1" matches no product. */
export const BC_PRODUCTS: readonly BcProduct[] = [
	{ sku: "TEE-BLK", bcId: 101, price: 19 },
	{ sku: "MUG-RED", bcId: 102, price: 9 },
	{ sku: "GHOST-1", bcId: 999, price: 0 },
];

export const SHOPIFY_PRODUCTS: readonly ShopifyProduct[] = [
	{ sku: "TEE-BLK", handle: "black-tee" },
	{ sku: "CAP-GRN", handle: "green-cap" },
];

/** Product 3 has no variations at all. */
export const VARIATIONS: readonly Variation[] = [
	{ productId: 1, option: "S", stock: 4 },
	{ productId: 1, option: "M", stock: 0 },
	{ productId: 2, option: "default", stock: 12 },
];

/**
 * A three-hop chain for `from`: a listing points at a product, which points at
 * a model, which points at a brand. Each hop has a deliberate hole — one
 * listing points at no product, and one model points at no brand — so a chain
 * can be tested where it breaks as well as where it holds.
 */
export interface ListingRow {
	readonly sku: string;
	readonly productId: number;
}

export interface DbProduct {
	readonly id: number;
	readonly modelId: number;
	readonly name: string;
}

export interface DbModel {
	readonly id: number;
	readonly brandId: number;
	readonly name: string;
}

export interface DbBrand {
	readonly id: number;
	readonly name: string;
}

export const LISTING_ROWS: readonly ListingRow[] = [
	{ sku: "TEE-BLK", productId: 1 },
	{ sku: "MUG-RED", productId: 2 },
	{ sku: "ORPHAN", productId: 99 },
];

export const DB_PRODUCTS: readonly DbProduct[] = [
	{ id: 1, modelId: 10, name: "Black tee" },
	{ id: 2, modelId: 11, name: "Red mug" },
];

/** Model 11 points at a brand that doesn't exist, breaking the chain's last hop. */
export const DB_MODELS: readonly DbModel[] = [
	{ id: 10, brandId: 100, name: "Tee" },
	{ id: 11, brandId: 999, name: "Mug" },
];

export const DB_BRANDS: readonly DbBrand[] = [{ id: 100, name: "Threadline" }];

/** Wraps a fixture in a fetcher, so async paths can be tested without a network. */
function fetcherFor<T>(
	rows: readonly T[],
	delayMs: number,
): () => Promise<readonly T[]> {
	return () =>
		new Promise((resolve) => {
			setTimeout(() => resolve(rows), delayMs);
		});
}

export const bcFetcher = (delayMs = 0): (() => Promise<readonly BcProduct[]>) =>
	fetcherFor(BC_PRODUCTS, delayMs);

export const shopifyFetcher = (
	delayMs = 0,
): (() => Promise<readonly ShopifyProduct[]>) =>
	fetcherFor(SHOPIFY_PRODUCTS, delayMs);

export const variationsFetcher = (
	delayMs = 0,
): (() => Promise<readonly Variation[]>) => fetcherFor(VARIATIONS, delayMs);

/** Counts how many times a key extractor was called — the proof that joins are indexed, not scanned. */
export function counted<TArgs extends unknown[], TResult>(
	fn: (...args: TArgs) => TResult,
): ((...args: TArgs) => TResult) & { calls: number } {
	const wrapper = ((...args: TArgs): TResult => {
		wrapper.calls += 1;
		return fn(...args);
	}) as ((...args: TArgs) => TResult) & { calls: number };
	wrapper.calls = 0;
	return wrapper;
}

export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

export type Expect<T extends true> = T;
