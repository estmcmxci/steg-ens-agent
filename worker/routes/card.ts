/**
 * GET /card/:name — ERC-8004 / A2A agent card, rendered from on-chain ENS state.
 *
 * This is the target an agent's `agentURI` points at (PLAN.md §3): instead of a
 * static per-agent file, the card is generated from the name's ENS records
 * (ENSIP-26 discovery fields) plus a live verification of its ERC-8004 binding
 * via the adapter8004 `bindingOf()` read.
 *
 * Success returns the RAW card JSON (so a consumer fetching agentURI gets the
 * A2A card directly, not an {ok,data} envelope). Failures return the standard
 * error envelope. Public + keyless — it's a published identity document.
 *
 * Content sources:
 *  - identity/discovery: ENS text records (display, description, avatar,
 *    agent-endpoint[web], agent-context, …)
 *  - registration: `agent-id` record → adapter8004.bindingOf() verifies the
 *    agentId actually binds THIS name's wrapped NFT (ERC-1155 tokenId == namehash)
 *  - authorization: the auth.* records + /evaluate model, surfaced as `x-authorization`
 */

import { Hono } from "hono";
import { isAddress } from "viem";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { ADAPTER_8004_ABI, RESOLVER_ABI } from "../lib/abi";
import { normalizeEnsName } from "../lib/node";
import { getResolverRecord, getTextRecordPublic } from "../lib/reads";
import { resolveAvatarUri } from "../lib/avatar";

const app = new Hono<{ Bindings: Env }>();

// ENS text record keys the card reads. ENSIP-26 discovery keys + our conventions
// (agent-id / agent-skills / agent-trust-models / agent-provider / agent-version
// are written by onboarding; agent-skills & co. are JSON-encoded strings).
const CARD_TEXT_KEYS = [
	"display",
	"description",
	"avatar",
	"url",
	"keywords",
	"agent-context",
	"agent-endpoint[web]",
	"agent-endpoint[a2a]",
	"agent-endpoint[mcp]",
	"agent-id",
	"agent-skills",
	"agent-trust-models",
	"agent-provider",
	"agent-version",
	"agent-registration-signature",
];

function safeJson<T>(raw: string | undefined): T | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

app.get("/card/:name", async (c) => {
	const name = c.req.param("name");
	// Cards are mainnet by default (that's where the agent identity lives).
	const network = c.req.query("network") || "mainnet";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	if (!name || isAddress(name) || !name.includes(".")) {
		return c.json(
			{ ok: false, error: { code: "INVALID_PARAM", message: "card requires an ENS name, e.g. /card/agent.steg.eth" } },
			400,
		);
	}

	const { fullName, node } = normalizeEnsName(name);

	const resolver = await getResolverRecord(node, client, config);
	if (!resolver) {
		return c.json(
			{ ok: false, error: { code: "NOT_REGISTERED", message: `${fullName} is not registered or has no resolver` } },
			404,
		);
	}

	// Read card-relevant text records + the address record concurrently.
	const rec: Record<string, string> = {};
	await Promise.all(
		CARD_TEXT_KEYS.map(async (key) => {
			const value = await getTextRecordPublic(resolver, node, key, client);
			if (value) rec[key] = value;
		}),
	);

	let address: string | null = null;
	try {
		const addr = (await client.readContract({
			address: resolver,
			abi: RESOLVER_ABI,
			functionName: "addr",
			args: [node],
		})) as string;
		if (addr && addr !== "0x0000000000000000000000000000000000000000") address = addr;
	} catch {
		/* no address record */
	}

	// Resolve avatar to a displayable URL (best-effort).
	let iconUrl: string | null = null;
	if (rec.avatar) {
		try {
			iconUrl = (await resolveAvatarUri(rec.avatar, client)).imageUrl;
		} catch {
			/* best effort */
		}
	}

	// ── ERC-8004 verification ──
	// Read the agentId from ENS, then confirm on-chain that it actually binds
	// this name's wrapped NFT. Wrapped ENS tokenId == namehash(name) == node.
	const registry = config.identityRegistry
		? `eip155:${config.chainId}:${config.identityRegistry}`
		: null;
	let registration:
		| { agentId: string; agentRegistry: string | null; signature: string | null; verified: boolean }
		| null = null;

	if (rec["agent-id"] && config.adapter8004) {
		try {
			const agentId = BigInt(rec["agent-id"]);
			const binding = (await client.readContract({
				address: config.adapter8004,
				abi: ADAPTER_8004_ABI,
				functionName: "bindingOf",
				args: [agentId],
			})) as { standard: number; tokenContract: string; tokenId: bigint };

			const verified =
				binding.tokenContract.toLowerCase() === config.nameWrapper.toLowerCase() &&
				binding.tokenId === BigInt(node);

			registration = {
				agentId: rec["agent-id"],
				agentRegistry: registry,
				signature: rec["agent-registration-signature"] ?? null,
				verified,
			};
		} catch {
			// agentId unparseable or not bound — leave registration null.
		}
	}

	// ── compose the card ──
	const provider = safeJson<Record<string, unknown>>(rec["agent-provider"]);
	const skills = safeJson<unknown[]>(rec["agent-skills"]) ?? [];
	const trustModels = safeJson<string[]>(rec["agent-trust-models"]) ?? ["feedback"];

	const endpoints: Record<string, string> = {};
	if (rec["agent-endpoint[web]"]) endpoints.web = rec["agent-endpoint[web]"];
	if (rec["agent-endpoint[a2a]"]) endpoints.a2a = rec["agent-endpoint[a2a]"];
	if (rec["agent-endpoint[mcp]"]) endpoints.mcp = rec["agent-endpoint[mcp]"];

	const card: Record<string, unknown> = {
		name: rec.display || fullName,
		description: rec.description || "",
		url: endpoints.web || rec.url || "",
		version: rec["agent-version"] || "1.0.0",
		capabilities: { streaming: false, pushNotifications: false },
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
		skills,
		trustModels,
		registrations: registration
			? [{ agentId: registration.agentId, agentRegistry: registration.agentRegistry, signature: registration.signature }]
			: [],
		// Non-standard extension: our authorization model. Authority lives in ENS
		// (auth.* records), operator-revocable, independent of the key.
		"x-authorization": {
			model: "ens-records",
			recordPrefix: "auth.",
			verifier: `${new URL(c.req.url).origin}/evaluate`,
		},
		// Convenience block for our own UI (not part of the A2A schema).
		"x-ens": {
			name: fullName,
			address,
			resolver,
			node,
			network,
			endpoints,
			agentContext: rec["agent-context"] || null,
			erc8004: registration
				? { registered: true, agentId: registration.agentId, verified: registration.verified }
				: { registered: false, agentId: null, verified: false },
		},
	};

	if (provider) card.provider = provider;
	if (iconUrl) card.iconUrl = iconUrl;

	return c.json(card);
});

export default app;
