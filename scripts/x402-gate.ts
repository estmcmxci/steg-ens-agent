/**
 * x402-gate.ts — CLI wrapper over the payment-specific ENS authority probe
 * (scripts/lib/x402-payment-gate.ts). Signs the REAL x402.payment (asset/payTo/
 * amount/network) under the `x402-payment` credential and evaluates it, so the
 * verdict reflects the on-chain x402.payment capability — not the generic
 * erc20.transfer placeholder (§15.7 #2). Exit 0 = allowed, 1 = denied/error.
 *
 * Run (allow):  WORKER_URL=… bun scripts/x402-gate.ts --pay-to 0x… --amount 7000
 * Run (deny):   … --amount 2000000            # over the $1 cap → POLICY_DENIED
 * Flags: --pay-to (req) · --amount base-units (req) · --asset (def Base USDC) ·
 *        --network (def eip155:8453) · --credential-id (def x402-payment)
 */

import { gatePayment } from "./lib/x402-payment-gate"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const argVal = (f: string): string | undefined => {
  const i = process.argv.indexOf(f)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const payTo = argVal("--pay-to")
const amount = argVal("--amount")
if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
  console.error("error: --pay-to 0x… (40 hex) required")
  process.exit(2)
}
if (!amount || !/^[0-9]+$/.test(amount)) {
  console.error("error: --amount <base-units integer> required")
  process.exit(2)
}

const verdict = await gatePayment({
  payTo,
  amount,
  asset: argVal("--asset") ?? BASE_USDC,
  network: argVal("--network") ?? "eip155:8453",
  credentialId: argVal("--credential-id") ?? "x402-payment",
})

console.error(`agent name : ${verdict.name}`)
console.log(JSON.stringify({ ok: true, ...verdict }))
process.exit(verdict.allowed ? 0 : 1)
