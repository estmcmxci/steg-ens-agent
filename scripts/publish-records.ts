/**
 * Operator publish path (PRD §10/§20) — build the three M1-shaped auth records
 * and emit the onchain calldata to set them, by dogfooding the vendored
 * ens-cli (`set batch` → a single multicall {to, data, value}).
 *
 * This does NOT send a transaction. It prints calldata for the operator to
 * sign and send from the name owner's wallet (the agent-native, key-holder
 * pattern the ens-cli is built around). Run AFTER the name exists and its
 * resolver is the ENS Public Resolver.
 *
 * The revocation record is pre-seeded with the {"revoked": false} sentinel
 * (PRD §10) so that the later live revoke is a value *update*, not a key
 * *creation*. The EnsRecordSource adapter maps that sentinel → absent.
 *
 * Usage:
 *   bun scripts/publish-records.ts <name> [credentialId]
 *
 * Env (all optional; defaults make the M1 demo signer/policy work as-is):
 *   SIGNER_ADDRESS    signer whose secp256k1 sigs the verifier checks
 *                     (default: the M1 demo agent account address)
 *   TOKEN             erc20 token address      (default: M1 demo token)
 *   MAX_AMOUNT        policy max amount        (default: 1000000)
 *   ALLOWED_RECIPIENT recipient or "*"         (default: "*")
 *   NOT_BEFORE        unix seconds             (default: 0)
 *   NOT_AFTER         unix seconds, 0 = no expiry (default: 0)
 *   ENS_CHAIN         ens-cli chain flag       (default: mainnet)
 */

import { $ } from "bun"
import { capabilityKey, credentialKey, revocationKey } from "../src/ensRecordSource"
import type { CredentialRecord, PolicyRecord } from "../src/types"

const name = process.argv[2]
const credentialId = process.argv[3] || "primary"
if (!name) {
  console.error("Usage: bun scripts/publish-records.ts <name> [credentialId]")
  process.exit(2)
}

// The signer is the agent wallet whose secp256k1 signatures the verifier
// checks. Default to AGENT_ADDRESS from .env (the mm BYOK wallet); never
// silently fall back to a test key — a wrong signer bakes a dead credential
// onchain. Override per-run with SIGNER_ADDRESS.
const signer = (process.env.SIGNER_ADDRESS || process.env.AGENT_ADDRESS) as `0x${string}` | undefined
if (!signer || !/^0x[0-9a-fA-F]{40}$/.test(signer)) {
  console.error(
    "error: no agent signer. Set AGENT_ADDRESS in .env (the mm wallet) or pass SIGNER_ADDRESS=0x…",
  )
  process.exit(2)
}
const token = (process.env.TOKEN || "0x1111111111111111111111111111111111111111") as `0x${string}`
const maxAmount = process.env.MAX_AMOUNT || "1000000"
const allowedRecipient = (process.env.ALLOWED_RECIPIENT || "*") as PolicyRecord["allowedRecipient"]
const notBefore = Number(process.env.NOT_BEFORE || "0")
const notAfter = Number(process.env.NOT_AFTER || "0")
const chain = process.env.ENS_CHAIN || "mainnet"

const credential: CredentialRecord = { credentialId, schemeId: "ecdsa-secp256k1", signer, notBefore, notAfter }
const policy: PolicyRecord = { credentialId, actionType: "erc20.transfer", token, maxAmount, allowedRecipient }
const revocationSentinel = { revoked: false } // pre-seed; adapter maps → absent

const operations = [
  { type: "text", key: credentialKey(credentialId), value: JSON.stringify(credential) },
  { type: "text", key: capabilityKey(credentialId), value: JSON.stringify(policy) },
  { type: "text", key: revocationKey(credentialId), value: JSON.stringify(revocationSentinel) },
]

console.error(`Building auth.* records for ${name} (credentialId=${credentialId}):`)
for (const op of operations) console.error(`  ${op.key} = ${op.value}`)
console.error("")

// `--records-json [path]`: write the records as a JSON file for manual pushing
// (ENS app / your own tool) instead of emitting onchain calldata. The file is
// an array of { type, key, value } — `value` is the EXACT string to set as the
// text record. It's also directly consumable by:
//   bun tools/ens-cli/src/index.ts set batch <name> --data "$(cat <file>)"
const jsonIdx = process.argv.indexOf("--records-json")
if (jsonIdx !== -1) {
  const outPath = process.argv[jsonIdx + 1]?.startsWith("--")
    ? `records/${name}.${credentialId}.json`
    : process.argv[jsonIdx + 1] || `records/${name}.${credentialId}.json`
  await Bun.write(outPath, JSON.stringify(operations, null, 2) + "\n")
  console.error(`Wrote ${operations.length} records to ${outPath}`)
  process.exit(0)
}

console.error(`Emitting multicall calldata via ens-cli (chain=${chain})...\n`)

// ens-cli emits {to, data, value} JSON to stdout — pass it straight through.
const data = JSON.stringify(operations)
await $`bun tools/ens-cli/src/index.ts set batch ${name} --chain ${chain} --data ${data}`
