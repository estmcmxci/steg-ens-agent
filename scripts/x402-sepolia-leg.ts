/**
 * x402-sepolia-leg.ts — ERD §9 leg-2: the Base-Sepolia EXECUTE validation (= S2).
 *
 * Pays the self-hosted reference seller (x402-sepolia-seller.ts) with TEST USDC
 * through the IDENTICAL payment core the mainnet EXECUTE uses:
 *
 *   gate probe → createMmX402Account (fail-closed guard) →
 *   ExactEvmScheme.createPaymentPayload (mm TEE signs EIP-3009) →
 *   encodePaymentSignatureHeader → replay with PAYMENT-SIGNATURE → settle.
 *
 * For maximum fidelity to the mainnet Travala run, the seller's v2 challenge is
 * first re-shaped into the v1-style wire form (`maxAmountRequired`) and pushed
 * back through `toV2Requirements` — exercising the exact normalization the
 * mainnet path relies on (the bug this leg exists to validate).
 *
 * Exit: non-zero unless the payment settled on-chain AND balances moved exactly
 * −amount (agent) / +amount (payTo). Prints the basescan link.
 *
 * Run (seller must be up):  bun scripts/x402-sepolia-leg.ts
 * Env: SELLER_URL · X402_SEPOLIA_PAYTO · X402_SEPOLIA_MAX (base units, default 0.05)
 *      SKIP_GATE=1 (plumbing-only mode; the default runs the real ENS gate probe)
 */

import { createPublicClient, http, erc20Abi } from "viem"
import { baseSepolia } from "viem/chains"
import { ExactEvmScheme } from "@x402/evm/exact/client"
import { encodePaymentSignatureHeader, decodePaymentResponseHeader } from "@x402/core/http"
import { gateAllows } from "./lib/ens-gate"
import { toV2Requirements, type X402Requirement } from "./x402-pay"
import { createMmX402Account, BASE_SEPOLIA_USDC, BASE_SEPOLIA_CHAIN_ID, type PaymentGuard } from "./mm-x402-account"

const SELLER_URL = process.env.SELLER_URL ?? "http://127.0.0.1:4021/paid"
const EXPECTED_PAYTO = (process.env.X402_SEPOLIA_PAYTO ?? "0x703ae03fB120eC91e9Ed6d08Ce8044E498CC789B").toLowerCase()
const MAX_TEST_USDC = BigInt(process.env.X402_SEPOLIA_MAX ?? "50000") // 0.05 test USDC cap
const NETWORK = `eip155:${BASE_SEPOLIA_CHAIN_ID}`

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") })
const usdcBalance = (addr: `0x${string}`) =>
  client.readContract({ address: BASE_SEPOLIA_USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] })

const fail = (msg: string): never => {
  console.error(`\n✗ SEPOLIA LEG FAILED: ${msg}`)
  process.exit(1)
}

// ── 1. Challenge: expect a 402 with a v2 accepts entry ──
console.error(`[leg] GET ${SELLER_URL} (expecting 402)`)
const challenge = await fetch(SELLER_URL)
if (challenge.status !== 402) fail(`expected HTTP 402, got ${challenge.status}`)
const body = (await challenge.json()) as { x402Version?: number; accepts?: Array<Record<string, unknown>> }
const v2wire = body.accepts?.[0]
if (body.x402Version !== 2 || !v2wire) fail(`402 body missing x402Version:2 / accepts[0]`)

// ── 2. Re-shape to the v1-style wire form, then normalize back via
//       toV2Requirements — the exact transform the mainnet EXECUTE performs. ──
const wireReq: X402Requirement = {
  scheme: String(v2wire!.scheme),
  network: String(v2wire!.network),
  asset: String(v2wire!.asset),
  payTo: String(v2wire!.payTo),
  maxAmountRequired: String(v2wire!.amount),
  maxTimeoutSeconds: Number(v2wire!.maxTimeoutSeconds ?? 300),
  extra: v2wire!.extra as { name?: string; version?: string } | undefined,
}

// ── 3. Fail-closed requirements guard (Sepolia pins) ──
if (wireReq.scheme !== "exact") fail(`scheme ${wireReq.scheme} ≠ exact`)
if (wireReq.network !== NETWORK) fail(`network ${wireReq.network} ≠ ${NETWORK}`)
if (wireReq.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) fail(`asset ${wireReq.asset} ≠ Base Sepolia test USDC`)
if (wireReq.payTo.toLowerCase() !== EXPECTED_PAYTO) fail(`payTo ${wireReq.payTo} ≠ pinned ${EXPECTED_PAYTO}`)
const amount = BigInt(wireReq.maxAmountRequired)
if (amount > MAX_TEST_USDC) fail(`amount ${amount} exceeds cap ${MAX_TEST_USDC}`)
if (wireReq.extra?.name !== "USDC" || wireReq.extra?.version !== "2") fail(`unexpected EIP-712 domain ${JSON.stringify(wireReq.extra)} (Sepolia test USDC is name "USDC" version "2")`)
console.error(`[leg] ✓ guard: ${(Number(amount) / 1e6).toFixed(6)} test-USDC → ${wireReq.payTo} on ${NETWORK}`)

// ── 4. ENS authority gate (same probe as the mainnet EXECUTE) ──
if (process.env.SKIP_GATE === "1") {
  console.error(`[leg] ⚠ SKIP_GATE=1 — plumbing-only run, gate probe skipped`)
} else {
  console.error(`[leg] running ENS authority probe …`)
  const gate = await gateAllows()
  if (!gate.allowed) fail(`ENS gate DENIED (${gate.reason}) — nothing signed`)
  console.error(`[leg] ✓ gate allowed`)
}

// ── 5. Sign + pay through the identical core ──
const account = await createMmX402Account(
  {
    maxValue: MAX_TEST_USDC,
    verifyingContract: BASE_SEPOLIA_USDC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    allowedTo: [wireReq.payTo as `0x${string}`],
  } satisfies PaymentGuard,
  { intent: `x402 Sepolia reference-seller leg — ${(Number(amount) / 1e6).toFixed(6)} test USDC (S2 validation)` },
)
const agentAddr = account.address
const [agentBefore, payToBefore] = await Promise.all([usdcBalance(agentAddr), usdcBalance(wireReq.payTo as `0x${string}`)])
console.error(`[leg] signer=${agentAddr}  balances before: agent=${agentBefore} payTo=${payToBefore}`)

const v2req = toV2Requirements(wireReq)
console.error(`[leg] mm TEE signing EIP-3009 (chain ${BASE_SEPOLIA_CHAIN_ID}, domain "${v2req.extra.name}" v${v2req.extra.version}) …`)
const result = await new ExactEvmScheme(account).createPaymentPayload(
  2,
  v2req as unknown as Parameters<ExactEvmScheme["createPaymentPayload"]>[1],
)
const header = encodePaymentSignatureHeader({
  x402Version: result.x402Version,
  payload: result.payload,
  accepted: v2req,
} as unknown as Parameters<typeof encodePaymentSignatureHeader>[0])
console.error(`[leg] ✓ signed — replaying with PAYMENT-SIGNATURE (${header.length}b header)`)

const paid = await fetch(SELLER_URL, { headers: { "PAYMENT-SIGNATURE": header } })
const paidBody = await paid.text()
if (paid.status !== 200) fail(`replay returned HTTP ${paid.status}: ${paidBody.slice(0, 600)}`)

const respHeader = paid.headers.get("PAYMENT-RESPONSE")
if (!respHeader) fail(`200 but no PAYMENT-RESPONSE header`)
const settlement = decodePaymentResponseHeader(respHeader!) as { success?: boolean; transaction?: string; network?: string; payer?: string }
if (!settlement.success || !settlement.transaction) fail(`settlement not successful: ${JSON.stringify(settlement).slice(0, 400)}`)
console.error(`[leg] ✓ HTTP 200 + PAYMENT-RESPONSE: tx=${settlement.transaction} payer=${settlement.payer}`)

// ── 6. On-chain assertion: exactly one settlement, exact amounts ──
console.error(`[leg] waiting for on-chain balance change …`)
let agentAfter = agentBefore
let payToAfter = payToBefore
for (let i = 0; i < 20 && agentAfter === agentBefore; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  ;[agentAfter, payToAfter] = await Promise.all([usdcBalance(agentAddr), usdcBalance(wireReq.payTo as `0x${string}`)])
}
if (agentBefore - agentAfter !== amount) fail(`agent balance moved ${agentBefore - agentAfter}, expected −${amount}`)
if (payToAfter - payToBefore !== amount) fail(`payTo balance moved +${payToAfter - payToBefore}, expected +${amount}`)

console.log(`\n✅ SEPOLIA LEG GREEN (S2)`)
console.log(`   amount   : ${(Number(amount) / 1e6).toFixed(6)} test USDC`)
console.log(`   payer    : ${agentAddr} (agent.steg.eth)  ${agentBefore} → ${agentAfter}`)
console.log(`   payTo    : ${wireReq.payTo}  ${payToBefore} → ${payToAfter}`)
console.log(`   tx       : https://sepolia.basescan.org/tx/${settlement.transaction}`)
console.log(`   proves   : mm TEE EIP-3009 sig is facilitator-valid; PaymentPayload/accepted v2 shape accepted; toV2Requirements normalization correct; guard passed a legit payment.`)
