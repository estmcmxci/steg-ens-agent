/**
 * Build setText/setAddr resolver calldata for an ENS name (PLAN.md §0 — NLI
 * record editing). Pure builder: prints `{ to, data }` JSON to stdout and signs
 * NOTHING. The caller (the brain's ens_set_records_execute tool) broadcasts it via
 * `mm wallet send-transaction` from the AGENT's TEE wallet — which works because,
 * in the self-sovereign provisioning flow, the agent OWNS its own name.
 *
 * In-process viem encoding (buildEnsBatch) — no subprocess, no auth, no worker.
 *
 * Usage:
 *   bun scripts/build-settext.ts --name alice.steg.eth --records '{"description":"hi","url":"https://x"}'
 *   bun scripts/build-settext.ts --name alice.steg.eth --records '{"avatar":"https://…/avatar/alice.steg.eth.png"}'
 *
 * Args:
 *   --name <s>       ENS name (REQUIRED)
 *   --records <json> JSON object of text records { key: value, … } (REQUIRED)
 *   --addr <0x…>     optional: also set the forward addr record
 */

import { makeFlag, buildEnsBatch } from "./lib/agent-config"

const flag = makeFlag(process.argv.slice(2))
const name = flag("--name")
const recordsRaw = flag("--records")

if (!name || !name.includes(".")) {
  console.error("error: pass --name <ens-name>")
  process.exit(2)
}

const records: Array<{ type: "text"; key: string; value: string } | { type: "address"; address: `0x${string}` }> = []

if (recordsRaw) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(recordsRaw)
  } catch {
    console.error("error: --records must be a JSON object, e.g. '{\"description\":\"hi\"}'")
    process.exit(2)
  }
  for (const [key, value] of Object.entries(parsed)) {
    records.push({ type: "text", key, value: String(value) })
  }
}

const addr = flag("--addr")
if (addr) records.push({ type: "address", address: addr as `0x${string}` })

if (records.length === 0) {
  console.error("error: nothing to set — pass --records '{…}' and/or --addr 0x…")
  process.exit(2)
}

const { to, data } = buildEnsBatch(name, records as any)
// Machine-readable line for the caller to parse.
console.log(JSON.stringify({ to, data, count: records.length }))
