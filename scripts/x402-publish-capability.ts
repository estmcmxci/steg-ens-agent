/**
 * x402-publish-capability.ts — build the ENS auth.*[<cid>] records that grant (or
 * revoke) the x402.payment capability (ERD Arc 3 Step 3c), and emit the resolver
 * multicall payload for `mm wallet send-transaction` to broadcast from the agent's
 * OWN TEE wallet (self-sovereign: the agent owns its name, so it setTexts its own
 * records — the same path as brain ens_set_records / build-settext.ts).
 *
 * Signs NOTHING. Writes records/<name>.<cid>.json (provenance, mirrors the
 * primary credential) + prints the mm payload {to,value,data} to STDOUT (last
 * line, for capture). Human preview goes to STDERR.
 *
 * The credential `signer` MUST be the EOA whose secp256k1 sigs the verifier
 * checks == the wallet that signs the x402 payment == the active mm wallet.
 *
 * Usage (grant):
 *   bun scripts/x402-publish-capability.ts \
 *     --name carlos.steg.eth --signer 0xbCE7…47Ef
 * Usage (revoke — the 3d demo): add --revoke (flips auth.revocation[<cid>] to a
 *   PRESENT record; the verifier is presence-based so any present value = revoked).
 *
 * Flags (defaults = the carlos x402.payment grant decided in ERD §0 Step 3c):
 *   --name <ens>          default carlos.steg.eth
 *   --signer <0x>         REQUIRED for grant (the agent EOA)
 *   --credential-id <s>   default x402-payment
 *   --asset <0x>          default Base USDC 0x8335…2913
 *   --max-amount <int>    default 1000000  ($1.00, 6dp)
 *   --allowed-payto <0x|*>default *
 *   --network <caip2>     default eip155:8453
 *   --revoke              emit a revoked revocation record (else the {"revoked":false} sentinel)
 */

import { buildEnsBatch } from "./lib/agent-config"

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(name)

const NAME = flag("--name") ?? "carlos.steg.eth"
const CID = flag("--credential-id") ?? "x402-payment"
const ASSET = flag("--asset") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const MAX_AMOUNT = flag("--max-amount") ?? "1000000"
const ALLOWED_PAYTO = flag("--allowed-payto") ?? "*"
const NETWORK = flag("--network") ?? "eip155:8453"
const REVOKE = has("--revoke")
const SIGNER = flag("--signer")

if (!REVOKE && (!SIGNER || !/^0x[0-9a-fA-F]{40}$/.test(SIGNER))) {
  console.error("error: --signer 0x… (the agent EOA) is required for a grant")
  process.exit(2)
}

const credential = { credentialId: CID, schemeId: "ecdsa-secp256k1", signer: SIGNER, notBefore: 0, notAfter: 0 }
const capability = { credentialId: CID, actionType: "x402.payment", asset: ASSET, maxAmount: MAX_AMOUNT, allowedPayTo: ALLOWED_PAYTO, network: NETWORK }
// Presence-based revocation: sentinel {"revoked":false} maps to ABSENT (granted);
// a present {revokedAt} record = revoked (the operator's kill-switch).
const revocation = REVOKE ? { credentialId: CID, revokedAt: 1 } : { revoked: false }

// A grant writes all three; a revoke only needs to flip the revocation key.
const records = REVOKE
  ? [{ type: "text" as const, key: `auth.revocation[${CID}]`, value: JSON.stringify(revocation) }]
  : [
      { type: "text" as const, key: `auth.credential[${CID}]`, value: JSON.stringify(credential) },
      { type: "text" as const, key: `auth.capability[${CID}]`, value: JSON.stringify(capability) },
      { type: "text" as const, key: `auth.revocation[${CID}]`, value: JSON.stringify(revocation) },
    ]

console.error(`=== ${REVOKE ? "REVOKE" : "GRANT"} x402.payment on ${NAME} (credentialId=${CID}) ===`)
for (const r of records) console.error(`  ${r.key}\n     = ${r.value}`)

// Provenance file (array form, mirrors records/agent.steg.eth.primary.json).
const outPath = `records/${NAME}.${CID}${REVOKE ? ".revoke" : ""}.json`
await Bun.write(outPath, JSON.stringify(records, null, 2) + "\n")
console.error(`\nwrote ${records.length} record(s) → ${outPath}`)

const { to, data } = buildEnsBatch(NAME, records as never)
console.error(`\nresolver multicall → ${to} (${(data.length - 2) / 2} bytes)`)
console.error(`Broadcast (self-sign, agent owns its name):`)
console.error(`  mm wallet select --address ${SIGNER ?? "<agent EOA>"}   # act as the name's controller`)
console.error(`  mm wallet send-transaction --chain-id 1 --payload "$PAYLOAD" --wait --json`)

// STDOUT: the mm-ready payload (last line) for `PAYLOAD=$(…)` capture.
console.log(JSON.stringify({ to, value: "0x0", data }))
