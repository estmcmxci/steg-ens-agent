# ERD: MetaMask Agent Wallet → x402 Payment Client

| | |
|---|---|
| **Status** | Draft v2 — fact-checked vs codebase + live sources (2026-06-29); §9 network strategy pending sign-off |
| **Author** | estmcmxci |
| **Date** | 2026-06-29 |
| **Effort** | High-level / comprehensive |
| **Architecture** | A — MetaMask `walletAccount` + `@x402/mcp` client driver (confirmed) |

---

## 1. Objective

Turn the **MetaMask Agent Wallet (`mm` CLI)** from a *signer-only* wallet into a first-class **x402 payment client**, so an agent holding an `mm` wallet can autonomously pay x402-gated services. Proven end-to-end by booking a real hotel through **Travala's MCP** with USDC on Base.

Three objectives, in sequence:

1. **Shim + upstream contribution.** *(1a)* Build the MetaMask-signed x402 payer that works today (a reusable TS library + CLI harness), proven against the live Travala MCP. *(1b)* Then land a **docs/skill workflow PR to the public `MetaMask/agent-skills`** repo, plus a **feature request for a native `mm x402` command**.
2. **Productize into steg.** Extend the shim into a native **plugin/tool inside our steg agent wallet** (`/Users/oakgroup/metamask`), so steg's own agent can pay x402 sellers behind its authority gate.
3. **(Umbrella)** A reusable x402 payer for *any* EVM "exact" / USDC-on-Base seller — not Travala-specific. (Validated by success criterion **S2**, not a dedicated phase.)

---

## 2. Background & problem statement

- **x402** (Coinbase, Apache-2.0, `github.com/coinbase/x402`) is an HTTP-native payment protocol. The relevant scheme is **"exact" on EVM**: the buyer signs an **EIP-3009 `transferWithAuthorization`** (gasless USDC) as **EIP-712 typed data**; a facilitator settles it on-chain. The payment payload is base64-encoded JSON. Over plain HTTP (x402 **v2**) it travels in the **`PAYMENT-SIGNATURE`** header — renamed from `X-PAYMENT` in v1 — with settlement results in `PAYMENT-RESPONSE`. Over the **MCP transport used here**, the payload rides in MCP's `_meta` field (`_meta["x402/payment"]`, response `_meta["x402/payment-response"]`) rather than an HTTP header.
- **Travala** ships a live x402 *seller* as an MCP server (`https://travel-mcp.travala.com/mcp`): "AI travel agent for hotel booking with USDC payments via x402 on Base." It is *reported* to be an **ERC-8004** agent (`agent_id 50920`, Base `chain_id 8453`) — but this identity is **UNVERIFIED**: no live endpoint exposes it (MCP `serverInfo`, the A2A `agent-card.json`, and all `/.well-known` metadata advertise only an A2A + x402 hotel-booking agent), and no on-chain ERC-8004 registry record has been cited on Base (note our own ERC-8004 registry/adapter target Ethereum mainnet, `chain_id 1`). *TODO: cite a Base explorer/tx for `agent_id 50920`, or drop the claim.*
- **MetaMask `mm` CLI** has the signing primitives (`mm wallet sign-typed-data`, `transfer`, `send-transaction` on Base) **but no native x402 client** — confirmed against the official command reference (`docs.metamask.io/agent-wallet/reference/commands/`, zero `x402`/`payment` references). Latest published CLI is **v3.1.1** (npm `latest`); the version installed and used in this repo is the pinned **2.0.0** (see §10/§11).
- **The gap is narrow:** MetaMask already owns the hard part (the signer). The missing piece is the x402 *client* glue (challenge parse → EIP-3009 build → sign → attach payment (`PAYMENT-SIGNATURE` / MCP `_meta`) → replay), all of which `coinbase/x402` already implements under Apache-2.0.

---

## 3. Goals / Non-goals

### Goals
- A reusable **`MetaMaskSigner`** (viem-style account) whose `signTypedData` is backed by `mm wallet sign-typed-data`, supporting **both** server-wallet (async/`pollingId`) and BYOK (`MM_PASSWORD`, immediate) modes.
- An **x402 client driver** that completes a paid MCP tool call against Travala using that signer.
- A **CLI harness** that demonstrates a real booking (the proof artifact).
- **Upstream:** a workflow/skill PR to `MetaMask/agent-skills` + a native-command feature request.
- **Steg:** a Python `@function_tool` (`x402_pay_*`) that invokes the TS payer behind `gate_or_refusal()`.

### Non-goals (this effort)
- A native `mm x402` subcommand (CLI binary repo is **private** — see §10). That's a *downstream outcome* of the feature request, not a deliverable here.
- The **seller/server** side of x402 (we are strictly the buyer).
- Non-EVM schemes (SVM/Aptos/etc.), the "upto" scheme, or chains other than **Base / USDC**.
- Replacing steg's existing wallet, gate, or provision flows.

---

## 4. Success criteria

1. **S1 — Real booking.** An agent with an `mm` wallet completes a Travala booking: OAuth → search → confirm → `402` → sign via `mm` → attach payment (MCP `_meta` / `PAYMENT-SIGNATURE`) → confirmation, with an on-chain USDC settlement on Base.
2. **S2 — Reusable.** The same payer pays a *second* x402 EVM "exact" seller (or the x402 reference server) with no Travala-specific code.
3. **S3 — Zero CLI fork.** No changes to the closed `mm` binary; we wrap it.
4. **S4 — Upstream landed.** PR opened to `MetaMask/agent-skills` and a feature request filed.
5. **S5 — Steg integration.** Steg's agent can invoke `x402_pay_execute` behind the authority gate (Phase 3).

---

## 5. Key findings (evidence base)

| Probe | Finding | Consequence |
|---|---|---|
| `grep coinbase/x402` for `make_http_request_with_x402` | **0 results** | Travala's recommended payer is a *proprietary* Coinbase "payments-mcp" — not reusable. We build the open equivalent. |
| `@x402/mcp` README | `createx402MCPClient({ schemes:[{network, client: new ExactEvmScheme(walletAccount)}], autoPayment, onPaymentRequested })` | **Open client-side auto-payer exists.** Signer seam = `walletAccount` → `ExactEvmScheme`. |
| `travala_search_hotel` (live) | Works **unauthenticated**; returns `sessionId` + `packageId`s | Discovery is open. |
| `travala_book` (live) | **HTTP 401**, `www-authenticate: Bearer` | Payment is **OAuth-gated**; the real `402`/`next_action` is behind login. |
| `.well-known/oauth-*` | OAuth 2.0: `/oauth/register` (dynamic), `authorization_code`+PKCE+`refresh_token`+`client_credentials`; scopes `mcp:read` / `mcp:book` / `mcp:cancel` | The driver must do the **MCP OAuth handshake** before payment. |
| Steg `scripts/sign-with-mm.ts` | Self-described "mm signer adapter — the one new integration point"; shells `mm wallet sign-message ... --json`, parses `{ ok, data }`, version-tolerant sig extraction | **Proven `mm`-signing template** to reuse, swapping `sign-message` → `sign-typed-data`. |
| Steg architecture map | TS worker/frontend/scripts (Bun) + **Python brain** (openai-agents, 66 `@function_tool`s, 59 registered in `all_tools` (writes.py's 7 intentionally unregistered)); brain already shells both `mm` and `bun scripts/*.ts`; cloud = server-wallet headless (no password), local = BYOK | x402 payer = **TS core invoked by Python brain via subprocess** — reuses an existing seam. |

---

## 6. Architecture (A)

We are the **MCP client**. Our code connects to the seller's MCP, performs OAuth, and lets `@x402/mcp` handle the 402 by signing with our MetaMask-backed `walletAccount`.

```
                         ┌─────────────────────────────────────────────┐
                         │  x402-metamask payer  (TypeScript / Bun)     │
                         │                                              │
  Travala MCP  ◀────────▶│  createx402MCPClient  (@x402/mcp)            │
  (OAuth +    MCP/SSE    │    ├─ OAuth handshake (@modelcontextprotocol)│
   402 seller)           │    ├─ ExactEvmScheme (@x402/evm)             │
                         │    │     builds EIP-3009 transferWithAuth    │
                         │    └─ onPaymentRequested → confirm hook      │
                         │              │                               │
                         │      ┌───────▼─────────┐                     │
                         │      │ MetaMaskSigner   │  (viem-style acct) │
                         │      │  .address        │──▶ mm wallet address│
                         │      │  .signTypedData  │──▶ mm wallet        │
                         │      └──────────────────┘     sign-typed-data │
                         └──────────────────────────────────│──────────┘
                                                             ▼
                                                   USDC settlement on Base
   Consumers:
     • Phase 1: CLI harness  (bun scripts/x402-pay.ts)        ← proof
     • Phase 3: steg Python tool  x402_pay_execute → bun script ← productized
     • Optional: local buyer-side MCP façade (still the BUYER, not a seller)
```

### Why Architecture A (vs building a payments-MCP server)
- **Least new code** — reuse `@x402/mcp` + `@x402/evm`; we own only the signer + OAuth glue.
- **It IS the Phase-3 artifact** — a client-driver library embeds directly into steg.
- Building a `make_http_request_with_x402` server would mean reverse-engineering a *proprietary, unknown* schema — more code, more risk.

---

## 7. Detailed design

### 7.1 `MetaMaskSigner` (the one integration point)
A viem-compatible account object consumed by `ExactEvmScheme`:

- **`address`** ← `mm wallet address --json` (parsed once, cached).
- **`signTypedData(typedData)`** ← shells `mm wallet sign-typed-data` with the EIP-712 payload, returns the `0x…` signature.
- **Output parsing** reuses the proven extractor from `scripts/sign-with-mm.ts:49-69` (`{ ok, data }`, keys `signature|sig|signedMessage|result`, deep-scan fallback).
- **Mode handling (both):**
  - *BYOK* (local): `MM_PASSWORD` in env → immediate signature.
  - *Server-wallet* (steg cloud, "beast", no password): sign may return a **`pollingId`** → poll via `mm wallet requests watch --polling-id <id>` or pass `--wait`. The signer auto-detects and blocks until the signature resolves.
- **Template:** copy `scripts/sign-with-mm.ts`, swap `mm wallet sign-message` → `mm wallet sign-typed-data`, feed typed data from `ExactEvmScheme` instead of `serializeRequest`.
- **Confirmed (CLI 2.0.0):** `mm wallet sign-typed-data --chain-id <id> --payload '<EIP-712 JSON: domain,types,primaryType,message>' [--wait] [--password <pw>] [--intent <text>] [--json]`. `--payload` is the typed-data JSON flag; `--wait` blocks in **server-wallet** mode (BYOK returns immediately) — exactly matching the `pollingId`/`--wait` handling above. (Verified via `--help` on the installed 2.0.0; behavioural parity to 3.x not yet exercised.)

### 7.2 x402 client driver
- Uses `createx402MCPClient` with `schemes: [{ network: "eip155:8453" (or 84532 testnet), client: new ExactEvmScheme(metamaskAccount) }]`, `autoPayment: true`, and an `onPaymentRequested` confirm hook (logs amount/recipient; returns false to abort). **Note:** `name` and `version` are **required** by `x402MCPClientConfig` (e.g. `name: 'x402-metamask', version: '0.1.0'`), and `ExactEvmScheme` imports from the subpath `@x402/evm/exact/client`.
- Drives the tool sequence: `travala_search_hotel` → (optional `travala_search_package`) → `travala_book`.

### 7.3 Travala OAuth
- Implement the MCP OAuth 2.0 client flow: dynamic registration (`/oauth/register`), `authorization_code` + **PKCE**, store `refresh_token`. Request scopes `mcp:read mcp:book`.
- Prefer the MCP SDK's built-in OAuth provider if it satisfies Travala's metadata; else a thin manual flow.

### 7.4 The 402-shape contingency (resolved in Phase 0)
Because `make_http_request_with_x402` is proprietary and Travala's docs mention a `next_action` object, we must confirm whether Travala emits **standard x402-over-MCP** (auto-intercepted by `createx402MCPClient`) or a **custom `next_action` handoff**:
- **Branch 1 (standard):** `createx402MCPClient` auto-pays. Minimal code.
- **Branch 2 (custom handoff):** Travala may route payment through a proprietary path — Coinbase's Agentic-Wallet MCP / a `payment_handle` token, possibly with an **ERC-7715 session-key** grant and a mandatory human final-approval — rather than a standard x402 402. In that case we parse the handoff, sign via our `MetaMaskSigner` (EIP-3009, or an ERC-7715 grant if required), set `PAYMENT-SIGNATURE` / the MCP `_meta["x402/payment"]` key, and replay the request ourselves.
- Either branch reuses `MetaMaskSigner` + `@x402/evm` — only the plumbing differs.

### 7.5 Packaging
- TS package/dir (e.g. `x402-pay/` or under `scripts/`), Bun runtime, ESM (matches steg).
- Entry: `bun scripts/x402-pay.ts <args>` — the Python brain and the CLI proof both invoke this.

---

## 8. Phasing & workplan

### Phase 0 — Spike (decisive, cheap)
- Complete Travala OAuth; capture **one real authenticated `402`/`next_action`** payload — **read-only, do NOT settle (zero spend).**
- Confirm Branch 1 vs Branch 2 (§7.4) — incl. whether Travala uses a Coinbase `payment_handle` / ERC-7715 handoff.
- Determine whether Travala permits **headless** completion or mandates an interactive human final-approval (ERC-7715 session-key) — this gates whether the server-wallet/cloud path (S5) can book at all.
- ~~Confirm `mm wallet sign-typed-data` flags.~~ **Done** (confirmed on the pinned 2.0.0 — see §7.1); Phase 0 now only needs to exercise one real signature end-to-end.
- **Exit:** the real 402 contract + whether headless booking is possible are known.

### Phase 1 — Shim + proof (Objective 1a)
- Implement `MetaMaskSigner` (both modes) + the driver.
- CLI harness completes a booking — first the **testnet plumbing leg** (x402 reference seller on Base Sepolia, no real funds; also the S2 artifact), then the **one-shot mainnet Travala booking** (real USDC). Validate per the **§9** network-strategy decision.
- **Exit:** S1, S2, S3.

### Phase 2 — Upstream (Objective 1b)
- Workflow/skill PR to **`MetaMask/agent-skills`**: an `x402-pay` workflow + routing-table row documenting paying x402 sellers via `mm sign-typed-data`.
- **Feature request** for native `mm x402`, with the shim as reference implementation.
- **Exit:** S4.

### Phase 3 — Steg plugin (Objective 2)
- Add `x402_pay_preview` / `x402_pay_execute` `@function_tool`s in **`brain/app/tools/actions.py`** (after `transfer_execute`), registered in `brain/app/tools/__init__.py` `action_tools`.
- `x402_pay_execute` calls **`gate_or_refusal()` first** (authority gate), then shells `bun scripts/x402-pay.ts` — mirroring the existing `gate → bun scripts/demo-mm.ts` pattern.
- Add `x402.payment` to the gate policy namespace (`gate.py` / ENS `auth.capability`).
- **Exit:** S5.

---

## 9. Decisions (grounded by investigation)

| Decision | Choice | Rationale |
|---|---|---|
| **Form factor** | Architecture A: `walletAccount` lib + CLI harness; optional buyer-side MCP façade | §6; least code, reusable, = Phase-3 artifact. |
| **Language/runtime** | **TypeScript / Bun / ESM** for the payer core; **Python tool wrapper** in the brain | `createx402MCPClient`/`@x402/evm`/`viem` are TS; steg already shells `bun scripts/*.ts` from the Python brain; `viem` already a dep. |
| **Wallet mode** | **Both / auto-detect** | Steg cloud = server-wallet headless (`pollingId`/`--wait`); local = BYOK (`MM_PASSWORD`). |

### Open decision (needs sign-off)
- **Network/validation strategy.** ⚠️ **Correction:** Travala has **no testnet** (the earlier "Travala supports test env" was unverified and is contradicted by Travala's own docs — its MCP is mainnet-only, real USDC). **Recommended (corrected, staged):**
  1. **Read-only mainnet 402 capture (zero spend)** — Phase 0: complete OAuth, drive search→book to the 402, capture one real authenticated `402`/`next_action` *without settling* → decides Branch 1 (standard x402-over-MCP) vs Branch 2 (Coinbase `payment_handle` / ERC-7715 handoff), and whether headless booking is even allowed.
  2. **Testnet plumbing proof (Base Sepolia 84532, no real funds)** — prove `MetaMaskSigner.signTypedData`→EIP-3009→payment→200 against the **x402 reference / self-hosted exact-EVM seller** (test USDC `0x036CbD…`), in **both** BYOK and server-wallet/`pollingId` modes. Validates the signer+plumbing (NOT Travala); doubles as the **S2** reusability artifact.
  3. **Mainnet Travala proof (Base 8453, real USDC)** — one real booking on the cheapest **free-cancellation** inventory; capture tx hash + confirmation; cancel for refund where terms allow. The only true Travala validation, unavoidably mainnet.
  Rejected: **mainnet-only** (wastes the free signer de-risk lane) and **testnet-only** (cannot satisfy S1's real-booking proof).

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Travala uses proprietary `next_action`, not standard x402-over-MCP | Med | Phase 0 capture decides Branch 1/2; both reuse our signer. |
| `mm wallet sign-typed-data` flag/output drift across versions | Med | Reuse version-tolerant parser; confirm flags in Phase 0; pin/note CLI version. |
| **CLI binary repo is private** (`MetaMask/agentic` 404s authed + anon) — cannot PR a native command | High (for objective scope) | Native command reframed as a *feature request*; ship via skill PR to public `MetaMask/agent-skills`. |
| Steg pins `agentic-cli@2.0.0` (Dockerfile:31); npm latest 3.1.1 | Low | **Confirmed:** `mm wallet sign-typed-data` exists on the pinned 2.0.0 (verified via `--help`) and in the 3.x docs. Residual risk is only flag/output drift — reuse the version-tolerant parser; behavioural parity (real signature output) not yet exercised. |
| Server-wallet headless signing needs human approval in some policies | Med | Use `--wait`/poll; confirm "beast" trading-mode permits headless typed-data signing. |
| Real USDC spent on a live booking; cancellation policy | Med | Testnet-first de-risks the **signer/plumbing** (vs the x402 reference server — Travala has no testnet); for the Travala spend, pick the cheapest **free-cancellation** inventory (not the ~$454 ibis example) and cancel for refund; one-shot mainnet proof only. |
| **Travala may mandate human final-approval** (ERC-7715 session-key "firewall") | High | A fully headless server-wallet agent may be unable to book without an interactive step — threatens S1 + server-wallet mode (S5). Confirm in Phase 0; if headless can't complete, scope S1 to the BYOK/interactive path and document the limitation. |
| EIP-712 domain differs per network (USDC `verifyingContract`/`chainId`/name/version) | Med | Re-derive the EIP-3009 domain per network; a sig valid on Base Sepolia test USDC can be rejected on Base mainnet USDC — verify the mainnet USDC domain explicitly before the one-shot booking. |
| OAuth dynamic registration / token storage security | Med | PKCE; store refresh token as a secret (Railway/`.dev.vars`), never log. |

---

## 11. Dependencies
- npm: `@x402/mcp`, `@x402/core`, `@x402/evm`, `@modelcontextprotocol/sdk`, `viem` (already present).
- `@metamask/agentic-cli` (v3.x target; steg pins 2.0.0 — see risk).
- Travala MCP endpoint + an OAuth-capable Travala account.
- Funded `mm` wallet: USDC on Base (mainnet) and/or Base Sepolia.

---

## 12. Testing & validation
- **Unit:** `MetaMaskSigner.signTypedData` against a known EIP-3009 vector; parser against sample `mm` outputs (both modes).
- **Integration (testnet):** full x402 *exact* flow against the **x402 reference / self-hosted exact-EVM seller** on Base Sepolia (Travala has **no** testnet — this validates the signer + plumbing, not Travala).
- **E2E (mainnet):** one real booking (per §9 decision) — capture tx hash + confirmation.
- **Reusability:** repeat against the x402 reference server / a second seller (S2).
- **Steg:** `x402_pay_execute` denied when gate refuses; succeeds when authorized.

---

## 13. Deliverables
1. `MetaMaskSigner` + x402 driver (TS) and `scripts/x402-pay.ts` CLI harness.
2. Proof: a real Travala booking (tx hash + confirmation).
3. `MetaMask/agent-skills` workflow/skill PR + native-command feature request.
4. Steg `x402_pay_*` tools wired behind the authority gate.

---

## 14. Appendix — key references

**coinbase/x402 (Apache-2.0):**
- Spec: `specs/schemes/exact/scheme_exact_evm.md`, `specs/transports-v2/mcp.md`
- Signer seam: `typescript/packages/mechanisms/evm/src/signer.ts`
- EIP-3009 client: `typescript/packages/mechanisms/evm/src/exact/client/eip3009.ts`
- MCP client: `typescript/packages/mcp/src/client/x402MCPClient.ts`

**Steg (this repo):**
- Signer template: `scripts/sign-with-mm.ts` (call shape `:35`, parser `:49-69`)
- mm subprocess helper: `brain/app/tools/wallet.py:_mm()`
- Agent definition: `brain/app/agent.py` (`ens_agent`); run loop = `Runner.run_streamed(ens_agent, …)` in `brain/app/server.py`; tools: `brain/app/tools/__init__.py`, `actions.py`
- Authority gate: `brain/app/gate.py:gate_or_refusal()` → `evaluate_action()` shells `bun scripts/demo-mm.ts` → worker `/evaluate`
- Provision flow: `brain/app/provision_routes.py:245-372`
- CLI pin: `Dockerfile:31` (`@metamask/agentic-cli@2.0.0`; npm latest 3.1.1)

**Travala MCP:**
- Endpoint: `https://travel-mcp.travala.com/mcp` (streamable-http, stateless)
- OAuth: `/.well-known/oauth-protected-resource`, `/oauth/{register,authorize,token}`; scopes `mcp:read|book|cancel`
- Tools: `travala_search_hotel`, `travala_search_package`, `travala_book`, `travala_book_status`, `travala_manage_bookings`, `travala_cancel_booking`, `travala_whoami`, `travala_logout`
