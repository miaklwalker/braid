import assert from "node:assert";
import test, { describe } from "node:test";
import { type BraidKey, Braid, BraidError } from "../modules/index.ts";
import {
	BC_PRODUCTS,
	PRODUCTS,
	SHOPIFY_PRODUCTS,
	VARIATIONS,
	type Variation,
} from "./support.ts";

describe("Braid.main", () => {
	test("produces one output row per main row, in source order", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.run();

		assert.deepStrictEqual(
			rows.map((row) => row.sku),
			["TEE-BLK", "MUG-RED", "CAP-GRN"],
		);
	});

	test("copies main rows rather than mutating them", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(
			Object.hasOwn(PRODUCTS[0] as object, "bigcommerce"),
			false,
		);
		assert.notStrictEqual(rows[0], PRODUCTS[0]);
	});

	test("an empty main collection yields an empty result", () => {
		const rows = new Braid()
			.main({ source: [] as { sku: string }[], key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.deepStrictEqual(rows, []);
	});

	test("a second .main() throws instead of replacing the first", () => {
		const builder = new Braid().main({ source: PRODUCTS, key: (p) => p.sku });

		assert.throws(() => {
			// @ts-expect-error a main collection is already defined
			builder.main({ source: PRODUCTS, key: (p) => p.id });
		}, BraidError);
	});

	test("running without a main collection throws", () => {
		assert.throws(() => new Braid().run(), BraidError);
	});

	test("a non-array source throws at .main() time", () => {
		assert.throws(() => {
			// @ts-expect-error source must be an array
			new Braid().main({ source: "not an array", key: (p) => p });
		}, BraidError);
	});

	test("a missing key extractor throws at .main() time", () => {
		assert.throws(() => {
			// @ts-expect-error key is required
			new Braid().main({ source: PRODUCTS });
		}, BraidError);
	});
});

describe("Braid.join single", () => {
	test("attaches the matching detail row under the join name", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.deepStrictEqual(rows[0]?.bigcommerce, {
			sku: "TEE-BLK",
			bcId: 101,
			price: 19,
		});
	});

	test("unmatched rows get null rather than undefined", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[2]?.bigcommerce, null);
	});

	test("an explicit default replaces null for unmatched rows", () => {
		const placeholder = { sku: "", bcId: -1, price: 0 };
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
				default: placeholder,
			})
			.run();

		assert.strictEqual(rows[2]?.bigcommerce, placeholder);
	});

	test("detail rows matching no main row are simply dropped", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(
			rows.some((row) => row.bigcommerce?.bcId === 999),
			false,
		);
	});

	test("when several detail rows share a key, the last one wins", () => {
		const duplicated = [
			{ sku: "TEE-BLK", bcId: 1, price: 1 },
			{ sku: "TEE-BLK", bcId: 2, price: 2 },
		];
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: duplicated,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.bigcommerce?.bcId, 2);
	});
});

describe("Braid.join many", () => {
	test("collects every matching detail row, in source order", () => {
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

		assert.deepStrictEqual(
			rows[0]?.variations.map((v) => v.option),
			["S", "M"],
		);
	});

	test("unmatched rows get an empty array", () => {
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

		assert.deepStrictEqual(rows[2]?.variations, []);
	});

	test("each unmatched row gets its own empty array, so mutating one is contained", () => {
		const noMatches: readonly Variation[] = [];
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "variations",
				source: noMatches,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		rows[0]?.variations.push({ productId: 1, option: "added", stock: 1 });

		assert.strictEqual(rows[0]?.variations.length, 1);
		assert.strictEqual(rows[1]?.variations.length, 0);
	});

	test("an explicit default is used verbatim for unmatched rows", () => {
		const fallback: Variation[] = [{ productId: -1, option: "none", stock: 0 }];
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
				default: fallback,
			})
			.run();

		assert.strictEqual(rows[2]?.variations, fallback);
	});
});

describe("Braid.join keys", () => {
	test("the key override changes which main field the join matches on", () => {
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

		assert.strictEqual(rows[1]?.variations[0]?.option, "default");
	});

	test("a nullish main key never matches, even against a nullish detail key", () => {
		const main = [{ sku: undefined as string | undefined, title: "orphan" }];
		const detail = [{ sku: undefined as string | undefined, bcId: 7 }];

		const rows = new Braid()
			.main({ source: main, key: (p) => p.sku })
			.join({
				name: "bigcommerce",
				source: detail,
				on: (bc) => bc.sku,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.bigcommerce, null);
	});

	test('falsy-but-real keys such as 0 and "" still match', () => {
		const main = [{ id: 0, title: "zero" }];
		const detail = [{ ref: 0, label: "hit" }];

		const rows = new Braid()
			.main({ source: main, key: (p) => p.id })
			.join({
				name: "detail",
				source: detail,
				on: (d) => d.ref,
				type: "single",
			})
			.run();

		assert.strictEqual(rows[0]?.detail?.label, "hit");
	});
});

describe("Braid key equality", () => {
	/**
	 * Both sides typed loosely, as they are when ids arrive as JSON from two
	 * platforms that disagree about quoting. The type system can't help here, so
	 * these pin what the runtime does.
	 */
	function joinOn(
		mainKey: BraidKey,
		detailKey: BraidKey,
	): { hit: string } | null {
		const rows = new Braid()
			.main({ source: [{ key: mainKey }], key: (row) => row.key })
			.join({
				name: "detail",
				source: [{ key: detailKey, hit: "matched" }],
				on: (row) => row.key,
				type: "single",
			})
			.run();

		return rows[0]?.detail ?? null;
	}

	test('a string key never matches its numeric twin: "2" is not 2', () => {
		assert.strictEqual(joinOn("2", 2), null);
		assert.strictEqual(joinOn(2, "2"), null);
	});

	test("a bigint never matches the equivalent number", () => {
		assert.strictEqual(joinOn(2, 2n), null);
	});

	test("a boolean never matches the number it coerces to", () => {
		assert.strictEqual(joinOn(1, true), null);
		assert.strictEqual(joinOn(0, false), null);
	});

	test("NaN matches NaN, which === would not", () => {
		assert.strictEqual(joinOn(Number.NaN, Number.NaN)?.hit, "matched");
	});

	test("0 matches -0, which Object.is would not", () => {
		assert.strictEqual(joinOn(0, -0)?.hit, "matched");
	});

	test("an exact string match still matches", () => {
		assert.strictEqual(joinOn("2", "2")?.hit, "matched");
	});
});

describe("Braid.join required", () => {
	test("a required join throws when a main row has no match", () => {
		assert.throws(
			() =>
				new Braid()
					.main({ source: PRODUCTS, key: (p) => p.sku })
					.join({
						name: "bigcommerce",
						source: BC_PRODUCTS,
						on: (bc) => bc.sku,
						type: "single",
						required: true,
					})
					.run(),
			BraidError,
		);
	});

	test("the required error names the join and the offending key", () => {
		assert.throws(
			() =>
				new Braid()
					.main({ name: "product", source: PRODUCTS, key: (p) => p.sku })
					.join({
						name: "bigcommerce",
						source: BC_PRODUCTS,
						on: (bc) => bc.sku,
						type: "single",
						required: true,
					})
					.run(),
			(error: unknown) =>
				error instanceof BraidError &&
				error.message.includes('"bigcommerce"') &&
				error.message.includes('"CAP-GRN"') &&
				error.message.includes("product"),
		);
	});

	test("a required join is satisfied when every main row matches", () => {
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

		assert.deepStrictEqual(
			rows.map((row) => row.bigcommerce.bcId),
			[101, 102],
		);
	});

	test("a required many join throws when a main row matches nothing", () => {
		assert.throws(
			() =>
				new Braid()
					.main({ source: PRODUCTS, key: (p) => p.sku })
					.join({
						name: "variations",
						source: VARIATIONS,
						on: (v) => v.productId,
						key: (p) => p.id,
						type: "many",
						required: true,
					})
					.run(),
			BraidError,
		);
	});
});

describe("Braid.join validation", () => {
	const withMain = () =>
		new Braid().main({ source: PRODUCTS, key: (p) => p.sku });

	test("a duplicate join name throws at .join() time", () => {
		const builder = withMain().join({
			name: "bigcommerce",
			source: BC_PRODUCTS,
			on: (bc) => bc.sku,
			type: "single",
		});

		assert.throws(() => {
			// @ts-expect-error "bigcommerce" is already used
			builder.join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});
		}, BraidError);
	});

	test("a missing name throws", () => {
		assert.throws(() => {
			// @ts-expect-error name is required
			withMain().join({
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				type: "single",
			});
		}, BraidError);
	});

	test("a missing source throws", () => {
		assert.throws(() => {
			// @ts-expect-error source is required
			withMain().join({
				name: "bigcommerce",
				on: (_bc: unknown) => "x",
				type: "single",
			});
		}, BraidError);
	});

	test("a missing on extractor throws", () => {
		assert.throws(() => {
			// @ts-expect-error on is required
			withMain().join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				type: "single",
			});
		}, BraidError);
	});

	test("a missing type throws", () => {
		assert.throws(() => {
			// @ts-expect-error type is required
			withMain().join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
			});
		}, BraidError);
	});

	test("an unknown type throws", () => {
		assert.throws(() => {
			withMain().join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				// @ts-expect-error "one" is not a join type
				type: "one",
			});
		}, BraidError);
	});

	test("a non-function key override throws", () => {
		assert.throws(() => {
			withMain().join({
				name: "bigcommerce",
				source: BC_PRODUCTS,
				on: (bc) => bc.sku,
				// @ts-expect-error key must be a function
				key: "sku",
				type: "single",
			});
		}, BraidError);
	});
});

describe("Braid chaining", () => {
	test("three joins stitch independently onto the same rows", () => {
		const rows = new Braid()
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
			})
			.join({
				name: "variations",
				source: VARIATIONS,
				on: (v) => v.productId,
				key: (p) => p.id,
				type: "many",
			})
			.run();

		assert.deepStrictEqual(rows[2], {
			id: 3,
			sku: "CAP-GRN",
			title: "Green cap",
			bigcommerce: null,
			shopify: { sku: "CAP-GRN", handle: "green-cap" },
			variations: [],
		});
	});

	test("joinNames reports the configured joins in order", () => {
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

		assert.deepStrictEqual(builder.joinNames, ["bigcommerce", "shopify"]);
	});

	test("a braid with no joins is just a copy of the main collection", () => {
		const rows = new Braid()
			.main({ source: PRODUCTS, key: (p) => p.sku })
			.run();

		assert.deepStrictEqual(
			rows,
			PRODUCTS.map((product) => ({ ...product })),
		);
	});
});
