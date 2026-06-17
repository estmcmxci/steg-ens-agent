import { Hono } from "hono";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { listNames } from "../lib/reads";

const app = new Hono<{ Bindings: Env }>();

app.get("/list", async (c) => {
	const address = c.req.query("address");
	if (!address) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "address is required" } },
			400,
		);
	}

	const network = c.req.query("network") || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const result = await listNames(address, config.ensNodeSubgraph, client, config);
	return c.json({ ok: true, data: { ...result, network } });
});

export default app;
