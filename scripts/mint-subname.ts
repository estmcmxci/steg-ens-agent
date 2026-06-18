/**
 * Mint a wrapped subname owned by the hot key (PLAN.md §3.3.1 Phase 1, option B) —
 * NameWrapper.setSubnodeRecord(parent, label, owner, resolver, ttl, fuses, expiry).
 *
 * This is THE one operator Ledger signature in the whole milestone-7 demo. The
 * parent (steg.eth) is wrapped and owner-held by the operator, so only the operator
 * can mint under it. We mint the child OWNED BY THE HOT KEY so the hot key then holds
 * the wrapped-subname ERC-1155 balance and can drive every subsequent provisioning
 * step (resolver records + the adapter bind/setAgentURI, which gate on balanceOf) with
 * NO delegate.xyz and NO standing setApprovalForAll. The hot key transfers the name to
 * the operator at the end (scripts/transfer-subname.ts).
 *
 * fuses = 0 — we burn NOTHING (notably not CANNOT_TRANSFER), so the final transfer to
 * the operator works. The subname is born WRAPPED because the parent is wrapped.
 *
 * Default DRY-RUN: build + eth_call-simulate from the operator. Pass --send → Ledger.
 *
 * Usage:
 *   bun scripts/mint-subname.ts --name demo.steg.eth                    # dry-run (owner = hot key)
 *   bun scripts/mint-subname.ts --name demo.steg.eth --owner 0x…        # explicit owner
 *   bun scripts/mint-subname.ts --name demo.steg.eth --send             # Ledger broadcast
 *
 * Args / env:
 *   --name <s>          full child name, e.g. demo.steg.eth   (REQUIRED)
 *   --owner <addr>      child owner (default: OPERATOR_HOT_KEY's address)
 *   --resolver <addr>   resolver (default: PublicResolver)
 *   --send | --ledger   actually broadcast (operator Ledger)
 *   --from / --hd-path / --rpc   as in the other scripts (signer = operator who owns the parent)
 */

import { namehash, encodeFunctionData, isAddress, getAddress } from "viem"
import {
  NAME_WRAPPER,
  PUBLIC_RESOLVER,
  parseCommon,
  makePublicClient,
  hotKeyAccount,
  confirmAndSend,
} from "./lib/agent-config"

const SET_SUBNODE_RECORD_ABI = [
  {
    name: "setSubnodeRecord",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "node", type: "bytes32" }],
  },
] as const

const OWNER_OF_ABI = [
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const

// mint is operator-signed (only the operator owns the parent), so default to Ledger.
const { flag, send, useHotKey, yes, hdPath, rpc, name, operator } = parseCommon({ defaultName: "" })
if (!name || !name.includes(".")) {
  console.error("error: pass a full child name via --name, e.g. --name demo.steg.eth")
  process.exit(2)
}

const dot = name.indexOf(".")
const label = name.slice(0, dot)
const parent = name.slice(dot + 1)
const parentNode = namehash(parent)
const childNode = namehash(name)

// owner = explicit --owner, else the hot key (option B).
const ownerRaw = flag("--owner") || hotKeyAccount().address
if (!isAddress(ownerRaw)) {
  console.error(`error: invalid --owner address: ${ownerRaw}`)
  process.exit(2)
}
const owner = getAddress(ownerRaw)
const resolverRaw = flag("--resolver") || PUBLIC_RESOLVER
const resolver = getAddress(resolverRaw)

const data = encodeFunctionData({
  abi: SET_SUBNODE_RECORD_ABI,
  functionName: "setSubnodeRecord",
  args: [parentNode, label, owner, resolver, 0n, 0, 0n], // ttl=0, fuses=0 (burn nothing), expiry=0
})

const client = makePublicClient(rpc)

console.error(`mint-subname — ${name}`)
console.error(`  parent:    ${parent} (node ${parentNode})`)
console.error(`  label:     ${label}`)
console.error(`  child:     ${name} (node ${childNode})`)
console.error(`  owner:     ${owner}  ← hot key (option B)`)
console.error(`  resolver:  ${resolver}`)
console.error(`  fuses:     0 (none burned — transfer-to-operator stays possible)`)
console.error(`  signer:    ${operator}${useHotKey ? " (hot key)" : " (operator Ledger)"}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

// ── pre-flight 1: child must not already exist ──
let existing = "0x0000000000000000000000000000000000000000"
try {
  existing = (await client.readContract({
    address: NAME_WRAPPER, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [BigInt(childNode)],
  })) as string
} catch { /* ownerOf reverts/zero for a non-existent name — treat as unminted */ }
if (existing && existing !== "0x0000000000000000000000000000000000000000") {
  console.error(`✗ pre-flight: ${name} already exists (owner ${existing}). Refusing to overwrite.`)
  process.exit(1)
}
console.error("✓ pre-flight: child name is unminted.")

// ── pre-flight 1.5: owner must be a clean EOA ──
// NameWrapper mints an ERC-1155 to `owner`; if owner has code (a contract OR an
// EIP-7702-delegated EOA, prefix 0xef0100), _mint runs onERC1155Received against
// that code and an unimplemented hook reverts with empty data. A fresh hot-key EOA
// is clean. Catch it here with a clear message instead of a cryptic revert.
const ownerCode = await client.getCode({ address: owner })
if (ownerCode && ownerCode !== "0x") {
  console.error(`✗ pre-flight: owner ${owner} has code on-chain (${ownerCode.slice(0, 12)}…).`)
  console.error(`  ERC-1155 mint requires onERC1155Received — use a fresh EOA hot key (no contract`)
  console.error(`  code, no EIP-7702 delegation) as the option-B owner.`)
  process.exit(1)
}
console.error("✓ pre-flight: owner is a clean EOA (no code).")

// ── pre-flight 2: simulate setSubnodeRecord from the operator ──
try {
  await client.call({ account: operator, to: NAME_WRAPPER, data })
  console.error("✓ pre-flight: setSubnodeRecord() simulates cleanly from the operator.")
} catch (err) {
  console.error("✗ pre-flight: setSubnodeRecord() reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  console.error(`  (does the signer own/control the wrapped parent ${parent}?)`)
  process.exit(1)
}
console.error("")

console.error(`to:   ${NAME_WRAPPER} (NameWrapper)`)
console.error(`data: ${data.length} chars (setSubnodeRecord)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast (operator Ledger).")
  console.log(JSON.stringify({ to: NAME_WRAPPER, data, childNode, owner }))
  process.exit(0)
}

await confirmAndSend({
  to: NAME_WRAPPER,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  assumeYes: yes,
  promptMsg: `About to mint ${name} owned by ${owner} from ${operator}.`,
})

console.error("")
console.error(`Done. ${name} minted, owned by the hot key. Next: run /provision (records → bind →`)
console.error(`identity → reverse), then scripts/transfer-subname.ts to hand it to the operator.`)
