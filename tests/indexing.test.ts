import assert from "node:assert";
import test, { describe } from "node:test";
import { groupBy, indexBy, isJoinableKey } from "../modules/index.ts";
import { BC_PRODUCTS, VARIATIONS } from "./support.ts";

describe("isJoinableKey", () => {
	test("rejects null and undefined and accepts every other primitive", () => {
		assert.strictEqual(isJoinableKey(null), false);
		assert.strictEqual(isJoinableKey(undefined), false);
		assert.strictEqual(isJoinableKey(0), true);
		assert.strictEqual(isJoinableKey(""), true);
		assert.strictEqual(isJoinableKey(false), true);
		assert.strictEqual(isJoinableKey(Symbol.iterator), true);
	});
});

describe("indexBy", () => {
	test("maps each key to its row", () => {
		const index = indexBy(BC_PRODUCTS, (bc) => bc.sku);

		assert.strictEqual(index.size, 3);
		assert.strictEqual(index.get("MUG-RED")?.bcId, 102);
	});

	test("keeps the last row when a key repeats", () => {
		const index = indexBy(
			[
				{ sku: "A", bcId: 1 },
				{ sku: "A", bcId: 2 },
			],
			(bc) => bc.sku,
		);

		assert.strictEqual(index.get("A")?.bcId, 2);
	});

	test("skips rows with a nullish key", () => {
		const index = indexBy([{ sku: null }, { sku: "A" }], (bc) => bc.sku);

		assert.deepStrictEqual([...index.keys()], ["A"]);
	});

	test("an empty source produces an empty index", () => {
		assert.strictEqual(indexBy([], (row: { id: number }) => row.id).size, 0);
	});
});

describe("groupBy", () => {
	test("collects rows per key in source order", () => {
		const index = groupBy(VARIATIONS, (v) => v.productId);

		assert.deepStrictEqual(
			index.get(1)?.map((v) => v.option),
			["S", "M"],
		);
	});

	test("never produces an empty group", () => {
		const index = groupBy(VARIATIONS, (v) => v.productId);

		for (const group of index.values()) {
			assert.ok(group.length > 0);
		}
	});

	test("skips rows with a nullish key", () => {
		const index = groupBy([{ ref: undefined }, { ref: 1 }], (row) => row.ref);

		assert.deepStrictEqual([...index.keys()], [1]);
	});
});
