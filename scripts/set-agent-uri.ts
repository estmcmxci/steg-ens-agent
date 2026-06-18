/**
 * Operator agentURI path (PLAN.md §3 step 5d) — point the ERC-8004 agent's URI
 * at the deployed card endpoint, hardware-signed.
 *
 * adapter8004.setAgentURI(agentId, newURI) forwards into the ERC-8004 registry
 * (becomes the agent NFT's tokenURI). Caller must control the bound token
 * (_requireController) — that's the operator, who manages via the adapter. The
 * URI is mutable, so this can be re-run.
 *
 * Default DRY-RUN: build + simulate via eth_call from the operator so a revert
 * surfaces BEFORE the Ledger. Pass --send (alias --ledger) to sign + broadcast.
 *
 * Usage:
 *   bun scripts/set-agent-uri.ts            # dry-run: build + simulate
 *   bun scripts/set-agent-uri.ts --send     # interactive confirm → Ledger
 *
 * Args / env:
 *   --uri <url>       agentURI (default: the deployed /card endpoint)
 *   --agent-id <n>    ERC-8004 agent id (default 34860)
 *   --from <addr>     Ledger account / controller (default OPERATOR_ADDRESS or 0x4767…96fF)
 *   --hd-path <p>     Ledger derivation path (env LEDGER_HD_PATH)
 *   --rpc <url>       RPC (default ETH_RPC_URL or eth.drpc.org)
 */

import { $ } from "bun"
import { createPublicClient, http, encodeFunctionData, isAddress } from "viem"
import { mainnet } from "viem/chains"

const ADAPTER = "0xde152AfB7db5373F34876E1499fbD893A82dD336" as const
const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const
const DEFAULT_AGENT_ID = "34860"
const DEFAULT_URI = "https://steg-agent-card.estmcmxci.workers.dev/card/agent.steg.eth"

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

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i !== -1 ? argv[i + 1] : undefined
}
const send = argv.includes("--send") || argv.includes("--ledger")
const uri = flag("--uri") || DEFAULT_URI
const agentId = BigInt(flag("--agent-id") || DEFAULT_AGENT_ID)
const operator = (flag("--from") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR) as `0x${string}`
const hdPath = flag("--hd-path") || process.env.LEDGER_HD_PATH
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || "https://eth.drpc.org"

if (!isAddress(operator)) {
  console.error(`error: invalid operator/--from address: ${operator}`)
  process.exit(2)
}

const data = encodeFunctionData({ abi: SET_AGENT_URI_ABI, functionName: "setAgentURI", args: [agentId, uri] })
const client = createPublicClient({ chain: mainnet, transport: http(rpc) })

console.error(`set-agent-uri — agent #${agentId}`)
console.error(`  adapter:   ${ADAPTER}`)
console.error(`  newURI:    ${uri}`)
console.error(`  operator:  ${operator}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

try {
  await client.call({ account: operator, to: ADAPTER, data })
  console.error("✓ pre-flight: setAgentURI() simulates cleanly from the operator.")
} catch (err) {
  console.error("✗ pre-flight: setAgentURI() reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  console.error("  (is the operator the controller of this agentId?)")
  process.exit(1)
}
console.error("")
console.error(`to:   ${ADAPTER}`)
console.error(`data: ${data.length} chars (setAgentURI(uint256,string))`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to sign on your Ledger.")
  console.log(JSON.stringify({ to: ADAPTER, data }))
  process.exit(0)
}

console.error("")
const answer = prompt(`About to setAgentURI(#${agentId}, ${uri}) from ${operator}. Type 'yes' to proceed:`)
if (answer?.trim().toLowerCase() !== "yes") {
  console.error("aborted — nothing sent.")
  process.exit(0)
}

const castArgs: string[] = [ADAPTER, data, "--rpc-url", rpc, "--ledger", "--from", operator]
if (hdPath) castArgs.push("--hd-path", hdPath)
console.error("")
console.error("(confirm the transaction on your Ledger)")
await $`cast send ${castArgs}`
console.error("")
console.error(`Done. The ERC-8004 agent's tokenURI now points at ${uri}.`)
