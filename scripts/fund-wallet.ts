/**
 * Fund a wallet with gas from the hot key (PLAN.md §3.3.1 Phase 4) — a plain ETH
 * transfer, hot-key-signed.
 *
 * The fresh TEE demo server wallet is created mid-/provision with ZERO balance but
 * must pay for its own reverse `setName`. It can't be pre-funded (it doesn't exist
 * yet) and the wizard streams the whole choreography in one call, so /provision
 * calls this right after wallet_create to top the new wallet up for that one tx.
 *
 * Default DRY-RUN: prints the transfer + checks the hot key can afford it. Pass
 * --send to broadcast.
 *
 * Usage:
 *   bun scripts/fund-wallet.ts --to 0x… --amount 0.003                  # dry-run
 *   bun scripts/fund-wallet.ts --to 0x… --amount 0.003 --send --yes     # broadcast (hot key)
 *
 * Args / env:
 *   --to <addr>      recipient                 (REQUIRED)
 *   --amount <eth>   ETH to send               (default: 0.003)
 *   --send           broadcast
 *   --yes | -y       skip the confirm prompt (automation)
 *   --rpc <url>      RPC
 */

import { isAddress, getAddress, parseEther, formatEther } from "viem"
import {
  DEFAULT_RPC,
  makeFlag,
  hotKeyAccount,
  makePublicClient,
  confirmAndSend,
} from "./lib/agent-config"

const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const send = argv.includes("--send") || argv.includes("--ledger")
const yes = argv.includes("--yes") || argv.includes("-y")
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC

const toRaw = flag("--to")
if (!toRaw || !isAddress(toRaw)) {
  console.error(`error: invalid/missing --to address: ${toRaw}`)
  process.exit(2)
}
const to = getAddress(toRaw)
const amount = flag("--amount") || "0.003"
const value = parseEther(amount)

const from = getAddress(hotKeyAccount().address)
const client = makePublicClient(rpc)

console.error(`fund-wallet — ${amount} ETH`)
console.error(`  from:   ${from}  ← hot key`)
console.error(`  to:     ${to}`)
console.error(`  rpc:    ${rpc}`)
console.error("")

// ── idempotency: if the recipient already holds >= amount, skip (safe retry) ──
// /provision re-runs this step after a transient Bun native crash. If the prior
// attempt already broadcast, the recipient is funded — re-sending would double-spend.
// Skipping makes the Fund step safe to retry (it's otherwise non-idempotent).
const recipientBal = await client.getBalance({ address: to })
if (recipientBal >= value) {
  console.error(`✓ idempotent: ${to} already holds ${formatEther(recipientBal)} ETH (>= ${amount}); skipping.`)
  console.log(JSON.stringify({ to, value: value.toString(), skipped: true }))
  process.exit(0)
}

// ── pre-flight: the hot key can afford amount + a gas buffer ──
const bal = await client.getBalance({ address: from })
const buffer = parseEther("0.0002") // gas headroom for a 21k transfer (~45x cost at sub-gwei)
if (bal < value + buffer) {
  console.error(`✗ pre-flight: hot key balance ${formatEther(bal)} ETH < ${amount} + gas buffer. Fund ${from}.`)
  process.exit(1)
}
console.error(`✓ pre-flight: hot key balance ${formatEther(bal)} ETH covers ${amount} + gas.`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast (hot key).")
  console.log(JSON.stringify({ to, value: value.toString() }))
  process.exit(0)
}

await confirmAndSend({
  to,
  data: "0x",
  value,
  rpc,
  operator: from,
  useHotKey: true, // always hot-key-signed
  assumeYes: yes,
  promptMsg: `About to send ${amount} ETH from the hot key to ${to}.`,
})

console.error("")
console.error(`Done. Funded ${to} with ${amount} ETH for gas.`)
