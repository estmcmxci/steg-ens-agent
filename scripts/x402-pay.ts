/**
 * x402-pay — the Branch-2 handoff-replay payer (ERD §15 Phase 1, Steps 10–11).
 *
 * Travala's `travala_book` returns a proprietary `next_action` (→ Coinbase's
 * `make_http_request_with_x402` → `POST payment-mcp.travala.com/m2m-payment/book`)
 * wrapping a STANDARD x402 `exact`-EVM `paymentRequirements`. So `createx402MCPClient`
 * auto-pay won't fire; we replicate the handoff: parse it, build + sign the EIP-3009
 * via our mm TEE adapter, and POST the x402 payment ourselves.
 *
 * Two modes:
 *   PREVIEW (default, ZERO-SPEND): search → book → parse next_action → guard →
 *     display the would-be payment. No sign, no POST. Safe against mainnet.
 *   EXECUTE (X402_EXECUTE=1 + gate + a FUNDED agent.steg.eth): gate probe →
 *     createPaymentPayload (mm-signs; the adapter's typed-data guard fires) →
 *     encodePaymentSignatureHeader → POST the replay → settle. NB: validate on the
 *     Base Sepolia reference seller (ERD §9 leg) before any mainnet run.
 *
 * Guards (ERD §15.7 #5): asset == canonical Base USDC, network == Base, amount ≤
 * X402_MAX_USDC cap, payTo == the pinned Travala recipient. Fail-closed.
 *
 * Run:
 *   bun scripts/x402-pay.ts                  # PREVIEW (zero-spend)
 *   X402_EXECUTE=1 bun scripts/x402-pay.ts   # EXECUTE (needs gate + funded wallet)
 */

import { ExactEvmScheme } from "@x402/evm/exact/client"
import { encodePaymentSignatureHeader } from "@x402/core/http"
import { connectTravala, runWithConsent, toolJson, deepFind } from "./lib/travala-mcp"
import { createMmX402Account, BASE_USDC, BASE_MAINNET_CHAIN_ID, type PaymentGuard } from "./mm-x402-account"

const X402_VERSION = 2 // @x402/core x402Version
// Pinned Travala payment recipient (captured §15 Step 8). Override with X402_PAYTO.
const EXPECTED_PAYTO = (process.env.X402_PAYTO ?? "0x0617973b64A7cEE9d9a0D66C53f1aecc312BB3ff").toLowerCase()
const MAX_USDC = BigInt(process.env.X402_MAX_USDC ?? "400000000") // base units (6 dp) → $400 default cap
const EXECUTE = process.env.X402_EXECUTE === "1"

/** The standard x402 `exact` requirement Travala wraps in its next_action (wire
 *  shape, with `maxAmountRequired`). Decoupled from @x402/core's `PaymentRequirements`
 *  type (which models `amount`); cast at the createPaymentPayload boundary. */
export interface X402Requirement {
  scheme: string
  network: string
  asset: string
  payTo: string
  maxAmountRequired: string
  maxTimeoutSeconds?: number
  extra?: { name?: string; version?: string }
}

interface TravalaNextAction {
  tool: string
  baseURL: string
  path: string
  method?: string
  body: Record<string, unknown>
  paymentRequirements: X402Requirement[]
}

/** Pull the next_action (with its standard x402 paymentRequirements) out of a
 *  travala_book result. Returns null if it's not the Branch-2 handoff. */
export function parseNextAction(bookResult: unknown): TravalaNextAction | null {
  const json = toolJson(bookResult) as { next_action?: TravalaNextAction } | undefined
  const na = json?.next_action
  if (!na || !Array.isArray(na.paymentRequirements) || na.paymentRequirements.length === 0) return null
  return na
}

/** Requirements-level fail-closed guard (preview + pre-execute). The adapter's
 *  typed-data guard is the second layer, enforced at sign time. */
export function assertRequirementsAllowed(req: X402Requirement, maxValue: bigint, expectedPayTo: string): void {
  if (req.scheme !== "exact") throw new Error(`x402 guard: unexpected scheme "${req.scheme}"`)
  if (req.network !== `eip155:${BASE_MAINNET_CHAIN_ID}`) throw new Error(`x402 guard: network ${req.network} ≠ eip155:${BASE_MAINNET_CHAIN_ID}`)
  if (req.asset.toLowerCase() !== BASE_USDC.toLowerCase()) throw new Error(`x402 guard: asset ${req.asset} ≠ canonical Base USDC`)
  const amount = BigInt(req.maxAmountRequired)
  if (amount > maxValue) throw new Error(`x402 guard: maxAmountRequired ${amount} exceeds cap ${maxValue}`)
  if (req.payTo.toLowerCase() !== expectedPayTo) throw new Error(`x402 guard: payTo ${req.payTo} ≠ pinned ${expectedPayTo}`)
}

const usd = (base: string) => (Number(BigInt(base)) / 1e6).toFixed(2)

/** ENS authority gate — shell scripts/demo-mm.ts → /evaluate (same probe the
 *  brain's gate_or_refusal() uses). Force TEE signing (drop local keys), fail-closed. */
async function gateAllows(): Promise<{ allowed: boolean; reason: string }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.MM_MNEMONIC
  delete env.AGENT_PRIVATE_KEY
  env.STEG_DEMO_NAME = process.env.STEG_DEMO_NAME ?? ""
  const proc = Bun.spawn(["bun", "scripts/demo-mm.ts"], { stdout: "pipe", stderr: "pipe", env })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  let reason = "unknown"
  try {
    reason = (JSON.parse(out) as { data?: { reason?: string } }).data?.reason ?? reason
  } catch {
    /* leave reason */
  }
  return { allowed: code === 0, reason }
}

// ── driver (runs only as the entry point, not when imported by tests) ──
if (import.meta.main) {
  const { client, transport, provider } = await connectTravala()
  try {
    const d = (o: number) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10)
    const search = process.env.TRAVALA_SEARCH
      ? (JSON.parse(process.env.TRAVALA_SEARCH) as Record<string, unknown>)
      : { location: "Lisbon", checkIn: d(30), checkOut: d(32), rooms: ["2"], response_format: "json" }

    console.error(`[search] travala_search_hotel ${JSON.stringify(search)}`)
    const hotelRes = toolJson(await client.callTool("travala_search_hotel", search))
    const sessionId = process.env.TRAVALA_SESSION_ID ?? deepFind(hotelRes, "sessionId")
    const packageId = process.env.TRAVALA_PACKAGE_ID ?? deepFind(hotelRes, "packageId")
    if (!packageId || !sessionId) throw new Error(`could not resolve packageId/sessionId from search (pkg=${packageId} sess=${sessionId})`)

    const customer = process.env.TRAVALA_CUSTOMER
      ? (JSON.parse(process.env.TRAVALA_CUSTOMER) as Record<string, unknown>)
      : { firstName: "Steg", lastName: "Tester", email: "steg-x402-test@example.com", phone: "+10000000000" }

    console.error(`[book] travala_book {packageId=${packageId}} — fetching the next_action handoff`)
    const bookRaw = await runWithConsent(provider, transport, () => client.callTool("travala_book", { packageId, sessionId, customer }))
    const na = parseNextAction(bookRaw)
    if (!na) {
      console.log(`\n⚠️  No next_action/paymentRequirements in travala_book result:\n${JSON.stringify(toolJson(bookRaw), null, 2).slice(0, 2000)}`)
      throw new Error("travala_book did not return the expected Branch-2 handoff")
    }
    const req = na.paymentRequirements[0]
    if (!req) throw new Error("empty paymentRequirements")

    // Guard (requirements-level) — fail-closed BEFORE any signing.
    assertRequirementsAllowed(req, MAX_USDC, EXPECTED_PAYTO)

    console.log(`\n── PAYMENT PREVIEW (zero-spend) ─────────────────────────────`)
    console.log(`  amount   : ${usd(req.maxAmountRequired)} USDC  (${req.maxAmountRequired} base units)`)
    console.log(`  payTo    : ${req.payTo}`)
    console.log(`  asset    : ${req.asset}  (${req.extra?.name} v${req.extra?.version})`)
    console.log(`  network  : ${req.network}   scheme: ${req.scheme}   timeout: ${req.maxTimeoutSeconds ?? "—"}s`)
    console.log(`  replay   : ${na.method ?? "POST"} ${na.baseURL.replace(/\/$/, "")}${na.path}`)
    console.log(`  guard    : ✓ asset=Base USDC, network=Base, amount ≤ ${usd(MAX_USDC.toString())} cap, payTo pinned`)
    console.log(`─────────────────────────────────────────────────────────────`)

    if (!EXECUTE) {
      console.log(`\nℹ️  PREVIEW only — no signing, no payment. Set X402_EXECUTE=1 with a funded agent.steg.eth (and clear the ENS gate) to settle.`)
      console.log(`   ⚠️  Validate EXECUTE on the Base Sepolia reference seller (ERD §9 leg) before any mainnet run.`)
    } else {
      // ── EXECUTE (gated + funded) — NOT exercised until the Sepolia leg is GREEN ──
      console.error(`\n[gate] running ENS authority probe (scripts/demo-mm.ts → /evaluate) …`)
      const gate = await gateAllows()
      if (!gate.allowed) throw new Error(`⛔ ENS gate DENIED (${gate.reason}) — NOTHING signed or sent. This is the thesis: revoke at ENS → the agent's next payment is refused.`)
      console.error(`[gate] ✓ allowed`)

      const account = await createMmX402Account(
        { maxValue: MAX_USDC, verifyingContract: req.asset as `0x${string}`, chainId: BASE_MAINNET_CHAIN_ID, allowedTo: [req.payTo as `0x${string}`] } satisfies PaymentGuard,
        { intent: `Travala booking ${packageId} — ${usd(req.maxAmountRequired)} USDC` },
      )
      console.error(`[pay] signer=${account.address} — building + signing EIP-3009 via mm TEE …`)
      const result = await new ExactEvmScheme(account).createPaymentPayload(
        X402_VERSION,
        req as unknown as Parameters<ExactEvmScheme["createPaymentPayload"]>[1],
      )
      // NB: exact PaymentPayload shape (incl. `accepted`) is confirmed on the Base
      // Sepolia reference-seller leg before any mainnet run — cast for now.
      const header = encodePaymentSignatureHeader({
        x402Version: result.x402Version,
        scheme: req.scheme,
        network: req.network,
        payload: result.payload,
        accepted: req,
      } as unknown as Parameters<typeof encodePaymentSignatureHeader>[0])

      const url = `${na.baseURL.replace(/\/$/, "")}${na.path}`
      console.error(`[pay] POST ${url} with PAYMENT-SIGNATURE …`)
      const res = await fetch(url, {
        method: na.method ?? "POST",
        headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": header },
        body: JSON.stringify(na.body),
      })
      const text = await res.text()
      console.log(`\n[pay] settle HTTP ${res.status}\n  PAYMENT-RESPONSE: ${res.headers.get("PAYMENT-RESPONSE") ?? "—"}\n  body: ${text.slice(0, 2000)}`)
      if (!res.ok) throw new Error(`settlement POST returned ${res.status}`)
      console.log(`\n✅ Replay settled. Verify the on-chain USDC tx + travala_book_status, then cancel before the free-cancellation deadline.`)
    }
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}
