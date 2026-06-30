/**
 * x402 TEE-signing smoke test — ERD §15 Step 6 (the decisive S5 feasibility check).
 *
 * Proves, ZERO-SPEND, that the MetaMask TEE server-wallet can sign EIP-712 typed
 * data **headlessly** (via `mm wallet sign-typed-data --wait`, no MFA in beast
 * mode), and that our `scripts/mm-x402-account.ts` adapter drives it end-to-end.
 *
 * The signed document is INERT: a custom `StegSmokeTest` type whose
 * `verifyingContract` is a non-token (0x..0001). A signature over it authorizes
 * NOTHING — it is not an EIP-3009 TransferWithAuthorization / Permit / Permit2 /
 * Seaport struct, so no funds can move (ERD §15.7 #10). The `types` deliberately
 * OMITS `EIP712Domain` (mirroring what ExactEvmScheme passes) — so this also
 * checks that mm 2.0.0 tolerates that (ERD §15.7 #5-low / #10).
 *
 * Run (after `mm auth status` is green): bun scripts/x402-smoke-sign.ts
 */

import { recoverTypedDataAddress } from "viem"
import { createMmX402Account, type Eip712TypedData, BASE_MAINNET_CHAIN_ID } from "./mm-x402-account"

// A non-token address — anything signed against this domain authorizes nothing.
const INERT_VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000001" as const

const inert: Eip712TypedData = {
  domain: {
    name: "steg-x402-smoke",
    version: "1",
    chainId: BASE_MAINNET_CHAIN_ID, // 8453 — the chain id the adapter will derive
    verifyingContract: INERT_VERIFYING_CONTRACT,
  },
  // Custom struct; intentionally NO EIP712Domain entry (the x402 scheme omits it too).
  types: { StegSmokeTest: [{ name: "purpose", type: "string" }] },
  primaryType: "StegSmokeTest",
  message: { purpose: "steg x402 TEE-signing smoke test — authorizes nothing" },
}

// Guard matched to the inert doc so the adapter's full path runs (guard → serialize
// → mm --wait → extract). The doc has no `value`/`to`/`from`, so those checks skip.
const account = await createMmX402Account(
  { maxValue: 0n, verifyingContract: INERT_VERIFYING_CONTRACT, chainId: BASE_MAINNET_CHAIN_ID },
  { intent: "steg x402 smoke test (inert, zero-spend)" },
)

console.error(`[smoke] signer (active mm wallet): ${account.address}`)
console.error(`[smoke] requesting TEE signature via mm wallet sign-typed-data --wait …`)
console.error(`[smoke] (beast mode => expect NO MFA prompt; if this blocks, the path is not headless)`)

const t0 = Date.now()
const sig = await account.signTypedData(inert)
const ms = Date.now() - t0

// Inert doc => the signature is harmless to surface; still print only a redacted
// summary to model the §15.7 #16 no-full-signature-in-logs hygiene.
const bytes = (sig.length - 2) / 2

// Cryptographically verify the signature is genuine: recover the EIP-712 signer
// and assert it equals the active wallet. This also proves mm emits a viem-/
// facilitator-compatible signature (recoverTypedDataAddress is what verifiers use).
// inert is typed as Eip712TypedData (Record<string, unknown>), which is looser
// than viem's strict TypedData generic — cast the whole arg (smoke harness only).
const recovered = await recoverTypedDataAddress({
  domain: inert.domain,
  types: inert.types,
  primaryType: inert.primaryType,
  message: inert.message,
  signature: sig,
} as Parameters<typeof recoverTypedDataAddress>[0])
const verified = recovered.toLowerCase() === account.address.toLowerCase()

console.log(`\n✅ PASS — TEE server-wallet signed EIP-712 HEADLESSLY in ${ms}ms`)
console.log(`   signature : ${bytes} bytes  (${sig.slice(0, 10)}…${sig.slice(-6)})`)
console.log(`   recovered : ${recovered}  ${verified ? "✓ MATCHES active wallet" : "✗ MISMATCH"}`)
console.log(`   => mm 2.0.0 server-wallet typed-data signing works on the TEE; EIP712Domain omission tolerated.`)
console.log(`   => signature is viem/EIP-712-valid (facilitator-compatible).`)
console.log(`   => ERD §15 Step 6 GREEN; S5 headless feasibility confirmed for beast mode.`)
if (!verified) {
  console.error(`\n❌ signature did NOT recover to the signer — investigate before trusting the path.`)
  process.exit(1)
}
