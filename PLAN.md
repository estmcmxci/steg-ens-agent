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

**Step 5 — ENS8004 / adapter8004** (refs: ens8004.xyz/how-it-works,
adapter8004.xyz, manifest `/api/manifest/<contract>/<tokenId>`):
adapter8004 (mainnet `0xde152AfB7db5373F34876E1499fbD893A82dD336`) non-custodially
binds the ENS **NFT → ERC-8004 agent id** (Identity Registry `0x8004…a432`), then
drives **ENSIP-26** records (`display`/`agent-context`/`avatar`/`agent-endpoint[a2a|mcp|web]`)
and an **ENSIP-25** claim (`agent-registration[<reg>][<id>]="1"`, on first save).
Sub-steps: (a) **WRAP CHECK (gating)** — adapter8004 maps an NFT; unwrapped subnames
aren't NFTs, so `agent.steg.eth` must be **wrapped** (NameWrapper ERC-1155) — verify/
wrap first. (b) Bind via adapter8004 (operator Ledger; **ABI not published — pull
from adapter8004.xyz/Etherscan**). (c) Set ENSIP-26 via ens-cli setText:
`agent-endpoint[web]` = the cockpit URL; **leave `[mcp]`/`[a2a]` UNSET** (our Worker
is REST, not MCP — don't mis-point; build an MCP server later). (d) ENSIP-25 claim
auto-written. (e) Verify via manifest; show an "ERC-8004 ✓" badge.

**Composition:** ENSIP-26 = discovery, `auth.*`+`/evaluate` = authorization,
ERC-8004 = verified identity → a complete, discoverable, gated agent identity.

**Then (UI wizard, build step 6/7):** "Sign in with email" button (MetaMask hosted
login + callback) → brain `POST /provision` → rebind step surfacing operator
calldata for Ledger → ENS8004 step. Result: "all through the UI."

**Open items:** adapter8004 ABI; `agent.steg.eth` wrap status; server provisioning
untested; mainnet-only; logout destroys local BYOK wallet (seed backed up).

---

## 4. Thesis (don't erode)

MetaMask = custody (TEE) · user = email identity · operator (`steg.eth`) = naming
+ authority. **Authority lives in ENS, not the wallet** — verifiable independently,
operator-revocable without the key. Server-wallet runs **beast mode** so ENS is the
*only* policy layer. The agent can't rewrite its own identity/authority (operator-
only). Every action remains `/evaluate`-gated. If a change breaks "MetaMask vanishes
→ counterparties still verify + operator still revokes," it crossed the line.
