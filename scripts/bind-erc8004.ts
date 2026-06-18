/**
 * Operator bind path (PLAN.md §3 step 5) — register the agent's wrapped ENS name
 * as an ERC-8004 agent via adapter8004, hardware-signed.
 *
 * adapter8004.register(standard, tokenContract, tokenId, agentURI, metadata)
 * mints a fresh ERC-8004 agent id bound to the name's wrapped NFT. The adapter
 * permanently holds the agent NFT; the wrapped-name owner manages it through the
 * adapter (control follows the name). No token is transferred and no approval is
 * needed — register() only checks the caller controls the NFT (ERC-1155:
 * balanceOf(caller, tokenId) > 0).
 *
 * Default is DRY-RUN: it builds the calldata and SIMULATES the call (eth_call
 * from the operator) so you see the would-be agentId and any revert BEFORE
 * touching the Ledger. Pass --send (alias --ledger) to actually sign + broadcast.
 * agentURI is left empty by default — it's mutable (setAgentURI) and the card
 * needs the minted agentId first; fill it in afterward.
 *
 * Usage:
 *   bun scripts/bind-erc8004.ts [name]                 # dry-run: build + simulate
 *   bun scripts/bind-erc8004.ts [name] --send          # sign on Ledger + broadcast
 *
 * Args / env (sensible defaults for agent.steg.eth):
 *   name              ENS name to bind        (default: agent.steg.eth)
 *   --send | --ledger actually broadcast (Ledger-signed)
 *   --agent-uri <s>   ERC-8004 agentURI       (default: "" — set later)
 *   --from <addr>     Ledger account / NFT holder (default OPERATOR_ADDRESS or 0x4767…96fF)
 *   --hd-path <p>     Ledger derivation path  (env LEDGER_HD_PATH)
 *   --rpc <url>       RPC                      (default ETH_RPC_URL or eth.drpc.org)
 */

import { $ } from "bun"
import {
  createPublicClient,
  http,
  namehash,
  encodeFunctionData,
  decodeFunctionResult,
  isAddress,
} from "viem"
import { mainnet } from "viem/chains"

// ── mainnet addresses (PLAN.md §3) ──
const ADAPTER = "0xde152AfB7db5373F34876E1499fbD893A82dD336" as const // adapter8004 proxy
const NAME_WRAPPER = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401" as const
const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const // wrapped-name holder
const STANDARD_ERC1155 = 1 // TokenStandard enum: ERC721=0, ERC1155=1, … (wrapped ENS = ERC-1155)

const REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "standard", type: "uint8" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "agentURI", type: "string" },
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          { name: "metadataKey", type: "string" },
          { name: "metadataValue", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
] as const

const ERC1155_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const

// ── parse args ──
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : undefined
}
const send = argv.includes("--send") || argv.includes("--ledger")
const name = argv.find((a) => !a.startsWith("--") && a !== flag("--agent-uri") && a !== flag("--from") && a !== flag("--hd-path") && a !== flag("--rpc")) || "agent.steg.eth"
const agentURI = flag("--agent-uri") ?? ""
const operator = (flag("--from") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR) as `0x${string}`
const hdPath = flag("--hd-path") || process.env.LEDGER_HD_PATH
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || "https://eth.drpc.org"

if (!isAddress(operator)) {
  console.error(`error: invalid operator/--from address: ${operator}`)
  process.exit(2)
}

const tokenId = BigInt(namehash(name)) // wrapped ENS ERC-1155 tokenId == namehash(name)
const data = encodeFunctionData({
  abi: REGISTER_ABI,
  functionName: "register",
  args: [STANDARD_ERC1155, NAME_WRAPPER, tokenId, agentURI, []],
})

const client = createPublicClient({ chain: mainnet, transport: http(rpc) })

console.error(`bind-erc8004 — ${name}`)
console.error(`  adapter:   ${ADAPTER}`)
console.error(`  token:     ${NAME_WRAPPER} (NameWrapper, ERC-1155)`)
console.error(`  tokenId:   ${tokenId}`)
console.error(`  agentURI:  ${agentURI === "" ? '"" (set later via setAgentURI)' : agentURI}`)
console.error(`  operator:  ${operator}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

// ── pre-flight 1: operator holds the wrapped NFT ──
const bal = (await client.readContract({
  address: NAME_WRAPPER,
  abi: ERC1155_ABI,
  functionName: "balanceOf",
  args: [operator, tokenId],
})) as bigint
if (bal === 0n) {
  console.error(`✗ pre-flight: operator ${operator} does NOT hold ${name} (balanceOf=0).`)
  console.error(`  Is the name wrapped, and is --from the wrapped-name owner?`)
  process.exit(1)
}
console.error(`✓ pre-flight: operator holds the wrapped NFT (balanceOf=${bal}).`)

// ── pre-flight 2: simulate register() (eth_call, no signature, no state change) ──
let agentId: bigint | null = null
try {
  const res = await client.call({ account: operator, to: ADAPTER, data })
  if (res.data) {
    agentId = decodeFunctionResult({ abi: REGISTER_ABI, functionName: "register", data: res.data }) as bigint
  }
  console.error(`✓ pre-flight: register() simulates cleanly — would-be agentId ≈ ${agentId} (sequential; confirm from the tx).`)
} catch (err) {
  console.error(`✗ pre-flight: register() reverted in simulation — NOT safe to send.`)
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  process.exit(1)
}
console.error("")

// ── output / send ──
console.error(`to:   ${ADAPTER}`)
console.error(`data: ${data.length} chars (selector 0x${data.slice(2, 10)} = register(uint8,address,uint256,string,(string,bytes)[]))`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to sign on your Ledger.")
  // Machine-readable line for piping (matches the {to,data} convention).
  console.log(JSON.stringify({ to: ADAPTER, data, tokenId: tokenId.toString(), simulatedAgentId: agentId?.toString() ?? null }))
  process.exit(0)
}

// Interactive confirmation before any broadcast (project rule: ledger-cast
// scripts are interactive). The Ledger device is the second confirmation.
console.error("")
const answer = prompt(`About to broadcast register() for ${name} from ${operator}. Type 'yes' to proceed:`)
if (answer?.trim().toLowerCase() !== "yes") {
  console.error("aborted — nothing sent.")
  process.exit(0)
}

// Hardware-signed broadcast. Key never enters this CLI — cast talks to the Ledger.
const castArgs: string[] = [ADAPTER, data, "--rpc-url", rpc, "--ledger", "--from", operator]
if (hdPath) castArgs.push("--hd-path", hdPath)
console.error("")
console.error("(confirm the transaction on your Ledger)")
await $`cast send ${castArgs}`
console.error("")
console.error("Done. Next: read the minted agentId from the AgentBound event, then set the")
console.error(`'agent-id' + ENSIP-26 records and setAgentURI(agentId, "https://<worker>/card/${name}").`)
