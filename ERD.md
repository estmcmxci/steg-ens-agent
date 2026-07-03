# ERD: MetaMask Agent Wallet → x402 Payment Client

| | |
|---|---|
| **Status** | Draft v3 — **implementation underway.** Phase 0 + Phase 1 build DONE; **§9 Sepolia EXECUTE GREEN (S2, 2026-07-02)**; **MAINNET EXECUTE GREEN (2026-07-03)** — the mm TEE payer settled real USDC on Base mainnet vs an independent seller (**Exa**, tx `0xfb19efdb…00eec8`), gate ✓, exact-amount asserted. Payer = steg's ENS-gated **TEE server-wallet** `agent.steg.eth`. Travala's settlement host went **down** mid-Arc-1 (issue #3) → pivoted the *payer* proof to Exa; **Travala stays the eventual real-product S1** once it recovers. **Arc 2 (S4) PROPOSAL POSTED** → [agent-skills#23](https://github.com/MetaMask/agent-skills/issues/23) (pivoted to the MCP-transport gap; the generic payer was already merged upstream as PR #16). **Arc 3 (S5 steg) STEP 1 DONE 2026-07-03** — brain `x402_pay_{preview,execute}` tools + capstone real settlement via the brain tool (tx `0x7056c04f…082c0`, $0.007 Base USDC, gate ✓). Remaining, **in this order: Arc 3 Step 2 (deploy) → Step 3 (x402.payment capability)**, then contact #23's maintainers (**@AyushBherwani1998**, cc **@basgys**) + open the mcp-mode PR. **Resume → §0.** |
| **Author** | estmcmxci |
| **Date** | 2026-06-29 |
| **Effort** | High-level / comprehensive |
| **Architecture** | A — MetaMask `walletAccount` + `@x402/mcp` client driver (confirmed) |
| **Position in the stack** | Umbrella (implicit): *ENS as operator-revocable authority for AI agents* → **this ERD** (extends the thesis into x402 payments) → nested: **§15** Phase-0 Travala setup runbook |

---

## 0. Current state & next session (resume — read first)

> **Updated 2026-07-03. Branch `feat/x402-mm-payer`.** The thesis + the x402 protocol shape + the **mainnet payer** are all **proven** (mm TEE settled real USDC on Base mainnet vs an independent seller, 2026-07-03). What remains is upstreaming (Arc 2) + the steg integration (Arc 3). No hard unknowns are open for the payer.

**✅ Done**
- **Phase 0** — the TEE server-wallet signs EIP-712 **headlessly** (beast mode; sig recovers — §15 Step 6); OAuth (DCR+PKCE) + **zero-spend 402 capture** (Step 8) → **Branch 2 *benign***: a `next_action` handoff (→ `payment-mcp.travala.com/m2m-payment/book`) wrapping a **standard `exact`-EVM EIP-3009** charge on Base USDC. No ERC-7715 firewall; headless feasible.
- **Phase 1 build** — the handoff-replay payer (`scripts/x402-pay.ts`) + shared OAuth/MCP lib (`scripts/lib/travala-mcp.ts`) + **23/23 unit tests**; **PREVIEW green live** (365.72 USDC → pinned `payTo`, fail-closed guard ✓), zero-spend. EXECUTE wired, gated behind `X402_EXECUTE=1` + a funded wallet.
- **Gate-probe `--wait` fix (2026-07-02)** — `scripts/sign-with-mm.ts` now passes `--wait` to `mm wallet sign-message` (server-wallet mode returned a `pollingId` → gate failed closed). Verified end-to-end: `demo-mm.ts` → deployed worker `/evaluate` → **`allowed:true, reason OK`** (headless TEE sign ~3.8s); tests 23/23.
- **`agent.steg.eth` selected + asserted (2026-07-02)** — the active wallet had been **carlos.steg.eth** (`0xbce7…47ef` — the smoke wallet). Reverse-ENS'd all 11 server wallets: `agent.steg.eth` = **`0x0943142f488fb694141841bf46e17be2bb5c7ee1`** (matches `agent-config.ts` KNOWN_AGENTS). `mm wallet select --address 0x0943…7ee1` done; gate probe re-derived `agent.steg.eth` from reverse-ENS and passed. **Key finding: active-wallet selection is per CLI install (`~/.metamask/wallets.json`), NOT server-side per account** — the Railway brain independently still acts as carlos (demo state untouched). Also: the brain's mm session is **alive** (`railway ssh` → `authenticated:true`), so the earlier "brain token rotated, re-auth needed" note is stale — both CLI tokens coexist validly.

- **§9 Base-Sepolia EXECUTE leg GREEN = S2 (2026-07-02).** Self-hosted reference seller (`scripts/x402-sepolia-seller.ts`, v2 402 → verify/settle via `facilitator.x402.rs` — the old default `x402.org/facilitator` is DEAD, domain moved to Linux Foundation) + buyer harness (`scripts/x402-sepolia-leg.ts`) exercising the identical EXECUTE core: gate probe ✓ → mm TEE signed the value-bearing EIP-3009 headlessly → facilitator verified + settled **on-chain**: 0.01 test USDC, agent 20.00→19.99, payTo +0.01, tx [`0x382492be…44ee9`](https://sepolia.basescan.org/tx/0x382492be5b9ca4dc4438402747601e16d5f16cbeaafa905ed91bf563fac44ee9). Negative test: over-cap challenge refused before signing.
  **Bug found + fixed en route (the leg's purpose):** v2 `ExactEvmScheme.createPaymentPayload` reads `requirements.amount`; the raw Travala wire req carries `maxAmountRequired` → the old `as unknown` cast would have signed `value: undefined` at the mainnet booking. Fix: `toV2Requirements()` in `x402-pay.ts` (wire→v2 normalization, used for both the scheme input and the header's `accepted`), validated live on this leg.
- **MAINNET EXECUTE GREEN — the mm mainnet payer proof (2026-07-03).** With Travala's settlement host down (see Arc 1 below), pivoted the payer proof to a live **independent** seller: **Exa web search** (`api.exa.ai/search`, standard Branch-1 x402-over-HTTP, $0.007 canonical Base USDC). Funded `agent.steg.eth` ~$1.69 Base USDC; `WORKER_URL=https://steg-verifier.estmcmxci.workers.dev X402_EXECUTE=1 bun scripts/x402-exa-leg.ts` → gate ✓ → mm TEE signed EIP-3009 **headlessly** → Exa 200 + on-chain exact-amount asserted (agent −0.007 / Exa +0.007) → real search results returned. **tx [`0xfb19efdb…00eec8`](https://basescan.org/tx/0xfb19efdb5979a67ad55f824a76176809ce321d632e256f163f4951fc1b00eec8)** (Base mainnet, status 0x1, gasless — facilitator paid gas). New harness `scripts/x402-exa-leg.ts` = mainnet twin of the §9 Sepolia leg (same `createMmX402Account`→`ExactEvmScheme` signer core + **accepts-selection** (Exa also lists a Solana rail — don't blind-take `accepts[0]`) + zero-spend **PREVIEW** mode; typecheck-clean, committed **`3be94b7`** on `feat/x402-mm-payer`). ⇒ the mm mainnet payer is proven vs a seller we don't control.

**⏭ NEXT — Arc 3 STEP 1 DONE (brain payer tools + capstone execute green, tx `0x7056c04f…082c0`, 2026-07-03). Next = Arc 3 Step 2 (Railway deploy + gated preview from prod), then Step 3 (x402.payment capability). Arc 2's PR + maintainer contact come AFTER Arc 3.** Arc 1 pivoted + payer-proven; **Arc 2's proposal is already POSTED** (issue [#23](https://github.com/MetaMask/agent-skills/issues/23)). Only **after Arc 3** do we contact the #23 maintainers (**@AyushBherwani1998** primary, cc **@basgys**) and open the mcp-mode PR.

**Arc 1 — mainnet payer proof: ✅ DONE via Exa; Travala = deferred real-product S1.** Arc 1's goal — a real mainnet settlement by the ENS-gated mm TEE wallet — is **met** by the Exa run above. Travala's settlement host `payment-mcp.travala.com` went **down mid-arc** (503 origin outage since 2026-07-02 ~23:56 UTC; **isolated** — Travala search/site stayed 200; Cloudflare edge up, origin unreachable; filed **travala/travel-mcp#3**), which is why we pivoted. **Travala stays the eventual *real-product* S1** — a real hotel booking, the exciting demo — once `payment-mcp` recovers (watch issue #3). The Travala payer `scripts/x402-pay.ts` (handoff-replay) is already built + PREVIEW-green; to resume: re-run its PREVIEW once issue #3 shows a non-5xx / 402, then fund (~$300 free-cancellation float) → `X402_EXECUTE=1` → `travala_cancel_booking` before the deadline (§15 Steps 10–12; never auto-retry a signed payment, §15.7 #11).

> **No hard unknowns block Arc 2/Arc 3.** The one Travala-specific open question (does `payment-mcp.travala.com/m2m-payment/book` accept a headless signed x402 POST vs. a Coinbase session) is moot until Travala recovers and is off the upstream/steg path.

**Arc 2 — upstream to MetaMask (= S4). PROPOSAL POSTED (#23); PR + maintainer contact DEFERRED until AFTER Arc 3.** The generic "mm as an x402 payer" was **already merged upstream** — PR #16 by **@basgys** (2026-06-29): `skills/metamask-agent-wallet/scripts/x402_pay.py`, pure-stdlib, **HTTP-only**. So Arc 2 **pivoted to the MCP-transport gap**: x402 v2 defines **3 transports** (`http`/`mcp`/`a2a`) and PR #16 did HTTP only. **Issue POSTED 2026-07-03 → [MetaMask/agent-skills#23](https://github.com/MetaMask/agent-skills/issues/23)** ("Add the x402 MCP transport to the buyer skill"), state=open, awaiting a maintainer. Full draft + expansion notes at scratchpad `x402-mcp-transport-issue.md`. Argument spine (all browser-verifiable): 1-of-3 transports; **MCP = #2 by npm adoption** (`@x402/mcp`+`x402-mcp` ~8k/mo, ~8× YoY; A2A `a2a-x402` ~115/mo; HTTP ~25× bigger); **multi-party** (Coinbase spec + Cloudflare Agents SDK `mcp/x402.ts` + ethanniser); the **mainnet Exa tx proves the mm signer core** the MCP mode reuses.
   - **AFTER Arc 3 → (a) contact #23's maintainers:** primary = **@AyushBherwani1998** (reviewed + LGTM'd the x402 PR #16, de-facto maintainer — merges most repo PRs); cc **@basgys** ("extends your #16"); senior = **@chaitanyapotti** (gave the 2nd approval + merged #16) — *don't* first-line-tag him. Keep the ping 1–2 sentences (estmcmxci = first-time contributor, `author_association: NONE`). Also fix #23's lost blank line before **Scope:** (it currently renders absorbed into the last bullet).
   - **(b) if greenlit → open the mcp-mode PR:** an `mcp` mode in `x402_pay.py` (accept the tool's `PaymentRequired` → print the b64 payload for the retry's `_meta["x402/payment"]`) + `references/x402.md`/`workflows/x402-pay.md` + conformance tests vs the spec's MCP vectors (`coinbase/x402 specs/transports-v2/mcp.md`). `handoff`/`next_action` = optional follow-up shipping the Travala capture as a **redacted fixture**. Reference signer impl = `scripts/mm-x402-account.ts` + `scripts/x402-exa-leg.ts`.
   - **Field findings still worth citing in the PR:** default `x402.org/facilitator` is **dead** (`facilitator.x402.rs` is live v2); the **v1-wire `maxAmountRequired` vs v2 `amount`** trap (signs `value: undefined` if missed); **accepts-selection** (filter to target network+asset — never blind-take `accepts[0]`); CDP **Bazaar** discovery (`GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, public/no-auth — note it's **100% HTTP-transport**, ~23k resources, MCP not indexed there).

**Arc 3 — steg integration (= S5). STEP 1 DONE 2026-07-03 — the brain is now an x402 payer, behind the gate.** Recommended order (verify → ship → enhance, ascending blast radius): **capstone ✓ → deploy (NEXT) → capability (last)** — reordered from the ERD's original list because capability is the biggest/only-irreversible change and nothing depends on it (the tools work today with the identity-scoped gate).
1. ✅ **DONE 2026-07-03.** `x402_pay_preview` / `x402_pay_execute` `@function_tool`s in `brain/app/tools/actions.py` (execute gated behind `gate_or_refusal()`, mirroring `transfer_execute`), registered in `__init__.py` `action_tools` (**61 tools**, was 59). They shell **`scripts/x402-brain-pay.ts`** — a generic machine-readable (single-JSON-line stdout) x402-over-HTTP payer that generalizes `x402-exa-leg.ts`, reusing the proven core unchanged (`createMmX402Account`→`ExactEvmScheme`, `toV2Requirements`, `gateAllows`, fail-closed guard: asset=Base USDC, domain USD-Coin/2, amount ≤ cap, optional payTo pin). Typecheck-clean; PREVIEW proven live vs Exa (raw script + Python `_x402_run` chain). **CAPSTONE EXECUTE GREEN through the brain tool:** `gate_or_refusal()` ✓ → mm TEE EIP-3009 → Exa 200 → settled **$0.007 Base USDC**, exact −7000/+7000 base-units asserted on-chain (`onchainConfirmed`), tx [`0x7056c04f…082c0`](https://basescan.org/tx/0x7056c04f3414de8f415c629977d458033f4851e33d238a67ffc41959cfe082c0) (status success, block 48158379, gasless — facilitator `0x59b7…e704` paid gas). agent.steg.eth 1.682859 → 1.675859 USDC. ⇒ the steg brain, behind the ENS gate, pays x402 sellers autonomously.
2. **Railway deploy + gated PREVIEW from prod** (← NEXT) — push the tools; prove a **zero-spend** gated preview from the deployed brain vs Exa (Travala still 503, verified 2026-07-03). ⚠️ The deployed brain's active mm wallet is **carlos**, not `agent.steg.eth` — for a *funded* execute from prod it must `mm wallet select` agent.steg.eth (selection is per CLI install, so this won't touch local), or the `x402.payment` capability must be granted to carlos. Preview is wallet-agnostic (zero-spend), so it proves the deployed pipeline regardless.
3. **`x402.payment` capability** (LAST — the honest-claim refinement, biggest change) — a new `actionType` in the verifier (`src/types.ts` + `checkPolicy.ts` + `schema.ts` + `evaluateAction`), worker redeploy, a rework of the gate *probe* (`demo-mm.ts`/`demo-request.ts` to carry the real amount/recipient instead of the fixed `erc20.transfer` placeholder), **and a real on-chain policy record** on `agent.steg.eth`, so the operator can revoke *payment* authority specifically — closes §15.7 #2's honest-claim gap (today the gate is an identity kill-switch, not per-payment authorization).
4. Then: ⏸ **live demo on steg-ens.vercel.app** (held).

**Resume facts:** mainnet payer proof = `WORKER_URL=https://steg-verifier.estmcmxci.workers.dev X402_EXECUTE=1 bun scripts/x402-exa-leg.ts` (PREVIEW by default; overrides `EXA_QUERY` / `X402_MAX` / `X402_EXA_PAYTO`). **GOTCHA (cost an aborted run):** the ENS gate probe (`scripts/lib/ens-gate.ts` → `demo-mm.ts`) defaults to a LOCAL worker `http://127.0.0.1:8787`; you MUST pass `WORKER_URL=https://steg-verifier.estmcmxci.workers.dev` (deployed verifier) or EXECUTE fails `ConnectionRefused` pre-sign. Travala payer `scripts/x402-pay.ts` (handoff-replay; `.travala-oauth.local.json` refresh_token, gitignored, OAuth id `steglabs@gmail.com`) stays ready for Travala's recovery. mm = **TEE server-wallet, beast mode**; local active wallet = **`agent.steg.eth` (`0x0943…7ee1`)**, funded ~**$1.68 USDC** on Base after the Exa run (headroom for re-runs / a 2nd seller); Railway brain's mm session **healthy + independent** (own token, active wallet = carlos — verified 2026-07-02 via `railway ssh`). `outflow_limits_usd.rolling_24h:0` does **not** block EIP-3009 signing (facilitator settles; the sign isn't a metered mm outflow). Deeper detail: §7 (design), §15 (Travala runbook), §15.7 (critic ledger + build status).

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
- A reusable **`MetaMaskSigner`** (viem-style account) whose `signTypedData` is backed by `mm wallet sign-typed-data` on the **TEE server-wallet** (the key never leaves the TEE; signing is async — `pollingId` / `--wait`, no password).
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
| Steg architecture map | TS worker/frontend/scripts (Bun) + **Python brain** (openai-agents, 66 `@function_tool`s, 59 registered in `all_tools` (writes.py's 7 intentionally unregistered)); brain already shells both `mm` and `bun scripts/*.ts`; the agent wallet is a **TEE server-wallet** (headless, no password; key held in the TEE) — local + cloud `mm` both act on that same server-wallet, **no BYOK** | x402 payer = **TS core invoked by Python brain via subprocess** — reuses an existing seam. |

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
- **Signing (TEE server-wallet only — no BYOK):** the key lives in the TEE; `mm wallet sign-typed-data` returns a **`pollingId`**, so the adapter's `signTypedData` passes **`--wait`** (or polls `mm wallet requests watch --polling-id <id>`) and blocks until the TEE returns the signature. No `--password`/`MM_PASSWORD`.
- **Headless requires `beast` trading-mode:** in `guard` mode a policy check can demand **MFA**, which a headless agent can't satisfy — the S5 feasibility gate, tested at §15 Step 6.
- **Template:** copy `scripts/sign-with-mm.ts`, swap `mm wallet sign-message` → `mm wallet sign-typed-data` **and add `--wait`** (the template omits it — it was immediate/synchronous-shaped), feed typed data from `ExactEvmScheme` instead of `serializeRequest`, and BigInt-serialize it (§15.7 #6).
- **Confirmed (CLI 2.0.0):** `mm wallet sign-typed-data --chain-id <id> --payload '<EIP-712 JSON: domain,types,primaryType,message>' [--wait] [--intent <text>] [--json]`. `--payload` is the typed-data JSON flag; for the **TEE server-wallet** the call returns a `pollingId`, so **`--wait` is required** to get the signature back inline (`--password` is BYOK-only — unused here). (Flags verified via `--help` on the installed 2.0.0; that headless typed-data signing actually *resolves* on 2.0.0 is the §15 Step 6 test.)

### 7.2 x402 client driver
- Uses `createx402MCPClient` with `schemes: [{ network: 'eip155:8453' (or 'eip155:84532' on testnet — a CAIP-2 string, NOT bare `84532`), client: new ExactEvmScheme(metamaskAccount) }]`, `autoPayment: true` **for the booking (Phase 1) only** — Phase-0 capture (§15 Step 8) MUST use `autoPayment:false` or it auto-settles real USDC (§15.7 #1) — and an `onPaymentRequested` confirm hook that **fail-closes** on an unexpected amount/recipient (not just logs; §15.7 #5). **Note:** `name` and `version` are **required** by `x402MCPClientConfig` (e.g. `name: 'x402-metamask', version: '0.1.0'`), and `ExactEvmScheme` imports from the subpath `@x402/evm/exact/client`.
- Drives the tool sequence: `travala_search_hotel` → (optional `travala_search_package`) → `travala_book`.

### 7.3 Travala OAuth
- Implement the MCP OAuth 2.0 client flow: dynamic registration (`/oauth/register`), `authorization_code` + **PKCE**, store `refresh_token`. Request scopes `mcp:read mcp:book`.
- Prefer the MCP SDK's built-in OAuth provider if it satisfies Travala's metadata; else a thin manual flow.

### 7.4 The 402-shape contingency (resolved in Phase 0)
Because `make_http_request_with_x402` is proprietary and Travala's docs mention a `next_action` object, we must confirm whether Travala emits **standard x402-over-MCP** (auto-intercepted by `createx402MCPClient`) or a **custom `next_action` handoff**:
- **Branch 1 (standard):** `createx402MCPClient` auto-pays. Minimal code.
- **Branch 2 (custom handoff):** Travala may route payment through a proprietary path — Coinbase's Agentic-Wallet MCP / a `payment_handle` token, possibly with an **ERC-7715 session-key** grant and a mandatory human final-approval — rather than a standard x402 402. In that case we parse the handoff, sign via our `MetaMaskSigner` (EIP-3009, or an ERC-7715 grant if required), set `PAYMENT-SIGNATURE` / the MCP `_meta["x402/payment"]` key, and replay the request ourselves. **✅ CONFIRMED Branch 2 (2026-06-30, §15 Step 8): a `next_action` → `make_http_request_with_x402` → `POST payment-mcp.travala.com/m2m-payment/book`, BUT the wrapped `paymentRequirements` is plain `exact`-EVM EIP-3009 on Base USDC — no ERC-7715 grant. So the handoff-replay path applies, NOT the ERC-7715 variant.**
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
- Implement `MetaMaskSigner` (TEE server-wallet, async via `--wait`) + the driver.
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
| **Wallet mode** | **TEE server-wallet only** | The agent key lives in the TEE (no BYOK); signing is async (`pollingId`/`--wait`, no password). Headless booking requires `beast` trading-mode (no per-tx MFA). |

### Open decision (needs sign-off)
- **Network/validation strategy.** ⚠️ **Correction:** Travala has **no testnet** (the earlier "Travala supports test env" was unverified and is contradicted by Travala's own docs — its MCP is mainnet-only, real USDC). **Recommended (corrected, staged):**
  1. **Read-only mainnet 402 capture (zero spend)** — Phase 0: complete OAuth, drive search→book to the 402, capture one real authenticated `402`/`next_action` *without settling* → decides Branch 1 (standard x402-over-MCP) vs Branch 2 (Coinbase `payment_handle` / ERC-7715 handoff), and whether headless booking is even allowed.
  2. **Testnet plumbing proof (Base Sepolia 84532, no real funds)** — prove `MetaMaskSigner.signTypedData`→EIP-3009→payment→200 against the **x402 reference / self-hosted exact-EVM seller** (test USDC `0x036CbD…`), via the **TEE server-wallet** (`pollingId`/`--wait`). Validates the signer+plumbing (NOT Travala); doubles as the **S2** reusability artifact.
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
| **Travala may mandate human final-approval** (ERC-7715 session-key "firewall") | High | A fully headless server-wallet agent may be unable to book without an interactive step — threatens S1 + server-wallet mode (S5). Confirm in Phase 0; if headless can't complete, scope S1 to an interactive (human-MFA) path and document the limitation. |
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
- **Unit:** `MetaMaskSigner.signTypedData` against a known EIP-3009 vector; parser against sample server-wallet `mm` outputs (`pollingId` → resolved signature).
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

---

## 15. Nested runbook — Phase 0–1: settle (then cancel) one real Travala booking, paid by steg's ENS-gated agent

> 🔁 **Reframed v1.0 (2026-06-30).** The payer is **steg's own agent wallet, `agent.steg.eth`** — the same `mm` wallet already gated by ENS authority — *not* a separate, brain-isolated payer wallet. (That earlier framing inverted the thesis: a throwaway account paying for a hotel proves *generic* x402, not *operator-revocable ENS authority gating payments*.) We reuse the wallet already here, sign x402 payments with it via `mm wallet sign-typed-data`, and route every payment through `gate_or_refusal()` — so the proof is "the agent paid, **and the operator could have revoked that at ENS.**" This reframe dissolved the two isolation blockers below.

> ⚠️ **Still NOT execution-ready.** All **4 critic lenses now run** (completeness + altitude earlier; **technical-correctness + risk-safety** on 2026-06-30 vs this reframed §15, run `wf_289107aa-e08`). The two new lenses' findings are logged as a severity-ranked ledger in **§15.7** (1 blocker, 4 high, rest med/low) — clear the **blocker + high** items **before any step that signs or spends.** Verdict: *factually clean (every package/export/version/USDC address/mm flag/citation checks out) but the danger is in the to-be-authored glue and a thesis overclaim.*

> **Position in the stack:** umbrella thesis *"ENS as operator-revocable authority for AI agents"* → **this ERD** (extends it into x402 payments via a MetaMask-signed payer) → **this section** (Phase 0–1: from *nothing* to *a verified real Travala booking paid by `agent.steg.eth` behind the gate*). Expands §7.1–7.4; executes the §9 staged decision.

**Revision checklist (make executable before running):**
- [x] ~~**(blocker)** specify the exact `mm` wallet-isolation mechanism~~ **RESOLVED by reframe** — there is no isolation step. The payer is the existing `agent.steg.eth` wallet; the only safety rule is **never run an account-level `mm` command (`login`/`logout`/`reset`/`init`)** during this work (reads + the TEE server-wallet `sign-typed-data --wait` don't touch the shared session). `mm` has no config-dir override anyway — only `MM_ENV`, which switches the API backend, not an isolation lever.
- [x] ~~give the exact non-account-level BYOK wallet create/import command~~ **RESOLVED by reframe** — no wallet is created; we use the wallet `mm` already acts as.
- [x] **(blocker)** **Step 0 dep-install DONE (2026-06-30)** — `bun add @modelcontextprotocol/sdk@1.29.0 @x402/mcp@2.17.0 @x402/evm@2.17.0`; `bun run typecheck` PASS (viem auto-resolved 2.47→2.52, no breakage); `bun pm ls` shows the three pins.
- [ ] **(thesis)** route the Phase-1 payment through `gate_or_refusal()` (Step 11) and add an `x402.payment` capability to the ENS authority policy so the operator can revoke *payment* authority specifically (Phase-3 wiring in §8).
- [x] **`scripts/mm-x402-account.ts` DONE (2026-06-30)** — the `ClientEvmSigner` (`{ address, signTypedData }`) `ExactEvmScheme` consumes, backed by `mm wallet sign-typed-data --wait` (TEE; shell-free `Bun.spawn`). Implements §15.7 #6 (BigInt-safe), #14 (chain-id from domain), #16 (no payload/sig logging) + the signer-side of #5 (hard cap/token/chain/recipient guard). Unit tests `scripts/mm-x402-account.test.ts` — **13/13 pass**.
- [ ] Add the MCP transport/connection step and wire **both** the OAuth-Bearer provider and the x402 schemes into the **same** client (between Step 3 and Step 7; and at Step 11).
- [ ] `refresh_token` **rotation**: persist on *every* refresh (OAuth 2.1 rotates public-client refresh tokens) — else the stored secret stales after the first use.
- [ ] Money lifecycle: do price discovery (Step 7) *before* funding (Step 5) or fix a conservative float; capture the **free-cancellation deadline** at Step 10/11; define + verify the **refund destination** (Step 12).
- [ ] Provision the localhost callback listener; mark Steps 1–2 as **local-workstation-only** (cannot run from the Railway brain).
- [ ] Pin canonical Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (name "USD Coin", version "2", chainId 8453) in Steps 5/10.
- [x] **(altitude)** ERD §9 leg-2 (Base Sepolia reference-seller plumbing proof) is a **precondition gate before Step 11** (baked into Step 11).
- [ ] Trim §15.5 risks that duplicate ERD §10; cite up instead of re-deriving §2/§5 background.
- [x] Retitle to Phase 0–1; reframe payer to `agent.steg.eth`.
- [x] **Ran the 2 critic lenses** (technical-correctness, risk-safety) vs reframed §15 → findings ledger in **§15.7** (clear blocker + high before signing/spending).

### 15.1 Objective & definition of "done"

Settle a real Travala booking **paid by `agent.steg.eth`** with our **`mm`-signed x402 payer** — *not* Coinbase's `@coinbase/payments-mcp` (the documented default; our value-add IS the mm-signed payer, so we never install the Coinbase payer). Travala = booking-auth (OAuth 2.1) + payment (x402-over-MCP, Base mainnet USDC) — see ERD §2/§5. Every payment passes through `gate_or_refusal()` (`brain/app/gate.py`), which is an **identity-scoped, operator-revocable kill-switch** — the operator can revoke this wallet's authority at ENS and the agent's *next* gated action (incl. the booking) is refused. ⚠️ It is **not** per-payment authorization of the amount/recipient — the gate probes a *fixed placeholder* credential (`erc20.transfer`, token `0x1111…`, amount `1000` — `demo-request.ts`), so it proves a coarse kill-switch, not approval of this USDC payment (§15.7 #2). The honest end-to-end claim: **the identity the gate can revoke is the one that pays.** Per-payment gating needs the parked `x402.payment` capability (§8).

**Done** is staged and honest about the unknown:
- **Phase 0 done** *(zero-spend)* — a persisted Travala `refresh_token`, a small USDC float on **`agent.steg.eth`** (Base 8453), and **one captured real authenticated `402`/`next_action` payload** — and from it a verdict on **Branch 1 vs Branch 2** (Step 9) plus whether **headless** booking is even permitted.
- **Phase 1 done** *(only if Branch 1)* — one real booking, **authorized by the gate**, settled on Base mainnet (USDC tx hash + Travala confirmation), then cancelled for refund. The only true "verified real booking", **unavoidably mainnet** (= success criterion S1).

If Phase 0 returns **Branch 2**, the plan **stops at the gate** and re-scopes (Step 9) — we do **not** spend real USDC down a path our signer can't drive headlessly.

### 15.2 Prerequisites — HUMAN vs AGENT

| HUMAN-only (irreducible) | AGENT / automatable |
|---|---|
| Provide the **email** Travala OAuth keys to (receives the OTP). | Run the DCR (`/oauth/register`) + PKCE handshake via the MCP SDK OAuth provider. |
| Do the **one-time** consent at `/oauth/authorize` (email-OTP login, approve `mcp:read mcp:book`). | Capture the redirect `code`, exchange it, **persist the `refresh_token` as a secret** (rotate-aware). |
| Fund **`agent.steg.eth`** with a small **USDC** float on **Base mainnet (8453)**. | Read the agent address/balance (`mm wallet address`/`balance --json`); never re-authenticate. |
| Approve (or decline) the **one real Phase-1 booking** + confirm cancellation. | Run the gate, drive `search → packageId → travala_book`, capture the zero-spend 402, render the Branch verdict. |
| (If Branch 2) decide whether to accept an interactive human-final-approval path at all. | Sign the EIP-3009 typed data via `mm wallet sign-typed-data`; replay the paid call. |

**The payer is the existing agent — no new wallet, no isolation step.** `agent.steg.eth` is whatever wallet `mm` is already acting as locally (its reverse-ENS resolves to that name — exactly what the gate evaluates). We fund *that* wallet and sign with it. Blast radius is bounded by **(a)** keeping the float small, **(b)** the `gate_or_refusal()` authority check, and **(c)** free-cancellation inventory — not by isolating a throwaway account (which would be off-thesis).

**One narrow safety rule (replaces the old "wallet isolation" story).** The local `mm` and the Railway brain **share one server-side account session**; an account-level `mm` command (`login`/`logout`/`reset`/`init`) would invalidate the brain's token and take the live deployment down until it re-auths. This runbook **never needs those**: the wallet is already provisioned (TEE server-wallet), and `sign-typed-data --wait` (key in the TEE) + reads use the existing session token. ⚠️ **Caveat (§15.7 #3):** "no account-level command" ≠ "no session mutation" — mm tokens are a `cliToken:cliRefreshToken` pair and the CLI can **silently refresh** an expired access token inside an ordinary read/sign (rotating the per-account session, which could still down the brain). **Precondition:** before starting, `mm auth status` / `mm doctor` must show `authenticated:true` with the access token **far from expiry** — *abort (do NOT login) if not* — and probe the brain's health after each local mm call. **Rule: signing + reads only; no account-level `mm` commands; run in a window where a brain re-login is acceptable.** (A blast-radius-isolated payer, if ever wanted, is a *second ENS-gated agent with its own authority records* — deferred to §15.6, not a throwaway account.)

### 15.3 Runbook

Each step: **actor** · **action/command** · **expected output** · **exit check**. All `bun`/`mm` commands run from repo root unless noted.

#### (a) Travala OAuth account — DCR + one-time consent → persisted refresh_token

**Step 1 — Author the OAuth client (agent).** Build `scripts/travala-oauth.ts` using `@modelcontextprotocol/sdk@1.29.0` `OAuthClientProvider` (`auth()`, `registerClient`, built-in PKCE). Public client: `token_endpoint_auth_method: 'none'`, `redirect_uri: http://localhost:<port>/callback`, PKCE **S256**, scopes `mcp:read mcp:book`. Discovery → `https://travel-mcp.travala.com/mcp`. *Exit:* a `client_id` obtained, authorize URL points at `travel-mcp.travala.com`. Do **not** rely on `client_credentials` (undocumented for headless).

**Step 2 — One-time human consent (HUMAN, local workstation).** Open the authorize URL; email-OTP login; approve `mcp:read mcp:book`. *Exit:* token response contains **`refresh_token`** (+ `access_token`). The only interactive step.

**Step 3 — Persist the refresh_token as a secret (agent).** Write `refresh_token` (+ `client_id`) to a secret store (`.dev.vars` dev / Railway secret), never to logs/git, **re-persisting on every rotation**. Verify silent re-auth (no browser) mints a fresh `access_token`. *Exit:* headless refresh succeeds AND the stored value rotated AND grep confirms no secret in any committed file.

#### (b) Confirm the agent wallet + fund it

**Step 4 — Confirm the payer = `agent.steg.eth` (agent).** Do **not** create, init, or log in. Read the wallet `mm` already acts as: `mm wallet show --json` / `mm wallet address --json` (parse via `scripts/sign-with-mm.ts:49-69`), and confirm its reverse-ENS name via the `agent_identity` path (`brain/app/tools/wallet.py`). *Exit:* address known; reverse-ENS = `agent.steg.eth`; **no account-level `mm` command was run**, so the Railway brain still answers without a re-login.

**Step 5 — Fund `agent.steg.eth` with USDC on Base (HUMAN).** Pricing isn't known until Step 7/10, so fund a **fixed conservative float under a stated hard cap** (`FLOAT = MAX_USDC`), not "≥ planned total" (§15.7 #8). **Gasless:** EIP-3009 `transferWithAuthorization` is facilitator-settled → the wallet needs **USDC, not ETH**. Pin canonical Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (name "USD Coin", version "2", chainId 8453). *Exit:* `mm wallet balance --chain 8453 --token USDC --json` shows USDC ≥ `FLOAT`; Step 10 re-checks `balance ≥ exact total` before signing.

**Step 6 — Prove the TEE server-wallet signs EIP-712 headlessly — the decisive test (agent). ✅ DONE 2026-06-30 (GREEN).** The TEE server-wallet (active `0xbce7…47ef`, beast) signed a **pinned inert** EIP-712 doc (§15.7 #10: `verifyingContract 0x…0001`, `primaryType 'StegSmokeTest'`, `types` *without* `EIP712Domain`) via `mm wallet sign-typed-data --wait` in **~2.2s with no MFA**, and the signature **recovers to the signer** (viem `recoverTypedDataAddress` → facilitator-compatible). Harness: `scripts/x402-smoke-sign.ts`. ⇒ mm 2.0.0 server-wallet typed-data signing works **headlessly** on the TEE; `EIP712Domain`-omission tolerated; the new adapter drives it end-to-end. **The signer-side of S5 is retired.** (The *seller-side* — does Travala permit headless booking, Branch 1 vs 2 — remains the Phase-0 zero-spend 402 capture, Steps 8–9. And before the real settle, confirm which synced server-wallet is `agent.steg.eth` and select it; the smoke ran on `0xbce7…47ef`.)

#### (c) Phase 0 — the ZERO-SPEND authenticated 402 capture

**Step 7 — Public discovery (agent).** `travala_search_hotel` (public) → drill to a concrete `packageId` (optionally `travala_search_package`). *Exit:* a `sessionId` + a selected `packageId`.

**Step 8 — Capture the authenticated 402 WITHOUT settling (agent). READ-ONLY / ZERO SPEND.** ⚠️ Use a **capture-only client (`autoPayment:false`, no `ExactEvmScheme` wired)** — the §7.2 driver's `autoPayment:true` would AUTO-SETTLE this 402 the instant `travala_book` returns it (§15.7 #1, blocker). Call `travala_book` for that `packageId` **with the OAuth access token attached** (passes the Bearer gate), **capture the payload and STOP** — no sign, no settle. *Expected:* a real challenge — standard **x402-over-MCP** in `_meta["x402/payment"]` (amount/asset/`eip155:8453`/facilitator/EIP-712 domain) **or** a proprietary **`next_action`** (Coinbase `payment_handle` / ERC-7715 grant). *Exit:* full challenge JSON captured (token-scrubbed); **assert the seller-advertised EIP-712 domain** (`extra.name=='USD Coin'`, `extra.version=='2'`, `asset==0x8335…2913`, `network=='eip155:8453'` — §15.7 #7); `mm wallet balance` **byte-identical** before/after.

> **✅ DONE 2026-06-30 — captured (zero-spend, `paymentMade:false`).** Harness `scripts/x402-capture.ts` (OAuth DCR+PKCE, capture-only `autoPayment:false`). `travala_book` returns a **`next_action` handoff** (`payments-mcp:make_http_request_with_x402` → `POST https://payment-mcp.travala.com/m2m-payment/book`) wrapping a **standard x402 `exact`-EVM `paymentRequirements`**: asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base USDC), `extra.name "USD Coin"`/`version "2"`, `payTo 0x0617973b64A7cEE9d9a0D66C53f1aecc312BB3ff`, `network eip155:8453`, `maxAmountRequired 365710000` (≈365.71 USDC), `maxTimeoutSeconds 300`. ⇒ **Branch 2 plumbing, Branch 1 payment** (see Step 9). Persisted `refresh_token` (gitignored). No ERC-7715 firewall; the only "approval" is a `description` instructing the agent to emit a USDC-via-Coinbase confirmation prompt — advisory, satisfied by our ENS gate + in-code confirm.

#### (d) DECISION GATE — Branch 1 vs Branch 2

**Step 9 — Classify the captured 402 (agent + human sign-off).**

| Criterion | **Branch 1 — standard x402-over-MCP** | **Branch 2 — Coinbase/ERC-7715 handoff** |
|---|---|---|
| Where is the challenge? | `_meta["x402/payment"]`, `exact`-EVM scheme | proprietary `next_action` / `payment_handle` |
| What to sign? | **EIP-3009 transferWithAuthorization** (our signer produces this) | an **ERC-7715 session-key grant** / Coinbase-MCP token |
| Headless completable? | **Yes** — `createx402MCPClient` auto-pays after we sign | likely **No** — interactive human final-approval firewall |

- **Branch 1 ⇒ proceed to (e).** `createx402MCPClient` (lowercase x, `@x402/mcp@2.17.0`, requires `name`+`version`) with `schemes:[{ network:'eip155:8453', client: new ExactEvmScheme(metamaskAccount) }]` (`ExactEvmScheme` from `@x402/evm/exact/client`) auto-intercepts; our adapter signs; facilitator settles.
- **Branch 2 ⇒ STOP and re-scope.** A headless server-wallet agent likely **cannot** book (threatens S1 + S5). Re-scope S1 to an interactive (human-MFA) path, document the limitation in §10. **No USDC moves until resolved.**
  - **✅ ACTUAL OUTCOME (2026-06-30): Branch 2 — but BENIGN, so we do NOT stop.** Travala uses the `next_action` handoff (Branch-2 *plumbing*), but the payment is **standard x402 `exact`-EVM (EIP-3009 on Base USDC)** — *Branch-1 payment*. No ERC-7715 session-key firewall; the feared "mandatory human final-approval" is just an advisory `description` prompt (satisfiable by our ENS gate + in-code confirm), not a technical gate. Our mm TEE signer (Step 6 ✓) produces the exact signature. **Re-scope = implement the handoff-replay**, not abandon headless: parse `next_action.paymentRequirements[0]` → build the EIP-3009 typed data → sign via `createMmX402Account` → `POST` the x402 payment to `payment-mcp.travala.com/m2m-payment/book` ourselves (we replicate `make_http_request_with_x402`; `createx402MCPClient` auto-pay won't fire on the non-standard envelope). Headless S1/S5 remain in play.
- *Exit:* a written Branch verdict + headless-feasibility verdict, human-signed-off, recorded under §8 Phase-0 exit.

#### (e) Phase 1 — the first REAL booking (Branch 1 only)

**Step 10 — Pick cheapest free-cancellation inventory (agent + human).** Re-search for the cheapest **free-cancellation** package. The EIP-712 domain comes from the seller's 402, not us (§15.7 #7) — so **verify** the captured domain is Base-mainnet USDC (`name 'USD Coin'`, `version '2'`, `asset 0x8335…2913`, `chainId 8453`); do not "re-derive" it (a Base-Sepolia sig — `name 'USDC'` — is rejected on mainnet). Before booking, confirm the refund is **USDC back to the paying wallet** (not credit/voucher/TINV) and capture the exact refund address + the free-cancellation deadline in **UTC** (§15.7 #9). *Exit:* a free-cancellation `packageId` + exact USDC total (≤ the Step-5 `FLOAT`) + refund-as-USDC-to-wallet confirmed + deadline (UTC) captured.

**Step 11 — Execute the real paid booking, through the gate (agent, with human approval).** *(Precondition: ERD §9 Base-Sepolia plumbing leg GREEN.)* **First run the ENS authority check** — `scripts/demo-mm.ts` → `/evaluate` (the probe `gate_or_refusal()` uses); if not `allowed`, **STOP, do not sign**. ⚠️ The gate is an **identity kill-switch, not a spend control** (§15.7 #2) — it proves revocability, NOT that this amount/recipient is authorized. So the adapter must independently **hard-assert before signing** (§15.7 #5): `amount ≤ MAX_USDC` AND `asset/recipient/chainId/verifyingContract` match the expected USDC + Travala facilitator, with `onPaymentRequested` **fail-closed**; and assert `gate-resolved addr == mm wallet address == sign-typed-data signer == agent.steg.eth` reverse-ENS (§15.7 #4); **never auto-retry** a signed authorization (§15.7 #11). If allowed and asserted, drive `travala_book` via `createx402MCPClient`; on the 402 the adapter signs via `mm wallet sign-typed-data --chain-id <domain.chainId>` (derive from the typed data, not hardcoded — §15.7 #14); the facilitator settles. *Exit:* gate `allowed` + identity-match logged; **exactly one** USDC settlement on basescan; `travala_book_status` confirmed; **no payment payload/signature in logs** (§15.7 #16).

**Step 12 — Cancel for refund (agent + human).** `travala_cancel_booking` **before the captured deadline**. *Exit:* `travala_manage_bookings` shows cancelled; refund verified at the defined destination. **Plan complete.**

### 15.4 Exit / success criteria

- **P0-1** — persisted Travala `refresh_token`; headless re-auth proven (no browser).
- **P0-2** — **`agent.steg.eth`** funded with a small USDC float on Base; confirmed via reads with **no account-level `mm` command run** (brain session intact).
- **P0-3** — one **real authenticated 402** captured **zero-spend**; balance provably unchanged.
- **P0-4** — a signed-off **Branch 1/2** verdict + headless-feasibility verdict (the §8 Phase-0 exit).
- **P1-1** *(Branch 1 only)* — one real booking, **passed through `gate_or_refusal()`**, settled on Base (USDC tx hash + Travala confirmation), then cancelled for refund (= **S1**).

### 15.5 Risks (runbook-specific; strategic risks owned by ERD §10)

| Risk | Severity | Mitigation |
|---|---|---|
| **Shared-session** — an account-level `mm` command (`login`/`logout`/`reset`/`init`) would invalidate the Railway brain's token and down the live deployment | High | This runbook is **signing + reads only**; the TEE server-wallet `sign-typed-data --wait` and reads don't re-authenticate. Hard rule in §15.2; the wallet is already provisioned, so no account-level command is ever needed. |
| `refresh_token` leakage / staleness | Med | PKCE; store as a secret; never log; grep-verify (Step 3); re-persist on every rotation. |

*Strategic risks — real-money spend, the Branch-2 human-approval firewall, EIP-712 domain mismatch, CLI drift — are owned by **ERD §10**; mitigations are realized at Steps 5 / 8–9 / 10 / 6.*

### 15.6 Out of scope / deferred

- **A blast-radius-isolated payer** — if we ever want the payer separated from the primary agent, the on-thesis way is a **second ENS-gated agent with its own name + authority records** (still gated, still revocable), not a throwaway account. Overkill for this proof; deferred.
- **ENS ↔ Travala linking** — do ENS identity via **ENSIP-25**, **backlogged**, not this plan.
- **The rebate `rewardWallet` (10% cbBTC) + the ERC-8004 `agentId`** (self-registered at `8004scan.io`, not Travala-issued) — optional, deferred.
- **The Base Sepolia (84532) reference-seller plumbing proof** — belongs to **ERD §9 / Phase 1's testnet leg**; this runbook treats it as a **precondition gate** before Step 11 (Travala itself has no testnet).
- The native `mm x402` command, the `MetaMask/agent-skills` PR, and the steg `x402_pay_*` tools — §8 Phases 2–3, downstream.

### 15.7 Critic-lens findings (technical-correctness + risk-safety, 2026-06-30) — clear before signing/spending

Both pending lenses ran against this reframed §15 (run `wf_289107aa-e08`, grounded in the live `@x402/evm@2.17.0` tarball, the installed `mm` 2.0.0, and the gate source). Joint verdict: **factually clean — every package, export, version, USDC address, EIP-712 domain, CAIP network format, mm flag, and file:line citation checks out — but NOT execution-ready.** The danger is concentrated in the *to-be-authored glue* and one *thesis overclaim*. Severity-ranked, deduped across both lenses; clear (or consciously accept) each before any step that signs or spends.

| # | Sev | Finding | Fix / owning step |
|---|---|---|---|
| 1 | 🔴 blocker | **Phase-0 capture can auto-spend.** §7.2 sets `autoPayment:true` and the checklist wires schemes into the *same* client used at Step 8 → a `travala_book` 402 auto-settles real USDC during the "zero-spend" capture. | Step 8 uses a **capture-only client** (`autoPayment:false`, no `ExactEvmScheme`, `onPaymentRequested`→false); exit-check `mm wallet balance` byte-identical before/after. Enable autoPayment only after the Branch-1 sign-off (Step 9). |
| 2 | 🟠 high | **Thesis overclaim.** §15.1/Step 11 implied the gate authorizes *this* payment. It doesn't: `gate_or_refusal()`→`demo-mm.ts` signs a FIXED placeholder (`erc20.transfer`, token `0x1111…`, to `0x7099…`, amount 1000 — `demo-request.ts:15-25`); the worker `checkPolicy` has no x402/eip3009 action type. | Restated to the honest claim (done in §15.1/Step 11): an **identity-scoped, operator-revocable kill-switch** (revoke at ENS → next gated action refused), **not** per-payment authorization. Per-payment gating = the parked `x402.payment` capability (§8 / `gate.py:18-21`). |
| 3 | 🟠 high | **Silent token-refresh can down the live brain.** "reads + server-wallet sign never touch the shared session" was too strong: mm **CLI auth** tokens are `cliToken:cliRefreshToken` (separate from the TEE wallet key) and the CLI silently refreshes an expired access token inside ordinary read/sign (`TOKEN_REFRESH_FAILED` exists); session is server-side per-account (G3). Catch-22: if the local token is already expired, the only fix is `mm login` (forbidden). | **Precondition** (added to §15.2): `mm auth status`/`mm doctor` → `authenticated:true` + token far from expiry, else **abort (do NOT login)**; probe the brain's health after each local mm call; run in a window where a brain re-login is acceptable. Confirm with MetaMask whether silent refresh rotates the per-account session. |
| 4 | 🟠 high | **Headless TEE signing must resolve without MFA (the real S5 gate).** Re-scoped (2026-06-30): the payer is the **TEE server-wallet**, not BYOK — so the gate and the payment now sign with the **same TEE EOA** and the old "signer-identity split / BYOK-broken-on-2.0.0 / raw `MM_MNEMONIC`" concern **dissolves**. The live risk is that server-wallet signing is **async** (`pollingId`/`--wait`) and, in `guard` trading-mode, a policy check can demand **MFA** a headless agent can't satisfy. | **✅ RESOLVED signer-side (Step 6, 2026-06-30):** TEE typed-data signing resolves **headlessly in beast mode** (~2.2s, no MFA, sig recovers to signer). The adapter's `signTypedData` runs `… --wait` and blocks on the TEE result. *Remaining:* before the real settle, assert the active wallet's reverse-ENS `== agent.steg.eth` and select that synced server-wallet (the smoke ran on `0xbce7…47ef`); the *seller-side* headless question (Branch 1/2) is Phase 0. |
| 5 | 🟠 high | **No spend ceiling.** The gate caps nothing on the real amount (it evaluates the placeholder); `onPaymentRequested` was "in-code preview", never specified to block → a mispriced/malicious 402 would be signed. | Adapter **hard-asserts** before signing (added to Step 11): `amount ≤ MAX_USDC` AND `asset/recipient/chainId/verifyingContract` match expected Base USDC + Travala facilitator; `onPaymentRequested` **fail-closed** (explicit human ack of exact amount/recipient). |
| 6 | 🟡 med | **BigInt serialization crash on the real path.** EIP-3009 `message` has `value`/`validAfter`/`validBefore` as JS **BigInt**; `JSON.stringify` throws → the live booking fails at sign time (the no-BigInt Step-6 dummy hides it). `@x402/evm@2.17.0 chunk-VFVBY5MG.mjs:60-70`. | In `scripts/mm-x402-account.ts`: `JSON.stringify(td, (_k,v)=> typeof v==='bigint'? v.toString(): v)` (uint256→decimal string is correct EIP-712). Add a §12 unit test signing a BigInt-containing message. |
| 7 | 🟡 med | **EIP-712 domain is the seller's, not "re-derived."** The signing domain comes verbatim from the 402 (`requirements.extra.name/version` + `.asset`); if absent the client throws before signing. Domains differ by network (Base `name:'USD Coin'`; Base Sepolia `name:'USDC'`; both `version:'2'`). | Step 8/10 now **assert** the captured domain (`'USD Coin'`/`'2'`/`0x8335…2913`/`eip155:8453`) instead of "re-deriving" it. |
| 8 | 🟡 med | **Fund-before-price ordering.** Step 5 funded before Step 7/10 priced → "USDC ≥ planned total" uncomputable. | Step 5 now funds a **fixed conservative `FLOAT`/MAX cap**; Step 10 re-checks `balance ≥ exact total` before signing. |
| 9 | 🟡 med | **Refund medium/deadline unenforced.** "Free cancellation" may refund as **credit/voucher/TINV, not USDC** → spend unrecovered; deadline had tz ambiguity + no guard. | Step 10 now requires written confirmation of **USDC-to-paying-wallet** refund + exact address + deadline in **UTC** with a hard reminder. |
| 10 | 🟡 med | **Step-6 dummy under-specified.** Warned only against USDC `TransferWithAuthorization`, but Permit/Permit2/DAI-permit/`ReceiveWithAuthorization`/Seaport are equally spendable. | Step 6 now pins an inert payload (`verifyingContract=0x…0001`, nonsense `name`, `primaryType:'StegSmokeTest'`); forbid any known token/router `verifyingContract`. Also test a `types` that **omits `EIP712Domain`** (the scheme does) to confirm mm 2.0.0 tolerates it. |
| 11 | 🟡 med | **Replay/double-settle on retry.** A `travala_book` timeout + retry re-signs a **fresh-nonce** authorization → second USDC charge (cf. the flaky-transfer backlog item). | Sign exactly one auth with a tight `validBefore`; before any re-call, query `travala_book_status`/on-chain settlement and dedupe on `sessionId+packageId`; assert exactly one settlement; **never auto-retry a signed payment** (noted in Step 11). |
| 12 | 🟡 med | **OAuth loopback callback exposure.** Plaintext `http://localhost/callback` without a validated `state` + bound ephemeral listener → login-CSRF / code interception; token logging leaks bearer secrets. | Steps 1–3: bind `127.0.0.1` + random high port; generate+verify `state`; close the listener after one callback; never log the callback URL or token response. (`.dev.vars` is gitignored — also keep Railway secrets write-only and grep CI logs.) |
| 13 | 🟡 med | **STOP gates are advisory + TOCTOU.** Branch-2 STOP (Step 9) and the gate verdict (Step 11) are manual, separate from the sign call; authority could be revoked in the gap, yet `sign-typed-data` still yields a spendable sig. | Encode the Branch-2 STOP as a **non-zero exit branch**; the adapter refuses to sign without a fresh `Branch-1 + gate-allowed` token from the same run; **re-run the gate immediately before settlement**. |
| 14 | 🔵 low | **Adapter must derive `--chain-id` from `domain.chainId`** (not hardcode 8453), else the Base-Sepolia leg (84532) hits `CHAIN_ID_MISMATCH`. | `const chainId = Number(td.domain.chainId); --chain-id ${chainId}` (noted in Step 11). |
| 15 | 🔵 low | **Step 0 viem bump.** `@x402/evm@2.17.0` needs `viem ^2.48.11`; repo pins `^2.47.6` (compatible, silent upgrade). | Pin `bun add @modelcontextprotocol/sdk@1.29.0 @x402/mcp@2.17.0 @x402/evm@2.17.0` (`@x402/core` is transitive — §11 over-lists it); run `bun run typecheck` after. |
| 16 | 🔵 low | **Bearer-spendable payload/signature logging.** The reused `sign-with-mm.ts` template prints request→stderr + sig→stdout; for the real payment that's a theft window until settled. | Strip request/signature logging from the x402 adapter; log only a redacted summary (amount + recipient last-4); "no payment payload/signature in logs" is a Step-11 exit check. |
| 17 | 🔵 low | **Gate reverse-ENS silent fallback.** `demo-mm.ts:51,56,60,63` falls back to the literal `"agent.steg.eth"` on RPC failure → a transient RPC issue corrupts the decisive authority verdict. | For the Step-11 thesis run, pin a reliable `ETH_RPC_URL` and require `resolveAgentName` to **succeed** (== the funded wallet's reverse-ENS); abort+retry rather than guess. |
| 18 | 🔵 low | **§7.2 network format.** `network: "eip155:8453" (or 84532 testnet)` — bare `84532` is not a valid CAIP-2 `Network`. | Fixed in §7.2 → `'eip155:84532'`. |

**Lens verdicts (verbatim).** Technical-correctness: *"NOT execution-ready, but factually clean … 0 blockers, 1 high, 2 medium, ~5 low. The blockers are all in the to-be-authored glue … not in any cited fact."* Risk-safety: *"NOT execution-ready. 13 concrete risks … 4 blocker/high that can spend real USDC or take the live Railway brain down, plus a load-bearing thesis overclaim."*

**Build status (2026-06-30).** Step 0 deps installed (pinned) + typecheck green (#15). `scripts/mm-x402-account.ts` + unit tests landed (13/13) → clears **#6, #14, #16** and the **signer-side of #5**. **§15 Step 6 GREEN** via `scripts/x402-smoke-sign.ts`: the TEE server-wallet signs EIP-712 **headlessly in beast mode** (~2.2s, no MFA) and the sig **recovers to the signer** → **#4 resolved (signer-side)**. **§15 Phase 0 DONE (Step 8, 2026-06-30):** capture-only OAuth/MCP client `scripts/x402-capture.ts` (DCR+PKCE, `autoPayment:false`, 127.0.0.1 callback + `state`) captured the real authenticated 402 zero-spend → **Branch 2 (benign): `next_action` handoff wrapping a standard `exact`-EVM EIP-3009 payment** (Base USDC, `payTo 0x0617…B3ff`, ≈365.71 USDC). No ERC-7715 firewall; headless feasible. *Still to build for Phase 1:* the **handoff-replay payer** — parse `next_action.paymentRequirements` → build EIP-3009 → `createMmX402Account` sign → `POST /m2m-payment/book` — behind `gate_or_refusal()`, with the `onPaymentRequested`/amount fail-closed guard (#5), idempotency (#11), wallet-identity assertion (#4 → select `agent.steg.eth`), and the §15.2 session precondition (#3). Then the §9 Base-Sepolia plumbing leg, then the one real mainnet booking + cancel.

**§15 Phase 1 — payer built + PREVIEW green (2026-06-30).** `scripts/x402-pay.ts` (handoff-replay) + `scripts/lib/travala-mcp.ts` (shared OAuth/MCP, also reused by the capture client) + tests (**23/23**). It parses the live `next_action`, runs the fail-closed **requirements guard** (asset=Base USDC, network=Base, amount ≤ `X402_MAX_USDC` $400 cap, `payTo` pinned to `0x0617…B3ff`), and **PREVIEWS** the real payment zero-spend (365.72 USDC, no sign/no POST). The **EXECUTE** path — `gate_or_refusal()` probe → `ExactEvmScheme.createPaymentPayload` (mm-signs; adapter guard fires) → `encodePaymentSignatureHeader` → `POST /m2m-payment/book` → settle — is implemented + gated behind `X402_EXECUTE=1` + a funded wallet. **Remaining for Phase 1 (needs funds + go):** ~~validate EXECUTE on the **§9 Base-Sepolia** reference seller~~ **DONE 2026-07-02 = S2 GREEN** (see §0 — on-chain settlement, `toV2Requirements` bug found+fixed, negative test passed); ~~confirm + `mm wallet select` `agent.steg.eth`'s synced wallet (#4)~~ **DONE 2026-07-02** (`0x0943…7ee1` selected; reverse-ENS asserted; brain unaffected — selection is per CLI install); ~~de-risk the gate probe's **server-wallet** path~~ **DONE 2026-07-02** (`sign-with-mm.ts` now passes `--wait`; gate probe green `allowed:true` vs the deployed worker); **fund `agent.steg.eth`**; then **one real mainnet booking + cancel** (= S1).
