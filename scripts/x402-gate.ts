/**
 * x402-gate.ts — the PAYMENT-SPECIFIC ENS authority probe (ERD Arc 3 Step 3d).
 *
 * The generic gate (demo-mm.ts) signs a FIXED erc20.transfer placeholder, so it
 * only proves an identity kill-switch (§15.7 #2). This probe instead signs the
 * REAL x402.payment (asset/payTo/amount/network) under the `x402-payment`
 * credential and POSTs it to /evaluate — so the verdict reflects the on-chain
 * x402.payment capability: the operator can cap the amount, pin the recipient,
 * or revoke PAYMENT authority independently of transfers.
 *
 * Signs with the active mm wallet (the TEE server-wallet) and evaluates whatever
 * name that wallet reverse-resolves to (like demo-mm.ts) — so signer ↔ published
 * credential stay coherent. Fail-closed: any error → exit 1.
 *
 * Run (allow):  WORKER_URL=… bun scripts/x402-gate.ts --pay-to 0x… --amount 7000
 * Run (deny):   … --amount 2000000            # over the $1 cap → POLICY_DENIED
 * Flags: --pay-to (req) · --amount base-units (req) · --asset (def Base USDC) ·
 *        --network (def eip155:8453) · --credential-id (def x402-payment)
 */

import { $ } from "bun"
import { serializeRequest } from "../src/hash"
import { signWithMM } from "./sign-with-mm"
import { DEFAULT_RPC, makePublicClient } from "./lib/agent-config"
import type { X402PaymentRequest } from "../src/types"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const argVal = (f: string): string | undefined => {
  const i = process.argv.indexOf(f)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const payTo = argVal("--pay-to")
const amount = argVal("--amount")
const asset = argVal("--asset") ?? BASE_USDC
const network = argVal("--network") ?? "eip155:8453"
const credentialId = argVal("--credential-id") ?? "x402-payment"
if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
  console.error("error: --pay-to 0x… (40 hex) required")
  process.exit(2)
}
if (!amount || !/^[0-9]+$/.test(amount)) {
  console.error("error: --amount <base-units integer> required")
  process.exit(2)
}

// 127.0.0.1 (not localhost): bun fetch prefers ::1 but wrangler binds IPv4.
const workerUrl = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "")

/** Evaluate whatever name the active mm wallet reverse-resolves to (G4). */
async function resolveAgentName(): Promise<string> {
  const pinned = process.env.STEG_DEMO_NAME
  if (pinned) return pinned
  try {
    const show = await $`mm wallet show --json`.quiet().text()
    const addr = JSON.parse(show)?.data?.address as `0x${string}` | undefined
    if (!addr) return "agent.steg.eth"
    const rpc = process.env.ETH_RPC_URL || DEFAULT_RPC
    return (await makePublicClient(rpc).getEnsName({ address: addr })) || "agent.steg.eth"
  } catch {
    return "agent.steg.eth"
  }
}

const request: X402PaymentRequest = {
  credentialId,
  actionType: "x402.payment",
  params: { asset: asset as `0x${string}`, payTo: payTo as `0x${string}`, amount, network },
}

const name = await resolveAgentName()
console.error(`agent name : ${name}`)
console.error(`request    : ${serializeRequest(request)}`)

const signature = await signWithMM(request)
console.error(`signature  : ${signature.slice(0, 22)}… (${signature.length} chars)`)

const res = await fetch(`${workerUrl}/evaluate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name, request, signature }),
})
const body = (await res.json()) as { ok?: boolean; data?: { allowed?: boolean; reason?: string } } & Record<string, unknown>
const verdict = (body.data ?? body) as { allowed?: boolean; reason?: string }
console.error(`\n→ ${workerUrl}/evaluate  (HTTP ${res.status})`)
console.log(JSON.stringify(body))
process.exit(verdict?.allowed === true ? 0 : 1)
