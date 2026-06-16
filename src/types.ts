/**
 * Core types for the Steg verifier demo — Milestone 1 (local mock verifier).
 *
 * Record shapes follow PRD §9; result shapes follow PRD §12–14. The auth
 * `reason` enum is a 1:1 image of the spec's `DenyReason` (§5.1), minus the
 * v1.1-reserved values: Unverified → UNVERIFIED, Stale → STALE,
 * Revoked → REVOKED, Mismatch → MISMATCH.
 */

export type Address = `0x${string}`
export type Hex = `0x${string}`

/** Schemes the demo verifier supports (PRD §16: EOA secp256k1 only). */
export const SUPPORTED_SCHEMES = ["ecdsa-secp256k1"] as const

/** The action envelope (PRD §6). `credentialId` is the join key. The envelope
 * is a discriminated union on `actionType` — `uniswap.swap` was the "clean path
 * to later adding" PRD §6 anticipated; the external `evaluateAction` signature
 * is unchanged. */
export type Erc20TransferRequest = {
  credentialId: string
  actionType: "erc20.transfer"
  params: {
    token: Address
    to: Address
    amount: string // base-10 integer string, token base units
  }
}

export type UniswapSwapRequest = {
  credentialId: string
  actionType: "uniswap.swap"
  params: {
    tokenIn: Address
    tokenOut: Address
    amountIn: string // base-10 integer, tokenIn base units
    to: Address // recipient of tokenOut
    slippageBps?: number // execution-side hint only; not policy-checked
  }
}

export type ActionRequest = Erc20TransferRequest | UniswapSwapRequest

export type ActionType = ActionRequest["actionType"]

// --- The three-record split (PRD §8/§9). Never collapsed into one object. ---

/** Authentication surface. `schemeId` is a plain string at decode time: an
 * unknown scheme is a *well-formed* record that fails the scheme-support step
 * (MISMATCH), not a malformed one (UNVERIFIED). */
export type CredentialRecord = {
  credentialId: string
  schemeId: string
  signer: Address
  notBefore: number // unix seconds
  notAfter: number // unix seconds; 0 = no expiry
}

/** Thin v1.1-preview capability layer (PRD §9.2). Discriminated union on
 * `actionType`, parallel to ActionRequest. */
export type Erc20TransferPolicy = {
  credentialId: string
  actionType: "erc20.transfer"
  token: Address
  maxAmount: string
  allowedRecipient: Address | "*"
}

export type UniswapSwapPolicy = {
  credentialId: string
  actionType: "uniswap.swap"
  tokenIn: Address
  tokenOut: Address | "*"
  maxAmountIn: string
  allowedRecipient: Address | "*"
}

export type PolicyRecord = Erc20TransferPolicy | UniswapSwapPolicy

/**
 * Tier-1 MARP fleet envelope — the global ceiling every agent in the fleet
 * must obey. Lives on the parent name (e.g. `oakgroup.eth`); changed only via
 * the operator's Ledger-multisig. The verifier enforces `fleet ∩ agent`
 * (most-restrictive-wins), so an agent's effective authority can never exceed
 * the envelope even if its own (Tier-2) policy is broader. All fields are
 * ceilings/allow-lists; an omitted field means "no fleet-level constraint on
 * that dimension".
 */
export type FleetEnvelope = {
  /** Action types the fleet permits at all. "*" = any. */
  allowedActionTypes: ActionType[] | "*"
  /** Ceiling on transfer `amount` / swap `amountIn` (base units). */
  maxAmount?: string
  /** Allowed transfer `token` / swap `tokenIn`. "*" or omitted = any. */
  allowedTokens?: Address[] | "*"
  /** Allowed swap `tokenOut`. "*" or omitted = any. */
  allowedTokensOut?: Address[] | "*"
  /** Allowed recipient (`to`). "*" or omitted = any. */
  allowedRecipients?: Address[] | "*"
}

/** Resolves the Tier-1 fleet envelope governing an agent name (raw JSON or
 * null = no fleet constraint). Distinct from RecordSource because the envelope
 * lives on the parent and may come from a different substrate (onchain,
 * Safe/Ledger-gated) than the agent's records (NameStone). */
export interface EnvelopeSource {
  resolveEnvelope(name: string): Promise<string | null>
}

/** Presence of this record means revoked (PRD §9.3). */
export type RevocationRecord = {
  credentialId: string
  revokedAt: number
}

/**
 * Raw records as resolved from a state source, keyed per credential id.
 * Values are raw JSON strings so decode/shape validation (spec §5.2 step 2)
 * is a real step even against the mock store — the same shape the ENS
 * text-record adapter produces in Milestone 2. `null` means record absent
 * (for revocation: absent = not revoked).
 */
export type ResolvedRecords = {
  credential: string | null
  policy: string | null
  revocation: string | null
}

/** Anything that can resolve current-authority records for a name. The mock
 * store implements this in M1; the ENS adapter implements it in M2. */
export interface RecordSource {
  resolveRecords(name: string, credentialId: string): Promise<ResolvedRecords>
}

// --- Results ---

export type AuthReason = "OK" | "UNVERIFIED" | "STALE" | "REVOKED" | "MISMATCH"

export type AuthDetail =
  | "CREDENTIAL_NOT_FOUND" // under UNVERIFIED
  | "RECORD_MALFORMED" // under UNVERIFIED
  | "SIGNER_MISMATCH" // under UNVERIFIED
  | "UNSUPPORTED_SCHEME" // under MISMATCH

export type AuthResult = {
  allowed: boolean
  reason: AuthReason
  detail?: AuthDetail
  resolvedAt: number
  stateHash: Hex
}

export type PolicyDetail =
  | "ACTION_NOT_ALLOWED"
  | "AMOUNT_EXCEEDED"
  | "RECIPIENT_NOT_ALLOWED"

export type PolicyResult = {
  allowed: boolean
  reason: "OK" | "POLICY_DENIED"
  detail?: PolicyDetail
  /** Which policy layer produced the deny: the agent's own Tier-2 policy, or
   * the MARP Tier-1 fleet envelope. */
  scope?: "agent" | "fleet"
}

/** The single integrator-facing result (PRD §14). */
export type EvaluateActionResult = {
  allowed: boolean
  reason: AuthReason | "POLICY_DENIED"
  layer?: "auth" | "policy" // which stage produced a deny
  /** When layer === "policy": which policy layer bound the deny (Tier-2 agent
   * policy vs Tier-1 fleet envelope). */
  scope?: "agent" | "fleet"
  detail?: AuthDetail | PolicyDetail
  resolvedAt: number
  stateHash: Hex
}
