import { Hono } from "hono";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { verifyName } from "../lib/reads";

const app = new Hono<{ Bindings: Env }>();

app.get("/verify", async (c) => {
	const name = c.req.query("name");
	if (!name) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "name is required" } },
			400,
		);
	}

	const network = c.req.query("network") || "sepolia";
	const recordsParam = c.req.query("records");
	const expectedRecords = recordsParam ? recordsParam.split(",") : undefined;
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const result = await verifyName(name, client, config, expectedRecords);
	return c.json({ ok: true, data: result });
});

export default app;
