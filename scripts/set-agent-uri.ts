/**
 * Operator agentURI path (PLAN.md §3 step 5d / §3.3.1) — point an ERC-8004 agent's
 * URI at the deployed card endpoint, signed by the name's controller.
 *
 * adapter8004.setAgentURI(agentId, newURI) forwards into the ERC-8004 registry
 * (becomes the agent NFT's tokenURI). Caller must control the bound token
 * (_requireController → ERC-1155 balanceOf). For a new name under option B that's
 * the hot key holding the freshly-minted subname. The URI is mutable (re-runnable).
 *
 * Default DRY-RUN: build + simulate via eth_call from the signer. Pass --send.
 *
 * Usage:
 *   bun scripts/set-agent-uri.ts                                       # agent.steg.eth / id 34860
 *   bun scripts/set-agent-uri.ts --name demo.steg.eth --agent-id <minted> --hot-key
 *   bun scripts/set-agent-uri.ts --name demo.steg.eth --agent-id <minted> --hot-key --send
 *
 * Args / env:
 *   name | --name <s>   ENS name (drives the default card URL)  (default: agent.steg.eth)
 *   --agent-id <n>      ERC-8004 agent id    (default: resolved from the agent, else 34860)
 *   --uri <url>         agentURI override    (default: the deployed /card/<name> endpoint)
 *   --send | --ledger   actually broadcast
 *   --hot-key           sign with OPERATOR_HOT_KEY (option B) instead of Ledger
 *   --from / --hd-path / --rpc   as in the other scripts
 */

import { encodeFunctionData } from "viem"
import {
  ADAPTER,
  parseCommon,
  makePublicClient,
  preflightSimulate,
  confirmAndSend,
} from "./lib/agent-config"

const WORKER_BASE = process.env.CARD_WORKER_BASE || "https://steg-agent-card.estmcmxci.workers.dev"

const SET_AGENT_URI_ABI = [
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
] as const

const { flag, send, useHotKey, yes, hdPath, rpc, name, operator, agent } = parseCommon({ defaultName: "agent.steg.eth" })
const agentIdStr = flag("--agent-id") || agent.agentId
if (!agentIdStr) {
  console.error("error: no agent id. Pass --agent-id <n> (minted by the bind for a new name).")
  process.exit(2)
}
const agentId = BigInt(agentIdStr)
const uri = flag("--uri") || `${WORKER_BASE}/card/${name}`

const data = encodeFunctionData({ abi: SET_AGENT_URI_ABI, functionName: "setAgentURI", args: [agentId, uri] })
const client = makePublicClient(rpc)

console.error(`set-agent-uri — agent #${agentId} (${name})`)
console.error(`  adapter:   ${ADAPTER}`)
console.error(`  newURI:    ${uri}`)
console.error(`  signer:    ${operator}${useHotKey ? " (hot key)" : ""}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

await preflightSimulate(
  client,
  { account: operator, to: ADAPTER, data },
  "setAgentURI() simulates cleanly from the signer.",
  "(is the signer the controller of this agentId?)",
)

console.error("")
console.error(`to:   ${ADAPTER}`)
console.error(`data: ${data.length} chars (setAgentURI(uint256,string))`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast.")
  console.log(JSON.stringify({ to: ADAPTER, data }))
  process.exit(0)
}

await confirmAndSend({
  to: ADAPTER,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  assumeYes: yes,
  promptMsg: `About to setAgentURI(#${agentId}, ${uri}) from ${operator}.`,
})

console.error("")
console.error(`Done. The ERC-8004 agent's tokenURI now points at ${uri}.`)
