/**
 * x402-exa-leg.ts — the MAINNET EXECUTE proof (S1-analog; mainnet twin of §9's S2).
 *
 * Pivot target after Travala's payment-mcp outage (memory: erd-x402-payment-client,
 * 2026-07-03): pay a live, reputable, INDEPENDENT third-party x402 seller on Base
 * MAINNET with real USDC, through the IDENTICAL payment core the Travala booking
 * uses — proving the mm TEE payer settles on mainnet, not just Base Sepolia.
 *
 * Seller = Exa web search (`api.exa.ai/search`), standard x402-over-HTTP (Branch 1),
 * $0.007 canonical Base USDC. Genuine value (steg has no search), tangible artifact
 * (real results), recognizable brand for the upstream PR.
 *
 * Flow:  POST {query} → 402 {accepts[]} → SELECT the Base-mainnet canonical-USDC
 *        exact entry (NOT accepts[0]: Exa also advertises a Solana rail) → fail-closed
 *        guard → ENS gate probe → createMmX402Account (mm TEE signs EIP-3009) →
 *        encodePaymentSignatureHeader → replay the POST with PAYMENT-SIGNATURE →
 *        200 + real results, settlement on Base mainnet.
 *
 * Two modes:
 *   PREVIEW (default, ZERO-SPEND): challenge → select → guard → gate probe, then STOP.
 *     Safe against mainnet with an UNFUNDED wallet — validates the whole pipeline.
 *   EXECUTE (X402_EXECUTE=1 + a FUNDED agent.steg.eth): sign → replay → settle →
 *     assert exactly −amount / +amount on-chain → print the search results + tx.
 *
 * Run:
 *   bun scripts/x402-exa-leg.ts                 # PREVIEW (zero-spend)
 *   X402_EXECUTE=1 bun scripts/x402-exa-leg.ts  # EXECUTE (needs funded wallet + gate)
 * Env: EXA_QUERY · X402_MAX (base units, default 10000=$0.01) · X402_EXA_PAYTO · EXA_URL
 */

import { createPublicClient, http, erc20Abi } from "viem"
import { base } from "viem/chains"
import { ExactEvmScheme } from "@x402/evm/exact/client"
import { encodePaymentSignatureHeader, decodePaymentResponseHeader } from "@x402/core/http"
import { gateAllows } from "./lib/ens-gate"
import { toV2Requirements, type X402Requirement } from "./x402-pay"
import { createMmX402Account, BASE_USDC, BASE_MAINNET_CHAIN_ID, type PaymentGuard } from "./mm-x402-account"

const SELLER_URL = process.env.EXA_URL ?? "https://api.exa.ai/search"
// Pinned Exa payment recipient (captured 2026-07-03 from the live 402). Override X402_EXA_PAYTO.
const EXPECTED_PAYTO = (process.env.X402_EXA_PAYTO ?? "0x6d6E695b09861467c7d462f5AAF31cF3540B9192").toLowerCase()
const MAX_USDC = BigInt(process.env.X402_MAX ?? "10000") // $0.01 cap (a search is $0.007)
const EXECUTE = process.env.X402_EXECUTE === "1"
const NETWORK = `eip155:${BASE_MAINNET_CHAIN_ID}`
const QUERY = process.env.EXA_QUERY ?? "What is the x402 payment protocol and how do AI agents use it?"
const REQ_BODY = JSON.stringify({ query: QUERY, numResults: 3 })

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") })
const usdcBalance = (addr: `0x${string}`) =>
  client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] })

const fail = (msg: string): never => {
  console.error(`\n✗ EXA MAINNET LEG FAILED: ${msg}`)
  process.exit(1)
}
const usd = (v: bigint) => (Number(v) / 1e6).toFixed(6)
const post = (extra: Record<string, string> = {}) =>
  fetch(SELLER_URL, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: REQ_BODY })

// ── 1. Challenge: POST the real query, expect a 402 with a v2 accepts array ──
console.error(`[exa] POST ${SELLER_URL} query="${QUERY}" (expecting 402)`)
const challenge = await post()
if (challenge.status !== 402) fail(`expected HTTP 402, got ${challenge.status} (endpoint free or changed?)`)
const cbody = (await challenge.json()) as { x402Version?: number; accepts?: Array<Record<string, unknown>> }
if (cbody.x402Version !== 2) fail(`402 body missing x402Version:2 (got ${cbody.x402Version})`)
if (!Array.isArray(cbody.accepts)) fail(`402 body missing accepts[]`)
const accepts = cbody.accepts as Array<Record<string, unknown>>

// ── 2. SELECT the Base-mainnet canonical-USDC exact entry (NOT accepts[0]) ──
const chosen = accepts.find(
  (a) =>
    a.scheme === "exact" &&
    a.network === NETWORK &&
    typeof a.asset === "string" &&
    a.asset.toLowerCase() === BASE_USDC.toLowerCase(),
)
if (!chosen) fail(`no ${NETWORK} canonical-USDC exact entry in accepts: ${JSON.stringify(cbody.accepts).slice(0, 500)}`)

const wireReq: X402Requirement = {
  scheme: String(chosen!.scheme),
  network: String(chosen!.network),
  asset: String(chosen!.asset),
  payTo: String(chosen!.payTo),
  maxAmountRequired: String(chosen!.amount),
  maxTimeoutSeconds: Number(chosen!.maxTimeoutSeconds ?? 300),
  extra: chosen!.extra as { name?: string; version?: string } | undefined,
}

// ── 3. Fail-closed requirements guard (mainnet pins) ──
if (wireReq.payTo.toLowerCase() !== EXPECTED_PAYTO) fail(`payTo ${wireReq.payTo} ≠ pinned ${EXPECTED_PAYTO}`)
if (wireReq.extra?.name !== "USD Coin" || wireReq.extra?.version !== "2")
  fail(`unexpected EIP-712 domain ${JSON.stringify(wireReq.extra)} (Base mainnet USDC is name "USD Coin" version "2")`)
const amount = BigInt(wireReq.maxAmountRequired)
if (amount > MAX_USDC) fail(`amount ${amount} exceeds cap ${MAX_USDC}`)
console.error(`[exa] ✓ guard: ${usd(amount)} USDC → ${wireReq.payTo} on ${NETWORK} (domain "${wireReq.extra?.name}" v${wireReq.extra?.version})`)

// ── 4. ENS authority gate — same probe the mainnet Travala EXECUTE uses ──
console.error(`[exa] running ENS authority probe (scripts/demo-mm.ts → /evaluate) …`)
const gate = await gateAllows()
if (!gate.allowed) fail(`ENS gate DENIED (${gate.reason}) — nothing signed. Revoke at ENS → next payment refused (the thesis).`)
console.error(`[exa] ✓ gate allowed`)

// ── PREVIEW: stop before any sign/spend (safe on an unfunded wallet) ──
if (!EXECUTE) {
  console.log(`\n── EXA MAINNET PREVIEW (zero-spend) ─────────────────────────`)
  console.log(`  would pay : ${usd(amount)} USDC → ${wireReq.payTo}  (Exa)`)
  console.log(`  asset     : ${wireReq.asset}  ("${wireReq.extra?.name}" v${wireReq.extra?.version})`)
  console.log(`  network   : ${wireReq.network}   scheme: ${wireReq.scheme}`)
  console.log(`  buys      : Exa search "${QUERY}"`)
  console.log(`  gate      : ✓ allowed    guard: ✓ (≤ ${usd(MAX_USDC)} cap, payTo pinned, domain USD-Coin/2)`)
  console.log(`─────────────────────────────────────────────────────────────`)
  console.log(`\nℹ️  PREVIEW only — no signing, no payment. Fund agent.steg.eth with ≥ ${usd(amount)} Base USDC,`)
  console.log(`   then: X402_EXECUTE=1 bun scripts/x402-exa-leg.ts`)
  process.exit(0)
}

// ── 5. EXECUTE — funds check, sign via mm TEE, replay, settle, assert ──
const account = await createMmX402Account(
  {
    maxValue: MAX_USDC,
    verifyingContract: BASE_USDC,
    chainId: BASE_MAINNET_CHAIN_ID,
    allowedTo: [wireReq.payTo as `0x${string}`],
  } satisfies PaymentGuard,
  { intent: `Exa x402 search — ${usd(amount)} USDC (mm mainnet payer proof)` },
)
const agentAddr = account.address
const [agentBefore, payToBefore] = await Promise.all([usdcBalance(agentAddr), usdcBalance(wireReq.payTo as `0x${string}`)])
if (agentBefore < amount)
  fail(`agent USDC ${agentBefore} < required ${amount} — fund agent.steg.eth (${agentAddr}) with Base USDC first`)
console.error(`[exa] signer=${agentAddr}  balances before: agent=${agentBefore} payTo=${payToBefore}`)

const v2req = toV2Requirements(wireReq)
console.error(`[exa] mm TEE signing EIP-3009 (chain ${BASE_MAINNET_CHAIN_ID}, domain "${v2req.extra.name}" v${v2req.extra.version}) …`)
const result = await new ExactEvmScheme(account).createPaymentPayload(
  2,
  v2req as unknown as Parameters<ExactEvmScheme["createPaymentPayload"]>[1],
)
const header = encodePaymentSignatureHeader({
  x402Version: result.x402Version,
  payload: result.payload,
  accepted: v2req,
} as unknown as Parameters<typeof encodePaymentSignatureHeader>[0])
console.error(`[exa] ✓ signed — replaying POST with PAYMENT-SIGNATURE (${header.length}b header) …`)

const paid = await post({ "PAYMENT-SIGNATURE": header })
const paidText = await paid.text()
if (paid.status !== 200) fail(`replay returned HTTP ${paid.status}: ${paidText.slice(0, 600)}`)

const respHeader = paid.headers.get("PAYMENT-RESPONSE")
if (!respHeader) fail(`200 but no PAYMENT-RESPONSE header`)
const settlement = decodePaymentResponseHeader(respHeader!) as {
  success?: boolean
  transaction?: string
  network?: string
  payer?: string
}
if (!settlement.success || !settlement.transaction) fail(`settlement not successful: ${JSON.stringify(settlement).slice(0, 400)}`)
console.error(`[exa] ✓ HTTP 200 + PAYMENT-RESPONSE: tx=${settlement.transaction} payer=${settlement.payer}`)

// ── 6. On-chain assertion: exactly one settlement, exact amounts ──
console.error(`[exa] waiting for on-chain balance change …`)
let agentAfter = agentBefore
let payToAfter = payToBefore
for (let i = 0; i < 20 && agentAfter === agentBefore; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  ;[agentAfter, payToAfter] = await Promise.all([usdcBalance(agentAddr), usdcBalance(wireReq.payTo as `0x${string}`)])
}
if (agentBefore - agentAfter !== amount) fail(`agent balance moved ${agentBefore - agentAfter}, expected −${amount}`)
if (payToAfter - payToBefore !== amount) fail(`payTo balance moved +${payToAfter - payToBefore}, expected +${amount}`)

// proof artifact: the search results we actually paid for
let results: unknown
try {
  results = JSON.parse(paidText)
} catch {
  results = paidText
}
const items = ((results as { results?: unknown[] })?.results ?? []) as Array<{ title?: string; url?: string }>

console.log(`\n✅ EXA MAINNET LEG GREEN — mm TEE payer settled on Base MAINNET vs an independent seller`)
console.log(`   paid    : ${usd(amount)} USDC   ${agentAddr} (agent.steg.eth)  ${agentBefore} → ${agentAfter}`)
console.log(`   payTo   : ${wireReq.payTo} (Exa)  ${payToBefore} → ${payToAfter}`)
console.log(`   tx      : https://basescan.org/tx/${settlement.transaction}`)
console.log(`   bought  : Exa search "${QUERY}"`)
for (const r of items.slice(0, 3)) console.log(`             • ${r.title ?? r.url ?? "(result)"}`)
console.log(`   proves  : mm TEE EIP-3009 sig is facilitator-valid on MAINNET; identical payment core as the Travala booking; ENS gate + fail-closed guard held.`)
