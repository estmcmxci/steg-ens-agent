/**
 * ENS-backed record source — Milestone 2.
 *
 * Implements the same `RecordSource` interface the mock store does, so
 * `verifyAuth()` / `checkPolicy()` / `evaluateAction()` are unchanged: M2 is
 * purely a swap of where records come from. Reads three text records per
 * evaluation, fresh from L1 over CCIP-Read (PRD §10):
 *
 *   auth.credential[<id>]   → credential record   (verifyAuth steps 1–2)
 *   auth.capability[<id>]   → policy record        (checkPolicy; spec capability key)
 *   auth.revocation[<id>]   → revocation record    (verifyAuth step 4, presence-based)
 *
 * Key convention mirrors the spec's `data` keys verbatim (PRD §10) so the
 * demo previews the funded substrate rather than diverging from it.
 *
 * Revocation sentinel containment (PRD §10): the revocation key is pre-seeded
 * with a "not revoked" sentinel so that revoking is a value *update*, not a
 * key *creation* (avoids the CCIP gateway's negative-cache lag on new keys).
 * That deviation lives ONLY here — the adapter maps the sentinel (and empty /
 * absent) to `null` before records reach the verifier, which therefore stays
 * purely presence-based and spec-aligned.
 */

import type { Address, PublicClient } from "viem"
import {
  createEnsClient,
  universalResolverOverride,
  viemDefaultUniversalResolver,
} from "./ensClient"
import type { RecordSource, ResolvedRecords } from "./types"

export function credentialKey(id: string): string {
  return `auth.credential[${id}]`
}
export function capabilityKey(id: string): string {
  return `auth.capability[${id}]`
}
export function revocationKey(id: string): string {
  return `auth.revocation[${id}]`
}

/** Empty / unset text records read back as `null` or `""` — both mean absent. */
function presentOrNull(raw: string | null): string | null {
  return raw && raw.length > 0 ? raw : null
}

/**
 * Map a revocation text record to the verifier's presence model. Absent,
 * empty, or the pre-seeded `{"revoked": false}` sentinel → not revoked
 * (null). Any other present value (including `{"revoked": true, ...}`) →
 * revoked. Malformed JSON is treated as present/revoked: fail safe — a
 * garbled revocation record should not silently re-enable a credential.
 */
function mapRevocation(raw: string | null): string | null {
  const value = presentOrNull(raw)
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as { revoked?: unknown }
    if (parsed && typeof parsed === "object" && parsed.revoked === false) {
      return null // sentinel → absent
    }
  } catch {
    // fall through: malformed → treat as present (revoked)
  }
  return value
}

export class EnsRecordSource implements RecordSource {
  private readonly universalResolverAddress?: Address
  private logged = false

  constructor(
    private readonly client: PublicClient = createEnsClient(),
    /** Explicit Universal Resolver override; defaults to env, then viem's
     * bundled address. Surfaced for ENSv2-readiness auditing. */
    universalResolverAddress: Address | undefined = universalResolverOverride(),
  ) {
    this.universalResolverAddress = universalResolverAddress
  }

  /** Log the effective UR once, so it's visible which resolver path reads go
   * through (override vs viem default). stderr, to keep script stdout clean. */
  private logUniversalResolver(): void {
    if (this.logged) return
    this.logged = true
    if (this.universalResolverAddress) {
      console.error(
        `[ens] resolving via Universal Resolver ${this.universalResolverAddress} (override)`,
      )
    } else {
      const def =
        viemDefaultUniversalResolver() ??
        this.client.chain?.contracts?.ensUniversalResolver?.address
      console.error(`[ens] resolving via Universal Resolver ${def ?? "(viem default)"}`)
    }
  }

  async resolveRecords(
    name: string,
    credentialId: string,
  ): Promise<ResolvedRecords> {
    this.logUniversalResolver()
    // Pass the override through to each read when set; otherwise viem uses the
    // UR from its chain config.
    const ur = this.universalResolverAddress
      ? { universalResolverAddress: this.universalResolverAddress }
      : {}

    // Three fresh reads per evaluation (PRD §10: no cache). The name is
    // already ENSIP-15 normalized by evaluateAction() before it reaches here.
    const [credential, policy, revocation] = await Promise.all([
      this.client.getEnsText({ name, key: credentialKey(credentialId), ...ur }),
      this.client.getEnsText({ name, key: capabilityKey(credentialId), ...ur }),
      this.client.getEnsText({ name, key: revocationKey(credentialId), ...ur }),
    ])

    return {
      credential: presentOrNull(credential),
      policy: presentOrNull(policy),
      revocation: mapRevocation(revocation),
    }
  }
}
