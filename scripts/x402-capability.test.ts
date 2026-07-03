/**
 * Unit tests for the x402.payment authority capability (ERD Arc 3 Step 3).
 *
 * Covers the pure verifier logic added for the new actionType: canonical
 * serialization (must be distinct from erc20.transfer or sigs mismatch),
 * boundary shape validation, policy decode, and the two-tier checkPolicy
 * (agent Tier-2 + fleet Tier-1). The live sign -> /evaluate round-trip is the
 * wrangler-dev integration check, not here.
 *
 * Run: bun test scripts/x402-capability.test.ts
 */

import { describe, test, expect } from "bun:test"
import { serializeRequest } from "../src/hash"
import { isActionRequest, decodePolicy } from "../src/schema"
import { checkPolicy } from "../src/checkPolicy"
import { evaluateAction } from "../src/evaluateAction"
import { createMockStore, agentAccount, wrongAccount, AGENT_NAME } from "../src/mockStore"
import type { MockStore } from "../src/mockStore"
import type { X402PaymentRequest, X402PaymentPolicy, FleetEnvelope } from "../src/types"

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const PAYTO = "0x6d6E695b09861467c7d462f5AAF31cF3540B9192"
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
const NET = "eip155:8453"

const req = (over: Partial<X402PaymentRequest["params"]> = {}): X402PaymentRequest => ({
  credentialId: "x402-payment",
  actionType: "x402.payment",
  params: { asset: USDC, payTo: PAYTO, amount: "7000", network: NET, ...over },
})

const policyJson = (over: Partial<X402PaymentPolicy> = {}): string =>
  JSON.stringify({
    credentialId: "x402-payment",
    actionType: "x402.payment",
    asset: USDC,
    maxAmount: "1000000",
    allowedPayTo: "*",
    ...over,
  })

describe("serializeRequest(x402.payment)", () => {
  test("canonical field order, no whitespace", () => {
    expect(serializeRequest(req())).toBe(
      `{"credentialId":"x402-payment","actionType":"x402.payment","params":{"asset":"${USDC}","payTo":"${PAYTO}","amount":"7000","network":"${NET}"}}`,
    )
  })

  test("distinct from an erc20.transfer with the same values (no cross-type collision)", () => {
    const erc20 = serializeRequest({
      credentialId: "x402-payment",
      actionType: "erc20.transfer",
      params: { asset: USDC, payTo: PAYTO, amount: "7000" } as never,
    } as never)
    expect(serializeRequest(req())).not.toBe(erc20)
  })
})

describe("isActionRequest(x402.payment)", () => {
  test("accepts a well-formed request", () => {
    expect(isActionRequest(req())).toBe(true)
  })
  test("rejects a bad asset address", () => {
    expect(isActionRequest(req({ asset: "0xnothex" as never }))).toBe(false)
  })
  test("rejects a non-integer amount", () => {
    expect(isActionRequest(req({ amount: "7.0" }))).toBe(false)
  })
  test("rejects a non-CAIP-2 network", () => {
    expect(isActionRequest(req({ network: "8453" }))).toBe(false)
  })
})

describe("decodePolicy(x402.payment)", () => {
  test("decodes a valid policy", () => {
    const p = decodePolicy(policyJson())
    expect(p).not.toBeNull()
    expect(p?.actionType).toBe("x402.payment")
  })
  test("decodes with an optional network pin", () => {
    expect(decodePolicy(policyJson({ network: NET }))).not.toBeNull()
  })
  test("rejects a bad maxAmount", () => {
    expect(decodePolicy(policyJson({ maxAmount: "lots" as never }))).toBeNull()
  })
  test("rejects a malformed network pin", () => {
    expect(decodePolicy(policyJson({ network: "mainnet" }))).toBeNull()
  })
})

describe("checkPolicy(x402.payment) — Tier-2 agent policy", () => {
  test("allows a payment within the capability", () => {
    expect(checkPolicy(req(), policyJson())).toEqual({ allowed: true, reason: "OK" })
  })

  test("denies AMOUNT_EXCEEDED over the cap", () => {
    const r = checkPolicy(req({ amount: "2000000" }), policyJson({ maxAmount: "1000000" }))
    expect(r).toMatchObject({ allowed: false, reason: "POLICY_DENIED", detail: "AMOUNT_EXCEEDED" })
  })

  test("denies RECIPIENT_NOT_ALLOWED when payTo is off the allow-list", () => {
    const r = checkPolicy(req(), policyJson({ allowedPayTo: OTHER }))
    expect(r).toMatchObject({ allowed: false, detail: "RECIPIENT_NOT_ALLOWED" })
  })

  test("allows when payTo matches a pinned recipient (case-insensitive)", () => {
    const r = checkPolicy(req({ payTo: PAYTO.toLowerCase() as never }), policyJson({ allowedPayTo: PAYTO }))
    expect(r.allowed).toBe(true)
  })

  test("denies ACTION_NOT_ALLOWED on a wrong asset", () => {
    const r = checkPolicy(req({ asset: OTHER as never }), policyJson({ asset: USDC }))
    expect(r).toMatchObject({ allowed: false, detail: "ACTION_NOT_ALLOWED" })
  })

  test("denies ACTION_NOT_ALLOWED when the network pin mismatches", () => {
    const r = checkPolicy(req({ network: "eip155:84532" }), policyJson({ network: NET }))
    expect(r).toMatchObject({ allowed: false, detail: "ACTION_NOT_ALLOWED" })
  })

  test("denies when the on-chain policy is a different actionType (transfer policy, x402 request)", () => {
    const transferPolicy = JSON.stringify({
      credentialId: "x402-payment",
      actionType: "erc20.transfer",
      token: USDC,
      maxAmount: "1000000",
      allowedRecipient: "*",
    })
    expect(checkPolicy(req(), transferPolicy)).toMatchObject({ allowed: false, reason: "POLICY_DENIED" })
  })

  test("denies when no capability is published (null policy) — revocation-style", () => {
    expect(checkPolicy(req(), null)).toMatchObject({ allowed: false, reason: "POLICY_DENIED" })
  })
})

describe("checkPolicy(x402.payment) — Tier-1 fleet envelope", () => {
  const env = (over: Partial<FleetEnvelope> = {}): string =>
    JSON.stringify({
      allowedActionTypes: ["x402.payment"],
      allowedTokens: [USDC],
      allowedRecipients: [PAYTO],
      maxAmount: "10000",
      ...over,
    })

  test("allows within both agent policy AND fleet ceiling", () => {
    expect(checkPolicy(req(), policyJson(), env()).allowed).toBe(true)
  })

  test("fleet ceiling binds even when the agent policy is broader", () => {
    // agent policy allows up to 1_000_000; fleet caps at 10_000; request 50_000.
    const r = checkPolicy(req({ amount: "50000" }), policyJson(), env({ maxAmount: "10000" }))
    expect(r).toMatchObject({ allowed: false, reason: "POLICY_DENIED", scope: "fleet", detail: "AMOUNT_EXCEEDED" })
  })

  test("fleet denies a payTo outside the fleet recipient list", () => {
    const r = checkPolicy(req({ payTo: OTHER as never }), policyJson({ allowedPayTo: "*" }), env({ allowedRecipients: [PAYTO] }))
    expect(r).toMatchObject({ allowed: false, scope: "fleet", detail: "RECIPIENT_NOT_ALLOWED" })
  })

  test("fleet denies an action type it does not permit", () => {
    const r = checkPolicy(req(), policyJson(), env({ allowedActionTypes: ["erc20.transfer"] }))
    expect(r).toMatchObject({ allowed: false, scope: "fleet", detail: "ACTION_NOT_ALLOWED" })
  })

  test("a malformed envelope fails safe (deny)", () => {
    expect(checkPolicy(req(), policyJson(), "{not json").allowed).toBe(false)
  })
})

describe("evaluateAction(x402.payment) — full local path (sign -> verifyAuth -> checkPolicy)", () => {
  const CID = "x402-payment"
  const plant = (store: MockStore, opts: { signer?: string; policy?: string } = {}) => {
    store.setRecord(
      AGENT_NAME, CID, "credential",
      JSON.stringify({ credentialId: CID, schemeId: "ecdsa-secp256k1", signer: opts.signer ?? agentAccount.address, notBefore: 0, notAfter: 0 }),
    )
    store.setRecord(AGENT_NAME, CID, "policy", opts.policy ?? policyJson({ credentialId: CID }))
  }

  test("allows a valid signed payment within the published capability", async () => {
    const request = req()
    const signature = await agentAccount.signMessage({ message: serializeRequest(request) })
    const store = createMockStore()
    plant(store)
    const res = await evaluateAction(AGENT_NAME, request, signature, { source: store })
    expect(res).toMatchObject({ allowed: true, reason: "OK" })
  })

  test("THE THESIS: revoke at ENS -> the SAME signature is now denied REVOKED", async () => {
    const request = req()
    const signature = await agentAccount.signMessage({ message: serializeRequest(request) })
    const store = createMockStore()
    plant(store)
    expect((await evaluateAction(AGENT_NAME, request, signature, { source: store })).allowed).toBe(true)
    store.revoke(AGENT_NAME, CID) // operator revokes payment authority — key untouched
    const after = await evaluateAction(AGENT_NAME, request, signature, { source: store })
    expect(after).toMatchObject({ allowed: false, reason: "REVOKED", layer: "auth" })
  })

  test("a wrong-signer signature is UNVERIFIED/SIGNER_MISMATCH (proves serialize<->recover agreement)", async () => {
    const request = req()
    const badSig = await wrongAccount.signMessage({ message: serializeRequest(request) })
    const store = createMockStore()
    plant(store) // credential signer = agentAccount, but badSig is wrongAccount
    const res = await evaluateAction(AGENT_NAME, request, badSig, { source: store })
    expect(res).toMatchObject({ allowed: false, reason: "UNVERIFIED", detail: "SIGNER_MISMATCH" })
  })

  test("over-cap payment authenticates but is POLICY_DENIED/AMOUNT_EXCEEDED", async () => {
    const request = req({ amount: "2000000" })
    const signature = await agentAccount.signMessage({ message: serializeRequest(request) })
    const store = createMockStore()
    plant(store, { policy: policyJson({ credentialId: CID, maxAmount: "1000000" }) })
    const res = await evaluateAction(AGENT_NAME, request, signature, { source: store })
    expect(res).toMatchObject({ allowed: false, reason: "POLICY_DENIED", layer: "policy", detail: "AMOUNT_EXCEEDED" })
  })
})
