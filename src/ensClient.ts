/**
 * L1 mainnet viem client for fresh ENS resolution (PRD §10/§17).
 *
 * The relying party resolves records fresh against an L1 RPC on every
 * evaluation — no indexer, subgraph, or cache. viem ≥ 2.35 resolves through
 * the ENS **Universal Resolver** (the canonical client-side entrypoint:
 * findResolver + CCIP-Read + ENSv2 routing) — we never call a name's resolver
 * directly. The UR address used is surfaced/overridable here for
 * ENSv2-readiness auditing; it is NOT the address a name owner sets as their
 * resolver record (that's the Public Resolver). See
 * https://docs.ens.domains/resolvers/universal/
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem"
import { mainnet } from "viem/chains"

/** Default L1 RPC (PRD §10: eth.drpc.org; llamarpc hangs). Override via env. */
const DEFAULT_RPC = "https://eth.drpc.org"

/**
 * Canonical ENSv2 Universal Resolver (ENS DAO-owned proxy), per the ENS docs.
 * Used only as an explicit override target / for logging — when no override is
 * set we defer to the address viem ships for the chain (ENS skill rule #4:
 * don't hardcode, track the library), which on current viem is this same
 * address.
 */
export const CANONICAL_UNIVERSAL_RESOLVER: Address =
  "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe"

/** Read an explicit UR override from env (unset → use viem's bundled default). */
export function universalResolverOverride(): Address | undefined {
  const v = process.env.ENS_UNIVERSAL_RESOLVER?.trim()
  return v ? (v as Address) : undefined
}

/** The UR address viem ships for mainnet — what's used when no override is set. */
export function viemDefaultUniversalResolver(): Address | undefined {
  return mainnet.contracts?.ensUniversalResolver?.address as Address | undefined
}

export function createEnsClient(
  rpcUrl: string = process.env.ETH_RPC_URL || DEFAULT_RPC,
): PublicClient {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
}
