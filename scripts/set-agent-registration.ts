/**
 * Operator ENSIP-25 claim path (PLAN.md §3 step 5e) — write the agent-registration
 * text record that attests agent.steg.eth ↔ ERC-8004 agent id, hardware-signed.
 *
 * ENSIP-25 (docs.ens.domains/ensip/25) is signature-FREE: the attestation IS the
 * record's presence, because only the name's controller can set it. Key:
 *   agent-registration[<registry>][<agentId>]   value: "1"
 * where <registry> is the ERC-7930 interoperable address of the ERC-8004 Identity
 * Registry (NOT the CAIP-10 form). We compute the ERC-7930 encoding in-script.
 *
 * Calldata is built by the vendored ens-cli (one resolver setText), the same path
 * as set-agent-records.ts. Default DRY-RUN: build + simulate via eth_call from the
 * operator. Pass --send to sign + broadcast.
 *
 * Usage:
 *   bun scripts/set-agent-registration.ts            # dry-run: build + simulate
 *   bun scripts/set-agent-registration.ts --send     # interactive confirm → Ledger
 */

import { $ } from "bun"
import { createPublicClient, http, isAddress } from "viem"
import { mainnet } from "viem/chains"

const NAME = "agent.steg.eth"
const AGENT_ID = "34860"
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
const CHAIN_ID = 1
const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const

/**
 * ERC-7930 interoperable address for an EVM (eip155) chain + address.
 * Layout: Version(2) ChainType(2) ChainRefLen(1) ChainRef(var) AddrLen(1) Address(var).
 * Verified against the spec's worked example for vitalik.eth on mainnet:
 *   erc7930Evm(1, 0xd8dA…6045) === 0x00010000010114d8da6bf26964af9d7eed9e03e53415d37aa96045
 */
function erc7930Evm(chainId: number, address: string): string {
  let ref = chainId.toString(16)
  if (ref.length % 2) ref = "0" + ref
  const refLen = (ref.length / 2).toString(16).padStart(2, "0")
  const addr = address.toLowerCase().replace(/^0x/, "")
  const addrLen = (addr.length / 2).toString(16).padStart(2, "0")
  return "0x0001" + "0000" + refLen + ref + addrLen + addr
}

const registry7930 = erc7930Evm(CHAIN_ID, IDENTITY_REGISTRY)
const key = `agent-registration[${registry7930}][${AGENT_ID}]`
const records = [{ type: "text", key, value: "1" }]

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

console.error(`set-agent-registration (ENSIP-25) — ${NAME}`)
console.error(`  registry (ERC-7930): ${registry7930}`)
console.error(`  key:   ${key}`)
console.error(`  value: "1"`)
console.error(`  operator: ${operator}`)
console.error(`  rpc:      ${rpc}`)
console.error("")

const out = await $`bun tools/ens-cli/src/index.ts set batch ${NAME} --chain mainnet --data ${JSON.stringify(records)}`.text()
const to = out.match(/^to:\s*(\S+)/m)?.[1] as `0x${string}` | undefined
const data = out.match(/^data:\s*(\S+)/m)?.[1] as `0x${string}` | undefined
if (!to || !data) {
  console.error("error: failed to build calldata via ens-cli. Output was:\n" + out)
  process.exit(1)
}

const client = createPublicClient({ chain: mainnet, transport: http(rpc) })
try {
  await client.call({ account: operator, to, data })
  console.error("✓ pre-flight: setText simulates cleanly from the operator.")
} catch (err) {
  console.error("✗ pre-flight: setText reverted in simulation — NOT safe to send.")
  console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
  process.exit(1)
}
console.error("")
console.error(`to:   ${to} (resolver)`)
console.error(`data: ${data.length} chars (setText of the ENSIP-25 claim)`)

if (!send) {
  console.error("")
  console.error("dry-run: not sending. Re-run with --send to sign on your Ledger.")
  console.log(JSON.stringify({ to, data, key }))
  process.exit(0)
}

console.error("")
const answer = prompt(`About to write the ENSIP-25 claim on ${NAME} from ${operator}. Type 'yes' to proceed:`)
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
console.error(`Done. ENSIP-25 claim set: a verifier resolving ${key} on ${NAME} now reads "1".`)
