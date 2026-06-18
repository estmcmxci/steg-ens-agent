/**
 * Milestone 6 step 4/5 — rebind agent.steg.eth from the old BYOK wallet to the
 * new MetaMask TEE server wallet, operator-signed, in ONE resolver multicall.
 *
 * This re-points the FORWARD addr record + flips the auth.credential signer (so
 * /evaluate validates the server wallet's secp256k1 sigs) + adds the
 * "tee-attestation" trust model (truthful now that the TEE wallet is provisioned,
 * PLAN.md §3.4). It does NOT touch:
 *   - the ERC-8004 binding (that's on the operator-owned wrapped NFT, not addr —
 *     /card stays verified:true through the rebind, PLAN.md §3.1 step 4), or
 *   - the REVERSE record (0x0943….addr.reverse is owned by the server wallet, not
 *     the operator — set separately via `mm wallet send-transaction` → ReverseRegistrar).
 *
 * Calldata is built by the vendored ens-cli (`set batch` → one resolver multicall),
 * the proven wrapped-name path (scripts/set-agent-records.ts). Default is DRY-RUN:
 * build + eth_call-simulate from the operator so a revert surfaces BEFORE the Ledger.
 *
 * Usage:
 *   bun scripts/rebind-server-wallet.ts            # dry-run: build + simulate
 *   bun scripts/rebind-server-wallet.ts --send     # interactive confirm → Ledger
 *
 * Args / env:
 *   --send | --ledger   actually broadcast (Ledger-signed)
 *   --from <addr>       Ledger account / name controller (default OPERATOR_ADDRESS or 0x4767…96fF)
 *   --hd-path <p>       Ledger derivation path (env LEDGER_HD_PATH)
 *   --rpc <url>         RPC (default ETH_RPC_URL or eth.drpc.org)
 *   --new <addr>        new server-wallet address (default SERVER_WALLET below)
 */

import { $ } from "bun"
import { createPublicClient, http, isAddress, getAddress } from "viem"
import { mainnet } from "viem/chains"

const NAME = "agent.steg.eth"
const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const
const OLD_BYOK = "0x2B4C7Ac514CE4f6FbEf26e23F83536C8E5838979" as const
// New TEE server wallet, provisioned this session via `mm init --wallet server-wallet --mode beast`.
const SERVER_WALLET = "0x0943142f488fb694141841bf46e17be2bb5c7ee1" as const

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
const newAddrRaw = flag("--new") || SERVER_WALLET

if (!isAddress(operator)) {
  console.error(`error: invalid operator/--from address: ${operator}`)
  process.exit(2)
}
if (!isAddress(newAddrRaw)) {
  console.error(`error: invalid --new server-wallet address: ${newAddrRaw}`)
  process.exit(2)
}
const newAddr = getAddress(newAddrRaw) // checksum

// auth.credential[primary] — same shape as records/agent.steg.eth.primary.json,
// signer flipped from the old BYOK to the server wallet. Compact JSON (key order
// matters for a clean diff vs the on-chain value).
const credential = {
  credentialId: "primary",
  schemeId: "ecdsa-secp256k1",
  signer: newAddr,
  notBefore: 0,
  notAfter: 0,
}

const records = [
  { type: "address", address: newAddr },
  { type: "text", key: "auth.credential[primary]", value: JSON.stringify(credential) },
  { type: "text", key: "agent-trust-models", value: JSON.stringify(["feedback", "tee-attestation"]) },
]

console.error(`rebind-server-wallet — ${NAME}`)
console.error(`  addr:               ${OLD_BYOK}  →  ${newAddr}`)
console.error(`  auth.credential[primary].signer:  ${OLD_BYOK}  →  ${newAddr}`)
console.error(`  agent-trust-models: ["feedback"]  →  ["feedback","tee-attestation"]`)
console.error(`  operator:           ${operator}`)
console.error(`  rpc:                ${rpc}`)
console.error("")

// ── build calldata via ens-cli (one resolver multicall) ──
const out = await $`bun tools/ens-cli/src/index.ts set batch ${NAME} --chain mainnet --data ${JSON.stringify(records)}`.text()
const to = out.match(/"?to"?:\s*"?(0x[0-9a-fA-F]+)"?/)?.[1] as `0x${string}` | undefined
const data = out.match(/"?data"?:\s*"?(0x[0-9a-fA-F]+)"?/)?.[1] as `0x${string}` | undefined
if (!to || !data) {
  console.error("error: failed to build calldata via ens-cli. Output was:\n" + out)
  process.exit(1)
}

// ── pre-flight: simulate the multicall from the operator (eth_call) ──
const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
try {
  await client.call({ account: operator, to, data })
  console.error("✓ pre-flight: rebind multicall simulates cleanly from the operator.")
} catch (err) {
  console.error("✗ pre-flight: multicall reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  console.error("  (is the operator authorised on the wrapped name's resolver?)")
  process.exit(1)
}
console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (multicall of ${records.length} calls: setAddr + 2 setText)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to sign on your Ledger.")
  console.log(JSON.stringify({ to, data }))
  process.exit(0)
}

// ── interactive confirm → Ledger broadcast (project rule) ──
console.error("")
const answer = prompt(`About to rebind ${NAME} → ${newAddr} (3 records) from ${operator}. Type 'yes' to proceed:`)
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
console.error(`Done. ${NAME} now resolves to ${newAddr} and /evaluate validates its sigs.`)
console.error(`Next: fund ${newAddr} with gas, then set the reverse record:`)
console.error(`  bun scripts/set-reverse-server-wallet.ts`)
