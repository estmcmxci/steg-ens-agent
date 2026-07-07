/**
 * Unit tests for the mm x402 signer adapter (ERD §12).
 *
 * Covers the pure, mm-free paths: BigInt-safe serialization (§15.7 #6), the
 * fail-closed pre-sign guard (§15.7 #5), and tolerant signature extraction.
 * The live TEE signing path (mm wallet sign-typed-data --wait) is exercised by
 * the §15 Step 6 integration check, not here.
 *
 * Run: bun test scripts/mm-x402-account.test.ts
 */

import { describe, test, expect } from "bun:test"
import {
  serializeTypedData,
  assertAllowed,
  extractSignature,
  BASE_USDC,
  BASE_MAINNET_CHAIN_ID,
  type Eip712TypedData,
  type PaymentGuard,
} from "./mm-x402-account"

const SIGNER = "0x1111111111111111111111111111111111111111" as const
const FACILITATOR = "0x0000000000000000000000000000000000000abc" as const

const guard: PaymentGuard = {
  maxValue: 10_000_000n, // $10 USDC (6 decimals)
  verifyingContract: BASE_USDC,
  chainId: BASE_MAINNET_CHAIN_ID,
  allowedTo: [FACILITATOR],
}

/** A realistic EIP-3009 TransferWithAuthorization on Base mainnet USDC, with
 *  bigint message fields (the shape ExactEvmScheme produces). */
function eip3009(
  message: Partial<Record<string, unknown>> = {},
  domain: Partial<Record<string, unknown>> = {},
): Eip712TypedData {
  return {
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC, ...domain },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: SIGNER,
      to: FACILITATOR,
      value: 5_000_000n, // $5
      validAfter: 0n,
      validBefore: 1_999_999_999n,
      nonce: "0x" + "11".repeat(32),
      ...message,
    },
  }
}

describe("serializeTypedData (§15.7 #6 — BigInt regression)", () => {
  test("does not throw on bigint fields and emits decimal strings", () => {
    const td = eip3009()
    let json = ""
    expect(() => {
      json = serializeTypedData(td)
    }).not.toThrow()
    const round = JSON.parse(json)
    expect(round.message.value).toBe("5000000")
    expect(round.message.validAfter).toBe("0")
    expect(round.message.validBefore).toBe("1999999999")
    // sanity: a raw JSON.stringify WOULD throw on the same input
    expect(() => JSON.stringify(td)).toThrow()
  })

  test("preserves non-bigint fields verbatim", () => {
    const round = JSON.parse(serializeTypedData(eip3009()))
    expect(round.domain.verifyingContract).toBe(BASE_USDC)
    expect(round.domain.chainId).toBe(8453)
    expect(round.primaryType).toBe("TransferWithAuthorization")
    expect(round.message.nonce).toBe("0x" + "11".repeat(32))
  })
})

describe("assertAllowed (§15.7 #5 — fail-closed spend guard)", () => {
  test("passes a valid in-policy payment", () => {
    expect(() => assertAllowed(eip3009(), guard)).not.toThrow()
  })

  test("rejects value over the cap", () => {
    expect(() => assertAllowed(eip3009({ value: 50_000_000n }), guard)).toThrow(/exceeds cap/)
  })

  test("rejects a wrong token (verifyingContract)", () => {
    const td = eip3009({}, { verifyingContract: "0x0000000000000000000000000000000000000bad" })
    expect(() => assertAllowed(td, guard)).toThrow(/verifyingContract/)
  })

  test("rejects a wrong chain id", () => {
    const td = eip3009({}, { chainId: 84532 })
    expect(() => assertAllowed(td, guard)).toThrow(/chainId/)
  })

  test("rejects a recipient not on the allowlist", () => {
    const td = eip3009({ to: "0x000000000000000000000000000000000000dEaD" })
    expect(() => assertAllowed(td, guard)).toThrow(/allowlist/)
  })

  test("value exactly at the cap is allowed (boundary)", () => {
    expect(() => assertAllowed(eip3009({ value: guard.maxValue }), guard)).not.toThrow()
  })

  test("checks are case-insensitive on addresses", () => {
    const td = eip3009({ to: FACILITATOR.toUpperCase().replace("0X", "0x") }, { verifyingContract: BASE_USDC.toLowerCase() })
    expect(() => assertAllowed(td, guard)).not.toThrow()
  })
})

describe("extractSignature", () => {
  const SIG = ("0x" + "ab".repeat(65)) as `0x${string}` // 65 bytes

  test("finds a signature under the canonical key", () => {
    expect(extractSignature({ ok: true, data: { signature: SIG } })).toBe(SIG)
  })

  test("deep-scans nested envelopes", () => {
    expect(extractSignature({ ok: true, data: { result: { inner: SIG } } })).toBe(SIG)
  })

  test("returns null on an error envelope", () => {
    expect(extractSignature({ ok: false })).toBeNull()
  })

  test("returns null when there is only a pollingId (no signature)", () => {
    expect(extractSignature({ ok: true, data: { pollingId: "abc-123" } })).toBeNull()
  })
})
