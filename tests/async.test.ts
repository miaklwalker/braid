import assert from "node:assert";
import test, { describe } from "node:test";
import { Braid, BraidError } from "../modules/index.ts";
import {
	BC_PRODUCTS,
	type BcProduct,
	PRODUCTS,
	SHOPIFY_PRODUCTS,
	bcFetcher,
	shopifyFetcher,
	variationsFetcher,
} from "./support.ts";

describe("Braid with async sources", () => {
	test("a fetcher source makes .run() return a promise", async () => {
		const pending = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: bcFetcher(),
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.ok(pending instanceof Promise);
		const rows = await pending;
		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 101);
	});

	test("sync and async sources mix in one braid", async () => {
		const rows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: bcFetcher(5),
				on: (bc) => bc.sku,
				type: "single",
			})
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			})
			.join({
				name: "variations",
				source: variationsFetcher(1),
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		assert.deepStrictEqual(rows[0], {
			id: 1,
			sku: "TEE-BLK",
			title: "Black tee",
			bigcommerce: { sku: "TEE-BLK", bcId: 101, price: 19 },
			shopify: { sku: "TEE-BLK", handle: "black-tee" },
			variations: [
				{ productId: 1, option: "S", stock: 4 },
				{ productId: 1, option: "M", stock: 0 },
			],
		});
	});

	test("fetchers run concurrently rather than one after another", async () => {
		const started = performance.now();

		await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: bcFetcher(40),
				on: (bc) => bc.sku,
				type: "single",
			})
			.join({
				name: "shopify",
				source: shopifyFetcher(40),
				on: (sp) => sp.sku,
				type: "single",
			})
			.run();

		const elapsed = performance.now() - started;
		assert.ok(
			elapsed < 75,
			`two 40ms fetchers should overlap, took ${elapsed.toFixed(0)}ms`,
		);
	});

	test("a synchronous function source is supported and still returns a promise", async () => {
		const rows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: () => BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[1]?.bigcommerce?.bcId, 102);
	});

	test("the builder itself is awaitable, with or without async sources", async () => {
		const syncRows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			});

		const asyncRows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "shopify",
				source: shopifyFetcher(),
				on: (sp) => sp.sku,
				type: "single",
			});

		assert.deepStrictEqual(syncRows, asyncRows);
	});

	test("a rejected fetcher rejects the braid", async () => {
		await assert.rejects(
			new Braid()
				.main({ source: PRODUCTS, key: (p) => p.sku })
				.join({
					name: "bigcommerce",
					source: (): Promise<readonly BcProduct[]> =>
						Promise.reject(new Error("storefront unreachable")),
					on: (bc) => bc.sku,
					type: "single",
				})
				.run(),
			/storefront unreachable/,
		);
	});

	test("a fetcher that resolves to a non-array throws a BraidError", async () => {
		const badFetcher = async () =>
			({ items: BC_PRODUCTS }) as unknown as readonly BcProduct[];

		await assert.rejects(
			new Braid()
				.main({ source: PRODUCTS, key: (p) => p.sku })
				.join({
					name: "bigcommerce",
					source: badFetcher,
					on: (bc) => bc.sku,
					type: "single",
				})
				.run(),
			BraidError,
		);
	});

	test("required joins still throw through the async path", async () => {
		await assert.rejects(
			new Braid()
				.main({ source: PRODUCTS, key: (p) => p.sku })
				.join({
					name: "bigcommerce",
					source: bcFetcher(),
					on: (bc) => bc.sku,
					type: "single",
					required: true,
				})
				.run(),
			BraidError,
		);
	});
});
