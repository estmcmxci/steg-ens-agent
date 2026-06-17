import { Hono } from "hono";
import type { Address } from "viem";
import { namehash } from "viem";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { computeCommitment, getMinCommitmentAge } from "../lib/reads";
import { buildCommitCalldata, buildResolverData } from "../lib/calldata";
import { parseDuration, DEFAULT_DURATION } from "../lib/duration";

const app = new Hono<{ Bindings: Env }>();

app.post("/commit", async (c) => {
	const body = await c.req.json<{
		label: string;
		owner: string;
		duration?: string | number;
		duration_years?: number;
		set_primary?: boolean;
		network?: string;
	}>();

	if (!body.label) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "label is required" } },
			400,
		);
	}
	if (!body.owner) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "owner is required" } },
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);
	const owner = body.owner as Address;
	const durationSeconds = body.duration
		? (parseDuration(body.duration) || DEFAULT_DURATION)
		: body.duration_years
			? parseDuration(`${body.duration_years}y`) || DEFAULT_DURATION
			: DEFAULT_DURATION;
	const setPrimary = body.set_primary ?? true;

	// Normalize label
	const normalizedLabel = normalize(body.label);
	const fullName = `${normalizedLabel}.eth`;
	const node = namehash(fullName) as `0x${string}`;

	// Generate secret
	const secretBytes = new Uint8Array(32);
	crypto.getRandomValues(secretBytes);
	const secret = `0x${Array.from(secretBytes).map((b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

	// Build resolver data (set address to owner)
	const resolverData = buildResolverData(node, owner);

	// Compute commitment
	const commitment = await computeCommitment(
		normalizedLabel,
		owner,
		durationSeconds,
		secret,
		config.resolver,
		resolverData,
		setPrimary,
		client,
		config,
	);

	// Build commit tx
	const tx = buildCommitCalldata(commitment, config);

	// Get wait time
	const minAge = await getMinCommitmentAge(client, config);
	const waitSeconds = Number(minAge) + 5;

	// Store session in KV
	const sessionId = crypto.randomUUID();
	await c.env.ENS_SESSIONS.put(
		sessionId,
		JSON.stringify({
			secret,
			label: normalizedLabel,
			owner,
			duration: durationSeconds.toString(),
			set_primary: setPrimary,
			resolver: config.resolver,
			resolver_data: resolverData,
			commitment,
			network,
			created_at: Date.now(),
		}),
		{ expirationTtl: 86400 }, // 24h TTL
	);

	return c.json({
		ok: true,
		data: {
			session_id: sessionId,
			tx,
			wait_seconds: waitSeconds,
			commitment,
			name: fullName,
			network,
		},
	});
});

export default app;
