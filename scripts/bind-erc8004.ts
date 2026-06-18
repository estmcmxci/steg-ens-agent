/**
 * Operator bind path (PLAN.md §3 step 5b / §3.3.1) — register an agent's wrapped
 * ENS name as an ERC-8004 agent via adapter8004, signed by the name's controller.
 *
 * adapter8004.register(standard, tokenContract, tokenId, agentURI, metadata)
 * mints a fresh ERC-8004 agent id bound to the name's wrapped NFT. The adapter
 * permanently holds the agent NFT; the wrapped-name owner manages it through the
 * adapter (control follows the name). No token is transferred and no approval is
 * needed — register() only checks the caller controls the NFT (ERC-1155:
 * balanceOf(caller, tokenId) > 0).
 *
 * PHASE 0 NOTE (PLAN.md §3.3): for plain ERC-1155 (an ENS subname's only standard)
 * the adapter ignores delegate.xyz — control is PURELY balanceOf. So the milestone-7
 * hot key can only bind a name it HOLDS (option B: demo.steg.eth is minted owned by
 * the hot key). `--hot-key` signs as that balance-holding hot key; there is no
 * delegation shortcut.
 *
 * Default is DRY-RUN: build calldata + eth_call-SIMULATE (from the signer) so the
 * would-be agentId and any revert surface BEFORE broadcasting. Pass --send to sign.
 * agentURI is left empty by default — it's mutable (setAgentURI) and the card needs
 * the minted agentId first; fill it in afterward.
 *
 * Usage:
 *   bun scripts/bind-erc8004.ts [name]                      # dry-run (default agent.steg.eth)
 *   bun scripts/bind-erc8004.ts --name demo.steg.eth --hot-key          # dry-run, hot-key signer
 *   bun scripts/bind-erc8004.ts --name demo.steg.eth --hot-key --send   # broadcast
 *
 * Args / env:
 *   name | --name <s>   ENS name to bind            (default: agent.steg.eth)
 *   --send | --ledger   actually broadcast
 *   --hot-key           sign with OPERATOR_HOT_KEY env (option B) instead of Ledger
 *   --agent-uri <s>     ERC-8004 agentURI           (default: "" — set later)
 *   --from <addr>       Ledger account / NFT holder (default OPERATOR_ADDRESS or 0x4767…96fF)
 *   --hd-path <p>       Ledger derivation path      (env LEDGER_HD_PATH)
 *   --rpc <url>         RPC                         (env ETH_RPC_URL or eth.drpc.org)
 */

import { namehash, encodeFunctionData, decodeFunctionResult } from "viem"
import {
  ADAPTER,
  NAME_WRAPPER,
  STANDARD_ERC1155,
  parseCommon,
  makePublicClient,
  confirmAndSend,
} from "./lib/agent-config"

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

const { flag, send, useHotKey, hdPath, rpc, name, operator } = parseCommon({ defaultName: "agent.steg.eth" })
const agentURI = flag("--agent-uri") ?? ""

const tokenId = BigInt(namehash(name)) // wrapped ENS ERC-1155 tokenId == namehash(name)
const data = encodeFunctionData({
  abi: REGISTER_ABI,
  functionName: "register",
  args: [STANDARD_ERC1155, NAME_WRAPPER, tokenId, agentURI, []],
})

const client = makePublicClient(rpc)

console.error(`bind-erc8004 — ${name}`)
console.error(`  adapter:   ${ADAPTER}`)
console.error(`  token:     ${NAME_WRAPPER} (NameWrapper, ERC-1155)`)
console.error(`  tokenId:   ${tokenId}`)
console.error(`  agentURI:  ${agentURI === "" ? '"" (set later via setAgentURI)' : agentURI}`)
console.error(`  signer:    ${operator}${useHotKey ? " (hot key)" : ""}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

// ── pre-flight 1: the signer holds the wrapped NFT (ERC-1155 balance == control) ──
const bal = (await client.readContract({
  address: NAME_WRAPPER,
  abi: ERC1155_ABI,
  functionName: "balanceOf",
  args: [operator, tokenId],
})) as bigint
if (bal === 0n) {
  console.error(`✗ pre-flight: signer ${operator} does NOT hold ${name} (balanceOf=0).`)
  console.error(`  Is the name wrapped, and is the signer the wrapped-name owner?`)
  console.error(`  (option B: demo.steg.eth must be minted owned by the hot key before binding.)`)
  process.exit(1)
}
console.error(`✓ pre-flight: signer holds the wrapped NFT (balanceOf=${bal}).`)

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

console.error(`to:   ${ADAPTER}`)
console.error(`data: ${data.length} chars (selector 0x${data.slice(2, 10)} = register(uint8,address,uint256,string,(string,bytes)[]))`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast.")
  console.log(JSON.stringify({ to: ADAPTER, data, tokenId: tokenId.toString(), simulatedAgentId: agentId?.toString() ?? null }))
  process.exit(0)
}

await confirmAndSend({
  to: ADAPTER,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  promptMsg: `About to broadcast register() for ${name} from ${operator}.`,
})

console.error("")
console.error("Done. Next: read the minted agentId from the AgentBound event, then set the")
console.error(`'agent-id' + ENSIP-26 records and setAgentURI(agentId, "https://<worker>/card/${name}").`)
