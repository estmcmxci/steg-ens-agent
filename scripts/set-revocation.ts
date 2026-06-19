/**
 * Operator revocation toggle (PLAN.md §5 A2.2) — set auth.revocation[<credential>]
 * on an agent's ENS name, signed by the name's controller (the operator).
 *
 * This is the live allow↔deny switch: the verifier (/evaluate) reads this record
 * and denies a otherwise-valid, correctly-signed action when revoked. Flipping it
 * costs the operator nothing but one setText — authority is withdrawn at ENS, not
 * at the key (§4 thesis).
 *
 * Replaces the old scripts/revoke.ts (which only printed calldata via an ens-cli
 * subprocess — the Bun-crash vector). Calldata here is built IN-PROCESS via the
 * shared buildEnsBatch (viem); default is DRY-RUN (eth_call simulate). Pass --send.
 *
 * Usage:
 *   bun scripts/set-revocation.ts --name agent.steg.eth --revoked false           # dry-run (restore/allow)
 *   bun scripts/set-revocation.ts --name agent.steg.eth --revoked false --send    # operator Ledger
 *   bun scripts/set-revocation.ts --name agent.steg.eth --revoked true --reason "operator revoke" --send
 *
 * Args / env:
 *   name | --name <s>   ENS name                 (default: agent.steg.eth)
 *   --credential <id>   credential id            (default: primary)
 *   --revoked <bool>    true → deny, false → allow  (REQUIRED — explicit, no default)
 *   --reason <s>        reason string (revoked:true only)  (default: "operator revoke")
 *   --send | --ledger   actually broadcast
 *   --hot-key           sign with OPERATOR_HOT_KEY instead of Ledger
 *   --from / --hd-path / --rpc   as in the other scripts
 */

import {
  parseCommon,
  makePublicClient,
  buildEnsBatch,
  preflightSimulate,
  confirmAndSend,
} from "./lib/agent-config"
import { revocationKey } from "../src/ensRecordSource"

const { flag, send, useHotKey, yes, hdPath, rpc, name, operator } = parseCommon({ defaultName: "agent.steg.eth" })

const credentialId = flag("--credential") || "primary"
const revokedRaw = flag("--revoked")
if (revokedRaw !== "true" && revokedRaw !== "false") {
  console.error("error: pass --revoked true (deny) or --revoked false (allow). No default — be explicit.")
  process.exit(2)
}
const revoked = revokedRaw === "true"
const reason = flag("--reason") || "operator revoke"

// revoked:false restores the exact {"revoked":false} sentinel (matches publish-records).
// revoked:true carries revokedAt + reason (matches the original revoke.ts shape).
const value = revoked
  ? JSON.stringify({ revoked: true, revokedAt: Math.floor(Date.now() / 1000), reason })
  : JSON.stringify({ revoked: false })

const key = revocationKey(credentialId)

console.error(`set-revocation — ${name}`)
console.error(`  ${key} = ${value}`)
console.error(`  effect:    ${revoked ? "DENY (revoked)" : "ALLOW (operational)"}`)
console.error(`  signer:    ${operator}${useHotKey ? " (hot key)" : " (operator Ledger)"}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

const { to, data } = buildEnsBatch(name, [{ type: "text", key, value }])
const client = makePublicClient(rpc)
await preflightSimulate(
  client,
  { account: operator, to, data },
  "setText simulates cleanly from the signer.",
  "(is the signer the controller of the name's resolver node?)",
)

console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (multicall of 1 setText)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast (operator Ledger).")
  console.log(JSON.stringify({ to, data }))
  process.exit(0)
}

await confirmAndSend({
  to,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  assumeYes: yes,
  promptMsg: `About to set ${key}=${value} on ${name} from ${operator}.`,
})

console.error("")
console.error(`Done. ${name} is now ${revoked ? "DENY (revoked)" : "ALLOW (operational)"}. Re-run`)
console.error(`scripts/demo-mm.ts to confirm /evaluate flips accordingly.`)
