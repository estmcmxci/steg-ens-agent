/**
 * Shared demo request builder.
 *
 * The signer (sign-with-mm.ts) and the evaluator (demo-mm.ts) MUST construct
 * byte-identical requests, or the verifier's recomputed message won't match the
 * signed one. Both import this single source of truth.
 *
 * Defaults are aligned with scripts/publish-records.ts's default policy
 * (token 0x1111…, maxAmount 1_000_000, allowedRecipient "*") so a freshly
 * published credential evaluates to OK before any revocation.
 */

import type { Erc20TransferRequest } from "../src/types"

export function buildDemoRequest(): Erc20TransferRequest {
  return {
    credentialId: process.env.CREDENTIAL_ID || "primary",
    actionType: "erc20.transfer",
    params: {
      token: (process.env.TOKEN || "0x1111111111111111111111111111111111111111") as `0x${string}`,
      to: (process.env.TO || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8") as `0x${string}`,
      amount: process.env.AMOUNT || "1000",
    },
  }
}
