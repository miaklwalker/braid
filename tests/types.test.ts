import assert from "node:assert";
import test, { describe } from "node:test";
import { Braid, BraidError, type InferBraidRow } from "../modules/index.ts";
import {
	BC_PRODUCTS,
	type BcProduct,
	type Product,
	PRODUCTS,
	SHOPIFY_PRODUCTS,
	VARIATIONS,
	type Variation,
	type Equal,
	type Expect,
	bcFetcher,
} from "./support.ts";

describe("accumulated row type", () => {
	test("each join widens the output row with its own property", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		type Row = (typeof rows)[number];
		type _Single = Expect<Equal<Row["bigcommerce"], BcProduct | null>>;
		type _Many = Expect<Equal<Row["variations"], Variation[]>>;
		type _Main = Expect<Equal<Row["sku"], string>>;

		assert.strictEqual(rows.length, 3);
	});

	test("an explicit default becomes part of the single join's union", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
				default: "missing" as const,
			})
			.run();

		type Row = (typeof rows)[number];
		type _Union = Expect<Equal<Row["bigcommerce"], BcProduct | "missing">>;

		assert.strictEqual(rows[2]?.bigcommerce, "missing");
	});

	test("required drops the default from the union", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS.slice(0, 2), key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
				required: true,
			})
			.run();

		type Row = (typeof rows)[number];
		type _NonNull = Expect<Equal<Row["bigcommerce"], BcProduct>>;

		assert.strictEqual(rows[0]?.bigcommerce.bcId, 101);
	});

	test("InferBraidRow reads the row type off a configured builder", () => {
		const builder = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			});

		type Row = InferBraidRow<typeof builder>;
		type _Shopify = Expect<
			Equal<
				Row["shopify"],
				{ readonly sku: string; readonly handle: string } | null
			>
		>;

		assert.deepStrictEqual(builder.joinNames, ["shopify"]);
	});
});

describe("nested main rows", () => {
	test("`as` moves the main row under its own property in the row type", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		type Row = (typeof rows)[number];
		type _Nested = Expect<Equal<Row["product"], Product>>;
		type _Join = Expect<Equal<Row["bigcommerce"], BcProduct | null>>;
		// The main row's own fields are no longer at the top level.
		type _Keys = Expect<Equal<keyof Row, "product" | "bigcommerce">>;

		assert.deepStrictEqual(Object.keys(rows[0] as object), [
			"product",
			"bigcommerce",
		]);
	});

	test("InferBraidRow accounts for the alias", () => {
		const builder = new Braid().main({
			source: PRODUCTS,
			key: (p) => p.sku,
			as: "product",
		});

		type Row = InferBraidRow<typeof builder>;
		type _Row = Expect<Equal<Row, { product: Product }>>;

		assert.deepStrictEqual(builder.joinNames, []);
	});

	test("a braid used as a source contributes its own nested row type", async () => {
		const inner = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku, as: "product" })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});

		const rows = await new Braid()
			.main({ source: inner, key: (row) => row.product.sku, as: "listing" })
			.run();

		type Row = (typeof rows)[number];
		type _Inner = Expect<
			Equal<Row["listing"], { product: Product; bigcommerce: BcProduct | null }>
		>;

		assert.strictEqual(rows[0]?.listing.bigcommerce?.bcId, 101);
	});
});

describe("join names", () => {
	test("joinNames is typed as the union of the names actually configured", () => {
		const builder = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			});

		type Names = (typeof builder.joinNames)[number];
		type _Names = Expect<Equal<Names, "bigcommerce" | "shopify">>;

		assert.deepStrictEqual(builder.joinNames, ["bigcommerce", "shopify"]);
	});

	test("a reused join name is rejected at compile time and at runtime", () => {
		const builder = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});

		assert.throws(() => {
			// @ts-expect-error "bigcommerce" is already defined on this braid
			builder.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});
		}, BraidError);
	});
});

describe("key compatibility", () => {
	test("a detail key of the wrong type is a compile error", () => {
		const builder = new Braid().main({ source: PRODUCTS, key: (p) => p.sku });

		const rows = builder
			.join({
				name: "variations",
				source: VARIATIONS,
				// @ts-expect-error productId is a number, but the main key is a string
				on: (v: Variation) => v.productId,
				type: "many",
			})
			.run();

		// Nothing matches, which is exactly the bug the compile error prevents.
		assert.deepStrictEqual(rows[0]?.variations, []);
	});

	test("the key override re-types the main side of the join", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		assert.strictEqual(rows[0]?.variations.length, 2);
	});

	test("joining before a main collection is defined cannot type-check", () => {
		assert.throws(() => {
			new Braid()
				.join({
					name: "bigcommerce",
					source: BC_PRODUCTS,
					// @ts-expect-error there is no main collection yet, so no key type to match
					on: (bc) => bc.sku,
					type: "single",
				})
				.run();
		}, BraidError);
	});
});

describe("sync and async result types", () => {
	test("array sources keep .run() synchronous", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		type _NotAPromise = Expect<
			Equal<typeof rows extends Promise<unknown> ? true : false, false>
		>;

		assert.ok(Array.isArray(rows));
	});

	test("one fetcher anywhere in the chain makes the whole result a promise", async () => {
		const pending = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "shopify",
				source: SHOPIFY_PRODUCTS,
				on: (sp) => sp.sku,
				type: "single",
			})
			.join({
				name: "bigcommerce",
				source: bcFetcher(),
				on: (bc) => bc.sku,
				type: "single",
			})
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		type _IsPromise = Expect<
			Equal<typeof pending extends Promise<unknown> ? true : false, true>
		>;

		const rows = await pending;
		type Row = (typeof rows)[number];
		type _Bc = Expect<Equal<Row["bigcommerce"], BcProduct | null>>;

		assert.strictEqual(rows.length, 3);
	});
});
