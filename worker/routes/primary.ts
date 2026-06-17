import { Hono } from "hono";
import type { Address } from "viem";
import type { Env } from "../lib/config";
import { getNetworkConfig } from "../lib/config";
import { normalizeEnsName } from "../lib/node";
import { buildSetPrimaryCalldata } from "../lib/calldata";

const app = new Hono<{ Bindings: Env }>();

app.post("/primary", async (c) => {
	const body = await c.req.json<{
		name: string;
		address: string;
		owner?: string;
		network?: string;
	}>();

	if (!body.name) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "name is required" } },
			400,
		);
	}
	if (!body.address) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "address is required" } },
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);

	const { fullName } = normalizeEnsName(body.name);
	const address = body.address as Address;
	const owner = (body.owner || body.address) as Address;

	const tx = buildSetPrimaryCalldata(address, owner, config.resolver, fullName, config);

	return c.json({
		ok: true,
		data: {
			tx,
			name: fullName,
			address,
			owner,
			network,
		},
	});
});

export default app;
