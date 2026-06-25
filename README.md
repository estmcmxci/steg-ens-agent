# steg — ENS-native agent identity, with an authority gate

Provision an AI agent that has a **human-readable ENS name**, an **ERC-8004 on-chain
identity**, a **TEE-backed wallet it controls**, and — the new part — an **authority gate**:
an ENS record the operator flips to allow or deny the agent's fund-moving actions, read
**keylessly** from L1 by any relying party, *without ever touching the agent's keys*.

The whole thing runs from an email sign-in to a self-sovereign, mainnet-registered agent in
one flow. The agent can then **read, write, and execute on-chain operations through natural
language** — including self-signing updates to its own ENS records.

> Status: working end-to-end on Ethereum mainnet. Repo is private for now; structured to be
> open-sourceable later.

---

## The idea

An agent's signing key is all-or-nothing. To "revoke" an agent today you rotate keys or move
funds — there's no clean *authority* layer separate from the key.

This project puts that authority layer on **ENS**. Three records on the agent's name encode
who may act, what they may do, and whether they're currently allowed to:

| Record | Meaning |
| --- | --- |
| `auth.credential[primary]` | **who** may sign (the agent/server wallet) |
| `auth.capability[primary]` | **what** is allowed (policy; e.g. `erc20.transfer`) |
| `auth.revocation[primary]` | **on/off** — `{"revoked": false \| true}` |

A keyless relying party reads these fresh from L1 before every fund-moving action. Flip
`auth.revocation` at ENS and the agent's *next* action is denied — fail-closed, no key
rotation, no key access required.

Identity is composed via **Adapter8004**: an ERC-8004 agent registration bound into ENS
identity records (**ENSIP-26** identity, **ENSIP-25** registration claim). The agent ends up
owning its own name (self-sovereign handoff) and can govern itself.

---

## Architecture — the trio

```
  Browser (Vite SPA)                 Brain (FastAPI)                Worker (CF)
  ┌────────────────┐  /chatkit       ┌──────────────────┐          ┌─────────────────────┐
  │ login + provis.│ ───────────────▶│ ChatKit agent    │  shells  │ /card, /avatar      │
  │ cockpit (NLI)  │  /provision     │ provisioning job │ ───────▶ │ public agent identity│
  │ ENS watcher    │ ───────────────▶│ the auth GATE    │  /eval   │ /evaluate (verifier)│
  └────────────────┘                 │ mm CLI + viem    │ ◀─────── │ reads auth.* from L1 │
                                      └──────────────────┘          └─────────────────────┘
                                         TEE agent wallet
```

- **Frontend** (`frontend/`) — Vite SPA. Email-login/provision landing + the agent cockpit
  (the natural-language interface). An on-chain watcher kicks off provisioning. In production,
  `frontend/vercel.json` rewrites proxy `/chatkit`, `/agent/*`, `/provision*` → the brain and
  `/api/*` → the worker (same-origin, no CORS).
- **Brain** (`brain/app/`) — FastAPI + ChatKit. Hosts the agent, the **authority gate**
  (`gate.py`), and the provisioning background job (`provision_routes.py`,
  `provision_job_store.py`). Drives a **TEE-based agent-wallet CLI (`mm`)** and `bun`/viem
  scripts. Runs **headless** — see below.
- **Worker** (`worker/`, `src/`) — Cloudflare Worker. The public agent-identity endpoint
  (`/card/<name>`, `/avatar/<name>`) **and** the keyless relying-party verifier
  (`/evaluate`) the gate calls. `/evaluate` reads the agent's `auth.*` straight from L1.

### The headless TEE wallet (the lynchpin)

The agent's keys live in a TEE; the cloud only orchestrates. The wallet:

- **runs fully unattended** — signs real mainnet txs with no human and no exposed key;
- **survives redeploys** — `mm` state (`session.json`, `wallets.json`) lives on a persistent
  volume, bootstrapped once from `MM_SESSION_B64` / `MM_WALLETS_B64`, so the agent's identity
  and keys aren't ephemeral;
- **is fully CLI/script-driven** — `mm` + `bun`/viem (`scripts/`), no GUI, reproducible.

---

## How provisioning works (one flow, 9 steps)

A user picks `<label>.steg.eth` and "signs in with email" (the email is just a queue label,
**not** auth). The request is queued; the **operator co-signs the mint** (e.g. on a Ledger);
the frontend's on-chain watcher fires `POST /provision`; the brain runs a background job,
polled via `GET /provision/status/{id}`:

```
wallet_create → fund → records → bind → identity → agent_uri → ensip25 → reverse → transfer
```

The final `transfer` hands the name to the agent's own TEE wallet → **self-sovereign**.
The `records` step writes the `auth.*` authority records; `bind` does ERC-8004; `identity`
writes ENSIP-26; `ensip25` writes the registration claim.

---

## The gate

`brain/app/gate.py:gate_or_refusal()` runs at the top of every fund-moving tool. It shells a
script to TEE-sign a canonical probe and POSTs it to the worker's `/evaluate`, which reads
the agent's `auth.*` fresh from L1. Revoked → denied (fail-closed). The agent's funds don't
move; nothing broadcasts.

---

## Repo layout

```
frontend/        Vite SPA — login/provision + agent cockpit (NLI)
brain/app/       FastAPI + ChatKit: agent, gate, provisioning job, tools
worker/, src/    Cloudflare Worker: agent card + /evaluate verifier
scripts/         bun/viem: mint, bind, records, reverse, transfer, sign, revoke …
records/         per-agent provisioning receipts (tx hashes, namehashes)
tools/ens-cli/   standalone ENS CLI helper
```

## Running it

Each service reads a gitignored env file; copy the matching `*.example`:

```bash
# 1. Worker (CF) — :8787
cp .dev.vars.example .dev.vars       # fill ETH_RPC_URL etc.
bun run worker:dev

# 2. Brain (FastAPI + ChatKit) — :8000
cp brain/.env.example brain/.env     # OPENAI_API_KEY, ETH_RPC_URL, OPERATOR_HOT_KEY, …
cd brain && uvicorn app.main:app --reload --port 8000

# 3. Frontend (Vite) — :5173
cp frontend/.env.example frontend/.env.local
cd frontend && npm install && npm run dev
```

Typecheck / build: `npm run typecheck` (root), `cd frontend && npm run build`.

## Contracts (mainnet)

- PublicResolver `0xF29100983E058B709F3D539b0c765937B804AC15`
- NameWrapper `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`
- ENS registry `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`

## Security notes

- All real secrets live only in gitignored env files (`.env`, `.env.local`, `.dev.vars`).
  Git history has been audited — no private keys, RPC keys, session blobs, or operator tokens
  were ever committed. ChatKit `domain_pk_*` keys are host-bound public keys.
- A deployed brain **must** set `OPERATOR_TOKEN` to lock down operator-only endpoints (when
  unset, auth is disabled for local dev).
- The demo deployment is single-tenant and the showcase agent is intentionally left
  **revoked** as a safe resting state.
