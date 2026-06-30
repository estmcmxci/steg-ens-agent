/**
 * Unit tests for the Branch-2 handoff-replay payer (ERD §12).
 *
 * Covers parsing the real captured travala_book `next_action` and the fail-closed
 * requirements guard — both pure (no network, no mm, no spend). The live
 * sign+POST path is validated on the Base Sepolia reference seller (ERD §9 leg).
 *
 * Run: bun test scripts/x402-pay.test.ts
 */

import { describe, test, expect } from "bun:test"
import { parseNextAction, assertRequirementsAllowed, type X402Requirement } from "./x402-pay"

// The actual exact-EVM requirement captured from travala_book on 2026-06-30.
const REQ: X402Requirement = {
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  extra: { name: "USD Coin", version: "2" },
  payTo: "0x0617973b64A7cEE9d9a0D66C53f1aecc312BB3ff",
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: "365710000", // 365.71 USDC
  maxTimeoutSeconds: 300,
}

const PAYTO = REQ.payTo.toLowerCase()

// travala_book returns it wrapped in MCP content[].text as a JSON string.
const bookResult = (req: X402Requirement = REQ) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        status: 402,
        next_action: {
          tool: "payments-mcp:make_http_request_with_x402",
          baseURL: "https://payment-mcp.travala.com",
          path: "/m2m-payment/book",
          method: "POST",
          body: { package_id: "CFDTiCVlBdpjSeU0", session_id: "5OFQX3yWVcgS36KN" },
          paymentRequirements: [req],
        },
      }),
    },
  ],
  paymentMade: false,
})

describe("parseNextAction", () => {
  test("extracts the next_action + paymentRequirements from the real shape", () => {
    const na = parseNextAction(bookResult())
    expect(na).not.toBeNull()
    expect(na!.baseURL).toBe("https://payment-mcp.travala.com")
    expect(na!.path).toBe("/m2m-payment/book")
    expect(na!.paymentRequirements[0]!.maxAmountRequired).toBe("365710000")
    expect(na!.paymentRequirements[0]!.asset).toBe(REQ.asset)
  })

  test("returns null when there is no next_action", () => {
    expect(parseNextAction({ content: [{ type: "text", text: '{"status":200,"ok":true}' }] })).toBeNull()
  })

  test("returns null when next_action has no paymentRequirements", () => {
    expect(parseNextAction({ content: [{ type: "text", text: '{"next_action":{"tool":"x","paymentRequirements":[]}}' }] })).toBeNull()
  })
})

describe("assertRequirementsAllowed (fail-closed guard)", () => {
  test("passes the captured Base-USDC exact requirement", () => {
    expect(() => assertRequirementsAllowed(REQ, 400_000_000n, PAYTO)).not.toThrow()
  })

  test("rejects amount over the cap", () => {
    expect(() => assertRequirementsAllowed(REQ, 300_000_000n, PAYTO)).toThrow(/exceeds cap/)
  })

  test("rejects a non-USDC asset", () => {
    expect(() => assertRequirementsAllowed({ ...REQ, asset: "0x000000000000000000000000000000000000dEaD" }, 400_000_000n, PAYTO)).toThrow(/asset/)
  })

  test("rejects a payTo that isn't the pinned recipient", () => {
    expect(() => assertRequirementsAllowed(REQ, 400_000_000n, "0x000000000000000000000000000000000000beef")).toThrow(/payTo/)
  })

  test("rejects a non-Base network", () => {
    expect(() => assertRequirementsAllowed({ ...REQ, network: "eip155:84532" }, 400_000_000n, PAYTO)).toThrow(/network/)
  })

  test("rejects a non-exact scheme", () => {
    expect(() => assertRequirementsAllowed({ ...REQ, scheme: "upto" }, 400_000_000n, PAYTO)).toThrow(/scheme/)
  })

  test("amount exactly at the cap is allowed (boundary)", () => {
    expect(() => assertRequirementsAllowed(REQ, 365_710_000n, PAYTO)).not.toThrow()
  })
})
