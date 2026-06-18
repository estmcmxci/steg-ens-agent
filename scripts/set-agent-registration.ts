/**
 * Operator ENSIP-25 claim path (PLAN.md §3 step 5e / §3.3.1) — write the
 * agent-registration text record that attests <name> ↔ ERC-8004 agent id, signed
 * by the name's controller.
 *
 * ENSIP-25 (docs.ens.domains/ensip/25) is signature-FREE: the attestation IS the
 * record's presence, because only the name's controller can set it. Key:
 *   agent-registration[<registry>][<agentId>]   value: "1"
 * where <registry> is the ERC-7930 interoperable address of the ERC-8004 Identity
 * Registry (NOT the CAIP-10 form). erc7930Evm() lives in lib/agent-config.ts.
 *
 * Calldata via the vendored ens-cli (one resolver setText). Default DRY-RUN:
 * build + simulate via eth_call from the signer. Pass --send.
 *
 * Usage:
 *   bun scripts/set-agent-registration.ts                              # agent.steg.eth / id 34860
 *   bun scripts/set-agent-registration.ts --name demo.steg.eth --agent-id <minted> --hot-key
 *   bun scripts/set-agent-registration.ts --name demo.steg.eth --agent-id <minted> --hot-key --send
 *
 * Args / env:
 *   name | --name <s>   ENS name             (default: agent.steg.eth)
 *   --agent-id <n>      ERC-8004 agent id    (default: resolved from the agent, else 34860)
 *   --send | --ledger / --hot-key / --from / --hd-path / --rpc   as in the other scripts
 */

import {
  IDENTITY_REGISTRY,
  CHAIN_ID,
  erc7930Evm,
  parseCommon,
  makePublicClient,
  buildEnsBatch,
  preflightSimulate,
  confirmAndSend,
} from "./lib/agent-config"

const { flag, send, useHotKey, hdPath, rpc, name, operator, agent } = parseCommon({ defaultName: "agent.steg.eth" })
const agentId = flag("--agent-id") || agent.agentId
if (!agentId) {
  console.error("error: no agent id. Pass --agent-id <n> (minted by the bind for a new name).")
  process.exit(2)
}

const registry7930 = erc7930Evm(CHAIN_ID, IDENTITY_REGISTRY)
const key = `agent-registration[${registry7930}][${agentId}]`
const records = [{ type: "text", key, value: "1" }] as const

console.error(`set-agent-registration (ENSIP-25) — ${name}`)
console.error(`  registry (ERC-7930): ${registry7930}`)
console.error(`  key:   ${key}`)
console.error(`  value: "1"`)
console.error(`  signer: ${operator}${useHotKey ? " (hot key)" : ""}`)
console.error(`  rpc:    ${rpc}`)
console.error("")

const { to, data } = await buildEnsBatch(name, records as any)
const client = makePublicClient(rpc)
await preflightSimulate(
  client,
  { account: operator, to, data },
  "setText simulates cleanly from the signer.",
)

console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (setText of the ENSIP-25 claim)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast.")
  console.log(JSON.stringify({ to, data, key }))
  process.exit(0)
}

await confirmAndSend({
  to,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  promptMsg: `About to write the ENSIP-25 claim on ${name} from ${operator}.`,
})

console.error("")
console.error(`Done. ENSIP-25 claim set: a verifier resolving ${key} on ${name} now reads "1".`)
