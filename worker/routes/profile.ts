import { Hono } from "hono";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { getProfile } from "../lib/reads";

const app = new Hono<{ Bindings: Env }>();

app.get("/profile", async (c) => {
	const input = c.req.query("input");
	if (!input) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "input is required" } },
			400,
		);
	}

	const network = c.req.query("network") || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const result = await getProfile(input, client, config, config.ensNodeSubgraph);
	return c.json({ ok: true, data: result });
});

export default app;
