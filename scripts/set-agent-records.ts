/**
 * Operator record path (PLAN.md §3 step 5c) — set the agent's ENSIP-26 / card
 * records on agent.steg.eth, hardware-signed.
 *
 * Writes the descriptive records that GET /card renders + the `agent-id` record
 * that flips /card's erc8004 block to verified (it reads agent-id, then confirms
 * via adapter8004.bindingOf). agent-endpoint[web] + setAgentURI are DEFERRED
 * until the worker/cockpit have a stable HTTPS URL — they're a separate script.
 *
 * Calldata is built by the vendored ens-cli (`set batch` → one resolver multicall),
 * the same proven path as scripts/publish-records.ts, so the wrapped-name resolver
 * is handled correctly. Default is DRY-RUN: build + simulate via eth_call from the
 * operator so a revert surfaces BEFORE the Ledger. Pass --send to sign + broadcast.
 *
 * Usage:
 *   bun scripts/set-agent-records.ts            # dry-run: build + simulate
 *   bun scripts/set-agent-records.ts --send     # interactive confirm → Ledger
 *
 * Args / env:
 *   --send | --ledger   actually broadcast (Ledger-signed)
 *   --from <addr>       Ledger account / name controller (default OPERATOR_ADDRESS or 0x4767…96fF)
 *   --hd-path <p>       Ledger derivation path (env LEDGER_HD_PATH)
 *   --rpc <url>         RPC (default ETH_RPC_URL or eth.drpc.org)
 */

import { $ } from "bun"
import { createPublicClient, http, isAddress } from "viem"
import { mainnet } from "viem/chains"

const NAME = "agent.steg.eth"
const AGENT_ID = "34860" // minted by the bind (tx 0x09d0356b…, records/agent.steg.eth.erc8004.json)
const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const

const DESCRIPTION =
  "ENS-native agent wallet. Operates a MetaMask wallet under verifiable, operator-revocable ENS authority: balances and transfers, token swaps and cross-chain bridges, perps and prediction markets, and ENS identity management."

// A2A skills (chosen in the 2026-06-18 card Q&A) — JSON-encoded into one text record.
const SKILLS = [
  { id: "wallet", name: "Wallet, balances & transfers", description: "Read native + token balances across chains with USD values, and send transfers.", tags: ["wallet", "balances", "transfers"] },
  { id: "swaps", name: "Swaps & cross-chain bridges", description: "Same-chain swaps and cross-chain bridge quotes and execution.", tags: ["swap", "bridge", "defi"] },
  { id: "markets", name: "Perps & prediction markets", description: "Hyperliquid perpetual futures and Polymarket prediction markets.", tags: ["perps", "prediction-markets", "trading"] },
  { id: "ens", name: "ENS identity management", description: "Resolve and register ENS names, edit records, and manage the agent's own ENS identity.", tags: ["ens", "identity", "naming"] },
]

const records = [
  { type: "text", key: "agent-id", value: AGENT_ID },
  { type: "text", key: "display", value: NAME },
  { type: "text", key: "description", value: DESCRIPTION },
  { type: "text", key: "agent-skills", value: JSON.stringify(SKILLS) },
  { type: "text", key: "agent-trust-models", value: JSON.stringify(["feedback"]) },
]

// ── parse args ──
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i !== -1 ? argv[i + 1] : undefined
}
const send = argv.includes("--send") || argv.includes("--ledger")
const operator = (flag("--from") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR) as `0x${string}`
const hdPath = flag("--hd-path") || process.env.LEDGER_HD_PATH
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || "https://eth.drpc.org"

if (!isAddress(operator)) {
  console.error(`error: invalid operator/--from address: ${operator}`)
  process.exit(2)
}

console.error(`set-agent-records — ${NAME}`)
for (const r of records) {
  const v = r.value.length > 80 ? r.value.slice(0, 77) + "…" : r.value
  console.error(`  ${r.key} = ${v}`)
}
console.error(`  operator:  ${operator}`)
console.error(`  rpc:       ${rpc}`)
console.error("")

// ── build calldata via ens-cli (one resolver multicall) ──
const out = await $`bun tools/ens-cli/src/index.ts set batch ${NAME} --chain mainnet --data ${JSON.stringify(records)}`.text()
const to = out.match(/^to:\s*(\S+)/m)?.[1] as `0x${string}` | undefined
const data = out.match(/^data:\s*(\S+)/m)?.[1] as `0x${string}` | undefined
if (!to || !data) {
  console.error("error: failed to build calldata via ens-cli. Output was:\n" + out)
  process.exit(1)
}

// ── pre-flight: simulate the multicall from the operator (eth_call) ──
const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
try {
  await client.call({ account: operator, to, data })
  console.error("✓ pre-flight: setText multicall simulates cleanly from the operator.")
} catch (err) {
  console.error("✗ pre-flight: multicall reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  console.error("  (is the operator authorised on the wrapped name's resolver?)")
  process.exit(1)
}
console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (multicall of ${records.length} setText calls)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to sign on your Ledger.")
  console.log(JSON.stringify({ to, data }))
  process.exit(0)
}

// ── interactive confirm → Ledger broadcast (project rule) ──
console.error("")
const answer = prompt(`About to set ${records.length} records on ${NAME} from ${operator}. Type 'yes' to proceed:`)
if (answer?.trim().toLowerCase() !== "yes") {
  console.error("aborted — nothing sent.")
  process.exit(0)
}

const castArgs: string[] = [to, data, "--rpc-url", rpc, "--ledger", "--from", operator]
if (hdPath) castArgs.push("--hd-path", hdPath)
console.error("")
console.error("(confirm the transaction on your Ledger)")
await $`cast send ${castArgs}`
console.error("")
console.error(`Done. /card/${NAME} now reads agent-id=${AGENT_ID} → erc8004 verified. Next:`)
console.error(`deploy the worker, then set agent-endpoint[web] + setAgentURI(${AGENT_ID}, <card URL>).`)
