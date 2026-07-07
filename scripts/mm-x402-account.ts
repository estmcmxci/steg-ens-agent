/**
 * mm-x402-account.ts — the MetaMask TEE server-wallet as an x402 `ClientEvmSigner`.
 *
 * This is THE one new integration point for x402 payments (ERD §7.1). The x402
 * "exact" scheme (`@x402/evm`'s `ExactEvmScheme`) consumes a `ClientEvmSigner` =
 * `{ address, signTypedData }`. We back `signTypedData` with
 * `mm wallet sign-typed-data --wait` so the agent's **TEE server-wallet**
 * (`agent.steg.eth`, key never leaves the TEE) signs the EIP-3009
 * `TransferWithAuthorization`. No BYOK, no password — server-wallet signing is
 * asynchronous, so we pass `--wait` and block until the TEE returns the signature.
 *
 * Safety, per the §15.7 critic ledger — the ENS gate is identity-scoped, NOT a
 * spend control (#2/#5), so the guards live HERE:
 *   #5  a hard pre-sign guard (cap + token + chain + recipient) — fail-closed.
 *   #6  BigInt-safe payload serialization (`JSON.stringify` throws on bigint).
 *   #14 `--chain-id` derived from the typed data's `domain.chainId`, never hardcoded.
 *   #16 NEVER log the payload or the signature (both are bearer-spendable until settled).
 *
 * mm is invoked via `Bun.spawn` (execve, no shell — mirrors `brain/app/tools/wallet.py:_mm`)
 * so the JSON payload is passed as one argv element and never parsed by a shell.
 */

import type { ClientEvmSigner } from "@x402/evm"

/** Canonical Base mainnet USDC (native Circle USDC). EIP-712 domain: name "USD
 *  Coin", version "2", chainId 8453. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const
export const BASE_MAINNET_CHAIN_ID = 8453
/** Base Sepolia test USDC (for the §9 plumbing leg). NB: its EIP-712 domain name
 *  is "USDC" (not "USD Coin") — a sig from one chain is invalid on the other. */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const
export const BASE_SEPOLIA_CHAIN_ID = 84532

/** The EIP-712 typed-data object `ClientEvmSigner.signTypedData` receives. */
export interface Eip712TypedData {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

/**
 * A HARD pre-sign control. The adapter refuses to sign (throws, before ever
 * calling `mm`) if the incoming typed data violates any of these. This is the
 * spend ceiling the ENS gate does NOT provide (§15.7 #5).
 */
export interface PaymentGuard {
  /** Reject if the EIP-3009 `value` (USDC base units, 6 decimals) exceeds this. */
  maxValue: bigint
  /** Expected token = EIP-712 `domain.verifyingContract` (e.g. `BASE_USDC`). */
  verifyingContract: `0x${string}`
  /** Expected EVM chain id = `domain.chainId` (e.g. 8453). */
  chainId: number
  /** Optional allowlist for the transfer recipient (`message.to`). */
  allowedTo?: readonly `0x${string}`[]
}

const SIG_HEX = /^0x[0-9a-fA-F]{130,}$/ // r‖s‖v ≥ 65 bytes
const ADDR_HEX = /^0x[0-9a-fA-F]{40}$/
const lc = (s: string) => s.toLowerCase()

/**
 * Serialize typed data to the JSON string `mm --payload` expects, converting
 * every `bigint` to its decimal string. EIP-3009 `value`/`validAfter`/
 * `validBefore` arrive as bigint and `JSON.stringify` throws on them (§15.7 #6);
 * a uint256 decimal string is the correct EIP-712 encoding.
 */
export function serializeTypedData(td: Eip712TypedData): string {
  return JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
}

/**
 * Fail-closed guard. Throws if the typed data's domain/value/recipient don't
 * match `guard`. Pure (no I/O) so it is unit-testable without `mm`.
 */
export function assertAllowed(td: Eip712TypedData, guard: PaymentGuard): void {
  const { domain, message } = td

  const vc = domain.verifyingContract
  if (typeof vc !== "string" || lc(vc) !== lc(guard.verifyingContract)) {
    throw new Error(`x402 guard: verifyingContract ${String(vc)} ≠ expected ${guard.verifyingContract}`)
  }

  const chainId = Number(domain.chainId)
  if (chainId !== guard.chainId) {
    throw new Error(`x402 guard: domain.chainId ${String(domain.chainId)} ≠ expected ${guard.chainId}`)
  }

  if ("value" in message) {
    let value: bigint
    try {
      value = BigInt(message.value as string | number | bigint)
    } catch {
      throw new Error(`x402 guard: unparseable message.value`)
    }
    if (value > guard.maxValue) {
      throw new Error(`x402 guard: value ${value} exceeds cap ${guard.maxValue}`)
    }
  }

  if (guard.allowedTo && "to" in message) {
    const to = message.to
    if (typeof to !== "string" || !guard.allowedTo.some((a) => lc(a) === lc(to))) {
      throw new Error(`x402 guard: recipient ${String(to)} not in allowlist`)
    }
  }
}

/**
 * mm wraps results as `{ ok, data: {...} }`. Find a `0x…` signature under common
 * keys, then deep-scan — without ever logging the value (§15.7 #16). The field
 * name varies across mm versions, hence the tolerant scan (cf. sign-with-mm.ts).
 */
export function extractSignature(parsed: unknown): `0x${string}` | null {
  const root = parsed as { ok?: boolean; data?: Record<string, unknown> } | null
  if (!root || root.ok === false) return null
  const data = root.data ?? (root as Record<string, unknown>)
  for (const k of ["signature", "sig", "signedMessage", "result"]) {
    const v = data[k]
    if (typeof v === "string" && SIG_HEX.test(v)) return v as `0x${string}`
  }
  let found: `0x${string}` | null = null
  const walk = (v: unknown) => {
    if (found) return
    if (typeof v === "string" && SIG_HEX.test(v)) found = v as `0x${string}`
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x)
  }
  walk(data)
  return found
}

/** Run `mm <args>` with no shell (execve) and return its parsed JSON. Never
 *  echoes the args (the payload is bearer-spendable) — only the topic + an error
 *  tail on failure. */
async function mmJson(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(["mm", ...args], { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    const tail = stderr.trim().split("\n").pop() ?? ""
    throw new Error(`mm ${args[0]} ${args[1] ?? ""} exited ${code}: ${tail}`)
  }
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`mm ${args[0]} ${args[1] ?? ""}: non-JSON output`)
  }
}

let cachedAddress: `0x${string}` | null = null
/** The active mm wallet address (the TEE server-wallet = agent.steg.eth). Cached. */
export async function mmWalletAddress(): Promise<`0x${string}`> {
  if (cachedAddress) return cachedAddress
  const parsed = await mmJson(["wallet", "address", "--json"])
  const addr = (parsed as { data?: { address?: unknown } })?.data?.address
  if (typeof addr !== "string" || !ADDR_HEX.test(addr)) {
    throw new Error(`mm wallet address: no address in response`)
  }
  cachedAddress = addr as `0x${string}`
  return cachedAddress
}

export interface MmX402AccountOptions {
  /** Human-readable intent forwarded with the signing request (mm `--intent`). */
  intent?: string
  /** Pre-resolved address — skips the `mm wallet address` read. */
  address?: `0x${string}`
}

/**
 * Build a `ClientEvmSigner` backed by the mm TEE server-wallet, consumable by
 * `new ExactEvmScheme(account)`.
 *
 * `guard` is enforced BEFORE any signature is requested: the ENS authority gate
 * is an identity-scoped kill-switch, not a per-payment spend control (§15.7
 * #2/#5), so the amount/token/chain/recipient checks must live here.
 */
export async function createMmX402Account(
  guard: PaymentGuard,
  opts: MmX402AccountOptions = {},
): Promise<ClientEvmSigner> {
  const address = opts.address ?? (await mmWalletAddress())

  return {
    address,
    async signTypedData(td: Eip712TypedData): Promise<`0x${string}`> {
      // 1) Fail-closed guard FIRST — never reach mm with an out-of-policy payload.
      assertAllowed(td, guard)

      // EIP-3009 `from` must be us, or we'd be authorizing someone else's transfer.
      const from = td.message.from
      if (typeof from === "string" && lc(from) !== lc(address)) {
        throw new Error(`x402 guard: message.from ${from} ≠ signer ${address}`)
      }

      // 2) chain id from the typed data, NOT hardcoded (§15.7 #14) — keeps the
      //    adapter correct on the Base Sepolia plumbing leg (84532) too.
      const chainId = Number(td.domain.chainId)
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`x402: invalid domain.chainId ${String(td.domain.chainId)}`)
      }

      // 3) BigInt-safe payload (§15.7 #6).
      const payload = serializeTypedData(td)

      // 4) TEE server-wallet → async → --wait blocks until the signature resolves.
      //    No --password (BYOK-only, unused here).
      const args = [
        "wallet", "sign-typed-data",
        "--chain-id", String(chainId),
        "--payload", payload,
        "--wait",
        "--json",
      ]
      if (opts.intent) args.push("--intent", opts.intent)

      const parsed = await mmJson(args)
      const sig = extractSignature(parsed)
      if (!sig) {
        // A pollingId (not a signature) means --wait didn't resolve to a sig.
        throw new Error(`mm sign-typed-data: no signature returned (did --wait resolve? got a pollingId?)`)
      }
      // Deliberately NOT logging `payload` or `sig` (§15.7 #16).
      return sig
    },
  }
}
