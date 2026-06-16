/**
 * ENS-backed Tier-1 fleet envelope source — priority #3.
 *
 * The MARP (`oakgroup.eth`) is a single name that BOTH issues Tier-2 agent
 * subnames offchain (NameStone CCIP) AND carries the Tier-1 fleet envelope as
 * an ONCHAIN text record on its own apex. NameStone's hybrid resolver is
 * onchain-first / offchain-fallback, so the two coexist on one resolver: the
 * envelope is written onchain by the name owner (a Safe/Ledger in #5), while
 * subnames keep resolving via the offchain gateway.
 *
 * `resolveEnvelope(agentName)` derives the MARP root as the PARENT of the agent
 * subname (`swap1.oakgroup.eth` → `oakgroup.eth`) and reads `auth.fleet` fresh
 * from L1 (PRD §10, no cache) — same UR/CCIP-Read path as EnsRecordSource. The
 * verifier then enforces `fleet ∩ agent` (checkPolicy), independent of the
 * executor, so a bad MARP Tier-2 write can never exceed this ceiling.
 *
 * Returns the raw JSON string, or null when no envelope governs the name
 * (absent record, or a name with no MARP parent) — checkPolicy treats null as
 * "no Tier-1 constraint".
 */

import type { Address, PublicClient } from "viem"
import {
  createEnsClient,
  universalResolverOverride,
} from "./ensClient"
import type { EnvelopeSource } from "./types"

/** Text-record key holding the FleetEnvelope JSON on the MARP root. Flat (not
 * per-credential) — the envelope is one fleet-wide ceiling. */
export function fleetKey(): string {
  return "auth.fleet"
}

/** MARP root = parent of the agent subname (drop the leftmost label). Returns
 * null for a bare 2LD / TLD where no MARP parent exists. */
export function marpRootOf(agentName: string): string | null {
  const labels = agentName.split(".")
  if (labels.length <= 2) return null
  return labels.slice(1).join(".")
}

export class EnsEnvelopeSource implements EnvelopeSource {
  private readonly universalResolverAddress?: Address

  constructor(
    private readonly client: PublicClient = createEnsClient(),
    /** Explicit fleet (MARP) name. Default: derive as the parent of the agent
     * subname per evaluation — the MARP is the immediate parent in our model. */
    private readonly fleetName?: string,
    universalResolverAddress: Address | undefined = universalResolverOverride(),
  ) {
    this.universalResolverAddress = universalResolverAddress
  }

  async resolveEnvelope(name: string): Promise<string | null> {
    const fleet = this.fleetName ?? marpRootOf(name)
    if (!fleet) return null

    const ur = this.universalResolverAddress
      ? { universalResolverAddress: this.universalResolverAddress }
      : {}

    // Fresh L1 read (PRD §10) of the onchain apex text record, via the UR.
    const raw = await this.client.getEnsText({ name: fleet, key: fleetKey(), ...ur })
    return raw && raw.length > 0 ? raw : null
  }
}
