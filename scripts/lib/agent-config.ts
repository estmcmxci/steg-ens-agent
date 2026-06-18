/**
 * Shared config + signing helpers for the operator write scripts (PLAN.md §3.3.1
 * Phase 1). Centralizes the mainnet addresses, the per-agent config (so scripts
 * stop hardcoding `agent.steg.eth` / `34860`), the ens-cli batch builder, the
 * eth_call pre-flight, and the one signing tail that every script shares.
 *
 * Signing path (PLAN.md §3.3, option B):
 *   - default            → Ledger via `cast send --ledger` (operator hardware key).
 *   - --hot-key          → viem private-key account from env OPERATOR_HOT_KEY
 *                          (the milestone-7 demo's hot key — it OWNS demo.steg.eth
 *                          during provisioning, so it passes the adapter's ERC-1155
 *                          balanceOf control with no delegation). NEVER passed as a
 *                          flag; read from env only (burned-secrets caveat).
 *
 * Every write stays DRY-RUN by default: scripts build calldata + eth_call-simulate
 * from the signer, and only `--send` (alias `--ledger`) broadcasts.
 */

import { $ } from "bun"
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  getAddress,
  type Hex,
  type PublicClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet } from "viem/chains"

// ── mainnet addresses (PLAN.md §3 / §3.3.1) ──
export const ADAPTER = "0xde152AfB7db5373F34876E1499fbD893A82dD336" as const // adapter8004 proxy
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const // ERC-8004 registry
export const NAME_WRAPPER = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401" as const
export const PUBLIC_RESOLVER = "0xF29100983E058B709F3D539b0c765937B804AC15" as const // from agent.steg.eth
export const REVERSE_REGISTRAR = "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb" as const
export const DEFAULT_OPERATOR = "0x4767b1902865940f020c3e3bA3C0E117941f96fF" as const // wrapped-name holder
export const STANDARD_ERC1155 = 1 // TokenStandard enum: ERC721=0, ERC1155=1, … (wrapped ENS = ERC-1155)
export const CHAIN_ID = 1
export const DEFAULT_RPC = "https://eth.drpc.org"

// ── per-agent config (so scripts stop hardcoding the live agent) ──
export type AgentConfig = {
  name: string
  agentId?: string
  serverWallet?: `0x${string}`
}

const KNOWN_AGENTS: Record<string, Omit<AgentConfig, "name">> = {
  // The live milestone-6 agent. demo.steg.eth (milestone 7) has no entry — its
  // agentId is minted at bind time and threaded in via --agent-id.
  "agent.steg.eth": {
    agentId: "34860",
    serverWallet: "0x0943142F488fb694141841bF46e17Be2bB5C7EE1",
  },
}

export function resolveAgent(name: string): AgentConfig {
  return { name, ...(KNOWN_AGENTS[name] ?? {}) }
}

// ── arg parsing ──
/** `--flag value` reader over an argv slice. */
export function makeFlag(argv: string[]) {
  return (n: string): string | undefined => {
    const i = argv.indexOf(n)
    return i !== -1 ? argv[i + 1] : undefined
  }
}

// Flags that consume a following value — used to find the bare positional `name`.
const VALUE_FLAGS = new Set([
  "--name", "--addr", "--agent-id", "--agent-uri", "--uri", "--from",
  "--hd-path", "--rpc", "--new", "--label", "--parent", "--owner",
  "--to", "--resolver", "--ttl", "--fuses", "--expiry",
])

/** First non-flag positional (the ENS name), skipping `--flag value` pairs. */
export function positionalName(argv: string[], flag: (n: string) => string | undefined): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) i++ // skip this flag's value
      continue
    }
    return a
  }
  return undefined
}

/** Load the demo hot key from env (never a flag). Exits if absent. */
export function hotKeyAccount() {
  const raw = process.env.OPERATOR_HOT_KEY?.trim()
  if (!raw) {
    console.error("error: --hot-key set but OPERATOR_HOT_KEY env is empty/missing.")
    console.error("  Set OPERATOR_HOT_KEY in your shell (off any transcript) and retry.")
    process.exit(2)
  }
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex
  return privateKeyToAccount(pk)
}

export type CommonArgs = {
  argv: string[]
  flag: (n: string) => string | undefined
  send: boolean
  useHotKey: boolean
  /** Skip the interactive confirm prompt (for automation, e.g. /provision). */
  yes: boolean
  hdPath?: string
  rpc: string
  name: string
  /** The signer / `from` address: hot-key address when --hot-key, else Ledger operator. */
  operator: `0x${string}`
  agent: AgentConfig
}

/**
 * Parse the flags every operator script shares. `defaultName` keeps the existing
 * scripts' behavior (agent.steg.eth) when neither --name nor a positional is given.
 */
export function parseCommon(opts: { defaultName: string }): CommonArgs {
  const argv = process.argv.slice(2)
  const flag = makeFlag(argv)
  const send = argv.includes("--send") || argv.includes("--ledger")
  const useHotKey = argv.includes("--hot-key")
  const yes = argv.includes("--yes") || argv.includes("-y")
  const hdPath = flag("--hd-path") || process.env.LEDGER_HD_PATH
  const rpc = flag("--rpc") || process.env.ETH_RPC_URL || DEFAULT_RPC
  const name = flag("--name") || positionalName(argv, flag) || opts.defaultName

  let operator: `0x${string}`
  if (useHotKey) {
    // The hot key is the signer AND the from-address (option B: it owns the name).
    operator = hotKeyAccount().address
    const from = flag("--from")
    if (from && isAddress(from) && getAddress(from) !== operator) {
      console.error(`error: --from ${from} != hot key address ${operator}. Drop --from when using --hot-key.`)
      process.exit(2)
    }
  } else {
    const raw = flag("--from") || process.env.OPERATOR_ADDRESS || DEFAULT_OPERATOR
    if (!isAddress(raw)) {
      console.error(`error: invalid operator/--from address: ${raw}`)
      process.exit(2)
    }
    operator = getAddress(raw)
  }

  return { argv, flag, send, useHotKey, yes, hdPath, rpc, name, operator, agent: resolveAgent(name) }
}

// ── ERC-7930 interoperable address (ENSIP-25 registry encoding) ──
/**
 * ERC-7930 interoperable address for an EVM (eip155) chain + address.
 * Layout: Version(2) ChainType(2) ChainRefLen(1) ChainRef(var) AddrLen(1) Address(var).
 * Verified against the spec's worked example for vitalik.eth on mainnet:
 *   erc7930Evm(1, 0xd8dA…6045) === 0x00010000010114d8da6bf26964af9d7eed9e03e53415d37aa96045
 */
export function erc7930Evm(chainId: number, address: string): string {
  let ref = chainId.toString(16)
  if (ref.length % 2) ref = "0" + ref
  const refLen = (ref.length / 2).toString(16).padStart(2, "0")
  const addr = address.toLowerCase().replace(/^0x/, "")
  const addrLen = (addr.length / 2).toString(16).padStart(2, "0")
  return "0x0001" + "0000" + refLen + ref + addrLen + addr
}

// ── ens-cli batch builder (one resolver multicall) ──
export type EnsRecord =
  | { type: "address"; address: string; coinType?: number; chainId?: number }
  | { type: "text"; key: string; value: string }
  | { type: "contenthash"; hash: string }

/** Build {to,data} for a resolver multicall via the vendored ens-cli `set batch`. */
export async function buildEnsBatch(
  name: string,
  records: EnsRecord[],
): Promise<{ to: `0x${string}`; data: `0x${string}` }> {
  const out = await $`bun tools/ens-cli/src/index.ts set batch ${name} --chain mainnet --data ${JSON.stringify(records)}`.text()
  // ens-cli prints `to: 0x…` / `data: 0x…` lines (also tolerate a JSON-ish `"to":`).
  const to = (out.match(/^to:\s*(\S+)/m) || out.match(/"?to"?:\s*"?(0x[0-9a-fA-F]+)"?/))?.[1] as `0x${string}` | undefined
  const data = (out.match(/^data:\s*(\S+)/m) || out.match(/"?data"?:\s*"?(0x[0-9a-fA-F]+)"?/))?.[1] as `0x${string}` | undefined
  if (!to || !data) {
    console.error("error: failed to build calldata via ens-cli. Output was:\n" + out)
    process.exit(1)
  }
  return { to, data }
}

// ── client + pre-flight ──
export function makePublicClient(rpc: string): PublicClient {
  return createPublicClient({ chain: mainnet, transport: http(rpc) })
}

/** eth_call the tx from `account`; exit(1) with a one-line reason on revert. */
export async function preflightSimulate(
  client: PublicClient,
  tx: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}` },
  okMsg: string,
  hint?: string,
): Promise<void> {
  try {
    await client.call({ account: tx.account, to: tx.to, data: tx.data })
    console.error(`✓ pre-flight: ${okMsg}`)
  } catch (err) {
    console.error("✗ pre-flight: reverted in simulation — NOT safe to send.")
    console.error(`  ${(err as Error).message?.split("\n")[0] ?? err}`)
    if (hint) console.error(`  ${hint}`)
    process.exit(1)
  }
}

// ── the shared signing tail (interactive confirm → broadcast) ──
/**
 * Confirm interactively, then broadcast either via the operator's Ledger
 * (`cast send --ledger`) or, when `useHotKey`, via a viem wallet client signing
 * with OPERATOR_HOT_KEY. Returns the tx hash for the hot-key path (cast prints its
 * own for the Ledger path).
 */
export async function confirmAndSend(opts: {
  to: `0x${string}`
  data: `0x${string}`
  rpc: string
  operator: `0x${string}`
  useHotKey: boolean
  hdPath?: string
  promptMsg: string
  /** Skip the interactive prompt (automation). The pre-flight sim is the safety gate. */
  assumeYes?: boolean
}): Promise<`0x${string}` | undefined> {
  if (opts.assumeYes) {
    console.error(`${opts.promptMsg} (auto-confirmed via --yes)`)
  } else {
    const answer = prompt(`${opts.promptMsg} Type 'yes' to proceed:`)
    if (answer?.trim().toLowerCase() !== "yes") {
      console.error("aborted — nothing sent.")
      process.exit(0)
    }
  }
  console.error("")

  if (opts.useHotKey) {
    const account = hotKeyAccount()
    if (getAddress(account.address) !== opts.operator) {
      console.error(`error: hot key ${account.address} != resolved from ${opts.operator}.`)
      process.exit(2)
    }
    const wallet = createWalletClient({ account, chain: mainnet, transport: http(opts.rpc) })
    console.error("(signing with the operator hot key — OPERATOR_HOT_KEY)")
    const hash = await wallet.sendTransaction({ to: opts.to, data: opts.data })
    console.error(`broadcast (hot key): ${hash}`)
    const receipt = await makePublicClient(opts.rpc).waitForTransactionReceipt({ hash })
    console.error(`mined in block ${receipt.blockNumber} — status ${receipt.status}`)
    if (receipt.status !== "success") process.exit(1)
    return hash
  }

  const castArgs: string[] = [opts.to, opts.data, "--rpc-url", opts.rpc, "--ledger", "--from", opts.operator]
  if (opts.hdPath) castArgs.push("--hd-path", opts.hdPath)
  console.error("(confirm the transaction on your Ledger)")
  await $`cast send ${castArgs}`
  return undefined
}
