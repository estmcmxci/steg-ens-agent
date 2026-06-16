/**
 * evaluateAction — the single supported public integrator surface (PRD §7).
 *
 * Flow (PRD §14): normalize name → resolve current records → verifyAuth() →
 * short-circuit on auth failure → checkPolicy(). Policy is NEVER evaluated
 * for a request that failed authentication.
 */

import { normalize } from "viem/ens"
import { checkPolicy } from "./checkPolicy"
import { currentUnixSeconds } from "./hash"
import { verifyAuth } from "./verifyAuth"
import type {
  ActionRequest,
  EnvelopeSource,
  EvaluateActionResult,
  Hex,
  RecordSource,
} from "./types"

export async function evaluateAction(
  name: string,
  request: ActionRequest,
  signature: Hex,
  opts: {
    /** Where the agent's (Tier-2) records come from. Mock store in M1; the ENS
     * resolution adapter in M2. */
    source: RecordSource
    /** Optional Tier-1 fleet envelope source (the MARP global ceiling). When
     * supplied, the request must satisfy `fleet ∩ agent` (most-restrictive-
     * wins). Omit for a standalone agent with no MARP envelope. */
    envelope?: EnvelopeSource
    /** Evaluation time (unix seconds). Defaults to the real clock; injectable
     * for the documented time-boundary tests. */
    now?: number
  },
): Promise<EvaluateActionResult> {
  // ENSIP-15 normalization at the boundary (PRD §10, spec F8). Invalid input
  // throws → caller treats as deny. Never toLowerCase().
  const normalizedName = normalize(name)

  const now = opts.now ?? currentUnixSeconds()
  const records = await opts.source.resolveRecords(
    normalizedName,
    request.credentialId,
  )

  const auth = await verifyAuth(normalizedName, request, signature, records, now)
  if (!auth.allowed) {
    return { ...auth, layer: "auth" }
  }

  // Resolve the Tier-1 fleet envelope (if any) fresh, same as Tier-2 records.
  const envelopeRaw = opts.envelope
    ? await opts.envelope.resolveEnvelope(normalizedName)
    : undefined

  const policy = checkPolicy(request, records.policy, envelopeRaw)
  if (!policy.allowed) {
    return {
      allowed: false,
      reason: policy.reason,
      layer: "policy",
      ...(policy.scope !== undefined && { scope: policy.scope }),
      ...(policy.detail !== undefined && { detail: policy.detail }),
      resolvedAt: auth.resolvedAt,
      stateHash: auth.stateHash,
    }
  }

  return {
    allowed: true,
    reason: "OK",
    resolvedAt: auth.resolvedAt,
    stateHash: auth.stateHash,
  }
}
