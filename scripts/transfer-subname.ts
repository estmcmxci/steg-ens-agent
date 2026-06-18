/**
 * Transfer a wrapped subname from the hot key to the operator (PLAN.md §3.3.1
 * Phase 1, final provisioning step / option B) —
 * NameWrapper.safeTransferFrom(hotKey, operator, namehash, 1, "0x").
 *
 * After /provision finishes (records + bind + identity + reverse), the hot key still
 * OWNS the subname — which would let the agent's authority key rewrite its own
 * identity. This hands the name to the operator so authority is operator-revocable at
 * rest (§4 thesis). Signed BY THE HOT KEY (it's the current owner), so --hot-key is
 * the default signer here, not the Ledger.
 *
 * Default DRY-RUN: build + eth_call-simulate from the hot key. Pass --send.
 *
 * Usage:
 *   bun scripts/transfer-subname.ts --name demo.steg.eth                 # dry-run (→ operator)
 *   bun scripts/transfer-subname.ts --name demo.steg.eth --to 0x… --send # broadcast
 *
 * Args / env:
 *   --name <s>          full child name, e.g. demo.steg.eth   (REQUIRED)
 *   --to <addr>         recipient (default: DEFAULT_OPERATOR / OPERATOR_ADDRESS)
 *   --send | --ledger   actually broadcast
 *   --hot-key           sign with OPERATOR_HOT_KEY (DEFAULT here — the hot key owns the name)
 *   --rpc <url>         RPC
 */

import { namehash, encodeFunctionData, isAddress, getAddress } from "viem"
import {
  NAME_WRAPPER,
  DEFAULT_OPERATOR,
  makeFlag,
  hotKeyAccount,
  makePublicClient,
  confirmAndSend,
  DEFAULT_RPC,
} from "./lib/agent-config"

const SAFE_TRANSFER_FROM_ABI = [
  {
    name: "safeTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const

const BALANCE_OF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const

// The signer is ALWAYS the hot key here (current owner). --hot-key is implied.
const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const send = argv.includes("--send") || argv.includes("--ledger")
const yes = argv.includes("--yes") || argv.includes("-y")
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC
const name = flag("--name")
if (!name || !name.includes(".")) {
  console.error("error: pass a full child name via --name, e.g. --name demo.steg.eth")
  process.exit(2)
}

const from = getAddress(hotKeyAccount().address) // hot key = current owner
const toRaw = flag("--to") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR
if (!isAddress(toRaw)) {
  console.error(`error: invalid --to address: ${toRaw}`)
  process.exit(2)
}
const to = getAddress(toRaw)
const id = BigInt(namehash(name))

const data = encodeFunctionData({
  abi: SAFE_TRANSFER_FROM_ABI,
  functionName: "safeTransferFrom",
  args: [from, to, id, 1n, "0x"],
})

const client = makePublicClient(rpc)

console.error(`transfer-subname — ${name}`)
console.error(`  from:   ${from}  ← hot key (current owner)`)
console.error(`  to:     ${to}  ← operator (authority at rest)`)
console.error(`  id:     ${id}`)
console.error(`  rpc:    ${rpc}`)
console.error("")

// ── pre-flight 1: the hot key actually owns the name ──
const bal = (await client.readContract({
  address: NAME_WRAPPER, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [from, id],
})) as bigint
if (bal === 0n) {
  console.error(`✗ pre-flight: hot key ${from} does NOT hold ${name} (balanceOf=0). Nothing to transfer.`)
  process.exit(1)
}
console.error(`✓ pre-flight: hot key holds the wrapped subname (balanceOf=${bal}).`)

// ── pre-flight 2: simulate the transfer from the hot key ──
try {
  await client.call({ account: from, to: NAME_WRAPPER, data })
  console.error("✓ pre-flight: safeTransferFrom() simulates cleanly from the hot key.")
} catch (err) {
  console.error("✗ pre-flight: safeTransferFrom() reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  console.error("  (is CANNOT_TRANSFER burned on this name? it must not be.)")
  process.exit(1)
}
console.error("")

console.error(`to:   ${NAME_WRAPPER} (NameWrapper)`)
console.error(`data: ${data.length} chars (safeTransferFrom)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast (hot key).")
  console.log(JSON.stringify({ to: NAME_WRAPPER, data }))
  process.exit(0)
}

await confirmAndSend({
  to: NAME_WRAPPER,
  data,
  rpc,
  operator: from,
  useHotKey: true, // always hot-key-signed
  hdPath: undefined,
  assumeYes: yes,
  promptMsg: `About to transfer ${name} from the hot key to ${to}.`,
})

console.error("")
console.error(`Done. ${name} now owned by ${to}. Authority is operator-revocable at rest (§4).`)
