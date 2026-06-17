import { Hono } from "hono";
import type { Address, Hex } from "viem";
import type { Env } from "../lib/config";
import { getNetworkConfig } from "../lib/config";
import { normalizeEnsName } from "../lib/node";
import { validateTextRecordKey } from "../lib/ensip5";
import {
	buildSetTextCalldata,
	buildSetAddrCalldata,
	buildMulticallCalldata,
} from "../lib/calldata";

const app = new Hono<{ Bindings: Env }>();

app.post("/records", async (c) => {
	const body = await c.req.json<{
		name: string;
		text_records?: Record<string, string>;
		address?: string;
		resolver?: string;
		network?: string;
	}>();

	if (!body.name) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "name is required" } },
			400,
		);
	}

	if (!body.text_records && !body.address) {
		return c.json(
			{
				ok: false,
				error: {
					code: "MISSING_PARAM",
					message: "At least one of text_records or address is required",
				},
			},
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);

	const { fullName, node } = normalizeEnsName(body.name);
	const resolver = (body.resolver as Address) || config.resolver;

	const calls: Hex[] = [];
	const recordsSet: string[] = [];
	const warnings: string[] = [];

	// Build setText calldata entries
	if (body.text_records) {
		for (const [key, value] of Object.entries(body.text_records)) {
			const validation = validateTextRecordKey(key);
			if (validation.warning) {
				warnings.push(validation.warning);
			}

			const txData = buildSetTextCalldata(node, key, value, resolver);
			calls.push(txData.data);
			recordsSet.push(`text:${key}`);
		}
	}

	// Build setAddr calldata
	if (body.address) {
		const txData = buildSetAddrCalldata(
			node,
			body.address as Address,
			resolver,
		);
		calls.push(txData.data);
		recordsSet.push("addr");
	}

	// Single call or multicall
	let tx;
	if (calls.length === 1) {
		// Use direct call (no multicall wrapper)
		if (body.address && !body.text_records) {
			tx = buildSetAddrCalldata(node, body.address as Address, resolver);
		} else if (body.text_records && !body.address) {
			const entries = Object.entries(body.text_records);
			if (entries.length === 1) {
				tx = buildSetTextCalldata(node, entries[0][0], entries[0][1], resolver);
			} else {
				tx = buildMulticallCalldata(resolver, calls);
			}
		} else {
			tx = buildMulticallCalldata(resolver, calls);
		}
	} else {
		tx = buildMulticallCalldata(resolver, calls);
	}

	return c.json({
		ok: true,
		data: {
			tx,
			records_set: recordsSet,
			warnings,
			name: fullName,
			network,
		},
	});
});

export default app;
