/**
 * Milestone 6 step 4 (reverse leg) — set the reverse record for the TEE server
 * wallet so 0x0943…C7EE1 reverse-resolves to agent.steg.eth.
 *
 * The reverse node (0x0943….addr.reverse) is owned by the server wallet itself,
 * NOT the operator — so this is signed by the TEE wallet via the mm CLI, not the
 * operator's Ledger. The server wallet calls ReverseRegistrar.setName("agent.steg.eth"),
 * which writes its own reverse record. Beast mode → no MFA/confirm prompt.
 *
 * Default is DRY-RUN: build calldata + eth_call-simulate setName from the server
 * wallet so a revert surfaces before spending gas. Pass --send to broadcast via mm.
 *
 * Usage:
 *   bun scripts/set-reverse-server-wallet.ts          # dry-run: build + simulate
 *   bun scripts/set-reverse-server-wallet.ts --send   # broadcast via mm (TEE-signed)
 */

import { $ } from "bun"
import { createPublicClient, http, encodeFunctionData, getAddress } from "viem"
import { mainnet } from "viem/chains"

const NAME = "agent.steg.eth"
const SERVER_WALLET = getAddress("0x0943142f488fb694141841bf46e17be2bb5c7ee1")
// ENS mainnet ReverseRegistrar (registry.owner(namehash("addr.reverse"))), verified on-chain.
const REVERSE_REGISTRAR = getAddress("0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb")
const setNameAbi = [
  { type: "function", name: "setName", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bytes32" }] },
] as const

const argv = process.argv.slice(2)
const send = argv.includes("--send")
const rpc = process.env.ETH_RPC_URL || "https://eth.drpc.org"

const data = encodeFunctionData({ abi: setNameAbi, functionName: "setName", args: [NAME] })

console.error(`set-reverse-server-wallet — ${NAME}`)
console.error(`  server wallet:     ${SERVER_WALLET}`)
console.error(`  ReverseRegistrar:  ${REVERSE_REGISTRAR}`)
console.error(`  call:              setName("${NAME}")`)
console.error("")

// ── pre-flight: simulate setName from the server wallet ──
const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
try {
  await client.call({ account: SERVER_WALLET, to: REVERSE_REGISTRAR, data })
  console.error("✓ pre-flight: setName simulates cleanly from the server wallet.")
} catch (err) {
  console.error("✗ pre-flight: setName reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  process.exit(1)
}

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast via mm (TEE-signed).")
  console.log(JSON.stringify({ to: REVERSE_REGISTRAR, data, value: "0x0" }))
  process.exit(0)
}

// ── broadcast via mm: the TEE server wallet signs (beast mode, no confirm) ──
const payload = JSON.stringify({ to: REVERSE_REGISTRAR, value: "0x0", data })
console.error("")
console.error("broadcasting via mm wallet send-transaction (TEE-signed)…")
await $`mm wallet send-transaction --chain-id 1 --payload ${payload} --intent ${`Set ENS reverse record → ${NAME}`} --wait --toon`
console.error("")
console.error(`Done. ${SERVER_WALLET} should now reverse-resolve to ${NAME}.`)
