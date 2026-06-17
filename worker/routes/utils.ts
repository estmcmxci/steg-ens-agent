import { Hono } from "hono";
import { namehash, keccak256, toBytes } from "viem";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig, ENS_DEPLOYMENTS } from "../lib/config";
import { normalizeEnsName } from "../lib/node";
import { getResolverRecord } from "../lib/reads";
import { getDomainByName } from "../lib/ensnode";

const app = new Hono<{ Bindings: Env }>();

/** GET /namehash?name=X */
app.get("/namehash", (c) => {
	const name = c.req.query("name");
	if (!name) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "name is required" } },
			400,
		);
	}

	let hash: string;
	if (name.includes(".")) {
		hash = namehash(name);
	} else {
		const { fullName, node } = normalizeEnsName(name);
		return c.json({ ok: true, data: { name: fullName, node } });
	}

	return c.json({ ok: true, data: { name, node: hash } });
});

/** GET /labelhash?label=X */
app.get("/labelhash", (c) => {
	const label = c.req.query("label");
	if (!label) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "label is required" } },
			400,
		);
	}

	const first = label.split(".")[0];
	const normalizedLabel = normalize(first);
	const hash = keccak256(toBytes(normalizedLabel));

	return c.json({ ok: true, data: { label: normalizedLabel, labelhash: hash } });
});

/** GET /resolver?name=X&network=Z */
app.get("/resolver", async (c) => {
	const name = c.req.query("name");
	if (!name) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "name is required" } },
			400,
		);
	}

	const network = c.req.query("network") || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const { fullName, node } = normalizeEnsName(name);

	// Try ENSNode first
	let resolver: string | null = null;
	let source = "on-chain";
	try {
		const ensNodeData = await getDomainByName(fullName, config.ensNodeSubgraph);
		if (ensNodeData?.resolver?.address) {
			resolver = ensNodeData.resolver.address;
			source = "ensnode";
		}
	} catch { /* fall through */ }

	if (!resolver) {
		resolver = await getResolverRecord(node, client, config);
	}

	return c.json({
		ok: true,
		data: {
			name: fullName,
			resolver,
			source,
			network,
		},
	});
});

/** GET /deployments */
app.get("/deployments", (c) => {
	return c.json({ ok: true, data: ENS_DEPLOYMENTS });
});

export default app;
