import { Hono } from "hono";
import type { Address } from "viem";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { resolveName } from "../lib/reads";

const app = new Hono<{ Bindings: Env }>();

app.get("/resolve", async (c) => {
	const input = c.req.query("input");
	if (!input) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "input is required" } },
			400,
		);
	}

	const network = c.req.query("network") || "sepolia";
	const txt = c.req.query("txt") || undefined;
	const contenthash = c.req.query("contenthash") === "true";
	const resolver = c.req.query("resolver") as Address | undefined;
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const result = await resolveName(input, client, config, config.ensNodeSubgraph, {
		txt,
		contenthash: contenthash || undefined,
		resolver,
	});

	return c.json({ ok: true, data: result });
});

export default app;
