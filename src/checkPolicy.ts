/**
 * checkPolicy — INTERNAL STAGE. Thin policy check previewing v1.1-style
 * capability enforcement (PRD §13), now two-tier: the request must satisfy
 * BOTH the agent's own Tier-2 policy AND the MARP Tier-1 fleet envelope
 * (most-restrictive-wins). A deny carries `scope` so callers see which layer
 * bound it.
 *
 * This is deliberately NOT part of verifyAuth(): the spec reserves
 * PolicyDenied for v1.1 and declares implementations that perform policy
 * checks inside the v1 auth path non-conformant (spec F6). Keeping the stages
 * separate is what lets verifyAuth() be cited as the spec's §5.2 check.
 */

import { decodeFleetEnvelope, decodePolicy } from "./schema"
import type {
  ActionRequest,
  Address,
  FleetEnvelope,
  PolicyDetail,
  PolicyResult,
} from "./types"

/**
 * Two-tier check. `envelopeRaw`:
 *   - undefined/null → no Tier-1 constraint (agent policy alone governs)
 *   - present & valid → request must also fall within the fleet ceiling
 *   - present & malformed → fail-safe deny (an unreadable guardrail must not
 *     silently grant unbounded authority)
 */
export function checkPolicy(
  request: ActionRequest,
  agentPolicyRaw: string | null,
  envelopeRaw?: string | null,
): PolicyResult {
  // Tier 2 — the agent's own policy. Most-restrictive-wins: if the agent's own
  // policy denies, we stop here (the agent constrained itself tighter).
  const agent = checkAgentPolicy(request, agentPolicyRaw)
  if (!agent.allowed) return { ...agent, scope: "agent" }

  // Tier 1 — the MARP fleet envelope, when one governs this agent.
  if (envelopeRaw !== undefined && envelopeRaw !== null) {
    const envelope = decodeFleetEnvelope(envelopeRaw)
    if (envelope === null) {
      return { allowed: false, reason: "POLICY_DENIED", detail: "ACTION_NOT_ALLOWED", scope: "fleet" }
    }
    const detail = checkEnvelope(request, envelope)
    if (detail) return { allowed: false, reason: "POLICY_DENIED", detail, scope: "fleet" }
  }

  return { allowed: true, reason: "OK" }
}

/** Tier-2 check — the agent's own policy record (the original checkPolicy). */
function checkAgentPolicy(request: ActionRequest, policyRaw: string | null): PolicyResult {
  const deny = (detail: PolicyDetail): PolicyResult => ({
    allowed: false,
    reason: "POLICY_DENIED",
    detail,
  })

  const policy = policyRaw === null ? null : decodePolicy(policyRaw)
  if (
    policy === null ||
    policy.credentialId !== request.credentialId ||
    policy.actionType !== request.actionType
  ) {
    return deny("ACTION_NOT_ALLOWED")
  }

  if (request.actionType === "erc20.transfer" && policy.actionType === "erc20.transfer") {
    if (policy.token.toLowerCase() !== request.params.token.toLowerCase()) {
      return deny("ACTION_NOT_ALLOWED")
    }
    let amount: bigint
    try {
      amount = BigInt(request.params.amount)
    } catch {
      return deny("ACTION_NOT_ALLOWED")
    }
    if (amount > BigInt(policy.maxAmount)) return deny("AMOUNT_EXCEEDED")
    if (
      policy.allowedRecipient !== "*" &&
      policy.allowedRecipient.toLowerCase() !== request.params.to.toLowerCase()
    ) {
      return deny("RECIPIENT_NOT_ALLOWED")
    }
    return { allowed: true, reason: "OK" }
  }

  if (request.actionType === "uniswap.swap" && policy.actionType === "uniswap.swap") {
    if (policy.tokenIn.toLowerCase() !== request.params.tokenIn.toLowerCase()) {
      return deny("ACTION_NOT_ALLOWED")
    }
    if (
      policy.tokenOut !== "*" &&
      policy.tokenOut.toLowerCase() !== request.params.tokenOut.toLowerCase()
    ) {
      return deny("ACTION_NOT_ALLOWED")
    }
    let amountIn: bigint
    try {
      amountIn = BigInt(request.params.amountIn)
    } catch {
      return deny("ACTION_NOT_ALLOWED")
    }
    if (amountIn > BigInt(policy.maxAmountIn)) return deny("AMOUNT_EXCEEDED")
    if (
      policy.allowedRecipient !== "*" &&
      policy.allowedRecipient.toLowerCase() !== request.params.to.toLowerCase()
    ) {
      return deny("RECIPIENT_NOT_ALLOWED")
    }
    return { allowed: true, reason: "OK" }
  }

  if (request.actionType === "x402.payment" && policy.actionType === "x402.payment") {
    if (policy.asset.toLowerCase() !== request.params.asset.toLowerCase()) {
      return deny("ACTION_NOT_ALLOWED")
    }
    let amount: bigint
    try {
      amount = BigInt(request.params.amount)
    } catch {
      return deny("ACTION_NOT_ALLOWED")
    }
    if (amount > BigInt(policy.maxAmount)) return deny("AMOUNT_EXCEEDED")
    if (
      policy.allowedPayTo !== "*" &&
      policy.allowedPayTo.toLowerCase() !== request.params.payTo.toLowerCase()
    ) {
      return deny("RECIPIENT_NOT_ALLOWED")
    }
    // Optional network pin: if the policy fixes a network, the request must match.
    if (policy.network !== undefined && policy.network !== request.params.network) {
      return deny("ACTION_NOT_ALLOWED")
    }
    return { allowed: true, reason: "OK" }
  }

  return deny("ACTION_NOT_ALLOWED")
}

/** Tier-1 check — the request against the fleet ceiling. Returns the deny
 * detail, or null if the request is within the envelope. */
function checkEnvelope(request: ActionRequest, env: FleetEnvelope): PolicyDetail | null {
  if (env.allowedActionTypes !== "*" && !env.allowedActionTypes.includes(request.actionType)) {
    return "ACTION_NOT_ALLOWED"
  }

  const inList = (addr: Address, list: Address[] | "*" | undefined): boolean =>
    list === undefined || list === "*" || list.some((a) => a.toLowerCase() === addr.toLowerCase())

  if (request.actionType === "erc20.transfer") {
    if (!inList(request.params.token, env.allowedTokens)) return "ACTION_NOT_ALLOWED"
    if (env.maxAmount !== undefined && BigInt(request.params.amount) > BigInt(env.maxAmount)) {
      return "AMOUNT_EXCEEDED"
    }
    if (!inList(request.params.to, env.allowedRecipients)) return "RECIPIENT_NOT_ALLOWED"
    return null
  }

  if (request.actionType === "x402.payment") {
    // asset reuses the token allow-list; payTo reuses the recipient allow-list.
    if (!inList(request.params.asset, env.allowedTokens)) return "ACTION_NOT_ALLOWED"
    if (env.maxAmount !== undefined && BigInt(request.params.amount) > BigInt(env.maxAmount)) {
      return "AMOUNT_EXCEEDED"
    }
    if (!inList(request.params.payTo, env.allowedRecipients)) return "RECIPIENT_NOT_ALLOWED"
    return null
  }

  // uniswap.swap
  if (!inList(request.params.tokenIn, env.allowedTokens)) return "ACTION_NOT_ALLOWED"
  if (!inList(request.params.tokenOut, env.allowedTokensOut)) return "ACTION_NOT_ALLOWED"
  if (env.maxAmount !== undefined && BigInt(request.params.amountIn) > BigInt(env.maxAmount)) {
    return "AMOUNT_EXCEEDED"
  }
  if (!inList(request.params.to, env.allowedRecipients)) return "RECIPIENT_NOT_ALLOWED"
  return null
}
