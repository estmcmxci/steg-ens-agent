# PLAN.md — Steg agent-wallet cockpit (resume doc)

Self-contained brief for a fresh session. Read top-to-bottom; everything you need
is here. Repo: `~/Desktop/metamask` (git `main`). Today the **identity leg is fully
live on mainnet**; the next task is **§3 milestone 6 (email login + server wallet)**.

---

## 0. End-product vision

A web app where you **sign in with only an email**, get a **MetaMask cloud (TEE)
agent wallet** named under ENS, with a **verifiable on-chain identity** (ERC-8004
+ ENSIP-25/26) and **ENS-published, operator-revocable authorization** gating every
action — all driven by **chat (ChatKit)**. The scalable-login agent-wallet demo.

Build rationale: **inside-out** — engine first, then face, then onboarding:

1. ✅ Wallet + ENS name (`agent.steg.eth`) — the agent exists & resolves
2. ✅ Verifier (`auth.*` + `/evaluate`) — actions gated by ENS authority, not the key
3. ✅ Brain: 57 `mm` tools, confirm-before-execute — it can act, safely
4. ✅ Cockpit shell — ChatKit UI anchored to the agent
5. ✅ **mm-in-UI** — portfolio-card panels (holdings/activity/perps/predict)
5b. ✅ **ERC-8004 identity** — `agent.steg.eth` bound (#34860) + ENSIP-26 records +
    agentURI→served `/card` + ENSIP-25 claim. All live on mainnet; `/card` returns
    `verified:true`. Worker deployed. (Only `agent-endpoint[web]` deferred → frontend deploy.)
6. ▶ **Email login + server-wallet (TEE) provisioning** — the two UNPROVEN legs [NEXT TASK, §3]
7. Onboarding wizard — wrap it all into the NLI cockpit

---

## 1. Current repo state (ground truth)

**This session added (latest first):** `89da8dc` identity-leg complete (agentURI +
ENSIP-25) · `ba82e42` set-agent-uri + set-agent-registration scripts · `003244f`
worker deploy (`steg-agent-card`) · `e49116e` ENSIP-26 records set · `d3dddd0`
set-agent-records.ts · `eaf5e9b` bind receipt · `3191730` bind-erc8004.ts · `8504f0d`
`/card` endpoint · `48ef1db` mm-in-UI portfolio card · `ebce0fd` plan/§3 rewrite.
Earlier base: `d6ad818` … `5faa347` verifier. **Tree clean.**

**Layout:**
- `src/` — verifier core (verifyAuth, checkPolicy, evaluateAction, schema, types,
  hash, ensClient, ensRecordSource, ensEnvelopeSource, mockStore). Scheme: secp256k1.
- `worker/` — CF Worker (Hono). Reads (public, keyless): check/profile/resolve/list/
  verify/utils/**evaluate**/**card**. Writes (API_KEY-gated): commit/register/records/
  renew/transfer/primary/subname. `wrangler.toml` (name `steg-agent-card`, dedicated
  KV `b75bf458…`). **Deployed:** `https://steg-agent-card.estmcmxci.workers.dev`.
  Local: `:8787`. `GET /card/:name` renders the ERC-8004/A2A card from on-chain state.
- `brain/` — Python (OpenAI Agents SDK + ChatKit/FastAPI). **57 `mm` tools**
  (`app/tools/`: wallet, actions, perps, predict) + **`app/agent_routes.py`** read-only
  `GET /agent/{balance,tx,perps,predict,aave}` (public, no MM_PASSWORD) for the portfolio
  card. `/chatkit` via `app/main.py`. Serves `:8000`. Needs `OPENAI_API_KEY` in
  `brain/.env`; `MM_PASSWORD` only for execute tools. venv at `brain/.venv`.
  **Deploy target: Railway** (persistent container — the `mm` CLI keeps a logged-in
  session on disk that serverless loses on cold start).
- `frontend/` — React+Vite ChatKit cockpit, anchored to `agent.steg.eth` (no
  wallet-connect). Portfolio card: `lib/agentApi.ts`, `hooks/useAgentWallet.ts`,
  `components/PortfolioPanels.tsx`, mounted in `ENSProfileCard`. vite proxy:
  `/chatkit`→:8000, `/agent`→:8000, `/api`→:8787. **Not yet deployed.**
- `scripts/` — operator writes. **All Ledger/cast writes are interactive, simulated
  bun scripts** (project rule — see below): `bind-erc8004.ts`, `set-agent-records.ts`,
  `set-agent-uri.ts`, `set-agent-registration.ts` (each: dry-run sim → `--send` →
  `yes` → one Ledger sig). Older: `send.sh --ledger` (auth.* records via ens-cli),
  publish-records/revoke, mm/viem signers. `tools/ens-cli/` — vendored write tool.
- `records/` — `agent.steg.eth.primary.json` (auth.* records), `*.card.json` (card
  template), **`*.erc8004.json`** (the full bind/records/agentURI/ENSIP-25 receipt).
- Reference: `~/Desktop/adapter8004-ref` (cloned `github.com/unruggable-labs/adapter`).

**The agent — `agent.steg.eth` (mainnet), full identity:**
- **Operator / name owner:** `0x4767b1902865940f020c3e3bA3C0E117941f96fF` (Ledger).
  Owns wrapped `steg.eth` + `agent.steg.eth`. This key signs all operator writes.
- **Wrapped ERC-1155** (NameWrapper `0xD441…6401`), tokenId = namehash
  `0x294f2b2635b4a9fb5e82a6a495d559c5139343a8fe5f1cb0d96f7f61e50927be`.
- **addr record (the agent's wallet):** BYOK `0x2B4C7Ac514CE4f6FbEf26e23F83536C8E5838979`
  (fwd+rev set). ⚠️ milestone 6 **replaces this** with a server wallet.
- **ERC-8004 agent id `34860`** — bound via adapter8004 `0xde152AfB7db5373F34876E1499fbD893A82dD336`,
  registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. `tokenURI(34860)` → the card URL.
- **Card (live):** `https://steg-agent-card.estmcmxci.workers.dev/card/agent.steg.eth`
  → `erc8004 {registered:true, verified:true}`, 4 skills, trustModels `["feedback"]`.
- **`auth.*` records** on-chain. Note: `records/agent.steg.eth.primary.json` has
  `auth.revocation[primary]={"revoked":false}` — verify on-chain before re-running an
  allow→revoke→deny demo.

**What works vs stubbed:**

| Layer | State |
|---|---|
| Verifier `/evaluate` | ✅ allow→revoke→deny proven LIVE on mainnet |
| CF Worker (ENS + verifier + `/card`) | ✅ deployed `steg-agent-card`; `/card` verified:true |
| Brain (57 tools + `/agent/*` reads) | ✅ proven via live LLM; portfolio reads live |
| Frontend cockpit + portfolio card | ✅ builds; not deployed |
| **ERC-8004 identity (§3 step 5)** | ✅ COMPLETE on mainnet (bind+records+agentURI+ENSIP-25) |
| Email login / server wallet | ⏸ §3 milestone 6 — UNPROVEN, next |
| Onboarding wizard | ⏸ §3 milestone 7 |
| Perps/Predict data | ⚪ empty (no funds; predict geoblocked+unset) |
| Aave | ⚪ no native `mm aave` (FR in `docs/`) |

**Run locally (3 tabs):**
```
bun run worker:dev                                       # :8787 (or use the deployed worker)
cd brain && .venv/bin/uvicorn app.main:app --port 8000   # :8000 (OPENAI_API_KEY in brain/.env)
cd frontend && npm run dev                               # localhost:5173
```

**Project rule (in memory):** any Ledger/cast onchain write → an **interactive,
simulated bun script** (build calldata with viem, `eth_call` dry-run + pre-flight
reads, `--send` → `yes` confirm → `cast send --ledger --from <op>`). Never hand over
raw calldata blobs. Pattern: `scripts/bind-erc8004.ts`.

**Caveats:** burned secrets in old transcripts (BYOK seed, `champion1` pw, OpenAI
key) — rotate before production. Server-wallet provisioning never tested.
`wrangler secret put` from a loop: zsh `${!k}` indirection silently sets EMPTY —
extract values with grep/cut and verify by hitting the endpoint.

---

## 2. NEXT TASK — §3 milestone 6 (email login + server-wallet provisioning)

The two genuinely UNPROVEN legs. ⚠️ **Destructive** — step 1 logs out and wipes the
local BYOK wallet (`0x2B4C…`) that the brain currently runs on (seed backed up).
**Checkpoint with the user before running `mm logout`.** Do CLI-orchestrated first
(the SDK is too raw; the supported interface is the `mm` CLI), then wrap in the wizard
(milestone 7). See §3 for the full trial + the already-done identity leg.

---

## 3. Onboarding (§3) — identity leg DONE; milestone 6/7 remain

### 3.1 Milestone 6 trial (CLI-orchestrated; user does OTP + Ledger)
1. `mm logout` — ⚠️ clears the BYOK wallet (`0x2B4C…`); seed backed up, we're replacing it.
2. `mm login email --no-wait` → sign in as **steglabs@gmail.com** + OTP → `mm login --token`.
3. `mm init --wallet server-wallet --mode beast` → provisions the **TEE server wallet**
   — *the gating unknown* (never tested). beast mode = ENS is the only policy layer.
4. **Rebind `agent.steg.eth` → the new server-wallet address**: re-point the `addr`
   record + reverse, and re-publish the `auth.credential` signer (`scripts/send.sh
   --ledger`, operator-signed). **IMPORTANT:** this touches the addr record + auth
   signer ONLY. It does **NOT** affect the ERC-8004 binding — that's on the
   operator-owned wrapped NFT, not the addr. `/card` renders from records, so identity
   stays `verified:true` through the rebind (and auto-reflects the new addr).
5. ERC-8004 identity — **already DONE** (§3.2). Nothing to redo. After step 4, the
   TEE-trust-model add (below) becomes truthful.

### 3.2 Identity leg — ✅ COMPLETE (reference; receipts in `records/agent.steg.eth.erc8004.json`)
Done by hand this session, all on mainnet, operator-signed via the interactive scripts:
- **(a) Wrap** ✅ — `steg.eth` + `agent.steg.eth` wrapped (ERC-1155). The adapter has
  no wrap requirement; wrap was needed only because an unwrapped *subname* isn't an NFT.
- **(b) Bind** ✅ — `register(1, NameWrapper, namehash, "", [])` on the adapter
  (`bind-erc8004.ts`), tx `0x09d0356b…`. → **agent id `34860`**. Verified: `bindingOf(34860)`
  = `(1, NameWrapper, namehash)`, `ownerOf(34860)` = adapter, `isController(…,0x4767…)`=true.
- **(c) ENSIP-26 records** ✅ — `agent-id=34860` + display + description + agent-skills
  + agent-trust-models `["feedback"]` (`set-agent-records.ts`), tx `0x7583fa6d…`.
- **(d) agentURI** ✅ — `setAgentURI(34860, <card URL>)` (`set-agent-uri.ts`), tx
  `0x169e252b…`. `tokenURI(34860)` → the card.
- **(e) ENSIP-25 claim** ✅ — signature-FREE (presence == attestation, only the name
  controller can set it). `agent-registration[<registry>][34860]="1"`
  (`set-agent-registration.ts`), tx `0x3e1e2146…`. `<registry>` is the **ERC-7930**
  interoperable address of the registry (NOT CAIP-10) =
  `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`. ERC-7930 layout:
  `version(0001) chainType(0000) refLen(01) chainRef(01) addrLen(14) address` — see
  `erc7930Evm()` in `set-agent-registration.ts` (verified vs the spec's vitalik example).

**adapter8004 reference** (mainnet; for milestone 7 / future agents):
adapter proxy `0xde152AfB7db5373F34876E1499fbD893A82dD336`, registry
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, admin Safe `0x03302Df4…3149`.
Key ABI: `register(uint8 standard,address token,uint256 id,string uri,(string,bytes)[] md)
→ agentId`; `setAgentURI(uint256,string)`; `setMetadata(uint256,string,bytes)`;
`bindingOf(uint256)→(uint8,address,uint256)`; `enum TokenStandard{ERC721=0,ERC1155=1,…}`.
**The adapter writes ERC-8004 metadata only — it does NOT touch ENS resolver records.**
ENSIP-26/25 text records are a separate surface WE write via ens-cli `setText`.

### 3.3 Milestone 7 — onboarding wizard (after 6)
"Sign in with email" → brain `POST /provision` → rebind step surfacing operator
calldata for Ledger → ENS8004 bind + card-generation. The hand-authored
`agent.steg.eth` card (`records/*.card.json`) is the prototype of what `/provision`
generates per agent; `/card` + the 4 scripts are the reusable wizard backend.

**Two design questions to resolve before building it:**
1. **NLI flow vs. stepper.** Frontend is a ChatKit NLI cockpit, not a form app. Lean:
   guided chat flow + minimal structured affordances (email-login button, operator-
   calldata→Ledger panel) only where chat can't (OAuth redirect, hardware sign).
2. **Who signs the ENS8004 bind at scale?** Operator-signing on a Ledger doesn't scale
   to many users. Options: (a) automated operator key (hot, or **delegated** via
   delegate.xyz — the adapter honors rights `keccak256("adapter8004.manage")`), or
   (b) the server wallet self-registers. Biggest open fork; interacts with the thesis.

### 3.4 Deferred (not blocking)
- **`agent-endpoint[web]`** — set to the cockpit URL after the frontend deploys (one
  more `setText`; batch with anything else to save a Ledger sig).
- **A2A + MCP endpoints** — build real servers, then publish `agent-endpoint[a2a]`/`[mcp]`
  + add to the card. Web only until they exist (publishing now would mis-point).
- **TEE trust model** — add `"tee-attestation"` to `agent-trust-models` the SAME day
  the server wallet is provisioned (milestone 6 step 3). Not before — would over-claim.
- **`avatar`** record — not set.

---

## 4. Thesis (don't erode)

MetaMask = custody (TEE) · user = email identity · operator (`steg.eth`) = naming +
authority. **Authority lives in ENS, not the wallet** — verifiable independently,
operator-revocable without the key. Server-wallet runs **beast mode** so ENS is the
*only* policy layer. The agent can't rewrite its own identity/authority (operator-only).
Every action remains `/evaluate`-gated. ERC-8004 = verified identity, ENSIP-26 =
discovery, `auth.*`+`/evaluate` = authorization → a complete, discoverable, gated
agent. If a change breaks "MetaMask vanishes → counterparties still verify + operator
still revokes," it crossed the line.
