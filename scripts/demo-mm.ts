/**
 * The demo driver — allow → (revoke) → deny, signature held constant.
 *
 * 1. Build an erc20.transfer request (shared builder).
 * 2. Sign it with the mm BYOK wallet (agent.steg.eth's EOA), EIP-191.
 * 3. POST { name, request, signature } to the relying-party Worker /evaluate.
 * 4. Print the verdict.
 *
 * Run it once after publishing records  -> expect allowed: true (OK).
 * Run it again after flipping revocation -> expect allowed: false (REVOKED),
 * with the SAME signature. That invariance is the whole point: authorization
 * was withdrawn at the ENS registry, not at the key.
 *
 * Usage:
 *   MM_PASSWORD=... STEG_DEMO_NAME=agent.steg.eth WORKER_URL=http://localhost:8787 \
 *     bun scripts/demo-mm.ts
 */

import { serializeRequest } from "../src/hash"
import { signWithMM } from "./sign-with-mm"
import { signWithViem } from "./sign-with-viem"
import { buildDemoRequest } from "./demo-request"

const name = process.env.STEG_DEMO_NAME || "agent.steg.eth"
// 127.0.0.1, not localhost: bun's fetch resolves localhost to IPv6 (::1) but
// wrangler dev binds IPv4 — `localhost` ECONNRESETs, 127.0.0.1 works.
const workerUrl = (process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "")

// Signer selection: mm 2.0.0 can't off-chain-sign in BYOK (server-keyring bug),
// so when a local key is present we sign the SAME key with viem (Path B). If mm
// ever fixes BYOK message signing, unset MM_MNEMONIC and it uses mm again.
const useLocal = !!(process.env.MM_MNEMONIC || process.env.AGENT_PRIVATE_KEY)

const request = buildDemoRequest()
console.error(`agent name : ${name}`)
console.error(`signer mode: ${useLocal ? "viem (local key, Path B)" : "mm wallet sign-message"}`)
console.error(`request    : ${serializeRequest(request)}`)

const signature = useLocal ? await signWithViem(request) : await signWithMM(request)
console.error(`signature  : ${signature.slice(0, 22)}… (${signature.length} chars)`)

const res = await fetch(`${workerUrl}/evaluate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name, request, signature }),
})

// The worker wraps verdicts as { ok, data: { allowed, reason, … } }; unwrap so the
// exit code reflects the real decision (older code read body.allowed = undefined).
const body = (await res.json()) as { ok?: boolean; data?: { allowed?: boolean; reason?: string } } & Record<string, unknown>
const verdict = (body.data ?? body) as { allowed?: boolean; reason?: string }
console.error(`\n→ ${workerUrl}/evaluate  (HTTP ${res.status})`)
console.log(JSON.stringify(body, null, 2))

// Exit non-zero on deny so the demo is scriptable in a pipeline.
process.exit(verdict?.allowed === true ? 0 : 1)
