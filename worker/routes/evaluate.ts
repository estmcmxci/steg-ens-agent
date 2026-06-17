/**
 * POST /evaluate — the authorization verifier (the grafted-in Steg layer).
 *
 * Public + keyless by design: any relying party can independently verify
 * whether a signed action is CURRENTLY authorized under the agent's ENS-
 * published authorization state — read fresh from L1 mainnet on every call.
 * This is the one route that decides allow/deny, and it touches no keys.
 *
 * Reuses the verifier core in ../../src (proven live in the terminal demo):
 * evaluateAction → resolve auth.* records → verifyAuth (EIP-191 secp256k1) →
 * checkPolicy, with the parent-name fleet envelope enforced as fleet ∩ agent.
 */

import { Hono } from "hono";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { createEnsClient } from "../../src/ensClient";
import { EnsRecordSource } from "../../src/ensRecordSource";
import { EnsEnvelopeSource } from "../../src/ensEnvelopeSource";
import { evaluateAction } from "../../src/evaluateAction";
import { isActionRequest } from "../../src/schema";
import type { ActionRequest, Address, Hex } from "../../src/types";

const app = new Hono<{ Bindings: Env }>();

app.post("/evaluate", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: { code: "INVALID_JSON" } }, 400);
	}

	const { name, request, signature } = (body ?? {}) as {
		name?: unknown;
		request?: unknown;
		signature?: unknown;
	};

	if (typeof name !== "string" || name.length === 0) {
		return c.json({ ok: false, error: { code: "MISSING_NAME" } }, 400);
	}
	if (!isActionRequest(request)) {
		return c.json({ ok: false, error: { code: "INVALID_REQUEST" } }, 400);
	}
	if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
		return c.json({ ok: false, error: { code: "INVALID_SIGNATURE" } }, 400);
	}

	// agent.steg.eth lives on mainnet; the verifier always reads mainnet.
	const ur = c.env.ENS_UNIVERSAL_RESOLVER as Address | undefined;
	const client = createEnsClient(c.env.ETH_RPC_URL_MAINNET);
	const source = new EnsRecordSource(client, ur);
	const envelope = new EnsEnvelopeSource(client, c.env.STEG_FLEET_NAME, ur);

	const result = await evaluateAction(
		normalize(name),
		request as ActionRequest,
		signature as Hex,
		{ source, envelope },
	);

	// Match the API's { ok, data } envelope used by the other routes.
	return c.json({ ok: true, data: result });
});

export default app;
