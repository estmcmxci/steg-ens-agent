/**
 * Operator revoke path — the live allow→deny flip (PRD §19, the demo's most
 * important moment). Emits onchain calldata that UPDATES the pre-seeded
 * revocation record from the {"revoked": false} sentinel to an active
 * revocation. Because the key already exists (pre-seeded at publish time),
 * this is a value update, not a key creation.
 *
 * Like publish-records.ts, this prints calldata for the operator to sign and
 * send — it does not broadcast a transaction.
 *
 * Usage:
 *   bun scripts/revoke.ts <name> [credentialId] [reason]
 */

import { $ } from "bun"
import { revocationKey } from "../src/ensRecordSource"

const name = process.argv[2]
const credentialId = process.argv[3] || "primary"
const reason = process.argv[4] || "operator revoke"
if (!name) {
  console.error("Usage: bun scripts/revoke.ts <name> [credentialId] [reason]")
  process.exit(2)
}

const chain = process.env.ENS_CHAIN || "mainnet"
// revokedAt is provided by the operator's clock; pass via env to keep the
// emitted calldata reproducible if needed.
const revokedAt = Number(process.env.REVOKED_AT || Math.floor(Date.now() / 1000))
const value = JSON.stringify({ revoked: true, revokedAt, reason })

console.error(`Revoking ${revocationKey(credentialId)} on ${name}:`)
console.error(`  ${value}\n`)
console.error(`Emitting setText calldata via ens-cli (chain=${chain})...\n`)

await $`bun tools/ens-cli/src/index.ts set text ${name} ${revocationKey(credentialId)} ${value} --chain ${chain}`
