/**
 * approve-mints — the operator's co-sign loop for Option C provisioning.
 *
 * A user who picks <label>.steg.eth can't mint it: only the operator's Ledger owns the
 * wrapped parent (NameWrapper.setSubnodeRecord needs the parent owner). The frontend
 * records each request in the brain's queue (POST /provision/request). This CLI drains
 * that queue: it fetches GET /provision/pending, and for each request runs the existing
 * `mint-subname.ts` Ledger path, then marks it fulfilled (POST /provision/fulfill).
 *
 * The operator runs this from their local checkout with the Ledger plugged in. Nothing
 * the Ledger touches goes near the cloud — the mint is signed + broadcast here; the
 * deployed brain only observes the on-chain result (useMintWatch → headless /provision).
 *
 * Idempotent: before minting it checks NameWrapper.ownerOf on-chain. An already-minted
 * name is marked fulfilled and skipped (no double-mint), so re-runs are safe.
 *
 * Usage:
 *   bun scripts/approve-mints.ts                                  # drain local brain (127.0.0.1:8000)
 *   bun scripts/approve-mints.ts --remote https://brain.example   # drain a deployed brain
 *   bun scripts/approve-mints.ts --dry-run                        # list pending, mint nothing
 *   bun scripts/approve-mints.ts --yes                            # skip the text confirm (Ledger still confirms)
 *   bun scripts/approve-mints.ts --watch 15                       # keep polling every 15s
 *
 * Flags / env:
 *   --remote <url>   brain base URL          (default env BRAIN_URL or http://127.0.0.1:8000)
 *   --token <t>      operator bearer token   (default env OPERATOR_TOKEN) — for component-4 auth
 *   --dry-run        list only; don't mint or fulfill
 *   --yes            skip the per-request text prompt (the Ledger is still the final confirm)
 *   --watch <secs>   poll the queue every <secs> seconds instead of a single pass
 *   --hd-path <p>    Ledger HD path, passed through to mint-subname.ts (or env LEDGER_HD_PATH)
 *   --rpc <url>      RPC, passed through + used for the on-chain ownerOf pre-check
 */

import { namehash } from "viem"
import { NAME_WRAPPER, DEFAULT_RPC, makePublicClient, makeFlag } from "./lib/agent-config"

const ZERO = "0x0000000000000000000000000000000000000000"

const OWNER_OF_ABI = [
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const

type PendingRequest = {
  id: string
  name: string
  label: string
  email: string | null
  status: string
  created_at: number
  fulfilled_at: number | null
}

const argv = process.argv.slice(2)
const flag = makeFlag(argv)
const remote = (flag("--remote") || process.env.BRAIN_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
const token = flag("--token") || process.env.OPERATOR_TOKEN
const dryRun = argv.includes("--dry-run")
const assumeYes = argv.includes("--yes") || argv.includes("-y")
const watchRaw = flag("--watch")
const watchSecs = watchRaw ? Number(watchRaw) : 0
const hdPath = flag("--hd-path") || process.env.LEDGER_HD_PATH
const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC

const authHeaders: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
const client = makePublicClient(rpc)

function ago(epochSecs: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSecs))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** On-chain owner of a wrapped name, or null if unminted. */
async function ownerOf(name: string): Promise<string | null> {
  try {
    const owner = (await client.readContract({
      address: NAME_WRAPPER, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [BigInt(namehash(name))],
    })) as string
    return owner && owner !== ZERO ? owner : null
  } catch {
    return null // reverts/zero on a non-existent name → unminted
  }
}

async function fetchPending(): Promise<PendingRequest[]> {
  const res = await fetch(`${remote}/provision/pending`, { headers: authHeaders })
  if (!res.ok) {
    throw new Error(`GET /provision/pending → ${res.status} ${res.statusText}`)
  }
  const body = (await res.json()) as { count: number; pending: PendingRequest[] }
  return body.pending ?? []
}

async function markFulfilled(req: PendingRequest, reason: string): Promise<void> {
  const res = await fetch(`${remote}/provision/fulfill`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({ id: req.id }),
  })
  if (!res.ok) {
    console.error(`  ⚠ could not mark fulfilled (${res.status}); the queue will keep showing it.`)
    return
  }
  console.error(`  ✓ marked fulfilled (${reason}).`)
}

/** Run mint-subname.ts on the operator Ledger for one name. Returns true on success. */
async function mintViaLedger(name: string): Promise<boolean> {
  const args = ["scripts/mint-subname.ts", "--name", name, "--send", "--yes"]
  if (hdPath) args.push("--hd-path", hdPath)
  if (rpc) args.push("--rpc", rpc)
  console.error(`  → bun ${args.join(" ")}`)
  console.error("  (confirm the mint on your Ledger when prompted)")
  // Inherit stdio so the operator sees the script's pre-flights + the Ledger prompt.
  const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit", stdin: "inherit" })
  const code = await proc.exited
  return code === 0
}

async function processOne(req: PendingRequest, index: number, total: number): Promise<void> {
  console.error("")
  console.error(`[${index + 1}/${total}] ${req.name}`)
  console.error(`  label: ${req.label}   email: ${req.email ?? "—"}   requested: ${ago(req.created_at)}   id: ${req.id}`)

  // Idempotency: if it's already on-chain, just clear it from the queue.
  const existing = await ownerOf(req.name)
  if (existing) {
    console.error(`  already minted on-chain (owner ${existing}) — no mint needed.`)
    if (!dryRun) await markFulfilled(req, "already on-chain")
    return
  }

  if (dryRun) {
    console.error("  dry-run: not minting.")
    return
  }

  if (!assumeYes) {
    const answer = prompt(`  Mint ${req.name} on the Ledger? [y/N/q to quit]:`)?.trim().toLowerCase()
    if (answer === "q" || answer === "quit") {
      console.error("  quitting — remaining requests left pending.")
      process.exit(0)
    }
    if (answer !== "y" && answer !== "yes") {
      console.error("  skipped — left pending.")
      return
    }
  }

  const ok = await mintViaLedger(req.name)
  if (!ok) {
    console.error("  ✗ mint did not complete — leaving this request pending (re-run to retry).")
    return
  }
  await markFulfilled(req, "minted")
}

async function drainOnce(): Promise<number> {
  const pending = await fetchPending()
  if (pending.length === 0) {
    console.error("no pending mint requests.")
    return 0
  }
  console.error(`${pending.length} pending mint request${pending.length === 1 ? "" : "s"} from ${remote}:`)
  for (const [i, req] of pending.entries()) {
    await processOne(req, i, pending.length)
  }
  return pending.length
}

console.error(`approve-mints — operator co-sign loop`)
console.error(`  brain:  ${remote}${token ? "  (bearer token set)" : ""}`)
console.error(`  rpc:    ${rpc}`)
console.error(`  mode:   ${dryRun ? "dry-run" : assumeYes ? "auto-confirm (Ledger still confirms)" : "interactive"}${watchSecs ? `, watch every ${watchSecs}s` : ""}`)

if (watchSecs > 0) {
  // Poll loop: drain, sleep, repeat. Ctrl-C to stop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await drainOnce()
    } catch (err) {
      console.error(`error: ${(err as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, watchSecs * 1000))
  }
} else {
  try {
    await drainOnce()
  } catch (err) {
    console.error(`error: ${(err as Error).message}`)
    process.exit(1)
  }
}
