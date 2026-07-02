/**
 * The mm signer adapter — the one new integration point.
 *
 * The agent identified by agent.steg.eth is a MetaMask Agentic CLI (mm) BYOK
 * wallet. To sign an action request, we serialize it with the SAME canonical
 * function the verifier recomputes (src/hash.serializeRequest), then hand that
 * exact string to `mm wallet sign-message` (EIP-191 personal_sign). The
 * verifier's step-6 ecrecover then matches the signature back to the
 * credential record's `signer` (= the mm wallet address).
 *
 * Nothing else in the verifier changes: the agent's signer is just an EOA, and
 * mm is how that EOA signs. BYOK signing needs MM_PASSWORD in the environment
 * to unlock the encrypted mnemonic — the caller sets it; we never log it.
 *
 * Usage (as a module):
 *   import { signWithMM } from "./sign-with-mm"
 *   const sig = await signWithMM(request)
 *
 * Usage (standalone, prints the signature for a default demo request):
 *   MM_PASSWORD=... bun scripts/sign-with-mm.ts
 */

import { $ } from "bun"
import { serializeRequest } from "../src/hash"
import type { ActionRequest, Hex } from "../src/types"

const CHAIN_ID = process.env.MM_SIGN_CHAIN_ID || "1"

/** Sign an action request with the active mm BYOK wallet (EIP-191). */
export async function signWithMM(request: ActionRequest): Promise<Hex> {
  const message = serializeRequest(request)
  // mm reads MM_PASSWORD from the environment to unlock the BYOK mnemonic.
  // --wait: the TEE server-wallet signs asynchronously — without it the call
  // returns a pollingId, not a signature, and the gate fails closed. BYOK signs
  // inline and tolerates the flag. --json for deterministic parsing.
  const out =
    await $`mm wallet sign-message --message ${message} --chain-id ${CHAIN_ID} --wait --json`.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error(`mm sign-message returned non-JSON: ${out.slice(0, 200)}`)
  }
  const sig = extractSignature(parsed)
  if (!sig) {
    throw new Error(`mm sign-message: no signature in response: ${JSON.stringify(parsed).slice(0, 300)}`)
  }
  return sig
}

/** mm wraps results as { ok, data: {...} }. The signature field name can vary
 * across versions, so look for a 0x… hex string under common keys, then fall
 * back to a deep scan. */
function extractSignature(parsed: unknown): Hex | null {
  const root = parsed as { ok?: boolean; data?: Record<string, unknown> } | null
  if (!root || root.ok === false) return null
  const data = root.data ?? (root as Record<string, unknown>)
  for (const k of ["signature", "sig", "signedMessage", "result"]) {
    const v = data[k]
    if (typeof v === "string" && /^0x[0-9a-fA-F]{130,}$/.test(v)) return v as Hex
  }
  // deep scan
  let found: Hex | null = null
  const walk = (v: unknown) => {
    if (found) return
    if (typeof v === "string" && /^0x[0-9a-fA-F]{130,}$/.test(v)) found = v as Hex
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x)
  }
  walk(data)
  return found
}

if (import.meta.main) {
  const { buildDemoRequest } = await import("./demo-request")
  const request = buildDemoRequest()
  const sig = await signWithMM(request)
  console.error("request:", serializeRequest(request))
  console.log(sig)
}
