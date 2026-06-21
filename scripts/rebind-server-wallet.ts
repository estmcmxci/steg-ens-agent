/**
 * Forward-bind a name to a TEE server wallet (PLAN.md §3.1 step 4 fwd / §3.3.1) —
 * set the FORWARD addr record + the auth.credential[primary] signer + the
 * agent-trust-models, in ONE resolver multicall, signed by the name's controller.
 *
 * Milestone 6 used this to re-point agent.steg.eth from the old BYOK wallet to the
 * TEE server wallet. Milestone 7 reuses it (parameterized) to point a fresh
 * demo.steg.eth at its fresh TEE server wallet. It does NOT touch:
 *   - the ERC-8004 binding (that's on the wrapped NFT, not addr — /card stays
 *     verified:true through the write), or
 *   - the REVERSE record (the server wallet sets its own reverse via `mm`).
 *
 * Calldata via the vendored ens-cli (`set batch` → one resolver multicall).
 * Default DRY-RUN: build + eth_call-simulate from the signer. Pass --send.
 *
 * Usage:
 *   bun scripts/rebind-server-wallet.ts                                # agent.steg.eth → 0x0943…
 *   bun scripts/rebind-server-wallet.ts --name demo.steg.eth --addr 0x… --hot-key
 *   bun scripts/rebind-server-wallet.ts --name demo.steg.eth --addr 0x… --hot-key --send
 *
 * Args / env:
 *   name | --name <s>   ENS name                 (default: agent.steg.eth)
 *   --addr | --new <a>  TEE server-wallet address (default: resolved from the agent)
 *   --send | --ledger / --hot-key / --from / --hd-path / --rpc   as in the other scripts
 */

import { isAddress, getAddress } from "viem"
import {
  parseCommon,
  makePublicClient,
  buildEnsBatch,
  preflightSimulate,
  confirmAndSend,
} from "./lib/agent-config"

const { flag, send, useHotKey, yes, hdPath, rpc, name, operator, agent } = parseCommon({ defaultName: "agent.steg.eth" })

const newAddrRaw = flag("--addr") || flag("--new") || agent.serverWallet
if (!newAddrRaw || !isAddress(newAddrRaw)) {
  console.error(`error: invalid/missing server-wallet address: ${newAddrRaw}`)
  console.error("  Pass --addr 0x… (the TEE server wallet for this name).")
  process.exit(2)
}
const newAddr = getAddress(newAddrRaw)

// auth.credential[primary] — same shape as records/agent.steg.eth.primary.json,
// signer set to the server wallet. Compact JSON (key order matters for a clean
// diff vs the on-chain value).
const credential = {
  credentialId: "primary",
  schemeId: "ecdsa-secp256k1",
  signer: newAddr,
  notBefore: 0,
  notAfter: 0,
}

// auth.capability[primary] — the agent's Tier-2 policy. Without it checkPolicy()
// sees `policy === null` → POLICY_DENIED (ACTION_NOT_ALLOWED) and the /evaluate
// gate can't authorize the new agent for anything (G2). Defaults match the live
// agent.steg.eth placeholder + the gate's canonical probe (demo-request.ts:
// erc20.transfer, token 0x1111…, amount 1000) so a freshly provisioned agent
// evaluates to OK before any revocation. Per the gate's scope note the demo keys
// on authority/revocation, not per-tx params — a tighter capability is the parked
// follow-up (needs an operator Ledger write).
const capToken = (flag("--capability-token") || "0x1111111111111111111111111111111111111111") as `0x${string}`
const maxAmount = flag("--max-amount") || "1000000"
const capability = {
  credentialId: "primary",
  actionType: "erc20.transfer",
  token: capToken,
  maxAmount,
  allowedRecipient: "*",
}

// auth.revocation[primary] — the "not revoked" sentinel. Pre-seeding it means the
// operator's first revoke is a value UPDATE, not a key CREATION (avoids the CCIP
// gateway's negative-cache lag on new keys; see src/ensRecordSource.ts). The
// verifier maps {"revoked":false} → null (not revoked), so this is gate-neutral
// at rest and flips to deny when the operator sets {"revoked":true}.
const revocation = { revoked: false }

const records = [
  { type: "address", address: newAddr },
  { type: "text", key: "auth.credential[primary]", value: JSON.stringify(credential) },
  { type: "text", key: "auth.capability[primary]", value: JSON.stringify(capability) },
  { type: "text", key: "auth.revocation[primary]", value: JSON.stringify(revocation) },
  { type: "text", key: "agent-trust-models", value: JSON.stringify(["feedback", "tee-attestation"]) },
] as const

console.error(`rebind-server-wallet — ${name}`)
console.error(`  addr:               → ${newAddr}`)
console.error(`  auth.credential[primary].signer:  → ${newAddr}`)
console.error(`  auth.capability[primary]:         erc20.transfer token=${capToken} maxAmount=${maxAmount} recipient=*`)
console.error(`  auth.revocation[primary]:         {"revoked":false} (not-revoked sentinel)`)
console.error(`  agent-trust-models: ["feedback","tee-attestation"]`)
console.error(`  signer:             ${operator}${useHotKey ? " (hot key)" : ""}`)
console.error(`  rpc:                ${rpc}`)
console.error("")

const { to, data } = await buildEnsBatch(name, records as any)
const client = makePublicClient(rpc)
await preflightSimulate(
  client,
  { account: operator, to, data },
  "rebind multicall simulates cleanly from the signer.",
  "(is the signer authorised on the wrapped name's resolver?)",
)

console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (multicall of ${records.length} calls: setAddr + 4 setText)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to broadcast.")
  console.log(JSON.stringify({ to, data }))
  process.exit(0)
}

await confirmAndSend({
  to,
  data,
  rpc,
  operator,
  useHotKey,
  hdPath,
  assumeYes: yes,
  promptMsg: `About to forward-bind ${name} → ${newAddr} (3 records) from ${operator}.`,
})

console.error("")
console.error(`Done. ${name} now resolves to ${newAddr} and /evaluate validates its sigs.`)
console.error(`Next: fund ${newAddr} with gas, then set the reverse record (server wallet self-signs via mm).`)
