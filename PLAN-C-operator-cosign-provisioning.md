# Plan — Option C: Operator Co-Sign Provisioning (live deployment)

**Status:** ✅ components 1–4 BUILT + verified; brain deployed live (§5 done) 2026-06-24.
Remaining: optional #5 (push notify); repoint+deploy frontend for a fully-online trio.
**Estimate:** 2–2.5 days MVP.
**Decision:** Build Option **C** (operator co-signs each new-agent mint at request time)
over A (pre-mint pool) or B (delegate parent to a hot key). Rationale below.

---

## 1. Why C

Creating a new subname under `steg.eth` requires a signature from the **owner of the
wrapped parent** (`NameWrapper.setSubnodeRecord`). `steg.eth` is owner-held by the
operator's **Ledger** — by design (`scripts/mint-subname.ts` header: *"This is THE one
operator Ledger signature in the whole milestone-7 demo… only the operator can mint
under it"*). The container's hot key owns *child* names, not the parent, so it cannot mint.

- **A (pre-mint pool):** operator Ledger batch-mints empty hot-key-owned names ahead of
  time; live provisioning claims one. Self-serve/instant, but pre-authorizes a batch.
- **B (delegate parent):** give a hot key `setApprovalForAll`/manager on `steg.eth` →
  headless mint. **Rejected by existing design** ("NO standing setApprovalForAll").
- **C (co-sign at request time):** operator signs each mint individually with the Ledger,
  triggered by a queued request. **Tightest security, least code, matches the real trust
  semantics** (steg.eth is a curated fleet, not an open registrar). Cost: provisioning a
  NEW agent blocks on the operator being reachable with the Ledger. Everything after the
  mint is fully headless.

**Trust property preserved:** nothing the Ledger touches goes near Railway. The mint is
signed + broadcast from the operator's own machine; the deployed brain only *observes*
the on-chain result.

---

## 2. What already exists (the hard half — ~90% reuse)

- **Frontend** `frontend/src/components/AgentLoginProvision.tsx` + `frontend/src/hooks/useMintWatch.ts`:
  user enters email + label → "**awaiting operator mint**" state → polls mainnet `ownerOf`
  until the name exists → **auto-streams `/provision`** when detected. Already shows the
  operator the exact command to run.
- **Brain** `brain/app/provision_routes.py`: `POST /provision` SSE choreography — wallet
  create → fund → records → bind (ERC-8004) → identity → agent_uri → ensip25 → reverse →
  transfer. Explicitly excludes the mint (operator Ledger, out of band).
- **`scripts/mint-subname.ts`**: operator Ledger mint, child owned-by-hot-key
  (`--send`/`--ledger`; `--hot-key` exists but reverts unless signer owns the parent).

**Detection → headless provision is DONE.** The chain is the source of truth and the
browser already watches for the mint. The gap is purely the operator-side loop.

---

## 3. Build plan (next session)

| # | Component | Target | Notes |
|---|---|---|---|
| 1 | **Pending-request store + endpoints** | `brain/app/provision_routes.py`, reuse `brain/app/store.py` | `POST /provision/request {label,email}` records a pending mint (name, owner=hot-key addr, ts, requester) → returns request id. `GET /provision/pending` lists unfulfilled. Mark fulfilled when mint detected on-chain or `/provision` completes. In-memory OK (chain is source of truth; survives restarts via re-detection). |
| 2 | **Operator co-sign CLI** | `scripts/approve-mints.ts` (new) | `--remote <brain-url>`: fetch `/provision/pending`, show each, run the existing `mint-subname.ts` Ledger path per name, broadcast. Thin wrapper over existing mint flow + `fetch`. Operator runs from their local checkout with Ledger plugged in. |
| 3 | **Frontend request hook** | `frontend/src/components/AgentLoginProvision.tsx` | On entering "awaiting" state, also `POST /provision/request` so the operator isn't blind. Keep `useMintWatch` on-chain poll as the detector (robust regardless of how the mint happens). |
| 4 | **Operator endpoint auth** | `brain/app/provision_routes.py` | Bearer-token-protect `/provision/pending` + `/provision/request` (operator token env var). Prevents enumeration/spam. Add basic rate-limit on `/request`. |
| 5 | *(optional)* **Push notification** | `brain/` | Email/Telegram on new request instead of operator polling. +0.5 day. |

**Estimate:** components 1–4 ≈ **2 days**; +0.5 day for #5. Most cost is #2 (co-sign
ergonomics) and #4 (auth); flow + frontend are mostly reused.

---

## 4. Risks / decisions to make

- Operator needs a local checkout + env + Ledger for `approve-mints.ts` (acceptable MVP).
- `/provision/request` needs rate-limiting; operator is the human filter regardless.
- Pending store in-memory is fine — re-detect from chain after restart.
- Decide: poll-based operator (MVP) vs push (#5) — depends on provisioning volume.

---

## 5. Prerequisite — Railway brain deploy (DONE 2026-06-24)

**Status: LIVE** at `https://steg-brain-production.up.railway.app` (Railway project
`steg-chatkit-brain`, service `steg-brain`, production). Components 1–4 verified against it.

C runs on top of the deployed brain. Deploy scope (as built):
- **Dockerfile** (not nixpacks): `python:3.12-slim-bookworm` + Node 20 + Bun 1.3.5 +
  `npm i -g @metamask/agentic-cli@2.0.0`. Repo-root build context (scripts import `../src`,
  read `records/`; `gate.py` runs bun with cwd=repo-root). uvicorn runs `app.main:app
  --app-dir brain`; subprocesses run cwd=/app (REPO_ROOT = parents[2]).
- **Headless mm:** inject **BOTH** files under `~/.metamask/` at boot:
  `session.json` ← `MM_SESSION_B64` **and** `wallets.json` ← `MM_WALLETS_B64`.
  ⚠️ session.json alone is NOT enough — without wallets.json mm returns
  `WALLET_NOT_FOUND`. (swap-quotes/ is cache; not injected.) No `MM_PASSWORD`
  (TEE/session signing only). `entrypoint.sh` writes both.
- **Env:** `OPENAI_API_KEY`, `OPERATOR_HOT_KEY`, `ETH_RPC_URL`,
  `WORKER_URL=https://steg-agent-card.estmcmxci.workers.dev`, `WORKER_API_KEY`,
  `MM_SESSION_B64`, `MM_WALLETS_B64`, `OPERATOR_TOKEN` (component-4 auth; set, stored in
  Railway vars), `PORT` (Railway injects). `STEG_DEMO_NAME` left **unset** — Railway
  rejects empty values, and `gate.py` already defaults it to `""` via `os.environ.get`.
- **Config:** `railway.json` → DOCKERFILE builder, replicas=1 (single signer/session/
  hot-key — no nonce races), healthcheck `/`.
- **Session expiry** is the recurring chore: re-mint locally + update `MM_SESSION_B64`
  (and `MM_WALLETS_B64` if wallets change).

Build artifacts: `Dockerfile`, `entrypoint.sh`, `.dockerignore`, `railway.json` — all
written at repo root. `.dockerignore` excludes `.env`/`brain/.env` (no secret bake-in),
node_modules, venvs, frontend, worker, docs.

**Deploy/verify cheatsheet:** `railway up --ci` (re-link with
`railway link --project steg-chatkit-brain` + `railway service steg-brain` if needed).
Live smoke: `GET /` → 200; `GET /agent/balance` → ok:true (proves mm headless);
operator drain: `bun scripts/approve-mints.ts --remote <url> --token $OPERATOR_TOKEN`.

**Still local:** the frontend's vite proxy `/provision` → `127.0.0.1:8000`. To put the
whole trio online, repoint it (and deploy the frontend) at the Railway brain URL.

---

## 6. Deployed-brain provision diagnosis (2026-06-24) — "Bun crash" was a misdiagnosis

Live UI provision of `uitest.steg.eth` against the deployed brain repeatedly "stopped"
with `Bun v1.3.x (Linux x64)` shown as the error. Bumped Bun 1.3.5→1.3.14: no change.
**Root cause was NOT Bun.** Diagnosed by shelling into the container (`railway ssh`):

- **Railway runs the stack fine.** Container: x86_64, 32 CPU, **256 GB RAM** (74 free),
  avx2/avx512. `mm` (Node 20) works headless. Bun 1.3.14 + viem: reads + `signMessage`
  (secp256k1) **20/20 clean** from `/app`. No segfault, no OOM, no missing instructions.
- **The real failure:** a provision tx (Records multicall ≈ **516k gas ≈ 0.00125 ETH**
  at ~2.4 gwei) exceeded the hot key's balance → node returns RPC **`-32003` /
  `insufficient funds`** → viem throws **uncaught** → Bun prints its version *footer* on
  exit. The brain's SSE error showed only `stderr_tail` (= that footer), and
  `_is_bun_crash()` matched the substring `"bun v1.3"` → misclassified every real error
  as a transient crash and burned retries. **The "Bun crash" was insufficient funds.**
- **Cost reality:** a full ~7-tx provision is **~0.004–0.008 ETH at 2.4 gwei** (scales
  with gas). The hot key had been funded with ~0.0012 ETH — ~10× too little.

**Requirements to run headless provision on Railway reliably:**
1. **Fund the operator hot key ~0.01 ETH/agent** (live-gas dependent), not sub-mEth.
2. **Dedicated mm session** (`session.json` + `wallets.json`) the local box never
   touches — mm rotates one shared refresh-token lineage, so any local `mm` command
   invalidates the deployed copy (the `mm login`→break→re-inject→`railway redeploy -y`
   cycle we hit; note an env-var change alone does NOT swap the instance — force it).
3. **Honest error surfacing (FIXED in `provision_routes.py`):** `_is_bun_crash` now
   matches only true panic signatures (never the version footer); a new `_error_detail`
   surfaces viem's `insufficient funds`/`Details:`/revert message instead of the footer.
   Also: `fund-wallet.ts` is now idempotent (skips if already funded) and the Fund step
   retries on a real crash.

**Update (later 2026-06-24): the deployed brain DOES provision 7/8 steps.** After
funding `0xe53` to 0.01 ETH, a direct-curl `/provision` ran clean through wallet_create
→ fund → records → bind (**agentId 35381**, tx `0x85dce0ed…`) → identity → agent_uri →
ensip25, failing only at **reverse** — again an under-funding masked as a "Bun crash":
the server wallet got `REVERSE_GAS_ETH=0.0003` (sub-gwei calibration) but reverse at
2.4 gwei needs more. **FIXED:** `REVERSE_GAS_ETH` now defaults to `0.001` and is env-
configurable (`provision_routes.py`).

### 6a. THE architectural blocker — mm state is ephemeral on Railway

`~/.metamask/` lives in the container's ephemeral filesystem. Injecting
`session.json`/`wallets.json` via `MM_SESSION_B64`/`MM_WALLETS_B64` only **bootstraps a
fresh container**. Consequences observed:
- **Created server wallets do NOT persist.** The brain's `mm wallet create` writes the
  new wallet into the *container's* `wallets.json`; on the next redeploy that file is
  replaced by the injected (older) one, so the wallet reference is gone. `uitest`'s
  server wallet `0x7ff94285…` was stranded this way — neither local mm nor the
  redeployed brain can address it (the TEE key exists but is unreferenced). Any agent
  provisioned on the deployed brain is lost on the next deploy.
- **The mm refresh-token can't persist.** mm rotates one shared refresh-token lineage;
  the container advances it in-memory/in-file but loses it on redeploy → every redeploy
  needs a fresh local `mm login` + re-inject (the tax paid repeatedly this session).

**REQUIRED FIX: a Railway persistent volume mounted at `/root/.metamask`.** ✅ DONE +
PROVEN (2026-06-24): created volume `steg-brain-volume` at `/root/.metamask`;
`entrypoint.sh` now **bootstraps-if-absent** (writes session/wallets from
`MM_SESSION_B64`/`MM_WALLETS_B64` only when the file is missing; `MM_FORCE_BOOTSTRAP=1`
overrides). Verified: after a fresh bootstrap, a `railway redeploy -y` with **no
re-injection and no `mm login`** kept `/agent/balance` → ok (entrypoint logged
"session.json present on volume — keeping brain-owned state"). The brain now owns its mm
state across deploys: refreshed tokens persist (relogin tax eliminated) and
`mm wallet create` wallets persist (no more stranded agents). Single most important
requirement for headless mm provisioning on Railway — now satisfied.

### 6b. Net "what Railway requires for headless mm provisioning"
1. **Persistent `/root/.metamask` volume** (§6a) — the dealbreaker.
2. **Adequate funding** — operator hot key ~0.01 ETH/agent + `REVERSE_GAS_ETH` scaled to
   live gas. [FIXED: env-configurable, default 0.001]
3. **Honest error surfacing** [FIXED]: `_is_bun_crash` no longer matches the Bun version
   footer; `_error_detail` surfaces the real RPC/insufficient-funds/revert message.
4. (Proven NON-issues) Bun+viem, mm(Node), CPU/RAM/RPC are all fine on Railway amd64.

**`uitest` status:** 7/8 on-chain (identity/bind 35381/records/card live), owned by
`0xe53`, but its server wallet is stranded → needs a clean re-provision under the volume
architecture (don't transfer it to the dead wallet). Funding to finish was never the
whole story; persistence is.
