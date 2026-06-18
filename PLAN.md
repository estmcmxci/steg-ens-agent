# PLAN.md — Steg agent-wallet cockpit (resume doc)

Self-contained brief for a fresh session. Read this top-to-bottom; everything
you need is here. Repo: `~/Desktop/metamask` (git `main`).

---

## 0. End-product vision

A web app where you **sign in with only an email**, get a **MetaMask cloud (TEE)
agent wallet** named under ENS, with a **verifiable on-chain identity** (ERC-8004
+ ENSIP-25/26) and **ENS-published, operator-revocable authorization** gating
every action — all driven by **chat (ChatKit)**. The scalable-login
agent-wallet demo for MetaMask.

Build rationale: **inside-out** — engine first, then face, then onboarding. Each
layer is provable before the next:

1. ✅ Wallet + ENS name (`agent.steg.eth`) — the agent exists & resolves
2. ✅ Verifier (`auth.*` + `/evaluate`) — actions gated by ENS authority, not the key
3. ✅ Brain: 57 `mm` tools, confirm-before-execute — it can act, safely
4. ✅ Cockpit shell — ChatKit UI anchored to the agent
5. ✅ **mm-in-UI** — portfolio-card panels (holdings/activity/perps/predict)
6. ▶ Email login — MetaMask social sign-in, no wallet, no seed [NEXT TASK]
7. Onboarding wizard — provision server wallet → bind to ENS → ERC-8004 + ENSIP-25/26

---

## 1. Current repo state (ground truth)

**Commits (latest first):** `d6ad818` fix profile timeout · `910f1ff` fix search
mainnet · `dcaee40` frontend step 1 (cockpit, re-anchor) · `b70cf3b` brain batch4
(raw tx + Aave FR) · `503185d` batch3 predict · `0df44db` batch2 perps · `025ef38`
batch1 core+swap · `27ad8a7` brain (reads + gated transfer) · `489dfc6` worker ·
`5faa347` verifier. Tree clean, nothing uncommitted.

**Layout:**
- `src/` — verifier core (verifyAuth, checkPolicy, evaluateAction, schema, types,
  hash, ensClient, ensRecordSource, ensEnvelopeSource, mockStore). Scheme: secp256k1.
- `worker/` — CF Worker (ensemble-beta `ens-agent-api` + grafted `/evaluate`).
  Routes: check/profile/resolve/list/verify/utils/**evaluate** (public, keyless)
  + write routes (commit/register/records/renew/transfer/primary/subname,
  API_KEY-gated). `wrangler.toml`, KV `ENS_SESSIONS`. Serves `:8787`.
- `brain/` — Python (OpenAI Agents SDK + ChatKit/FastAPI). **57 `mm` tools**
  (`app/tools/`: wallet, actions, perps, predict). `/chatkit` endpoint via
  `app/main.py`. Serves `:8000`. Needs `OPENAI_API_KEY` in `brain/.env`;
  `MM_PASSWORD` only for execute tools. venv at `brain/.venv`.
  **Deploy target: Railway** (persistent container) — the brain ships as one
  service: Python + the `mm` CLI binary + the 57 tools. Must be a container, not
  edge/serverless: the `mm` CLI keeps a logged-in wallet session on disk, which a
  serverless function loses on each cold start. Railway image must install the
  `mm` CLI **and** carry a logged-in session — today that's the local BYOK login;
  it stops being a per-box concern once §3's server-wallet (TEE) holds the session.
- `frontend/` — React+Vite ChatKit cockpit, re-anchored to `agent.steg.eth`
  (no wallet-connect). vite proxy: `/chatkit`→:8000, `/api`→:8787.
- `scripts/` — operator (publish-records, revoke, **send.sh --ledger**), mm/viem
  signers, demo-mm. `tools/ens-cli/` — vendored operator write tool.
- `records/agent.steg.eth.primary.json` — the auth.* records. `docs/feature-request-aave-v3.md`.

**The agent:** `agent.steg.eth` → BYOK wallet `0x2B4C7Ac514CE4f6FbEf26e23F83536C8E5838979`
(fwd+rev set). `auth.*` records live on-chain. ⚠️ `auth.revocation[primary]` is
currently `{"revoked":true}` (from the demo) — **un-revoke to reset** the allow path.

**What works vs stubbed:**

| Layer | State |
|---|---|
| Verifier `/evaluate` | ✅ allow→revoke→deny proven LIVE on mainnet |
| CF Worker (ENS tools + verifier) | ✅ boot-tested |
| Brain (57 tools, confirm-gated) | ✅ proven via live LLM (balance/price/swap-quote/perps/raw-tx gates) |
| Frontend cockpit | ✅ builds; profile card loads agent.steg.eth (identity, search) |
| **mm-in-UI panels** | ✅ built — brain `/agent/*` + tabbed portfolio card (Holdings/Activity live; Perps/Predict empty/locked; Aave deferred) |
| Email login / server wallet / onboarding / ENS8004 | ⏸ parked (§3) |
| Perps/Predict data | ⚪ empty (no funds; predict geoblocked+unset) |
| Aave | ⚪ no native `mm aave` (FR filed) |

**Run locally (3 tabs):**
```
bun run worker:dev                                   # :8787
cd brain && .venv/bin/uvicorn app.main:app --port 8000   # :8000 (OPENAI_API_KEY in brain/.env)
cd frontend && npm run dev                           # localhost:5173
```

**Caveats:** burned secrets in old transcripts (BYOK seed, `champion1` pw, OpenAI
key) — rotate before production. Server-wallet provisioning never tested. Worker
profile latency ~7s (serial record resolution). localhost needs no ChatKit domainKey.

---

## 2. FIRST TASK — mm-in-UI (portfolio card)

Turn the profile card into a **portfolio card**: ENS identity + live `mm` state
as panels inside the same card. Full scaffolding; panels light up when funded.

**Constraint:** browser can't run `mm` — only the brain can. Add thin REST GETs
to the brain; frontend polls them. All panel reads are **public (no MM_PASSWORD)**.

**Brain (`main.py`, beside `/chatkit`)** — reuse `app.tools.wallet._mm`:
| Endpoint | mm call | Panel |
|---|---|---|
| `GET /agent/balance` | `wallet balance` | Holdings (REAL ~$0.83) |
| `GET /agent/tx?limit=` | `tx history` | Activity (REAL) |
| `GET /agent/perps` | `perps positions` + `perps balance` | Perps (empty state) |
| `GET /agent/predict` | `predict portfolio` | Predict (empty/locked state) |
| `GET /agent/aave` | — (no native cmd) | Aave (deferred placeholder) |

**Vite proxy:** add `'/agent': { target: 'http://127.0.0.1:8000', changeOrigin: true }`.

**Frontend:** keep identity header (balance ← `/agent/balance` total USD). Add a
tabbed region inside the card: `Identity · Holdings · Activity · Perps · Predict ·
Aave`. New files: `lib/agentApi.ts` (typed client), `hooks/useAgentWallet.ts`
(fetch + loading/empty/error + refresh), `components/PortfolioPanels.tsx` (tabs +
bodies + empty states). Mount in `ENSProfileCard`.

**Build order:** (1) brain `/agent/*` (+ aave stub) → (2) vite `/agent` proxy →
(3) `lib/agentApi.ts` + `hooks/useAgentWallet.ts` → (4) `PortfolioPanels.tsx` +
wire header balance + mount → (5) run + verify Holdings($0.83)+Activity render,
Perps/Predict empty states.

**Reality:** Holdings + Activity = real, live. Perps/Predict = structured empty
states (no funds/setup). Aave = placeholder (no `mm aave`; FR in `docs/`). This is
read-only exposure; *actions* stay in the chat (57 confirm-gated tools); verifier
untouched.

---

## 3. PARKED — onboarding trial (email → server wallet → ENS identity)

The scalable-login demo. Validates the two UNPROVEN legs: **email login** +
**server-wallet provisioning**. Do CLI-orchestrated first (the SDK is too raw /
undocumented; the supported interface is the `mm` CLI), then wrap in the UI wizard.

**Trial (CLI-orchestrated; you do OTP + Ledger):**
1. `mm logout` — ⚠️ clears current BYOK wallet (`0x2B4C`); seed backed up, we're replacing it.
2. `mm login email --no-wait` → sign in as **steglabs@gmail.com** + OTP → `mm login --token`.
3. `mm init --wallet server-wallet --mode beast` → provisions TEE server wallet (the gating unknown).
4. **Rebind `agent.steg.eth` → new address**: re-point addr + reverse + re-publish
   `auth.credential` signer (`scripts/send.sh --ledger` + reverse `setName`, operator-signed).
5. **Register ENS identity via ENS8004/adapter8004** (below).

**Step 5 — ENS8004 / adapter8004** (source repo cloned to `~/Desktop/adapter8004-ref`,
`github.com/unruggable-labs/adapter` — read it, the ABI is no longer a mystery).
adapter8004 binds an **NFT → ERC-8004 agent id**; the adapter then *permanently owns*
the agent NFT and the external-token (ENS) owner manages it through the adapter.
Addresses (mainnet, confirmed): adapter proxy `0xde152AfB7db5373F34876E1499fbD893A82dD336`,
Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, admin = Safe 3-of-4
`0x03302Df40186D9B85faEA4fbb6cC5da028B23149`. NameWrapper `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`.

**ABI (verbatim, `src/Adapter8004.sol` / `IERCAgentBindings.sol`):**
- `register(TokenStandard standard, address tokenContract, uint256 tokenId, string agentURI, MetadataEntry[] metadata) → uint256 agentId` (+ overload w/o metadata). Mints agentId to the adapter; caller must own/delegate the NFT.
- `bindExisting(uint256 agentId, TokenStandard standard, address tokenContract, uint256 tokenId)` — bind an already-minted agent (needs ERC-721 approval of the adapter).
- `setAgentURI(uint256 agentId, string newURI)` — agentURI is **mutable**.
- `setMetadata(uint256 agentId, string key, bytes value)` — writes ERC-8004 metadata (reserved keys `agent-binding`, `cf-registration`).
- `enum TokenStandard { ERC721=0, ERC1155=1, ERC6909=2, ERC1155F=3, ERC6909F=4 }`.

**(a) WRAP — ✅ DONE.** Both names wrapped (verified on-chain 2026-06-18 via `eth.drpc.org`).
`steg.eth` and `agent.steg.eth` both owned-in-registry by NameWrapper; wrapper.ownerOf
= operator EOA `0x4767b1902865940f020c3e3bA3C0E117941f96fF`. `agent.steg.eth` is now an
**ERC-1155**, tokenId = namehash `0x294f2b2635b4a9fb5e82a6a495d559c5139343a8fe5f1cb0d96f7f61e50927be`.
(Note: the adapter has NO wrap requirement; the wrap was needed only because an
unwrapped *subname* isn't an NFT. Binds as `ERC1155` (=1), tokenContract = NameWrapper.)

**(b) Bind — ✅ DONE.** `register(1, NameWrapper, 0x294f…27be, "", [])` on the adapter,
operator-signed via `bun scripts/bind-erc8004.ts --send` (interactive, simulated).
Landed in tx `0x09d0356bfc8ced8e00c5e1cacc403a6d44b90567feaba1173c981eb8e9cfac1c`
(block 25346611). **agent.steg.eth = ERC-8004 agent id `34860`.** Verified on-chain:
`bindingOf(34860)` = `(1, NameWrapper, namehash)`, `ownerOf(34860)` = adapter (it
permanently holds the agent NFT), `isController(34860, 0x4767…96fF)` = true.

**(c) ENSIP-26 records — ✅ DONE.** `agent-id=34860` + `display` + `description` +
`agent-skills` + `agent-trust-models=["feedback"]` set on the resolver
(`0xF291…AC15`) via `bun scripts/set-agent-records.ts --send`, tx
`0x7583fa6d…07e8fb` (block 25346670). **GET /card/agent.steg.eth now returns
`erc8004: {registered:true, verified:true}`** (reads agent-id → `bindingOf(34860)`
→ confirms the binding) with the full card body. Still TODO: ENSIP-25 claim
(`registrations[].signature`) + `agent-endpoint[web]`/`setAgentURI` (need deploy).

**(c-note) ENSIP-25/26 — CORRECTION to earlier draft.** The adapter does **NOT** write ENS
resolver records; it only writes ERC-8004 metadata via `setMetadata`. ENS text records
are a *separate surface we* write via ens-cli `setText` on the resolver. So: set
ENSIP-26 `display` / `avatar` / `agent-context` / `agent-endpoint[web]` (= cockpit URL)
ourselves; ENSIP-25 `agent-registration[<registry>][<id>]="1"` is also ours to write
(NOT auto-written). **Leave `agent-endpoint[a2a]`/`[mcp]` UNSET for now** — future work
(see below).

**(d) agentURI = a SERVED endpoint, not a static file.** Per the onboarding insight:
the card is a generated artifact. Build Worker `GET /card/<name>` that renders the
ERC-8004/A2A card from on-chain state (ENS records + binding + registry) — our analog
to adapter8004.xyz's `/api/manifest/<contract>/<tokenId>` (that endpoint is NOT in the
repo; it's their off-chain service). `agentURI` → `https://<worker>/card/agent.steg.eth`.
**Card content already decided** (2026-06-18 Q&A) and drafted at
`records/agent.steg.eth.card.json` (template the wizard fills): name `agent.steg.eth`;
4 skills (wallet/swaps/markets/ens); `trustModels:["feedback"]`; ENS-gated authority as
an `x-authorization` extension (NOT a fake trustModel); web endpoint only.

**(d-deploy) Worker DEPLOYED — ✅.** `steg-agent-card` live at
`https://steg-agent-card.estmcmxci.workers.dev` (dedicated KV `b75bf458…`, NOT the
shared `ENS_SESSIONS`; secrets from `.dev.vars`). Production card:
`https://steg-agent-card.estmcmxci.workers.dev/card/agent.steg.eth` →
`erc8004 {registered:true, verified:true}`. This is the **agentURI target** —
ready for `setAgentURI`. `agent-endpoint[web]` (the cockpit URL) still waits on the
frontend deploy.

**ENSIP-25 (researched, docs.ens.domains/ensip/25):** signature-FREE. Key
`agent-registration[<registry>][<agentId>]` where `<registry>` is the **ERC-7930**
interoperable address of the registry (NOT the CAIP-10 `eip155:1:…` used in the
card's `agentRegistry`), `<agentId>`=`34860`; value SHOULD be `"1"`. The attestation
IS the record's presence (only the name controller can set it). So the card's
`registrations[].signature:null` is correct. Remaining: compute the ERC-7930 encoding
of `0x8004…a432` on chain 1, then one `setText`.

**Bind/card ORDERING (chicken-and-egg — card needs the agentId):**
1. `register(...)` with `agentURI=""` → mints `agentId`.
2. Fill the card: `registrations[]` = `{agentId, "eip155:1:0x8004…a432", signature}` (sign over it).
3. `setAgentURI(agentId, "https://<worker>/card/agent.steg.eth")`.
4. Set ENSIP-26 text records on the resolver (ens-cli `setText`).
5. Write ENSIP-25 claim `agent-registration[…]="1"`.
6. Verify: read `bindingOf(agentId)` + `getMetadata` on-chain (and/or our `/card`); show "ERC-8004 ✓" badge.

**Composition:** ENSIP-26 = discovery, `auth.*`+`/evaluate` = authorization,
ERC-8004 = verified identity → a complete, discoverable, gated agent identity.

**Then (UI wizard, build step 6/7):** "Sign in with email" button (MetaMask hosted
login + callback) → brain `POST /provision` → rebind step surfacing operator
calldata for Ledger → ENS8004 bind + card-generation step. The hand-authored
`agent.steg.eth` card is the prototype of what `/provision` generates per agent.
Result: "all through the UI." The identity leg (wrap→bind→records→`/card`) is now
PROVEN by hand and its scripts (`bind-erc8004.ts`, `set-agent-records.ts`) + `/card`
are the reusable wizard backend; only legs 6 (email login, server provisioning)
remain unproven, so the wizard is gated on those, not on identity.

**Milestone-7 design questions (decide before building the wizard):**
1. **NLI flow vs. stepper.** The frontend is a ChatKit NLI cockpit, not a form app.
   Should onboarding be a *guided chat flow* (the agent walks the user through it)
   plus a few structured affordances (the email-login button, an operator-
   calldata→Ledger panel), or an overlaid modal stepper? Lean: chat-driven, with
   minimal structured surfaces only where chat can't (OAuth redirect, hardware sign).
2. **Who signs the ENS8004 bind at scale?** Today operator == us and we signed
   bind + records on a Ledger — that does NOT scale to many users signing
   interactively. The scaled flow needs one of: (a) an automated operator key
   (hot, or delegated via the delegate.xyz path the adapter supports — rights
   `keccak256("adapter8004.manage")`), or (b) the server wallet self-registering
   its own name. This is the biggest open fork and it interacts with the thesis
   (authority lives with the operator, `steg.eth`). Resolve before §3's wizard.

**Future work (deferred, not blocking the trial):**
- **A2A + MCP endpoints** — build real A2A (JSON-RPC) and MCP servers, then publish
  `agent-endpoint[a2a]`/`[mcp]` + add them to the card. Until they exist, publishing
  them would mis-point; web only for now.
- **TEE trust model** — add `"tee-attestation"` to the card's `trustModels` the SAME
  day the §3 TEE server wallet is provisioned (step 3). Not before — the agent is BYOK
  today and the claim would fail verification.

**Open items:** server-wallet provisioning untested (the real gating unknown now that
ABI + wrap are resolved); mainnet-only; logout destroys local BYOK wallet (seed backed
up); production cockpit/worker URLs + the `/card` endpoint not yet built; `avatar` record
not yet checked/set.

---

## 4. Thesis (don't erode)

MetaMask = custody (TEE) · user = email identity · operator (`steg.eth`) = naming
+ authority. **Authority lives in ENS, not the wallet** — verifiable independently,
operator-revocable without the key. Server-wallet runs **beast mode** so ENS is the
*only* policy layer. The agent can't rewrite its own identity/authority (operator-
only). Every action remains `/evaluate`-gated. If a change breaks "MetaMask vanishes
→ counterparties still verify + operator still revokes," it crossed the line.
