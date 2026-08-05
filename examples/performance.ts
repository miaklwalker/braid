/**
 * Braid against the loop it replaces: the same seven joins written once with
 * `.find()` / `.filter()` inside a `.map()`, and once as a braid.
 *
 * The shape is a listing row that has to be enriched from two sales channels
 * and four database tables — five one-to-one sources and two one-to-many ones.
 * Both implementations produce identical output; the only difference is that
 * the naive version rescans every detail array for every listing row.
 *
 * It also reports what each approach costs in memory. Braid trades space for
 * time — one `Map` per join — so its peak heap is higher, but the indexes are
 * garbage the moment `.run()` returns and what's still held afterwards is the
 * output rows both approaches produce anyway.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/performance.ts
 *
 * Pass a row count to see how the gap widens:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/performance.ts 2000
 */

import assert from "node:assert";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { Braid } from "../main.ts";

/** How many rows each `single` source holds — one per listing row. */
const singleRowCount = Number(process.argv[2] ?? 100);
const runCount = Number(process.argv[3] ?? 3);
/** How many rows each `many` source holds per listing row. */
const manyRowsPerSingle = 4;

interface ListRow {
	id: number;
	sku: string;
	productId: number;
	modelId: number;
	brandId: number;
	title: string;
}

interface ChannelParentItem {
	sku: string;
	listingId: string;
	price: number;
}

interface ChannelChildItem {
	parentSku: string;
	variantId: string;
	stock: number;
}

interface DbProduct {
	id: number;
	name: string;
}

interface DbModel {
	id: number;
	name: string;
}

interface DbBrand {
	id: number;
	name: string;
}

interface DbSku {
	productId: number;
	code: string;
}

interface Sources {
	listRows: ListRow[];
	channelOneParentItems: ChannelParentItem[];
	channelTwoParentItems: ChannelParentItem[];
	channelTwoChildItems: ChannelChildItem[];
	dbProducts: DbProduct[];
	dbModels: DbModel[];
	dbBrands: DbBrand[];
	dbSkus: DbSku[];
}

/**
 * Builds a full set of sources for `count` listing rows. Every row matches in
 * every source, which is the case that flatters the naive version most — a miss
 * costs it a full scan with nothing to show for it.
 */
function buildSources(count: number): Sources {
	const listRows: ListRow[] = [];
	const channelOneParentItems: ChannelParentItem[] = [];
	const channelTwoParentItems: ChannelParentItem[] = [];
	const channelTwoChildItems: ChannelChildItem[] = [];
	const dbProducts: DbProduct[] = [];
	const dbModels: DbModel[] = [];
	const dbBrands: DbBrand[] = [];
	const dbSkus: DbSku[] = [];

	for (let index = 0; index < count; index += 1) {
		const sku = `SKU-${index}`;

		listRows.push({
			id: index,
			sku,
			productId: 5_000 + index,
			modelId: 10_000 + index,
			brandId: 20_000 + index,
			title: `Listing ${index}`,
		});

		channelOneParentItems.push({
			sku,
			listingId: `C1-${index}`,
			price: 10 + index,
		});
		channelTwoParentItems.push({
			sku,
			listingId: `C2-${index}`,
			price: 12 + index,
		});
		dbProducts.push({ id: 5_000 + index, name: `Product ${index}` });
		dbModels.push({ id: 10_000 + index, name: `Model ${index}` });
		dbBrands.push({ id: 20_000 + index, name: `Brand ${index}` });

		for (let child = 0; child < manyRowsPerSingle; child += 1) {
			channelTwoChildItems.push({
				parentSku: sku,
				variantId: `C2-${index}-${child}`,
				stock: child,
			});
			dbSkus.push({ productId: 5_000 + index, code: `SKU-${index}-${child}` });
		}
	}

	return {
		listRows,
		channelOneParentItems,
		channelTwoParentItems,
		channelTwoChildItems,
		dbProducts,
		dbModels,
		dbBrands,
		dbSkus,
	};
}

/** The pattern Braid exists to replace: a linear scan per row, per source. */
function stitchNaively(sources: Sources) {
	return sources.listRows.map((listRow) => ({
		...listRow,
		channelOneParentItem:
			sources.channelOneParentItems.find((item) => item.sku === listRow.sku) ??
			null,
		channelTwoParentItem:
			sources.channelTwoParentItems.find((item) => item.sku === listRow.sku) ??
			null,
		channelTwoChildItems: sources.channelTwoChildItems.filter(
			(item) => item.parentSku === listRow.sku,
		),
		dbProduct:
			sources.dbProducts.find((product) => product.id === listRow.productId) ??
			null,
		dbModel:
			sources.dbModels.find((model) => model.id === listRow.modelId) ?? null,
		dbBrand:
			sources.dbBrands.find((brand) => brand.id === listRow.brandId) ?? null,
		dbSkus: sources.dbSkus.filter(
			(dbSku) => dbSku.productId === listRow.productId,
		),
	}));
}

/**
 * The same seven joins, declared. Three key off the listing SKU (the braid's
 * default key) and four override it with an id, which is what the `key` option
 * is for.
 */
function stitchWithBraid(sources: Sources) {
	return new Braid()
		.main({
			name: "listRow",
			source: sources.listRows,
			key: (listRow) => listRow.sku,
		})
		.join({
			name: "channelOneParentItem",
			source: sources.channelOneParentItems,
			on: (item) => item.sku,
			type: "single",
		})
		.join({
			name: "channelTwoParentItem",
			source: sources.channelTwoParentItems,
			on: (item) => item.sku,
			type: "single",
		})
		.join({
			name: "channelTwoChildItems",
			source: sources.channelTwoChildItems,
			on: (item) => item.parentSku,
			type: "many",
		})
		.join({
			name: "dbProduct",
			source: sources.dbProducts,
			on: (product) => product.id,
			key: (listRow) => listRow.productId,
			type: "single",
		})
		.join({
			name: "dbModel",
			source: sources.dbModels,
			on: (model) => model.id,
			key: (listRow) => listRow.modelId,
			type: "single",
		})
		.join({
			name: "dbBrand",
			source: sources.dbBrands,
			on: (brand) => brand.id,
			key: (listRow) => listRow.brandId,
			type: "single",
		})
		.join({
			name: "dbSkus",
			source: sources.dbSkus,
			on: (dbSku) => dbSku.productId,
			key: (listRow) => listRow.productId,
			type: "many",
		})
		.run();
}

/**
 * Node only exposes the collector behind `--expose-gc`, so ask V8 for it
 * directly. Without a forced collection, heap deltas measure whatever garbage
 * happened to be lying around rather than what each approach actually holds.
 */
function resolveCollectGarbage(): () => void {
	const exposed = (globalThis as { gc?: () => void }).gc;
	if (exposed !== undefined) return exposed;

	v8.setFlagsFromString("--expose-gc");
	const collect = runInNewContext("gc") as () => void;
	v8.setFlagsFromString("--no-expose-gc");
	return collect;
}

const collectGarbage = resolveCollectGarbage();

interface HeapMeasurement<T> {
	/** High-water mark: everything the approach allocated and hadn't dropped yet. */
	peak: number;
	/** What's still alive once the result is the only thing being held. */
	retained: number;
	result: T;
}

/**
 * Measures the heap cost of one stitch. Braid's indexes are unreachable the
 * moment `.run()` returns but haven't been collected yet, so they show up in
 * `peak` and not in `retained` — which is exactly the trade: transient memory
 * for linear time.
 */
function measureHeap<T>(work: () => T): HeapMeasurement<T> {
	collectGarbage();
	collectGarbage();
	const baseline = process.memoryUsage().heapUsed;

	const result = work();
	const peak = process.memoryUsage().heapUsed - baseline;

	collectGarbage();
	collectGarbage();
	const retained = process.memoryUsage().heapUsed - baseline;

	// `result` is returned, so V8 can't collect the output rows early and
	// flatter the retained figure.
	return { peak, retained, result };
}

function formatBytes(bytes: number): string {
	const megabytes = bytes / 1_048_576;
	return megabytes >= 1
		? `${megabytes.toFixed(1)} MB`
		: `${(bytes / 1024).toFixed(0)} KB`;
}

/** Best of a few runs, which is stabler than an average on a JIT. */
function fastestRun(work: () => unknown, runs: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (let run = 0; run < runs; run += 1) {
		const started = performance.now();
		work();
		best = Math.min(best, performance.now() - started);
	}
	return best;
}

function compare(count: number, runs: number): Record<string, string> {
	const sources = buildSources(count);

	// Identical output is the whole premise — this measures the same work twice,
	// not two different jobs.
	assert.deepStrictEqual(stitchWithBraid(sources), stitchNaively(sources));
	const detailRows = count * 5 + count * manyRowsPerSingle * 2;
	// Warm both paths before measuring, so the first heap reading isn't paying
	// for code the JIT hasn't compiled yet.
	stitchWithBraid(sources);
	const braidHeap = measureHeap(() => stitchWithBraid(sources));
	// if row count greater than 10,000 skip naive
	if (count >= 10_000) {
		const braided = fastestRun(() => stitchWithBraid(sources), runs);
		return {
			"Row Count": `${String(count).padStart(6)} rows`,
			"Detail Row Count": `${String(detailRows).padStart(7)} detail rows`,
			"Naive Fastest": `N/A`,
			"Braid Fastest": `${braided.toFixed(1).padStart(6)}ms`,
			Difference: `N/A`,
			"Comparisons Avoided": `N/A`,
			"Naive Peak Heap": `N/A`,
			"Braid Peak Heap": formatBytes(braidHeap.peak).padStart(7),
			"Naive Heap Held": `N/A`,
			"Braid Heap Held": formatBytes(braidHeap.retained).padStart(7),
		};
	}
	stitchNaively(sources);
	const naiveHeap = measureHeap(() => stitchNaively(sources));
	const naive = fastestRun(() => stitchNaively(sources), runs);
	const braided = fastestRun(() => stitchWithBraid(sources), runs);

	return {
		"Row Count": `${String(count).padStart(6)} rows`,
		"Detail Row Count": `${String(detailRows).padStart(7)} detail rows`,
		"Naive Fastest": `${naive.toFixed(1).padStart(8)}ms`,
		"Braid Fastest": `${braided.toFixed(1).padStart(6)}ms`,
		Difference: `${(naive / braided).toFixed(1).padStart(5)}× faster`,
		"Comparisons Avoided": `${((count * detailRows) / 1e6).toFixed(1).padStart(6)}M comparisons avoided`,
		"Naive Peak Heap": formatBytes(naiveHeap.peak).padStart(7),
		"Braid Peak Heap": formatBytes(braidHeap.peak).padStart(7),
		"Naive Heap Held": formatBytes(naiveHeap.retained).padStart(7),
		"Braid Heap Held": formatBytes(braidHeap.retained).padStart(7),
	};
}

const runs = [1, 5, 10, 20, 40, 80, 160].map((multiplier) =>
	compare(singleRowCount * multiplier, runCount),
);
console.table(runs);
