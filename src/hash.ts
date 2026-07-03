/**
 * Canonical request serialization + stateHash.
 *
 * stateHash binds a verification result to every input that informed it
 * (spec §5.1). The spec's reference computation is keccak256 over the
 * ABI-encoded tuple (node, credentialId, keccak(message), keccak(signature),
 * credential record bytes, revocation record bytes, block.number). TS-demo
 * adaptation, documented per PRD §15: the normalized name stands in for the
 * node, raw JSON strings stand in for CBOR record bytes, and `resolvedAt`
 * (unix seconds) stands in for block.number. Deterministic over the same
 * inputs; changes when any record changes.
 */

import { keccak256, stringToBytes } from "viem"
import type { ActionRequest, Hex } from "./types"

/**
 * The exact string the agent signs (EIP-191 personal message) and the
 * verifier recomputes: explicit field order, no whitespace. Both sides must
 * use this function — ad-hoc JSON.stringify of the request object is not
 * guaranteed to produce the same byte sequence.
 */
export function serializeRequest(request: ActionRequest): string {
  if (request.actionType === "uniswap.swap") {
    return JSON.stringify({
      credentialId: request.credentialId,
      actionType: request.actionType,
      params: {
        tokenIn: request.params.tokenIn,
        tokenOut: request.params.tokenOut,
        amountIn: request.params.amountIn,
        to: request.params.to,
        slippageBps: request.params.slippageBps ?? null,
      },
    })
  }
  if (request.actionType === "x402.payment") {
    // Explicit field order; both signer (sign-with-mm) and verifier recompute
    // via THIS function, so the bytes match. Missing this branch would fall
    // through to the erc20 shape (reads params.token → undefined) and every
    // payment would ecrecover to a SIGNER_MISMATCH.
    return JSON.stringify({
      credentialId: request.credentialId,
      actionType: request.actionType,
      params: {
        asset: request.params.asset,
        payTo: request.params.payTo,
        amount: request.params.amount,
        network: request.params.network,
      },
    })
  }
  // erc20.transfer — byte-identical to the original serialization.
  return JSON.stringify({
    credentialId: request.credentialId,
    actionType: request.actionType,
    params: {
      token: request.params.token,
      to: request.params.to,
      amount: request.params.amount,
    },
  })
}

export function computeStateHash(input: {
  name: string
  credentialId: string
  message: string
  signature: Hex
  credentialRaw: string | null
  revocationRaw: string | null
  resolvedAt: number
}): Hex {
  const tuple = [
    input.name,
    input.credentialId,
    keccak256(stringToBytes(input.message)),
    keccak256(stringToBytes(input.signature)),
    input.credentialRaw ?? "",
    input.revocationRaw ?? "",
    input.resolvedAt,
  ]
  return keccak256(stringToBytes(JSON.stringify(tuple)))
}

export function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
