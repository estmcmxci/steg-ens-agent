/**
 * verifyAuth — INTERNAL STAGE. The spec's §5.2 authentication check mirrored
 * in TypeScript. Exported for tests, conformance inspection, and debugging;
 * the supported integrator surface is `evaluateAction()` (PRD §7).
 *
 * Authentication ONLY — no policy enforcement in this stage (spec F6).
 * Fail-fast: the first failed step returns immediately (spec F5), which is
 * what makes reason precedence stable (e.g. revoked AND expired → STALE,
 * because the validity window is step 3 and revocation is step 4).
 */

import { recoverMessageAddress } from "viem"
import { computeStateHash, currentUnixSeconds, serializeRequest } from "./hash"
import { decodeCredential } from "./schema"
import { SUPPORTED_SCHEMES } from "./types"
import type {
  ActionRequest,
  AuthDetail,
  AuthReason,
  AuthResult,
  Hex,
  ResolvedRecords,
} from "./types"

export async function verifyAuth(
  name: string,
  request: ActionRequest,
  signature: Hex,
  records: ResolvedRecords,
  now: number = currentUnixSeconds(),
): Promise<AuthResult> {
  const message = serializeRequest(request)
  const resolvedAt = now
  const stateHash = computeStateHash({
    name,
    credentialId: request.credentialId,
    message,
    signature,
    credentialRaw: records.credential,
    revocationRaw: records.revocation,
    resolvedAt,
  })

  const deny = (reason: AuthReason, detail?: AuthDetail): AuthResult => ({
    allowed: false,
    reason,
    ...(detail !== undefined && { detail }),
    resolvedAt,
    stateHash,
  })

  // Step 1 — credential lookup (spec: empty bytes → Unverified)
  if (records.credential === null) {
    return deny("UNVERIFIED", "CREDENTIAL_NOT_FOUND")
  }

  // Step 2 — decode / shape validation (spec: decode failure → Unverified)
  const credential = decodeCredential(records.credential)
  if (credential === null) {
    return deny("UNVERIFIED", "RECORD_MALFORMED")
  }

  // Step 3 — validity window. Boundary semantics per spec: stale only when
  // now < notBefore or now > notAfter, so now == notBefore and
  // now == notAfter are both ALLOWED. notAfter == 0 means no expiry.
  if (
    now < credential.notBefore ||
    (credential.notAfter !== 0 && now > credential.notAfter)
  ) {
    return deny("STALE")
  }

  // Step 4 — revocation. Presence-based: any record present → revoked
  // (spec: decoding the revocation record is OPTIONAL for the deny decision).
  if (records.revocation !== null) {
    return deny("REVOKED")
  }

  // Step 5 — scheme support (spec: unsupported scheme → Mismatch, a
  // first-class DenyReason, not an Unverified detail)
  if (!(SUPPORTED_SCHEMES as readonly string[]).includes(credential.schemeId)) {
    return deny("MISMATCH", "UNSUPPORTED_SCHEME")
  }

  // Step 6 — signature verification (spec: failure → Unverified). An
  // unrecoverable signature is the same deny as a recovered-but-wrong signer.
  let recovered: string
  try {
    recovered = await recoverMessageAddress({ message, signature })
  } catch {
    return deny("UNVERIFIED", "SIGNER_MISMATCH")
  }
  if (recovered.toLowerCase() !== credential.signer.toLowerCase()) {
    return deny("UNVERIFIED", "SIGNER_MISMATCH")
  }

  // Step 7 — success
  return { allowed: true, reason: "OK", resolvedAt, stateHash }
}
