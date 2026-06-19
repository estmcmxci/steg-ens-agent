/**
 * A2.3 — the action-layer proof (PLAN.md §5): a real, TEE-signed on-chain tx from
 * the live agent wallet, executed via the mm CLI in beast mode (NO Ledger, NO
 * MM_PASSWORD). Default is a 0-VALUE SELF-TRANSFER: it proves the TEE wallet can
 * author and broadcast a transaction end-to-end while moving no value — the safest
 * possible "it can act" demonstration on a near-empty wallet.
 *
 * The active mm wallet IS the signer, so `mm wallet select` the intended wallet
 * first (default here = whatever is active). Beast mode → ENS is the only policy
 * layer, so there is no confirm prompt on the device.
 *
 * Default is DRY-RUN: build the tx + eth_call-simulate from the wallet so a revert
 * surfaces before any gas. Pass --send to broadcast via mm.
 *
 * Usage:
 *   bun scripts/tee-self-transfer.ts                       # dry-run, self → self, 0 value
 *   bun scripts/tee-self-transfer.ts --send --yes          # broadcast (TEE-signed)
 *   bun scripts/tee-self-transfer.ts --to 0x… --value 0    # explicit recipient
 *
 * Args / env:
 *   --to <addr>     recipient        (default: the active mm wallet — self)
 *   --value <eth>   ETH to send      (default: 0)
 *   --send          broadcast via mm (TEE-signed)
 *   --yes | -y      skip the confirm prompt
 *   --rpc <url>     RPC
 */

import { $ } from "bun"
import { getAddress, isAddress, parseEther, formatEther, toHex } from "viem"
import { DEFAULT_RPC, makeFlag, makePublicClient } from "./lib/agent-config"

const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const send = argv.includes("--send")
const yes = argv.includes("--yes") || argv.includes("-y")
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC

// Active mm wallet = the signer. Resolve it so the default recipient is self.
const showRaw = await $`mm wallet show --json`.nothrow().quiet().text()
let active: string | undefined
try {
  active = JSON.parse(showRaw)?.data?.address
} catch { /* fall through to the guard below */ }
if (!active || !isAddress(active)) {
  console.error("error: could not read the active mm wallet (`mm wallet show`). Is mm logged in?")
  process.exit(2)
}
const signer = getAddress(active)

const toRaw = flag("--to") || signer
if (!isAddress(toRaw)) {
  console.error(`error: invalid --to address: ${toRaw}`)
  process.exit(2)
}
const to = getAddress(toRaw)
const valueEth = flag("--value") || "0"
const valueWei = parseEther(valueEth)

console.error(`tee-self-transfer — ${valueEth} ETH`)
console.error(`  signer (active mm wallet): ${signer}`)
console.error(`  to:                        ${to}${to === signer ? " (self)" : ""}`)
console.error(`  value:                     ${valueEth} ETH`)
console.error(`  rpc:                       ${rpc}`)
console.error("")

// ── pre-flight: balance covers value + gas, and the tx simulates ──
const client = makePublicClient(rpc)
const bal = await client.getBalance({ address: signer })
try {
  const gas = await client.estimateGas({ account: signer, to, value: valueWei })
  const gp = await client.getGasPrice()
  const cost = valueWei + gas * gp
  if (bal < cost) {
    console.error(`✗ pre-flight: balance ${formatEther(bal)} ETH < value + gas (~${formatEther(cost)} ETH).`)
    process.exit(1)
  }
  console.error(`✓ pre-flight: simulates; est gas ${gas}, ~${formatEther(gas * gp)} ETH fee, balance ${formatEther(bal)} ETH covers it.`)
} catch (err) {
  console.error("✗ pre-flight: tx reverted / gas estimation failed — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  process.exit(1)
}

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast via mm (TEE-signed).")
  console.log(JSON.stringify({ to, value: "0x0", data: "0x" }))
  process.exit(0)
}

if (!yes) {
  const answer = prompt(`About to send ${valueEth} ETH ${signer} → ${to} via mm (TEE). Type 'yes' to proceed:`)
  if (answer?.trim().toLowerCase() !== "yes") {
    console.error("aborted — nothing sent.")
    process.exit(0)
  }
}

// ── broadcast via mm: the TEE wallet signs (beast mode, no confirm) ──
const payload = JSON.stringify({ to, value: toHex(valueWei), data: "0x" })
console.error("")
console.error("broadcasting via mm wallet send-transaction (TEE-signed)…")
const out = await $`mm wallet send-transaction --chain-id 1 --payload ${payload} --intent ${"action-layer proof: 0-value self-transfer"} --wait --json`.text()

// mm wraps the result as { ok, data: { hash, explorerUrl, status, … } }. Parse it
// so callers (the brain's /action/execute) get a machine-readable tx line.
let txHash: string | undefined, explorerUrl: string | undefined, status: string | undefined
try {
  const parsed = JSON.parse(out)
  const d = (parsed?.data ?? parsed) as Record<string, string>
  txHash = d.hash
  explorerUrl = d.explorerUrl
  status = d.status
} catch { /* non-JSON output — handled below */ }
if (!txHash) {
  console.error("error: could not parse a tx hash from mm send-transaction output:")
  console.error(out.slice(0, 400))
  process.exit(1)
}

console.error("")
console.error(`Done. ${signer} executed a ${valueEth}-ETH self-transfer — tx ${txHash} (${status}).`)
console.log(JSON.stringify({ txHash, explorerUrl, status }))
