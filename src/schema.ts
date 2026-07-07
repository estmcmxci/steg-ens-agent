/**
 * Record decode / shape validation — the TS equivalent of spec §5.2 step 2
 * (CBOR decode in the real substrate; JSON here, per the documented demo
 * deviation in PRD §10).
 *
 * Decode is strict on shape but deliberately does NOT judge scheme support:
 * an unrecognized `schemeId` decodes fine and fails the later scheme-support
 * step (MISMATCH). Conflating the two would collapse two distinct spec
 * DenyReasons into one.
 */

import type {
  ActionType,
  CredentialRecord,
  Erc20TransferPolicy,
  FleetEnvelope,
  PolicyRecord,
  RevocationRecord,
  UniswapSwapPolicy,
  X402PaymentPolicy,
} from "./types"

const ACTION_TYPES: readonly ActionType[] = ["erc20.transfer", "uniswap.swap", "x402.payment"]

/** CAIP-2 network id, e.g. "eip155:8453". Namespace:reference, permissive. */
const CAIP2_RE = /^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}$/

function isCaip2(value: unknown): boolean {
  return typeof value === "string" && CAIP2_RE.test(value)
}

/** Validate an allow-list field: undefined, "*", or an array of addresses. */
function isAddressListOrWildcard(value: unknown): boolean {
  return (
    value === undefined ||
    value === "*" ||
    (Array.isArray(value) && value.every((a) => isAddress(a)))
  )
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function isAddress(value: unknown): boolean {
  return typeof value === "string" && ADDRESS_RE.test(value)
}

function isUnixSeconds(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

/** Base-10 unsigned integer string (token base units). */
function isAmount(value: unknown): boolean {
  return typeof value === "string" && /^[0-9]+$/.test(value)
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Returns null on any shape violation — callers map null to RECORD_MALFORMED. */
export function decodeCredential(raw: string): CredentialRecord | null {
  const v = parseJson(raw) as Partial<CredentialRecord> | null
  if (
    v === null ||
    typeof v !== "object" ||
    typeof v.credentialId !== "string" ||
    v.credentialId.length === 0 ||
    typeof v.schemeId !== "string" ||
    v.schemeId.length === 0 ||
    !isAddress(v.signer) ||
    !isUnixSeconds(v.notBefore) ||
    !isUnixSeconds(v.notAfter)
  ) {
    return null
  }
  return v as CredentialRecord
}

export function decodePolicy(raw: string): PolicyRecord | null {
  const v = parseJson(raw) as Record<string, unknown> | null
  if (
    v === null ||
    typeof v !== "object" ||
    typeof v.credentialId !== "string" ||
    (v.credentialId as string).length === 0
  ) {
    return null
  }

  if (v.actionType === "erc20.transfer") {
    if (
      !isAddress(v.token) ||
      !isAmount(v.maxAmount) ||
      !(v.allowedRecipient === "*" || isAddress(v.allowedRecipient))
    ) {
      return null
    }
    return v as unknown as Erc20TransferPolicy
  }

  if (v.actionType === "uniswap.swap") {
    if (
      !isAddress(v.tokenIn) ||
      !(v.tokenOut === "*" || isAddress(v.tokenOut)) ||
      !isAmount(v.maxAmountIn) ||
      !(v.allowedRecipient === "*" || isAddress(v.allowedRecipient))
    ) {
      return null
    }
    return v as unknown as UniswapSwapPolicy
  }

  if (v.actionType === "x402.payment") {
    if (
      !isAddress(v.asset) ||
      !isAmount(v.maxAmount) ||
      !(v.allowedPayTo === "*" || isAddress(v.allowedPayTo)) ||
      !(v.network === undefined || isCaip2(v.network))
    ) {
      return null
    }
    return v as unknown as X402PaymentPolicy
  }

  return null
}

/** Decode the Tier-1 fleet envelope. Returns null on shape violation — the
 * caller treats a present-but-malformed envelope as fail-safe deny. */
export function decodeFleetEnvelope(raw: string): FleetEnvelope | null {
  const v = parseJson(raw) as Record<string, unknown> | null
  if (v === null || typeof v !== "object") return null

  const at = v.allowedActionTypes
  const actionTypesOk =
    at === "*" ||
    (Array.isArray(at) && at.every((t) => ACTION_TYPES.includes(t as ActionType)))
  if (!actionTypesOk) return null

  if (v.maxAmount !== undefined && !isAmount(v.maxAmount)) return null
  if (!isAddressListOrWildcard(v.allowedTokens)) return null
  if (!isAddressListOrWildcard(v.allowedTokensOut)) return null
  if (!isAddressListOrWildcard(v.allowedRecipients)) return null

  return v as unknown as FleetEnvelope
}

export function decodeRevocation(raw: string): RevocationRecord | null {
  const v = parseJson(raw) as Partial<RevocationRecord> | null
  if (
    v === null ||
    typeof v !== "object" ||
    typeof v.credentialId !== "string" ||
    !isUnixSeconds(v.revokedAt)
  ) {
    return null
  }
  return v as RevocationRecord
}

/** Shape check for incoming requests at the integrator boundary. */
export function isActionRequest(value: unknown): boolean {
  const v = value as { credentialId?: unknown; actionType?: unknown; params?: any } | null
  if (
    v === null ||
    typeof v !== "object" ||
    typeof v.credentialId !== "string" ||
    v.credentialId.length === 0 ||
    v.params === null ||
    typeof v.params !== "object"
  ) {
    return false
  }

  if (v.actionType === "erc20.transfer") {
    return isAddress(v.params.token) && isAddress(v.params.to) && isAmount(v.params.amount)
  }

  if (v.actionType === "uniswap.swap") {
    return (
      isAddress(v.params.tokenIn) &&
      isAddress(v.params.tokenOut) &&
      isAmount(v.params.amountIn) &&
      isAddress(v.params.to) &&
      (v.params.slippageBps === undefined ||
        (typeof v.params.slippageBps === "number" &&
          Number.isInteger(v.params.slippageBps) &&
          v.params.slippageBps >= 0))
    )
  }

  if (v.actionType === "x402.payment") {
    return (
      isAddress(v.params.asset) &&
      isAddress(v.params.payTo) &&
      isAmount(v.params.amount) &&
      isCaip2(v.params.network)
    )
  }

  return false
}
