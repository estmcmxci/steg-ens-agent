/**
 * x402-sepolia-seller.ts — minimal self-hosted x402 "exact"-EVM reference seller
 * (ERD §9 leg-2 / §15.6). Base Sepolia (84532), Circle test USDC, verify + settle
 * via a hosted facilitator. Test money only — this seller exists so the buyer
 * harness (x402-sepolia-leg.ts) can validate the EXECUTE path with zero real funds.
 *
 * Protocol (x402 v2 over plain HTTP):
 *   GET /paid                        → 402 + PaymentRequired JSON body (+ header)
 *   GET /paid + PAYMENT-SIGNATURE    → facilitator /verify → /settle → 200 +
 *                                      PAYMENT-RESPONSE header (tx hash inside)
 *
 * Run: bun scripts/x402-sepolia-seller.ts
 * Env: SELLER_PORT (4021) · SELLER_PAYTO · SELLER_AMOUNT (base units) · X402_FACILITATOR
 */

import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http"
import { BASE_SEPOLIA_USDC } from "./mm-x402-account"

const PORT = Number(process.env.SELLER_PORT ?? 4021)
const FACILITATOR = (process.env.X402_FACILITATOR ?? "https://facilitator.x402.rs").replace(/\/$/, "")
// Default payTo: the (already public) Base-Sepolia funder EOA — lets the leg
// assert the settled USDC actually arrived somewhere we can watch.
const PAY_TO = process.env.SELLER_PAYTO ?? "0x703ae03fB120eC91e9Ed6d08Ce8044E498CC789B"
const AMOUNT = process.env.SELLER_AMOUNT ?? "10000" // 0.01 test USDC (6 dp)

const requirements = {
  scheme: "exact",
  network: "eip155:84532",
  asset: BASE_SEPOLIA_USDC,
  amount: AMOUNT,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  // Base Sepolia test USDC EIP-712 domain — name differs from mainnet's "USD Coin".
  extra: { name: "USDC", version: "2" },
}

const paymentRequired = {
  x402Version: 2,
  error: "payment required",
  resource: { url: `http://127.0.0.1:${PORT}/paid`, description: "steg x402 reference resource (Base Sepolia)" },
  accepts: [requirements],
}

async function facilitator(path: "/verify" | "/settle", paymentPayload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(FACILITATOR + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, body }
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== "/paid") return new Response("not found", { status: 404 })

    const sigHeader = req.headers.get("PAYMENT-SIGNATURE")
    if (!sigHeader) {
      console.error("[seller] no PAYMENT-SIGNATURE → 402 challenge")
      return Response.json(paymentRequired, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired as never) },
      })
    }

    let payload: unknown
    try {
      payload = decodePaymentSignatureHeader(sigHeader)
    } catch {
      return Response.json({ error: "malformed PAYMENT-SIGNATURE header" }, { status: 400 })
    }

    console.error("[seller] PAYMENT-SIGNATURE received → facilitator /verify")
    const verify = await facilitator("/verify", payload)
    if (verify.status !== 200 || verify.body.isValid !== true) {
      console.error(`[seller] ✗ verify failed (HTTP ${verify.status}): ${JSON.stringify(verify.body).slice(0, 400)}`)
      return Response.json({ error: "payment verification failed", verify: verify.body }, { status: 402 })
    }
    console.error(`[seller] ✓ verified (payer ${verify.body.payer}) → facilitator /settle`)

    const settle = await facilitator("/settle", payload)
    if (settle.status !== 200 || settle.body.success !== true) {
      console.error(`[seller] ✗ settle failed (HTTP ${settle.status}): ${JSON.stringify(settle.body).slice(0, 400)}`)
      return Response.json({ error: "settlement failed", settle: settle.body }, { status: 402 })
    }
    console.error(`[seller] ✓ SETTLED on-chain: tx ${settle.body.transaction}`)

    return Response.json(
      { ok: true, resource: "you paid for this", settlement: { transaction: settle.body.transaction, network: settle.body.network } },
      { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settle.body as never) } },
    )
  },
})

console.error(
  `[seller] x402 reference seller up: http://127.0.0.1:${PORT}/paid — ${(Number(AMOUNT) / 1e6).toFixed(6)} test-USDC → ${PAY_TO} (facilitator: ${FACILITATOR})`,
)
