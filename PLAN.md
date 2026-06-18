# PLAN.md — Steg agent-wallet cockpit (resume doc)

Self-contained brief for a fresh session. Read top-to-bottom; everything you need
is here. Repo: `~/Desktop/metamask` (git `main`). **Milestone 7 is now DONE** — the
onboarding wizard provisioned a fresh agent **`demo.steg.eth`** end-to-end on mainnet
(POST /provision, option B: hot-key-signed, one operator Ledger sig for the mint).
agent id **34863**, server wallet `0xb51cCa…e001`, `/card` verified, owned-by-operator
at rest. Receipts: `records/demo.steg.eth.erc8004.json`. (Milestone 6 — the agent on
TEE wallet `0x0943…C7EE1` under email login — also DONE.) Next: see §3.4 deferred /
the milestone-7 follow-ups (pin the Bun crash; deploy frontend).

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
6. ✅ **Email login + server-wallet (TEE)** — the two formerly-UNPROVEN legs, now
   proven on mainnet. `mm logout`→`mm login email`→`mm init server-wallet beast`→
   rebind. The agent now runs on TEE wallet `0x0943…C7EE1`, not the old BYOK key.
7. ▶ Onboarding wizard — wrap it all into the NLI cockpit [NEXT TASK, §3.3]

---

## 1. Current repo state (ground truth)

**Latest commit:** `74bb69b` **milestone 6 complete** — email login + TEE server-wallet
(`0x0943…C7EE1`) + ENS rebind fwd+rev + `tee-attestation`, all live on mainnet (rebind
txs `0xacba52a3…` operator multicall, `0x4de8807c…` TEE reverse). Tree clean.

**Earlier this session (latest first):** `89da8dc` identity-leg complete (agentURI +
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
  `set-agent-uri.ts`, `set-agent-registration.ts`, **`rebind-server-wallet.ts`** (m6
  fwd rebind, operator Ledger) (each: dry-run sim → `--send` → `yes` → one Ledger sig).
  **`set-reverse-server-wallet.ts`** is the exception: TEE-signed via `mm` (no Ledger),
  beast mode. Older: `send.sh --ledger` (auth.* records via ens-cli),
  publish-records/revoke, mm/viem signers. `tools/ens-cli/` — vendored write tool.
- `records/` — `agent.steg.eth.primary.json` (auth.* records), `*.card.json` (card
  template), **`*.erc8004.json`** (the full bind/records/agentURI/ENSIP-25 receipt).
- Reference: `~/Desktop/adapter8004-ref` (cloned `github.com/unruggable-labs/adapter`).

**The agent — `agent.steg.eth` (mainnet), full identity:**
- **Operator / name owner:** `0x4767b1902865940f020c3e3bA3C0E117941f96fF` (Ledger).
  Owns wrapped `steg.eth` + `agent.steg.eth`. This key signs all operator writes.
- **Wrapped ERC-1155** (NameWrapper `0xD441…6401`), tokenId = namehash
  `0x294f2b2635b4a9fb5e82a6a495d559c5139343a8fe5f1cb0d96f7f61e50927be`.
- **addr record (the agent's wallet):** MetaMask TEE **server wallet**
  `0x0943142F488fb694141841bF46e17Be2bB5C7EE1` (fwd+rev set, milestone 6). Under email
  login as **steglabs@gmail.com**, `beast` mode. Replaced the old BYOK `0x2B4C…8979`
  (seed backed up; pre-wipe `~/.metamask` snapshot at `~/.metamask.backup-pre-milestone6`).
  Rebind tx `0xacba52a3…` (fwd addr + auth.credential signer + trust-model, operator
  multicall) + `0x4de8807c…` (reverse setName, TEE-signed via `mm`).
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
| **Email login / server wallet (§3 m6)** | ✅ COMPLETE — TEE wallet `0x0943…`, ENS rebound fwd+rev, `tee-attestation` live |
| Onboarding wizard | ⏸ §3 milestone 7 — next |
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
key) — rotate before production. Server-wallet provisioning now PROVEN (milestone 6).
`wrangler secret put` from a loop: zsh `${!k}` indirection silently sets EMPTY —
extract values with grep/cut and verify by hitting the endpoint.

---

## 2. NEXT TASK — §3 milestone 7 (onboarding wizard)

Milestone 6 is DONE (§3.1 below, all receipts recorded). The agent now runs on the
TEE server wallet under email login, with ENS rebound fwd+rev and `tee-attestation`
live. Next is the **onboarding wizard** (§3.3): wrap the proven manual flow
(email login → `mm init` server-wallet → operator rebind → ENS8004 bind) into the NLI
cockpit. Design fully resolved (Phase 0 done — delegate.xyz dropped, option B chosen);
build plan ready to execute at §3.3.1 Phase 1.

---

## 3. Onboarding (§3) — identity leg DONE; milestone 6/7 remain

### 3.1 Milestone 6 — ✅ COMPLETE (2026-06-18, all on mainnet)
1. ✅ `mm logout` — wiped the BYOK wallet (`0x2B4C…`); seed backed up, pre-wipe
   `~/.metamask` snapshot at `~/.metamask.backup-pre-milestone6`.
2. ✅ `mm login email` as **steglabs@gmail.com** + OTP → `mm login --token`.
3. ✅ `mm init --wallet server-wallet --mode beast` → TEE server wallet
   `0x0943142F488fb694141841bF46e17Be2bB5C7EE1`. **The gating unknown passed first try.**
   beast mode = ENS is the only policy layer.
4. ✅ **Rebind `agent.steg.eth` → `0x0943…`**, two txs:
   - **fwd** (`scripts/rebind-server-wallet.ts`, operator Ledger multicall, tx
     `0xacba52a3…`): `setAddr`→`0x0943…` + `auth.credential[primary].signer`→`0x0943…`
     + `agent-trust-models`→`["feedback","tee-attestation"]`. ONE sig.
   - **rev** (`scripts/set-reverse-server-wallet.ts`, **TEE-signed via `mm wallet
     send-transaction`**, tx `0x4de8807c…`): `ReverseRegistrar.setName("agent.steg.eth")`
     from the server wallet itself. ReverseRegistrar `0xa58E81fe…fc7Cb`.
   ERC-8004 binding untouched (it's on the operator-owned wrapped NFT, not the addr);
   `/card` stayed `verified:true` and auto-reflects the new addr (`x-ens.addr`).
5. ✅ ERC-8004 identity unchanged (§3.2); `tee-attestation` added in step 4's multicall.

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

### 3.3 Milestone 7 — onboarding wizard (NEXT) — SCOPE DECIDED 2026-06-18
**Thin-slice demo** (not multi-tenant), **mainnet**. "Sign in with email" → brain
`POST /provision` → run the milestone-6 choreography for a NEW agent **`demo.steg.eth`**.
The `agent.steg.eth` card (`records/*.card.json`) is the per-agent template; `/card` +
the parameterized scripts are the reusable backend.

**Resolved decisions:**
- **Scope:** thin-slice demo, mainnet, single email (steglabs@gmail — the only email on
  the early-access CLI). "Sign in" = log in as steglabs (already done); "run the rest" =
  provision one fresh agent. Multi-tenant / L2 / scalable-signing all DEFERRED.
- **Subname label:** `demo.steg.eth`.
- **Fresh wallet:** `mm wallet create --name demo --trading-mode beast` → a SECOND TEE
  server wallet under steglabs (confirmed: `mm wallet create`/`select` support this).
  The demo shows a genuinely new agent, not a reuse of `0x0943…`.
- **Ownership (thesis fidelity):** operator OWNS `demo.steg.eth` (mirrors agent.steg.eth).
  Server wallet is only the `addr` target + `auth.credential` signer + self-signs its own
  reverse. Authority stays operator-revocable — §4 intact. (Server-wallet-owns-subname
  was REJECTED: it would let the agent rewrite its own identity.)
- **Subname is born wrapped** via `setSubnodeRecord` under wrapped `steg.eth` → no
  separate wrap step (unlike agent.steg.eth, which pre-existed unwrapped).
- **Operator signing = HOT KEY, name born owned-by-hot-key, transferred to operator at the
  end** (chosen 2026-06-18; revised after Phase 0). The brain signs ALL provisioning steps
  server-side with a hot key via viem — the demo runs end-to-end in the UI, **no per-step
  Ledger, no browser wallet-connect**. Needs exactly ONE operator Ledger sig (the subname
  mint), done before the demo run.
  - **PHASE 0 VERDICT (2026-06-18, VERIFIED vs `~/Desktop/adapter8004-ref`): delegate.xyz
    does NOT work for our bind.** The adapter honors `keccak256("adapter8004.manage")` ONLY
    for single-owner standards (`ERC721`/`ERC1155F`/`ERC6909F`, the ones exposing per-id
    `ownerOf`). For **plain `ERC1155`** (enum=1), control is pure `balanceOf(caller,id) > 0`
    and delegation is ignored — `_hasBindingControl` (`Adapter8004.sol:805`), proven by
    `testERC1155DelegateIsNotController` (`delegate.t.sol:268`: even a full all-wallet
    delegation reverts `NotController`). An ENS **subname is always a plain ERC-1155** in the
    NameWrapper (no per-id `ownerOf`), so it can only bind as `ERC1155` — confirmed by
    `agent.steg.eth`'s own `register(1, NameWrapper, …)`. No F-profile path exists. delegate.xyz
    is therefore DROPPED from the design.
  - **The fix (option B):** control for `ERC1155` is just `balanceOf > 0`, so **mint
    `demo.steg.eth` owned by the hot key.** The hot key then holds the wrapped-subname balance
    and natively passes `_hasBindingControl` for BOTH adapter calls (`register` + `setAgentURI`)
    with zero delegation. At the end the hot key `safeTransferFrom`s the wrapped name to the
    operator → operator owns at rest, §4 thesis intact. The hot key also owns the node during
    provisioning, so it authorizes all resolver writes (setAddr + auth.* + ENSIP-26 + ENSIP-25).
  - **The ONE Ledger sig:** operator mints the subname directly via `NameWrapper.setSubnodeRecord(
    steg.eth, "demo", hotKey, publicResolver, ttl, fuses, expiry)` — owner = hot key. NO
    `setApprovalForAll`, so **no all-names blast radius and no revoke step** (the rejected
    alternative was a reusable `setApprovalForAll(hotkey,true)` grant; option B trades reuse for
    a per-agent mint and zero standing approval). Don't burn `CANNOT_TRANSFER` — the final
    transfer to operator needs it.
  - **Custody unchanged:** a leaked hot key could rewrite this one demo agent's identity records
    while it owns the node (NOT move funds — custody is the TEE; "authority ≠ custody" holds).
    Hot key in env only (`OPERATOR_HOT_KEY`), never committed.
  - **Hot key MUST be a clean EOA** (no contract code, no EIP-7702 delegation). The mint
    transfers the wrapped ERC-1155 to the hot key, so `_mint` runs `onERC1155Received`; a
    delegated/contract address that doesn't implement it reverts with empty `0x`. Verified on
    mainnet (Phase 1): mint-to-operator and mint-to-fresh-EOA simulate cleanly; mint-to-7702-
    delegated-addr reverts. `mint-subname.ts` guards this with an owner-has-code pre-flight.
    Generate the demo hot key fresh (`cast wallet new`); don't reuse a smart-account address.
  - The END USER never touches a Ledger (email only). Server wallet still self-signs its
    own reverse via `mm` (TEE).
- **NLI flow:** guided chat + minimal structured affordances (email-login button + live
  progress panel) only where chat can't. Brain orchestrates the WHOLE choreography (TEE
  wallet via `mm` + operator hot key via viem); the UI just drives `/provision` + shows
  progress. NOTE: frontend ALREADY ships wagmi/RainbowKit + RegistrationProgress/Success/
  SigningOverlay (legacy from an earlier ENS-name-registration flow) — repurpose the
  progress/success components; the wallet-connect path is now unused for the operator.

**Per-agent flow (= milestone 6 choreography, new subname; hot-key-signed, 0 Ledger
during the demo after the one-time mint):**
0. (one-time, operator Ledger) `NameWrapper.setSubnodeRecord(steg.eth, "demo", hotKey,
   publicResolver, ttl, fuses, expiry)` → mints `demo.steg.eth` **owned by the hot key**
   (no `setApprovalForAll`, no delegate.xyz, no revoke).
1. `mm wallet create` fresh TEE wallet (steglabs/TEE)  ·  2. resolver multicall
setAddr+auth.*+ENSIP-26 (hot key, owns node)  ·  3. `register()` bind → agent id (hot key,
holds ERC-1155 balance — no delegation)  ·  4. agentURI + ENSIP-25 (hot key)  ·  5. reverse
`setName` (server wallet, TEE)  ·  6. `safeTransferFrom` wrapped `demo.steg.eth` hot key →
operator (hot key) — operator owns at rest.

**DEFERRED (real-product fork, out of demo scope):** gas funding for N agents; multi-tenant
mm sessions (CLI holds one session on disk); L2 ENS subnames for cost; reusable
`setApprovalForAll`-style grant (option A) for provisioning many agents without a per-agent
mint sig; tighter-scoped / TEE-held operator key instead of a raw hot key. Revisit after the
thin slice validates.

### 3.3.1 Build plan — file-level, execute in order (handoff for the next session)
~70% reuse. Genuinely new code: `mint-subname`, the two grant scripts, `/provision`, the
wizard hook. Hold ALL Ledger sigs (the one-time grant) until the code is ready + user is
set to run the demo — build & dry-run everything first.

**Phase 0 — ✅ DONE (2026-06-18). VERDICT: delegate.xyz does NOT gate our bind.** Verified
vs `~/Desktop/adapter8004-ref`: the adapter honors `keccak256("adapter8004.manage")` ONLY
for single-owner standards (`ERC721`/`ERC1155F`/`ERC6909F`). Plain `ERC1155` (our subname's
only possible standard) uses pure `balanceOf > 0`, delegation ignored — `Adapter8004.sol:805`,
test `delegate.t.sol:268` `testERC1155DelegateIsNotController`. **Switched to option B
(mint the subname owned by the hot key; hot key passes `balanceOf` for register+setAgentURI;
transfer to operator at the end).** delegate.xyz dropped; one Ledger sig = the mint. Full
rationale in §3.3 "Operator signing" + "Resolved decisions".

**Phase 1 — ✅ DONE (2026-06-18). Backend scripts parameterized + 2 new, all dry-run-verified
on mainnet via eth_call.**
- ✅ `scripts/lib/agent-config.ts` (new) — central addresses + `resolveAgent(name)` config +
  shared `parseCommon()` (handles `--name`/`--hot-key`/`--from`), `buildEnsBatch()`,
  `preflightSimulate()`, `erc7930Evm()`, and `confirmAndSend()` (the one signing tail:
  Ledger via `cast send --ledger`, or hot key via viem `OPERATOR_HOT_KEY` env).
- ✅ Parameterized the 5 scripts (`bind-erc8004`, `set-agent-records`, `set-agent-uri`,
  `set-agent-registration`, `rebind-server-wallet`): `--name`/`--addr`/`--agent-id` + `--hot-key`
  as an alternative to `--ledger`. agent.steg.eth defaults unchanged (verified: identical
  calldata). For `ERC1155` the hot key signs AS the balance-holding owner (no delegation).
- ✅ `scripts/mint-subname.ts` (new) — `setSubnodeRecord(steg.eth, "demo", hotKey, resolver,
  0, 0, 0)`, owner = **hot key**. fuses=0/expiry=0 (matches the live agent.steg.eth subname;
  burning nothing keeps the name transferable). THE one Ledger-signed script. Pre-flights:
  child-unminted + owner-is-clean-EOA + simulate-from-operator. Subname born WRAPPED.
- ✅ `scripts/transfer-subname.ts` (new, hot key) — `safeTransferFrom(hotKey, operator,
  namehash, 1, "0x")`, the final provisioning step → operator owns at rest. Pre-flights:
  hot-key-holds-name + simulate.
- ~~`operator-grant.ts`/`operator-revoke.ts`~~ — DROPPED (option B has no `setApprovalForAll`,
  no delegate.xyz grant, no revoke). The only Ledger sig is `mint-subname.ts`.

**Phase 2 — ✅ DONE (2026-06-18). brain `POST /provision` (SSE), wired + smoke-tested.**
- ✅ `brain/app/provision_routes.py` (new) — streams the choreography: `mm wallet create
  --name demo --trading-mode beast --json` (parse `data.address`) → rebind-server-wallet
  (forward addr + auth.credential + trust-models) → bind (parse minted `{agentId,txHash}`
  from stdout) → set-agent-records (ENSIP-26) → set-agent-uri → set-agent-registration
  (ENSIP-25) → `mm wallet select` demo + set-reverse-server-wallet (TEE) → transfer-subname
  (hot key → operator). Emits `{event,step,status,…}` SSE frames; on failure emits an
  `error` frame and stops; a `finally` re-selects the prior `mm` wallet so the cockpit's
  read-only `/agent/*` card keeps pointing at the live agent wallet. Operator steps shell
  out to the parameterized bun scripts with `--hot-key --send --yes` (hot key from env
  `OPERATOR_HOT_KEY`). mint-subname is the pre-demo Ledger step, NOT in `/provision`.
- ✅ Supporting changes: added `--yes` (skip the confirm prompt for automation; the
  eth_call pre-flight stays the gate) across the lib + scripts; `bind-erc8004.ts` now decodes
  the `AgentBound` event after a hot-key send and prints `{agentId,txHash,name}`;
  parameterized `set-reverse-server-wallet.ts` (`--name`/`--wallet`/`--yes`).
- ✅ Wired into `brain/app/main.py` (`include_router(provision_router)`). Smoke-tested:
  SSE streams `begin`→preflight-`error` with `OPERATOR_HOT_KEY` unset (no wallet create, no
  broadcast); hot-key signer path resolves + balance guard fires. Live broadcast path validates
  in Phase 4.

**Phase 3 — ✅ DONE (2026-06-18). Frontend wizard, built + Playwright-verified.**
- ✅ `frontend/src/lib/provisionApi.ts` (new) — SSE client: POSTs `/provision`, reads the
  ReadableStream, yields parsed `data:` frames (EventSource is GET-only, so fetch+reader).
- ✅ `frontend/src/hooks/useProvision.ts` (new) — drives the stream, reduces frames into a
  per-step status map (`pending/active/done/error`) + `agentId`/`serverWallet`/`card`. Exports
  the 8-step `PROVISION_STEPS` (wallet_create→records→bind→identity→agent_uri→ensip25→reverse
  →transfer). Aborts on unmount/reset.
- ✅ `ProvisionProgress.tsx` + `ProvisionWizard.tsx` (new) — the wizard card: one CTA →
  live 8-step stepper → success block (TEE wallet, ERC-8004 id, "View verifiable card" link)
  or an error+retry. Self-contained, **no wallet-connect** (email-thesis). Reuses the
  cockpit's design tokens (new `prov-*` CSS in `index.css`). Entry point chosen: composed
  into the profile column (below `ENSProfileCard`) in `App.tsx` — NOT inside the
  wallet-connect-gated card. (The legacy `RegistrationProgress/Success` stayed untouched;
  a provision-specific stepper was cleaner than overloading the 4-step registration one.)
- ✅ `/provision` vite proxy → brain :8000. Frontend `tsc -b && vite build` passes.
- ✅ Playwright-verified the full chain (component→hook→SSE→proxy→brain→reduce→UI): the card
  renders, clicking streams `begin`→8-step stepper→preflight `error` ("OPERATOR_HOT_KEY not
  set")→retry — all with the hot key unset, so NO wallet create / NO broadcast. The
  wagmi/RainbowKit operator path is now unused (legacy, left in place).

**Phase 4 — ✅ DONE (2026-06-18). `demo.steg.eth` provisioned live on mainnet.**
- ✅ RAN: hot key `0x0343…BeE5` (clean EOA, funded) → `mint-subname --send` (operator Ledger,
  tx `0xde62a76b…`) → wizard `POST /provision` → server wallet `0xb51cCa…e001`, agent id
  **34863**, all hot-key-signed. Receipts in `records/demo.steg.eth.erc8004.json`.
- ✅ VERIFIED: `/card/demo.steg.eth` → `x-ens.erc8004 {registered:true, verified:true,
  agentId:34863}` + ENSIP-25 in `registrations[]` · forward addr → `0xb51cCa…` · reverse
  `0xb51cCa…`→`demo.steg.eth` · `ownerOf` == operator `0x4767…96fF` · `tokenURI(34863)` → card.
- Key tx: bind `0xbaaa08da…` · ENSIP-26 `0xd462b64e…` · agentURI `0xf514129d…` · ENSIP-25
  `0xc533ae0a…` · reverse `0xf0c90156…` · transfer→operator `0x0f5d4e4b…`.
- **Gotchas hit + fixed live:** (1) `mm wallet create` nests the address under `data.wallet.
  address` (not `data.address`) — parser fixed. (2) `REVERSE_GAS_ETH` 0.003→0.001 (gas was
  ~0.25 gwei). (3) One transient **Bun 1.3.5 native crash** on the ENSIP-26 step mid-stream
  (hot-key send path) — recovered by re-running that step manually; steps are idempotent so the
  retry was clean. FOLLOW-UP: pin/avoid the Bun crash (e.g. replace `buildEnsBatch`'s nested
  `Bun.$` ens-cli call with direct viem multicall encoding) before relying on an unattended run.

**Original plan (for reference):**
- ✅ `scripts/preflight-demo.ts` (new, READ-ONLY) — gates the live run: checks hot key set +
  clean EOA + funded (≥0.02 ETH floor), operator owns wrapped `steg.eth`, child unminted,
  mint-subname simulates (shells out to its dry-run), mm session is server-wallet mode, and
  the card worker is up. Prints the gas budget + exact run order; exits GO/NO-GO. Spends no
  gas. Run it first.
- ✅ **server-wallet reverse gas — RESOLVED.** `scripts/fund-wallet.ts` (new, hot-key ETH
  transfer) + a `fund` step in `/provision` right after `wallet_create` top the fresh server
  wallet up with ~0.003 ETH (`REVERSE_GAS_ETH`) so it can pay its own reverse `setName`. The
  frontend stepper now has 9 steps (Wallet→Fund→Records→…). The 0.02 hot-key floor budgets for
  it (7 hot-key txs total). `confirmAndSend` gained `value` support for the transfer.
- Run: ensure brain has `OPERATOR_HOT_KEY` → `preflight-demo` = GO → `mint-subname --send`
  (Ledger, owner = hot key) → run the wizard → confirm `demo.steg.eth` resolves fwd+rev,
  `/card/demo.steg.eth` returns `verified:true`, `tokenURI(newId)` → card, and
  `NameWrapper.ownerOf(namehash)` == operator (the transfer-subname step landed). No revoke
  needed (option B grants no standing approval). Record receipts in `records/demo.steg.eth.*.json`.

**Key facts the new session needs:** parent `steg.eth` is wrapped, owner = operator
`0x4767…96fF` (Ledger). NameWrapper `0xD441…6401`. PublicResolver (from agent.steg.eth)
`0xF29100983E058B709F3D539b0c765937B804AC15`. adapter proxy `0xde152AfB…dD336`, registry
`0x8004A169…a432` (ERC-7930 = `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`).
ReverseRegistrar `0xa58E81fe…fc7Cb`. ens-cli `set batch` op types: `{type:"address",address}`
(legacy ETH setAddr) + `{type:"text",key,value}`. `mm wallet create`/`select` support a 2nd
TEE wallet under steglabs. Existing scripts already do dry-run sim → `--send` → confirm.

### 3.4 Deferred (not blocking)
- **`agent-endpoint[web]`** — set to the cockpit URL after the frontend deploys (one
  more `setText`; batch with anything else to save a Ledger sig).
- **A2A + MCP endpoints** — build real servers, then publish `agent-endpoint[a2a]`/`[mcp]`
  + add to the card. Web only until they exist (publishing now would mis-point).
- **TEE trust model** — ✅ DONE: `"tee-attestation"` added to `agent-trust-models`
  in milestone 6 step 4 (same day the server wallet was provisioned). Card shows
  `trustModels: ["feedback","tee-attestation"]`.
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
