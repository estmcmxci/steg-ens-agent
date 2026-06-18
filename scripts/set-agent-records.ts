/**
 * Operator record path (PLAN.md §3 step 5c / §3.3.1) — set an agent's ENSIP-26 /
 * card records, signed by the name's controller.
 *
 * Writes the descriptive records that GET /card renders + the `agent-id` record
 * that flips /card's erc8004 block to verified (it reads agent-id, then confirms
 * via adapter8004.bindingOf). agent-endpoint[web] + setAgentURI are DEFERRED
 * until the worker/cockpit have a stable HTTPS URL — they're a separate script.
 *
 * Calldata is built by the vendored ens-cli (`set batch` → one resolver multicall).
 * Default is DRY-RUN: build + simulate via eth_call from the signer. Pass --send.
 *
 * Usage:
 *   bun scripts/set-agent-records.ts                                  # agent.steg.eth (id 34860)
 *   bun scripts/set-agent-records.ts --name demo.steg.eth --agent-id <minted> --hot-key
 *   bun scripts/set-agent-records.ts --name demo.steg.eth --agent-id <minted> --hot-key --send
 *
 * Args / env:
 *   name | --name <s>   ENS name             (default: agent.steg.eth)
 *   --agent-id <n>      ERC-8004 agent id    (default: resolved from the agent, else 34860)
 *   --send | --ledger   actually broadcast
 *   --hot-key           sign with OPERATOR_HOT_KEY (option B) instead of Ledger
 *   --from / --hd-path / --rpc   as in the other scripts
 */

import {
  parseCommon,
  makePublicClient,
  buildEnsBatch,
  preflightSimulate,
  confirmAndSend,
} from "./lib/agent-config"

const DESCRIPTION =
  "ENS-native agent wallet. Operates a MetaMask wallet under verifiable, operator-revocable ENS authority: balances and transfers, token swaps and cross-chain bridges, perps and prediction markets, and ENS identity management."

// A2A skills (the per-agent card template, PLAN.md §3.3) — JSON-encoded into one text record.
const SKILLS = [
  { id: "wallet", name: "Wallet, balances & transfers", description: "Read native + token balances across chains with USD values, and send transfers.", tags: ["wallet", "balances", "transfers"] },
  { id: "swaps", name: "Swaps & cross-chain bridges", description: "Same-chain swaps and cross-chain bridge quotes and execution.", tags: ["swap", "bridge", "defi"] },
  { id: "markets", name: "Perps & prediction markets", description: "Hyperliquid perpetual futures and Polymarket prediction markets.", tags: ["perps", "prediction-markets", "trading"] },
  { id: "ens", name: "ENS identity management", description: "Resolve and register ENS names, edit records, and manage the agent's own ENS identity.", tags: ["ens", "identity", "naming"] },
]

const { flag, send, useHotKey, yes, hdPath, rpc, name, operator, agent } = parseCommon({ defaultName: "agent.steg.eth" })
const agentId = flag("--agent-id") || agent.agentId
if (!agentId) {
  console.error("error: no agent id. Pass --agent-id <n> (minted by the bind for a new name).")
  process.exit(2)
}

const records = [
  { type: "text", key: "agent-id", value: agentId },
  { type: "text", key: "display", value: name },
  { type: "text", key: "description", value: DESCRIPTION },
  { type: "text", key: "agent-skills", value: JSON.stringify(SKILLS) },
  { type: "text", key: "agent-trust-models", value: JSON.stringify(["feedback"]) },
] as const

console.error(`set-agent-records — ${name}`)
for (const r of records) {
  const v = r.value.length > 80 ? r.value.slice(0, 77) + "…" : r.value
  console.error(`  ${r.key} = ${v}`)
}
console.error(`  signer:    ${operator}${useHotKey ? " (hot key)" : ""}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

const { to, data } = await buildEnsBatch(name, records as any)
const client = makePublicClient(rpc)
await preflightSimulate(
  client,
  { account: operator, to, data },
  "setText multicall simulates cleanly from the signer.",
  "(is the signer authorised on the wrapped name's resolver?)",
)

console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (multicall of ${records.length} setText calls)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast.")
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
  promptMsg: `About to set ${records.length} records on ${name} from ${operator}.`,
})

console.error("")
console.error(`Done. /card/${name} now reads agent-id=${agentId} → erc8004 verified. Next:`)
console.error(`setAgentURI(${agentId}, <card URL>) + the ENSIP-25 claim.`)
