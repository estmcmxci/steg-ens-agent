/**
 * Phase 4 pre-flight checklist (PLAN.md §3.3.1 Phase 4) — READ-ONLY. Verifies every
 * precondition for the milestone-7 live run BEFORE any gas is spent or the operator
 * touches the Ledger. Broadcasts NOTHING; runs the mint only as an eth_call dry-run.
 *
 * Run this immediately before Phase 4. A clean GO means: the hot key is a fundable
 * clean EOA, the operator can mint the subname, the name is an unused clean slate,
 * the mint simulates, the mm session is a live server-wallet account, and the card
 * backend is up. It also prints the gas budget (incl. the server-wallet reverse) and
 * the exact run order.
 *
 * Usage:
 *   OPERATOR_HOT_KEY=0x… bun scripts/preflight-demo.ts                  # default demo.steg.eth
 *   OPERATOR_HOT_KEY=0x… bun scripts/preflight-demo.ts --name foo.steg.eth --min-gas 0.02
 *
 * Args / env:
 *   --name <s>      child name to provision   (default: demo.steg.eth)
 *   --operator <a>  operator / parent owner    (default: OPERATOR_ADDRESS or 0x4767…96fF)
 *   --min-gas <eth> hot-key balance floor      (default: 0.02)
 *   --rpc <url>     RPC                         (env ETH_RPC_URL or eth.drpc.org)
 */

import { $ } from "bun"
import { namehash, isAddress, getAddress, formatEther } from "viem"
import {
  NAME_WRAPPER,
  DEFAULT_OPERATOR,
  DEFAULT_RPC,
  makeFlag,
  makePublicClient,
  hotKeyAccount,
} from "./lib/agent-config"

const OWNER_OF_ABI = [
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const
const BALANCE_OF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const

const CARD_BASE = process.env.CARD_WORKER_BASE || "https://steg-agent-card.estmcmxci.workers.dev"

const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const name = flag("--name") || "demo.steg.eth"
const minGas = parseFloat(flag("--min-gas") || "0.02")
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC
const operatorRaw = flag("--operator") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR
if (!name.includes(".")) {
  console.error("error: --name must be a full subname, e.g. demo.steg.eth")
  process.exit(2)
}
if (!isAddress(operatorRaw)) {
  console.error(`error: invalid operator address: ${operatorRaw}`)
  process.exit(2)
}
const operator = getAddress(operatorRaw)
const parent = name.slice(name.indexOf(".") + 1)
const childNode = namehash(name)
const parentNode = namehash(parent)
const client = makePublicClient(rpc)

// ── check harness ──
let pass = 0
let fail = 0
let warn = 0
function ok(label: string, detail = "") {
  pass++
  console.error(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`)
}
function bad(label: string, detail = "") {
  fail++
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
}
function caution(label: string, detail = "") {
  warn++
  console.error(`  ⚠ ${label}${detail ? ` — ${detail}` : ""}`)
}

console.error(`Phase 4 pre-flight — provisioning ${name} (parent ${parent})`)
console.error(`  operator: ${operator}`)
console.error(`  rpc:      ${rpc}`)
console.error("")

// 1. hot key present + derive address
let hotKey: `0x${string}` | null = null
if (!process.env.OPERATOR_HOT_KEY?.trim()) {
  bad("OPERATOR_HOT_KEY set", "absent — the brain + scripts sign operator steps with it")
} else {
  hotKey = getAddress(hotKeyAccount().address)
  ok("OPERATOR_HOT_KEY set", `hot key ${hotKey}`)
}

// 2. hot key is a clean EOA (option B mint requirement: no code / no 7702 delegation)
if (hotKey) {
  const code = await client.getCode({ address: hotKey })
  if (code && code !== "0x") {
    bad("hot key is a clean EOA", `has code ${code.slice(0, 12)}… → ERC-1155 mint would revert; use a fresh EOA`)
  } else {
    ok("hot key is a clean EOA", "no code")
  }
}

// 3. hot key gas: 6 hot-key txs (records, bind, identity, agent_uri, ensip25, transfer)
//    + funding the fresh server wallet's reverse tx. min-gas covers all of it.
if (hotKey) {
  const bal = await client.getBalance({ address: hotKey })
  const eth = Number(formatEther(bal))
  if (eth >= minGas) {
    ok("hot key funded", `${eth.toFixed(4)} ETH ≥ ${minGas} floor`)
  } else {
    bad("hot key funded", `${eth.toFixed(4)} ETH < ${minGas} floor — fund ${hotKey}`)
  }
}

// 4. operator owns the wrapped parent (mint authority)
const parentBal = (await client.readContract({
  address: NAME_WRAPPER, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [operator, BigInt(parentNode)],
})) as bigint
if (parentBal > 0n) {
  ok(`operator owns wrapped ${parent}`, `balanceOf=${parentBal}`)
} else {
  bad(`operator owns wrapped ${parent}`, "balanceOf=0 — cannot mint the subname")
}

// 5. child is unminted (clean slate)
let childOwner = "0x0000000000000000000000000000000000000000"
try {
  childOwner = (await client.readContract({
    address: NAME_WRAPPER, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [BigInt(childNode)],
  })) as string
} catch { /* unminted → ownerOf reverts/zero */ }
if (!childOwner || childOwner === "0x0000000000000000000000000000000000000000") {
  ok(`${name} is unminted`, "clean slate")
} else {
  bad(`${name} is unminted`, `already owned by ${childOwner}`)
}

// 6. mint-subname dry-run (reuses the script's child-unminted + clean-EOA + simulate checks)
if (hotKey) {
  const res = await $`bun scripts/mint-subname.ts --name ${name} --rpc ${rpc}`.nothrow().quiet()
  if (res.exitCode === 0) {
    ok("mint-subname simulates", "setSubnodeRecord clean from the operator")
  } else {
    const tail = res.stderr.toString().trim().split("\n").filter(Boolean).pop() || `exit ${res.exitCode}`
    bad("mint-subname simulates", tail)
  }
}

// 7. mm session: logged in + server-wallet mode (email login)
try {
  const showRaw = await $`mm wallet show --json`.nothrow().quiet().text()
  const show = JSON.parse(showRaw)
  const mode = show?.data?.mode
  if (show?.ok && mode === "server") {
    ok("mm session ready", `active wallet ${show.data.address} (mode ${mode}, ${show.data.tradingMode || "?"})`)
  } else if (show?.ok) {
    caution("mm session ready", `mode is '${mode}', expected 'server' (email login). wallet create may differ`)
  } else {
    bad("mm session ready", "mm wallet show not ok — log in as steglabs (mm login email)")
  }
} catch {
  bad("mm session ready", "could not run/parse `mm wallet show` — is mm logged in?")
}

// 8. card backend up (the new agent's URI will point at CARD_BASE/card/<name>)
try {
  const r = await fetch(`${CARD_BASE}/card/agent.steg.eth`, { signal: AbortSignal.timeout(8000) })
  if (r.ok) {
    ok("card worker up", `${CARD_BASE} → ${r.status}`)
  } else {
    caution("card worker up", `${CARD_BASE} → ${r.status}`)
  }
} catch {
  caution("card worker up", `could not reach ${CARD_BASE} — /card link won't resolve until it's up`)
}

// ── gas-budget note (server-wallet reverse) ──
console.error("")
console.error("Gas budget:")
console.error("  • operator (Ledger) pays: 1 tx — the subname mint.")
console.error("  • hot key pays: 6 txs — records, bind, identity, agent_uri, ensip25, transfer.")
console.error(`  • the FRESH demo server wallet pays: 1 tx — reverse setName. It is created`)
console.error(`    mid-flow with ZERO balance, so it MUST be funded before the reverse step.`)
caution("server-wallet reverse gas", "fund the new server wallet (or wire a hot-key→wallet funding step into /provision) — else the reverse step fails")

// ── verdict + run order ──
console.error("")
const go = fail === 0
console.error(`VERDICT: ${go ? "GO" : "NO-GO"}  (${pass} pass, ${warn} warn, ${fail} fail)`)
console.error("")
if (go) {
  console.error("Phase 4 run order:")
  console.error(`  1. bun scripts/mint-subname.ts --name ${name} --send        # operator Ledger (1 sig)`)
  console.error(`  2. (ensure the brain has OPERATOR_HOT_KEY + the new server wallet will be funded)`)
  console.error(`  3. run the wizard → POST /provision streams the rest (0 Ledger)`)
  console.error(`  4. verify: ${name} resolves fwd+rev · ${CARD_BASE}/card/${name} verified:true ·`)
  console.error(`     NameWrapper.ownerOf == operator · record receipts in records/${name}.*.json`)
} else {
  console.error("Resolve the ✗ items above, then re-run this checklist. No gas spent.")
}
process.exit(go ? 0 : 1)
