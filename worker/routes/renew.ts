import { Hono } from "hono";
import { formatEther } from "viem";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { getRentPrice } from "../lib/reads";
import { buildRenewCalldata } from "../lib/calldata";
import { parseDuration, DEFAULT_DURATION } from "../lib/duration";

const app = new Hono<{ Bindings: Env }>();

app.post("/renew", async (c) => {
	const body = await c.req.json<{
		label: string;
		duration?: string | number;
		duration_years?: number;
		network?: string;
	}>();

	if (!body.label) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "label is required" } },
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);
	const durationSeconds = body.duration
		? (parseDuration(body.duration) || DEFAULT_DURATION)
		: body.duration_years
			? parseDuration(`${body.duration_years}y`) || DEFAULT_DURATION
			: DEFAULT_DURATION;

	const normalizedLabel = normalize(body.label);
	const fullName = `${normalizedLabel}.eth`;

	// Get price with buffer
	const price = await getRentPrice(normalizedLabel, durationSeconds, client, config);

	// Build renew tx
	const tx = buildRenewCalldata(
		normalizedLabel,
		durationSeconds,
		price.totalWithBuffer,
		config,
	);

	return c.json({
		ok: true,
		data: {
			tx,
			price_eth: formatEther(price.total),
			price_with_buffer_eth: formatEther(price.totalWithBuffer),
			name: fullName,
			duration_seconds: Number(durationSeconds),
			network,
		},
	});
});

export default app;
