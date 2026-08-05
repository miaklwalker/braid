import assert from "node:assert";
import test, { describe } from "node:test";
import { Braid, BraidError } from "../modules/index.ts";
import {
	BC_PRODUCTS,
	PRODUCTS,
	SHOPIFY_PRODUCTS,
	VARIATIONS,
	bcFetcher,
} from "./support.ts";

describe("Braid.main as", () => {
	test("without `as`, the main row is spread across the output row", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.deepStrictEqual(Object.keys(rows[0] as object), [
			"id",
			"sku",
			"title",
			"bigcommerce",
		]);
	});

	test("with `as`, the main row is nested under that property instead", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.deepStrictEqual(Object.keys(rows[0] as object), [
			"product",
			"bigcommerce",
		]);
		assert.deepStrictEqual(rows[0]?.product, PRODUCTS[0]);
	});

	test("the nested main row is the source row itself, not a copy of it", () => {
		// Spreading has to copy; nesting doesn't, and doesn't pretend to — the
		// nested row is the same reference, exactly like a joined detail row.
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.run();

		assert.strictEqual(rows[0]?.product, PRODUCTS[0]);
	});

	test("key extractors still receive the raw main row, not the nested wrapper", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		assert.deepStrictEqual(
			rows[0]?.variations.map((v) => v.option),
			["S", "M"],
		);
	});

	test("a join may not take the name the main row is nested under", () => {
		assert.throws(() => {
			new Braid()
				.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
				// @ts-expect-error "product" is already the main alias
				.join({
					name: "product",
					source: BC_PRODUCTS,
					on: (bc) => bc.sku,
					type: "single",
				});
		}, BraidError);
	});

	test("an empty `as` throws rather than producing a nameless property", () => {
		assert.throws(() => {
			new Braid().main({ source: PRODUCTS, key: (p) => p.sku, as: "" });
		}, BraidError);
	});
});

describe("composing braids", () => {
	/** Two independently-stitched braids, each nesting its own main row. */
	function listingBraid() {
		return new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});
	}

	function catalogueBraid() {
		return new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "listed" })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			});
	}

	test("a braid can be the source of another braid's join", async () => {
		const rows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "listing",
				source: listingBraid(),
				on: (row) => row.product.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.listing?.bigcommerce?.bcId, 101);
		assert.strictEqual(rows[2]?.listing?.bigcommerce, null);
	});

	test("a braid can be the source of another braid's main collection", async () => {
		const rows = await new Braid()
			.main({ source: listingBraid(), key: (row) => row.product.sku })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 101);
		assert.strictEqual(rows[0]?.shopify?.handle, "black-tee");
	});

	test("two braids stitched by a third keep their own field namespaces", async () => {
		const rows = await new Braid()
			.main({
				source: listingBraid(),
				key: (row) => row.product.sku,
				as: "listing",
			})
			.join({
				name: "catalogue",
				source: catalogueBraid(),
				on: (row) => row.listed.sku,
				type: "single",
			})
			.run();

		const first = rows[0];
		assert.strictEqual(first?.listing.product.sku, "TEE-BLK");
		assert.strictEqual(first?.listing.bigcommerce?.bcId, 101);
		assert.strictEqual(first?.catalogue?.listed.sku, "TEE-BLK");
		assert.strictEqual(first?.catalogue?.shopify?.handle, "black-tee");
	});

	test("an async inner braid propagates through the outer one", async () => {
		const inner = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "bigcommerce",
				source: bcFetcher(),
				on: (bc) => bc.sku,
				type: "single",
			});

		const rows = await new Braid()
			.main({ source: inner, key: (row) => row.product.sku })
			.run();

		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 101);
	});

	test("a required join against a braid source still throws on a miss", async () => {
		const sparse = new Braid()
			.main({ source: BC_PRODUCTS, key: (bc) => bc.sku, as: "bc" })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			});

		await assert.rejects(
			new Braid()
				.main({ source: PRODUCTS, key: (p) => p.sku })
				.join({
					name: "listing",
					source: sparse,
					on: (row) => row.bc.sku,
					type: "single",
					required: true,
				})
				.run(),
			BraidError,
		);
	});
});

describe("promise and thenable sources", () => {
	test("a promise works as a main source", async () => {
		const rows = await new Braid()
			.main({ source: Promise.resolve(PRODUCTS), key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows.length, 3);
		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 101);
	});

	test("a promise works as a join source", async () => {
		const rows = await new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: Promise.resolve(BC_PRODUCTS),
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 101);
	});

	test("an async main source makes the whole run a promise", () => {
		const result = new Braid()
			.main({ source: Promise.resolve(PRODUCTS), key: (p) => p.sku })
			.run();

		assert.ok(result instanceof Promise);
	});

	test("a main source that resolves to a non-array rejects", async () => {
		// The types already reject this, so the cast stands in for a JavaScript
		// caller — the runtime guard is what's under test.
		const notACollection = Promise.resolve({
			not: "an array",
		}) as unknown as Promise<readonly object[]>;

		await assert.rejects(
			new Braid().main({ source: notACollection, key: () => "x" }).run(),
			BraidError,
		);
	});
});
