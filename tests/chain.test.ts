import assert from "node:assert";
import test, { describe } from "node:test";
import { Braid, BraidError } from "../modules/index.ts";
import {
	DB_BRANDS,
	DB_MODELS,
	DB_PRODUCTS,
	LISTING_ROWS,
	type DbBrand,
	type DbModel,
	type DbProduct,
	type Equal,
	type Expect,
	PRODUCTS,
	VARIATIONS,
} from "./support.ts";

/** The canonical chain: listing → product → model → brand, all flat on one row. */
function chained() {
	return new Braid()
		.main({ name: "listing", source: LISTING_ROWS, key: (l) => l.sku })
		.join({
			name: "dbProduct",
			source: DB_PRODUCTS,
			on: (p) => p.id,
			key: (l) => l.productId,
			type: "single",
		})
		.join({
			name: "dbModel",
			source: DB_MODELS,
			on: (m) => m.id,
			from: (row) => row.dbProduct?.modelId,
			type: "single",
		})
		.join({
			name: "dbBrand",
			source: DB_BRANDS,
			on: (b) => b.id,
			from: (row) => row.dbModel?.brandId,
			type: "single",
		});
}

describe("chained joins", () => {
	test("a three-hop chain lands flat on the output row", () => {
		const rows = chained().run();

		type Row = (typeof rows)[number];
		type _Row = Expect<
			Equal<
				Row,
				{
					readonly sku: string;
					readonly productId: number;
					dbProduct: DbProduct | null;
					dbModel: DbModel | null;
					dbBrand: DbBrand | null;
				}
			>
		>;

		assert.deepStrictEqual(rows[0], {
			sku: "TEE-BLK",
			productId: 1,
			dbProduct: { id: 1, modelId: 10, name: "Black tee" },
			dbModel: { id: 10, brandId: 100, name: "Tee" },
			dbBrand: { id: 100, name: "Threadline" },
		});
	});

	test("a break mid-chain nulls out only the hops below it", () => {
		const rows = chained().run();

		// Model 11 points at a brand that doesn't exist.
		assert.strictEqual(rows[1]?.dbProduct?.id, 2);
		assert.strictEqual(rows[1]?.dbModel?.id, 11);
		assert.strictEqual(rows[1]?.dbBrand, null);
	});

	test("a break at the first hop nulls out the whole chain", () => {
		const rows = chained().run();

		assert.strictEqual(rows[2]?.dbProduct, null);
		assert.strictEqual(rows[2]?.dbModel, null);
		assert.strictEqual(rows[2]?.dbBrand, null);
	});

	test("`from` can read the main row's own fields as well as earlier joins", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				from: (row) => row.id,
				type: "many",
			})
			.run();

		assert.strictEqual(rows[0]?.variations.length, 2);
	});

	test("`from` reads through the alias when the main row is nested", () => {
		const rows = new Braid()
			.main({ source: LISTING_ROWS, key: (l) => l.sku, as: "listing" })
			.join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => p.id,
				from: (row) => row.listing.productId,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.dbProduct?.name, "Black tee");
	});

	test("a chained `many` join collects against the reached-through key", () => {
		const rows = new Braid()
			.main({ source: LISTING_ROWS, key: (l) => l.sku })
			.join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => p.id,
				key: (l) => l.productId,
				type: "single",
			})
			.join({
				name: "models",
				source: DB_MODELS,
				on: (m) => m.id,
				from: (row) => row.dbProduct?.modelId,
				type: "many",
			})
			.run();

		assert.deepStrictEqual(
			rows[0]?.models.map((m) => m.name),
			["Tee"],
		);
		assert.deepStrictEqual(rows[2]?.models, []);
	});

	test("a required chained join explains that the break may be upstream", () => {
		assert.throws(
			() =>
				new Braid()
					.main({ name: "listing", source: LISTING_ROWS, key: (l) => l.sku })
					.join({
						name: "dbProduct",
						source: DB_PRODUCTS,
						on: (p) => p.id,
						key: (l) => l.productId,
						type: "single",
					})
					.join({
						name: "dbModel",
						source: DB_MODELS,
						on: (m) => m.id,
						from: (row) => row.dbProduct?.modelId,
						type: "single",
						required: true,
					})
					.run(),
			(error: unknown) =>
				error instanceof BraidError &&
				error.message.includes('Join "dbModel" is required') &&
				error.message.includes(
					"an earlier join in the chain may not have matched",
				),
		);
	});

	test("reaching for a join that hasn't been declared yet is a compile error", () => {
		const rows = new Braid()
			.main({ source: LISTING_ROWS, key: (l) => l.sku })
			.join({
				name: "dbModel",
				source: DB_MODELS,
				on: (m) => m.id,
				// @ts-expect-error dbProduct is joined after this one, so it isn't on the row yet
				from: (row) => row.dbProduct?.modelId,
				type: "single",
			})
			.join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => p.id,
				key: (l) => l.productId,
				type: "single",
			})
			.run();

		// At runtime the key is simply undefined, which is a miss — the compile
		// error is what stops this reaching production.
		assert.strictEqual(rows[0]?.dbModel, null);
	});

	test("`key` and `from` together throw rather than silently picking one", () => {
		assert.throws(() => {
			new Braid().main({ source: LISTING_ROWS, key: (l) => l.sku }).join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => p.id,
				key: (l) => l.productId,
				from: (row) => row.productId,
				type: "single",
			});
		}, BraidError);
	});

	test("a `from` that isn't a function throws at .join() time", () => {
		assert.throws(() => {
			new Braid().main({ source: LISTING_ROWS, key: (l) => l.productId }).join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => p.id,
				// @ts-expect-error from must be a function
				from: "productId",
				type: "single",
			});
		}, BraidError);
	});

	test("each source in a chain is still indexed exactly once", () => {
		let productLookups = 0;
		let modelLookups = 0;

		new Braid()
			.main({ source: LISTING_ROWS, key: (l) => l.sku })
			.join({
				name: "dbProduct",
				source: DB_PRODUCTS,
				on: (p) => {
					productLookups += 1;
					return p.id;
				},
				key: (l) => l.productId,
				type: "single",
			})
			.join({
				name: "dbModel",
				source: DB_MODELS,
				on: (m) => {
					modelLookups += 1;
					return m.id;
				},
				from: (row) => row.dbProduct?.modelId,
				type: "single",
			})
			.run();

		// One call per detail row, not one per main row per detail row.
		assert.strictEqual(productLookups, DB_PRODUCTS.length);
		assert.strictEqual(modelLookups, DB_MODELS.length);
	});
});
