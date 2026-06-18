/**
 * Reverse leg (PLAN.md §3.1 step 4 reverse / §3.3.1) — set a TEE server wallet's
 * reverse record so it reverse-resolves to its ENS name.
 *
 * The reverse node (<wallet>.addr.reverse) is owned by the server wallet itself,
 * NOT the operator — so this is signed by the TEE wallet via the mm CLI, not a
 * Ledger or the hot key. The server wallet calls ReverseRegistrar.setName(<name>),
 * writing its own reverse record. Beast mode → no MFA/confirm prompt.
 *
 * Milestone 7 reuse: the orchestrator selects the fresh demo wallet (`mm wallet
 * select`) before running this, so `mm wallet send-transaction` signs from it.
 *
 * Default is DRY-RUN: build calldata + eth_call-simulate setName from the server
 * wallet so a revert surfaces before spending gas. Pass --send to broadcast via mm.
 *
 * Usage:
 *   bun scripts/set-reverse-server-wallet.ts                                  # agent.steg.eth / 0x0943…
 *   bun scripts/set-reverse-server-wallet.ts --name demo.steg.eth --wallet 0x… --send --yes
 *
 * Args / env:
 *   --name <s>          ENS name to reverse to     (default: agent.steg.eth)
 *   --wallet <addr>     server wallet (simulate account; default: resolved from the agent)
 *   --send              broadcast via mm (TEE-signed)
 *   --yes | -y          skip the confirm prompt (automation)
 *   --rpc <url>         RPC
 */

import { $ } from "bun"
import { encodeFunctionData, getAddress, isAddress } from "viem"
import {
  REVERSE_REGISTRAR,
  DEFAULT_RPC,
  makeFlag,
  resolveAgent,
  makePublicClient,
} from "./lib/agent-config"

const setNameAbi = [
  { type: "function", name: "setName", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bytes32" }] },
] as const

const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const send = argv.includes("--send")
const yes = argv.includes("--yes") || argv.includes("-y")
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC
const name = flag("--name") || "agent.steg.eth"

const agent = resolveAgent(name)
const walletRaw = flag("--wallet") || agent.serverWallet
if (!walletRaw || !isAddress(walletRaw)) {
  console.error(`error: invalid/missing server-wallet address: ${walletRaw}. Pass --wallet 0x….`)
  process.exit(2)
}
const serverWallet = getAddress(walletRaw)

const data = encodeFunctionData({ abi: setNameAbi, functionName: "setName", args: [name] })

console.error(`set-reverse-server-wallet — ${name}`)
console.error(`  server wallet:     ${serverWallet}`)
console.error(`  ReverseRegistrar:  ${REVERSE_REGISTRAR}`)
console.error(`  call:              setName("${name}")`)
console.error("")

// ── pre-flight: simulate setName from the server wallet ──
const client = makePublicClient(rpc)
try {
  await client.call({ account: serverWallet, to: REVERSE_REGISTRAR, data })
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

if (!yes) {
  const answer = prompt(`About to set reverse ${serverWallet} → ${name} via mm. Type 'yes' to proceed:`)
  if (answer?.trim().toLowerCase() !== "yes") {
    console.error("aborted — nothing sent.")
    process.exit(0)
  }
}

// ── broadcast via mm: the TEE server wallet signs (beast mode, no confirm) ──
// NOTE: the orchestrator must have `mm wallet select`ed this server wallet first.
const payload = JSON.stringify({ to: REVERSE_REGISTRAR, value: "0x0", data })
console.error("")
console.error("broadcasting via mm wallet send-transaction (TEE-signed)…")
await $`mm wallet send-transaction --chain-id 1 --payload ${payload} --intent ${`Set ENS reverse record → ${name}`} --wait --toon`
console.error("")
console.error(`Done. ${serverWallet} should now reverse-resolve to ${name}.`)
