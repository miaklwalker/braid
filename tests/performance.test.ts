import assert from "node:assert";
import test, { describe } from "node:test";
import { Braid } from "../modules/index.ts";
import { counted } from "./support.ts";

interface Row {
	readonly id: number;
	readonly sku: string;
}

const SIZE = 10_000;

const MAIN: readonly Row[] = Array.from({ length: SIZE }, (_, index) => ({
	id: index,
	sku: `SKU-${index}`,
}));

const DETAIL: readonly Row[] = Array.from({ length: SIZE }, (_, index) => ({
	id: index,
	sku: `SKU-${index}`,
}));

describe("Braid indexing cost", () => {
	test("each source is visited once per row, not once per main row", () => {
		const mainKey = counted((row: Row) => row.sku);
		const detailKey = counted((row: Row) => row.sku);

		new Braid()
			.main({ source: MAIN, key: mainKey })
			.join({ name: "a", source: DETAIL, on: detailKey, type: "single" })
			.join({ name: "b", source: DETAIL, on: detailKey, type: "single" })
			.join({ name: "c", source: DETAIL, on: detailKey, type: "many" })
			.run();

		// Three joins × one pass over the detail source each.
		assert.strictEqual(detailKey.calls, SIZE * 3);
		// One extraction per main row per join — never a scan.
		assert.strictEqual(mainKey.calls, SIZE * 3);
	});

	test("10k main rows across three joins stitch well inside a quadratic budget", () => {
		const started = performance.now();

		const rows = new Braid()
			.main({ source: MAIN, key: (row) => row.sku })
			.join({ name: "a", source: DETAIL, on: (row) => row.sku, type: "single" })
			.join({ name: "b", source: DETAIL, on: (row) => row.sku, type: "single" })
			.join({ name: "c", source: DETAIL, on: (row) => row.sku, type: "many" })
			.run();

		const elapsed = performance.now() - started;

		assert.strictEqual(rows.length, SIZE);
		assert.strictEqual(rows.at(-1)?.a?.id, SIZE - 1);
		assert.strictEqual(rows.at(-1)?.c.length, 1);
		assert.ok(
			elapsed < 1_000,
			`expected under 1000ms, took ${elapsed.toFixed(0)}ms`,
		);
	});
});
