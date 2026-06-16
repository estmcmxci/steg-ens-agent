/**
 * Relying-party Worker — the minimal verify surface.
 *
 * One job: given an agent `name`, a signed action `request`, and its
 * `signature`, decide whether the action is *currently authorized* under the
 * authorization state published on that ENS name — read fresh from L1 on every
 * request (no cache). This is the relying-party boundary from the proposal: a
 * counterparty checks current authority before honoring an agent's signature,
 * rather than trusting signature validity alone.
 *
 * Records resolve through the ENS Universal Resolver (CCIP-Read), so the same
 * endpoint works whether agent.steg.eth's auth.* records live on-chain or
 * behind an offchain gateway. Tier-1 fleet envelope (the MARP ceiling on the
 * parent name, e.g. steg.eth) is enforced as `fleet ∩ agent` when present.
 *
 * Deliberately excludes the issuer side (record writes) and all of steg-alpha's
 * Privy/Safe/Uniswap/registration machinery — verify path only.
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { normalize } from "viem/ens"
import { createEnsClient } from "../src/ensClient"
import { EnsRecordSource } from "../src/ensRecordSource"
import { EnsEnvelopeSource } from "../src/ensEnvelopeSource"
import { evaluateAction } from "../src/evaluateAction"
import { isActionRequest } from "../src/schema"
import type { ActionRequest, Address, Hex } from "../src/types"

type Env = {
  ETH_RPC_URL: string
  ENS_UNIVERSAL_RESOLVER?: string
  STEG_FLEET_NAME?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use("*", cors())

app.get("/health", (c) => c.json({ ok: true }))

app.post("/evaluate", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400)
  }

  const { name, request, signature } = (body ?? {}) as {
    name?: unknown
    request?: unknown
    signature?: unknown
  }

  if (typeof name !== "string" || name.length === 0) {
    return c.json({ error: "MISSING_NAME" }, 400)
  }
  if (!isActionRequest(request)) {
    return c.json({ error: "INVALID_REQUEST" }, 400)
  }
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return c.json({ error: "INVALID_SIGNATURE" }, 400)
  }

  const ur = c.env.ENS_UNIVERSAL_RESOLVER as Address | undefined
  const client = createEnsClient(c.env.ETH_RPC_URL)
  const source = new EnsRecordSource(client, ur)
  // Fleet envelope lives on the parent name; default-derive parent unless pinned.
  const envelope = new EnsEnvelopeSource(client, c.env.STEG_FLEET_NAME, ur)

  // ENSIP-15 normalization at the boundary (never toLowerCase).
  const normalized = normalize(name)

  // Validated by isActionRequest above (boolean guard, not a type predicate).
  const result = await evaluateAction(normalized, request as ActionRequest, signature as Hex, {
    source,
    envelope,
  })

  return c.json(result)
})

export default app
