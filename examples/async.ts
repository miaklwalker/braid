/**
 * The same braid, but the detail collections come from other platforms' APIs.
 *
 * The point of this example is that nothing about the join changes: you hand
 * Braid a fetcher instead of an array, the fetchers run concurrently, and the
 * result type becomes a promise on its own.
 *
 * Run with:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning examples/async.ts
 */

import { Braid, BraidError } from "../main.ts";

interface Order {
	reference: string;
	channel: "bigcommerce" | "shopify";
	customerId: number;
	total: number;
}

interface Customer {
	id: number;
	email: string;
}

interface Shipment {
	orderReference: string;
	carrier: string;
	trackingNumber: string;
}

const orders: Order[] = [
	{ reference: "BC-1001", channel: "bigcommerce", customerId: 7, total: 38 },
	{ reference: "SH-2002", channel: "shopify", customerId: 8, total: 19 },
	{ reference: "SH-2003", channel: "shopify", customerId: 7, total: 9 },
];

/** Stands in for an API call — slow, and resolving to a plain array. */
function withLatency<T>(rows: readonly T[], ms: number): Promise<readonly T[]> {
	return new Promise((resolve) => setTimeout(() => resolve(rows), ms));
}

function fetchCustomers(): Promise<readonly Customer[]> {
	return withLatency(
		[
			{ id: 7, email: "ada@example.com" },
			{ id: 8, email: "grace@example.com" },
		],
		60,
	);
}

function fetchShipments(): Promise<readonly Shipment[]> {
	return withLatency(
		[
			{ orderReference: "BC-1001", carrier: "DPD", trackingNumber: "DPD-1" },
			{ orderReference: "BC-1001", carrier: "DPD", trackingNumber: "DPD-2" },
			{ orderReference: "SH-2002", carrier: "Evri", trackingNumber: "EV-9" },
		],
		60,
	);
}

const started = performance.now();

// No `.run()` needed — the builder is awaitable. Both fetchers are in flight at
// once, so this costs one round trip, not two.
const dispatched = await new Braid()
	.main({ name: "order", source: orders, key: (order) => order.reference })
	.join({
		name: "shipments",
		source: fetchShipments,
		on: (shipment) => shipment.orderReference,
		type: "many",
	})
	.join({
		name: "customer",
		source: fetchCustomers,
		on: (customer) => customer.id,
		key: (order) => order.customerId,
		type: "single",
		// Every order must belong to a customer; a miss here is a data bug worth
		// failing on rather than a null to handle downstream.
		required: true,
	});

console.log(
	`Braided ${dispatched.length} orders in ${(performance.now() - started).toFixed(0)}ms`,
);

for (const order of dispatched) {
	// `customer` is non-nullable because the join is required.
	const tracking =
		order.shipments.map((shipment) => shipment.trackingNumber).join(", ") ||
		"—";
	console.log(
		`${order.reference}  ${order.customer.email.padEnd(20)} ${tracking}`,
	);
}

// A required join that can't be satisfied fails loudly, naming the key that
// went missing rather than leaving an undefined to trip over later.
try {
	await new Braid()
		.main({ name: "order", source: orders, key: (order) => order.reference })
		.join({
			name: "shipments",
			source: fetchShipments,
			on: (shipment) => shipment.orderReference,
			type: "many",
			required: true,
		});
} catch (error) {
	if (!(error instanceof BraidError)) throw error;
	console.log(`\nCaught as expected: ${error.message}`);
}
