/**
 * In-memory mock record store — Milestone 1's stand-in for ENS-backed
 * resolution (Milestone 2 swaps in an adapter with the same RecordSource
 * interface).
 *
 * Records are stored as raw JSON strings keyed by (name, credentialId), and
 * the three record families are kept as separate keyed entries — mirroring
 * the spec's `auth.credential[<id>]` / `auth.capability[<id>]` /
 * `auth.revocation[<id>]` key convention (PRD §10). Revocation is purely
 * presence-based in this store: no entry means not revoked.
 */

import { privateKeyToAccount } from "viem/accounts"
import type {
  CredentialRecord,
  Erc20TransferPolicy,
  RecordSource,
  ResolvedRecords,
  RevocationRecord,
} from "./types"

// Deterministic fixture accounts. Test-only keys, never used onchain.
export const agentAccount = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
)
export const wrongAccount = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000002",
)

export const AGENT_NAME = "agent.eth"
export const TOKEN = "0x1111111111111111111111111111111111111111" as const
export const ALLOWED_RECIPIENT =
  "0x2222222222222222222222222222222222222222" as const
export const OTHER_RECIPIENT =
  "0x3333333333333333333333333333333333333333" as const
export const MAX_AMOUNT = "1000000"

/** Window used by the "windowed" fixture for explicit-clock boundary tests. */
export const WINDOW = { notBefore: 1_000, notAfter: 2_000 } as const

export interface MockStore extends RecordSource {
  /** Flip a credential to revoked — the live allow→deny demo moment. */
  revoke(name: string, credentialId: string, revokedAt?: number): void
  /** Raw escape hatch for tests (e.g. planting malformed records). */
  setRecord(
    name: string,
    credentialId: string,
    kind: keyof ResolvedRecords,
    raw: string | null,
  ): void
}

type Entry = { credential: string | null; policy: string | null; revocation: string | null }

function credential(fields: Partial<CredentialRecord> & { credentialId: string }): string {
  return JSON.stringify({
    schemeId: "ecdsa-secp256k1",
    signer: agentAccount.address,
    notBefore: 0,
    notAfter: 0,
    ...fields,
  } satisfies CredentialRecord)
}

function policy(fields: Partial<Erc20TransferPolicy> & { credentialId: string }): string {
  return JSON.stringify({
    actionType: "erc20.transfer",
    token: TOKEN,
    maxAmount: MAX_AMOUNT,
    allowedRecipient: "*",
    ...fields,
  } satisfies Erc20TransferPolicy)
}

function revocation(credentialId: string, revokedAt: number): string {
  return JSON.stringify({ credentialId, revokedAt } satisfies RevocationRecord)
}

/** Each call returns a fresh, isolated store seeded with the M1 fixtures. */
export function createMockStore(): MockStore {
  const entries = new Map<string, Entry>()
  const key = (name: string, credentialId: string) => `${name}#${credentialId}`

  const seed = (credentialId: string, entry: Partial<Entry>) => {
    entries.set(key(AGENT_NAME, credentialId), {
      credential: null,
      policy: null,
      revocation: null,
      ...entry,
    })
  }

  // Valid: open validity window, wildcard recipient.
  seed("primary", {
    credential: credential({ credentialId: "primary" }),
    policy: policy({ credentialId: "primary" }),
  })

  // Valid credential, recipient-restricted policy.
  seed("restricted", {
    credential: credential({ credentialId: "restricted" }),
    policy: policy({ credentialId: "restricted", allowedRecipient: ALLOWED_RECIPIENT }),
  })

  // Expired long ago (notAfter in 1970).
  seed("expired", {
    credential: credential({ credentialId: "expired", notAfter: 1_000_000 }),
    policy: policy({ credentialId: "expired" }),
  })

  // Revoked: valid window, but a revocation record is present.
  seed("revoked", {
    credential: credential({ credentialId: "revoked" }),
    policy: policy({ credentialId: "revoked" }),
    revocation: revocation("revoked", 1_700_000_000),
  })

  // Revoked AND expired: pins fail-fast precedence (window precedes
  // revocation in the spec ordering, so the deny must be STALE).
  seed("revoked-expired", {
    credential: credential({ credentialId: "revoked-expired", notAfter: 1_000_000 }),
    policy: policy({ credentialId: "revoked-expired" }),
    revocation: revocation("revoked-expired", 1_700_000_000),
  })

  // Malformed credential record (not JSON).
  seed("malformed", {
    credential: "this is not json {{{",
    policy: policy({ credentialId: "malformed" }),
  })

  // Well-formed credential carrying a scheme the demo verifier doesn't support.
  seed("unsupported-scheme", {
    credential: credential({ credentialId: "unsupported-scheme", schemeId: "eddsa-ed25519" }),
    policy: policy({ credentialId: "unsupported-scheme" }),
  })

  // Bounded validity window for explicit-clock boundary tests.
  seed("windowed", {
    credential: credential({ credentialId: "windowed", ...WINDOW }),
    policy: policy({ credentialId: "windowed" }),
  })

  return {
    async resolveRecords(name, credentialId): Promise<ResolvedRecords> {
      const entry = entries.get(key(name, credentialId))
      return entry
        ? { ...entry }
        : { credential: null, policy: null, revocation: null }
    },
    revoke(name, credentialId, revokedAt = Math.floor(Date.now() / 1000)) {
      const entry = entries.get(key(name, credentialId))
      if (entry) entry.revocation = revocation(credentialId, revokedAt)
    },
    setRecord(name, credentialId, kind, raw) {
      const k = key(name, credentialId)
      const entry = entries.get(k) ?? { credential: null, policy: null, revocation: null }
      entry[kind] = raw
      entries.set(k, entry)
    },
  }
}
