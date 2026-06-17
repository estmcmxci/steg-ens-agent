import { Hono } from "hono";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { checkName } from "../lib/reads";
import { parseDuration, DEFAULT_DURATION } from "../lib/duration";

const app = new Hono<{ Bindings: Env }>();

app.get("/check", async (c) => {
	const label = c.req.query("label");
	if (!label) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "label is required" } },
			400,
		);
	}

	const durationParam = c.req.query("duration");
	const durationSeconds = parseDuration(durationParam) || DEFAULT_DURATION;

	const network = c.req.query("network") || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const result = await checkName(label, durationSeconds, client, config);
	return c.json({ ok: true, data: result });
});

export default app;
