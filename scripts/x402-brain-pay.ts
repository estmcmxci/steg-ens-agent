/**
 * x402-brain-pay.ts — the machine-readable x402-over-HTTP payer the steg BRAIN
 * shells (ERD Arc 3 / §8 Phase 3). It generalizes scripts/x402-exa-leg.ts (the
 * mainnet payer proof) into a parameterized CLI that emits a single JSON line on
 * stdout, so brain/app/tools/actions.py's `x402_pay_{preview,execute}` can parse
 * a verdict — mirroring how demo-mm.ts / build-settext.ts are shelled today.
 *
 * We are the BUYER of a standard x402 (Branch-1) HTTP seller. Proven seller = Exa
 * web search (Travala's payment host is 503 — deferred). Every already-tested
 * piece is reused unchanged:
 *   - createMmX402Account (mm TEE server-wallet signs EIP-3009)  → mm-x402-account.ts
 *   - toV2Requirements / X402Requirement (v1-wire → v2 amount fix) → x402-pay.ts
 *   - gateAllows (ENS authority probe → /evaluate)                → lib/ens-gate.ts
 *   - the fail-closed requirements guard (asset/network/domain/cap/payTo)
 *
 * Two modes:
 *   PREVIEW (default, ZERO-SPEND): 402 → select → guard → (gate probe) → emit.
 *     Safe on an UNFUNDED wallet; validates the whole pipeline.
 *   EXECUTE (--execute + a FUNDED agent.steg.eth): sign → replay → settle →
 *     assert on-chain deltas → emit tx.
 *
 * The gate: by DEFAULT the script runs its own ENS gate probe (safe standalone).
 * The brain passes --no-gate because it already called gate_or_refusal() one layer
 * up (matching transfer_execute: Python gates, then shells an ungated executor).
 *
 * stdout = EXACTLY ONE JSON line (the verdict). All diagnostics go to stderr.
 * Exit 0 on ok:true, 1 on ok:false.
 *
 * Args:
 *   --url <sellerUrl>       (required) the x402-gated endpoint to POST
 *   --body <jsonString>     request body (default "{}")
 *   --max <baseUnits>       USDC cap in base units (6 dp; default 10000 = $0.01)
 *   --pay-to <0xaddr>       optional: pin the expected payment recipient
 *   --execute               sign + settle (omit = zero-spend preview)
 *   --no-gate               skip the internal gate probe (caller already gated)
 *   --intent <text>         human-readable intent forwarded to mm --intent
 */

import { createPublicClient, http, erc20Abi } from "viem"
import { base } from "viem/chains"
import { ExactEvmScheme } from "@x402/evm/exact/client"
import { encodePaymentSignatureHeader, decodePaymentResponseHeader } from "@x402/core/http"
import { gatePayment } from "./lib/x402-payment-gate"
import { toV2Requirements, type X402Requirement } from "./x402-pay"
import { createMmX402Account, BASE_USDC, BASE_MAINNET_CHAIN_ID, type PaymentGuard } from "./mm-x402-account"

// ── args ──
const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
const hasFlag = (flag: string): boolean => process.argv.includes(flag)

const NETWORK = `eip155:${BASE_MAINNET_CHAIN_ID}` // brain payer is Base-mainnet USDC only

const emit = (obj: Record<string, unknown>): void => {
  process.stdout.write(JSON.stringify(obj) + "\n")
}
const fail = (stage: string, error: string): never => {
  emit({ ok: false, stage, error })
  process.exit(1)
}
const usd = (v: bigint): string => (Number(v) / 1e6).toFixed(6)

const url = argVal("--url") ?? fail("args", "--url is required")
const bodyStr = argVal("--body") ?? "{}"
const MAX_UNITS = ((): bigint => {
  try {
    return BigInt(argVal("--max") ?? "10000")
  } catch {
    return fail("args", `--max must be an integer (base units), got "${argVal("--max")}"`)
  }
})()
const payToPin = argVal("--pay-to")?.toLowerCase()
const EXECUTE = hasFlag("--execute")
const GATE = !hasFlag("--no-gate")
const intent = argVal("--intent") ?? `x402 payment (≤ $${usd(MAX_UNITS)}) via steg brain`

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") })
const usdcBalance = (addr: `0x${string}`) =>
  client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] })
const post = (extra: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: bodyStr })

// ── 1. Challenge: POST → expect a 402 with a v2 accepts[] ──
process.stderr.write(`[brain-pay] POST ${url} (expecting 402) …\n`)
let challenge: Response
try {
  challenge = await post()
} catch (e) {
  fail("challenge", `POST failed: ${String(e).slice(0, 200)}`)
}
if (challenge!.status !== 402) {
  const t = await challenge!.text().catch(() => "")
  fail("challenge", `expected HTTP 402, got ${challenge!.status} (endpoint free or changed?) ${t.slice(0, 200)}`)
}
const cbody = (await challenge!.json().catch(() => ({}))) as {
  x402Version?: number
  accepts?: Array<Record<string, unknown>>
}
if (cbody.x402Version !== 2) fail("challenge", `402 body missing x402Version:2 (got ${cbody.x402Version})`)
if (!Array.isArray(cbody.accepts) || cbody.accepts.length === 0) fail("challenge", `402 body missing accepts[]`)

// ── 2. SELECT the Base-mainnet canonical-USDC exact entry (NEVER blind-take accepts[0]) ──
const chosen = cbody.accepts!.find(
  (a) =>
    a.scheme === "exact" &&
    a.network === NETWORK &&
    typeof a.asset === "string" &&
    (a.asset as string).toLowerCase() === BASE_USDC.toLowerCase(),
)
if (!chosen) {
  fail("select", `no ${NETWORK} canonical-USDC exact entry in accepts: ${JSON.stringify(cbody.accepts).slice(0, 400)}`)
}
const wireReq: X402Requirement = {
  scheme: String(chosen!.scheme),
  network: String(chosen!.network),
  asset: String(chosen!.asset),
  payTo: String(chosen!.payTo),
  // v2 sellers advertise `amount`; v1-wire (Travala) uses `maxAmountRequired`.
  maxAmountRequired: String(chosen!.amount ?? chosen!.maxAmountRequired),
  maxTimeoutSeconds: Number(chosen!.maxTimeoutSeconds ?? 300),
  extra: chosen!.extra as { name?: string; version?: string } | undefined,
}

// ── 3. Fail-closed requirements guard ──
if (payToPin && wireReq.payTo.toLowerCase() !== payToPin) fail("guard", `payTo ${wireReq.payTo} ≠ pinned ${payToPin}`)
if (wireReq.extra?.name !== "USD Coin" || wireReq.extra?.version !== "2")
  fail("guard", `unexpected EIP-712 domain ${JSON.stringify(wireReq.extra)} (Base mainnet USDC is name "USD Coin" version "2")`)
let amount: bigint
try {
  amount = BigInt(wireReq.maxAmountRequired)
} catch {
  fail("guard", `unparseable amount "${wireReq.maxAmountRequired}"`)
}
if (amount! > MAX_UNITS) fail("guard", `amount ${amount!} (${usd(amount!)} USDC) exceeds cap ${MAX_UNITS} ($${usd(MAX_UNITS)})`)
process.stderr.write(`[brain-pay] ✓ guard: ${usd(amount!)} USDC → ${wireReq.payTo} on ${NETWORK}\n`)

// ── 4. PAYMENT-SPECIFIC ENS authority gate — signs the REAL x402.payment and
//    evaluates it against the on-chain x402.payment capability (amount cap,
//    recipient, PAYMENT-specific revocation). Not the erc20 placeholder (§15.7 #2). ──
let gate: { allowed: boolean; reason: string } = { allowed: true, reason: "SKIPPED (--no-gate)" }
if (GATE) {
  process.stderr.write(`[brain-pay] x402.payment authority probe (sign real payment → /evaluate) …\n`)
  const v = await gatePayment({
    payTo: wireReq.payTo,
    amount: amount!.toString(),
    asset: wireReq.asset,
    network: NETWORK,
    credentialId: "x402-payment",
  })
  gate = { allowed: v.allowed, reason: v.detail ? `${v.reason}/${v.detail}` : v.reason }
  process.stderr.write(`[brain-pay] gate: ${gate.allowed ? "✓ allowed" : `✗ ${gate.reason}`}\n`)
  // In EXECUTE, a deny is a hard stop before signing. In PREVIEW it's informational.
  if (EXECUTE && !gate.allowed)
    fail("gate", `ENS gate DENIED (${gate.reason}) — nothing signed. The operator revoked or capped x402.payment authority at ENS.`)
}

const domain = { name: wireReq.extra?.name, version: wireReq.extra?.version }

// ── PREVIEW: stop before any sign/spend ──
if (!EXECUTE) {
  emit({
    ok: true,
    mode: "preview",
    url,
    amount: amount!.toString(),
    amountUsd: usd(amount!),
    payTo: wireReq.payTo,
    asset: wireReq.asset,
    network: NETWORK,
    scheme: wireReq.scheme,
    domain,
    capUsd: usd(MAX_UNITS),
    gate,
  })
  process.exit(0)
}

// ── 5. EXECUTE — funds check, sign via mm TEE, replay, settle, assert ──
const account = await createMmX402Account(
  {
    maxValue: MAX_UNITS,
    verifyingContract: BASE_USDC,
    chainId: BASE_MAINNET_CHAIN_ID,
    allowedTo: [wireReq.payTo as `0x${string}`],
  } satisfies PaymentGuard,
  { intent },
)
const agentAddr = account.address
const [agentBefore, payToBefore] = await Promise.all([
  usdcBalance(agentAddr),
  usdcBalance(wireReq.payTo as `0x${string}`),
])
if (agentBefore < amount!)
  fail("funds", `agent USDC ${agentBefore} < required ${amount!} — fund agent.steg.eth (${agentAddr}) with Base USDC first`)

const v2req = toV2Requirements(wireReq)
process.stderr.write(`[brain-pay] mm TEE signing EIP-3009 (chain ${BASE_MAINNET_CHAIN_ID}) …\n`)
let header: string
try {
  const result = await new ExactEvmScheme(account).createPaymentPayload(
    2,
    v2req as unknown as Parameters<ExactEvmScheme["createPaymentPayload"]>[1],
  )
  header = encodePaymentSignatureHeader({
    x402Version: result.x402Version,
    payload: result.payload,
    accepted: v2req,
  } as unknown as Parameters<typeof encodePaymentSignatureHeader>[0])
} catch (e) {
  fail("sign", `mm TEE sign / payload build failed: ${String(e).slice(0, 240)}`)
}

process.stderr.write(`[brain-pay] replaying POST with PAYMENT-SIGNATURE …\n`)
const paid = await post({ "PAYMENT-SIGNATURE": header! })
const paidText = await paid.text()
if (paid.status !== 200) fail("settle", `replay returned HTTP ${paid.status}: ${paidText.slice(0, 400)}`)

const respHeader = paid.headers.get("PAYMENT-RESPONSE")
if (!respHeader) fail("settle", `200 but no PAYMENT-RESPONSE header`)
const settlement = decodePaymentResponseHeader(respHeader!) as {
  success?: boolean
  transaction?: string
  network?: string
  payer?: string
}
if (!settlement.success || !settlement.transaction)
  fail("settle", `settlement not successful: ${JSON.stringify(settlement).slice(0, 300)}`)
process.stderr.write(`[brain-pay] ✓ HTTP 200 + settlement tx=${settlement.transaction}\n`)

// ── 6. On-chain assertion (bounded poll; header success is the source of truth) ──
let agentAfter = agentBefore
let payToAfter = payToBefore
for (let i = 0; i < 8 && agentAfter === agentBefore; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  ;[agentAfter, payToAfter] = await Promise.all([
    usdcBalance(agentAddr),
    usdcBalance(wireReq.payTo as `0x${string}`),
  ])
}
const onchainConfirmed = agentBefore - agentAfter === amount! && payToAfter - payToBefore === amount!

emit({
  ok: true,
  mode: "execute",
  url,
  tx: settlement.transaction,
  explorerUrl: `https://basescan.org/tx/${settlement.transaction}`,
  paid: amount!.toString(),
  amountUsd: usd(amount!),
  payTo: wireReq.payTo,
  asset: wireReq.asset,
  network: NETWORK,
  agent: agentAddr,
  settlement: { success: settlement.success, payer: settlement.payer, network: settlement.network },
  onchainConfirmed,
  balances: {
    agentBefore: agentBefore.toString(),
    agentAfter: agentAfter.toString(),
    payToBefore: payToBefore.toString(),
    payToAfter: payToAfter.toString(),
  },
})
