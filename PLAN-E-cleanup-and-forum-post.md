# Plan E — Repo cleanup + ENS forum post (title TBD)

**Status:** scoped, not started. Follow-on to PLAN-D (Parts 1–3 done; frontend deployed to
Vercel; whole stack validated live incl. the auth gate). This plan has two workstreams:
(A) clean the repo + secret-audit it (open-source-ready, but stays private for now), and
(B) draft an ENS-forum post showing off what we built.

**Decisions locked in (via AskUserQuestion, 2026-06-25; refined 2026-06-25):**
- **Post angle (the real story, title TBD):** *email login → provision an ENS agent identity
  via **Adapter8004** (ENSIP-25 + ENSIP-26 + ERC-8004 registration), plus a new primitive,
  the **auth gate***. The **lynchpin is the TEE server wallet**; the novel/neat bit is that we
  run the TEE server wallet **headlessly (on Railway)**. ("ENS as agent authority" was the old
  framing — NOT the title.)
- **Repo:** clean + secret-audit NOW; **open-source later** (so cleanup is thorough but the
  repo stays private until the post lands).
- **Docs:** **delete all other plan/demo docs** (PLAN-C-*, PLAN-D-*, DEMO.md, etc.) —
  keep ONLY this PLAN-E (it drives the work). No `/docs` consolidation.
- **MetaMask Agent Wallet disclosure:** **generic only** — call it "a TEE-based agent
  wallet"; do NOT name MetaMask Agent Wallet or the Early-Access program (it's a private
  program — the operator was accepted into MM Agent Wallet Early Access; confidentiality
  unclear, so omit specifics).
- **Demo link:** **TBD — operator will swap in a different URL** (NOT
  `https://metamask-two.vercel.app`). Leave a placeholder until provided.
  ⚠️ Whatever URL ships is unauthenticated + single-tenant — mitigations in the Pre-publish
  section.

---

## Context a fresh session needs (read first)

**What we built:** an ENS-native agent system where an agent's *authority to move funds* is
an ENS record the operator controls. Provision a subname per agent, bind it as an ERC-8004
agent, give it a TEE-based agent wallet, and publish `auth.*` records that a keyless relying
party checks before every fund-moving action. Flip `auth.revocation` at ENS → the agent's
next action is denied, without touching its keys. The agent is self-sovereign (owns its own
name, can self-govern).

**The live trio (all deployed):**
- **Frontend (Vercel):** `https://metamask-two.vercel.app` (project `metamask`, scope
  estmcmcxcis-projects). Vite SPA; `frontend/vercel.json` rewrites proxy `/chatkit`,
  `/agent/*`, `/provision`, `/provision/*` → the brain and `/api/*` → the worker
  (server-side, same-origin, no CORS). Prod env: `VITE_CHATKIT_DOMAIN_KEY`
  (`domain_pk_6a3ca4e9…`, host-bound to metamask-two.vercel.app), `VITE_MAINNET_RPC`.
  Landing = email-login/provision flow (App defaults `connected=false`).
- **Brain (Railway):** `https://steg-brain-production.up.railway.app` (project
  `steg-chatkit-brain`, service `steg-brain`). FastAPI in `brain/app/`. Runs `mm` (TEE
  agent-wallet CLI) + `bun scripts/*.ts` (viem). `/root/.metamask` is a Railway volume so
  created wallets + tokens persist across deploys. Deploy: `railway up --ci`.
- **Worker (Cloudflare):** `https://steg-agent-card.estmcmxci.workers.dev` — the public
  on-chain identity endpoint (`/card/<name>`, `/avatar/<name>`) AND the keyless
  relying-party verifier (`/evaluate`) the gate calls.
- **Parent name:** `steg.eth` (wrapped; owned by the operator's **Ledger** `0x4767b190…`).
  Operator **hot key** `0xe53AaAE8…9Ac5` (signs provisioning; from `brain/.env` /
  root `.env` `OPERATOR_HOT_KEY`).

**How provisioning works (Option C, 9 steps):** a user picks `<label>.steg.eth` and "signs
in with email" (email is just a queue label, NOT auth) → request is queued → the **operator
co-signs the mint on a Ledger** (`scripts/mint-subname.ts`; owner = hot key `0xe53`) → the
frontend's on-chain watcher fires `POST /provision` → the brain runs a background job:
`wallet_create → fund → records → bind → identity → agent_uri → ensip25 → reverse →
transfer`, polled via `GET /provision/status/{id}` (PLAN-D Part 2). Final `transfer` hands
the name to the agent's own TEE wallet → self-sovereign.

**The records that encode authority (written during provisioning):**
- `auth.credential[primary]` — who may sign (the server wallet).
- `auth.capability[primary]` — what's allowed (Tier-2 policy; placeholder erc20.transfer).
- `auth.revocation[primary]` — `{"revoked":false|true}`; the live allow↔deny switch.
- ERC-8004 bind → `agent-id`; ENSIP-26 identity (`display`, `description`, `avatar`,
  `agent-skills`, `agent-trust-models`); ENSIP-25 claim
  (`agent-registration[<registry>][<agentId>]="1"`).

**The gate:** `brain/app/gate.py` `gate_or_refusal()` runs at the top of every fund-moving
tool — shells `scripts/demo-mm.ts` to TEE-sign a canonical probe and POST it to the worker
`/evaluate`, which reads the agent's `auth.*` fresh from L1. Revoked → denied (fail-closed).

**Verified showcase facts from this session (cite these in the post — all on mainnet):**
- `uitest10.steg.eth` — agentId **35417**, self-sovereign (owner==addr
  `0x36A4Ca97cC6a5F311f3A96408bB02F0b83f41B8e`), reverse set.
- Self-sovereign ENS write via NLI: set `url` record, tx
  `0xa477cea8fca4f003eb4b1c50fd79790781e77d8d56220ce5d8d5d222b903dfbd`, **self-signed by the
  agent's own wallet** (from = 0x36A4Ca97…), status success.
- Auth gate proven live: agent self-revoked (`auth.revocation[primary]={"revoked":true}`,
  tx `0x49cf20e8…`) → a confirmed 0.0001 ETH transfer was **BLOCKED** with the verbatim
  gate message:
  > ⛔ BLOCKED by the ENS authority gate: This agent's ability to move funds has been
  > REVOKED by its operator. The onchain record auth.revocation[primary] for
  > uitest10.steg.eth is set to {"revoked"} — all fund-moving actions are currently paused.
  > Nothing was sent.
- uitest10 is currently **left revoked** on purpose (safer resting state while the URL is public).
- Part-2 resilience demoed for real: during a provision the operator's wifi dropped, the
  browser UI timed out, but the server-side background job kept running.

**Contracts:** PublicResolver `0xF29100983E058B709F3D539b0c765937B804AC15`; NameWrapper
`0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401`; ENS registry `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`.

---

## Workstream A — Repo cleanup (open-source-ready; repo stays PRIVATE for now)

**Goal:** tidy + provably secret-safe, so it can be open-sourced later by flipping one switch.

1. **Purge ephemeral artifacts.** `.playwright-mcp/` (screenshots, console/network logs),
   any stray `provision-ring.png` / `uitest5-cockpit.png` at repo root, `dist/`, the
   scratchpad dir, leftover `scripts/_tmp_*.ts` (already removed). Audit `.gitignore` covers
   `node_modules`, `dist`, `.vercel`, `.env*`, `.playwright-mcp`.

2. **Secret audit — the gate for ever going public.**
   - **Inventory live secrets (confirm each is gitignored, NOT tracked):**
     - root `.env`: `OPERATOR_HOT_KEY` (priv key `0xbfc17f37…` → `0xe53`), `ETH_RPC_URL`
       (Alchemy key), `STEG_FLEET_NAME`.
     - `brain/.env`: `OPERATOR_HOT_KEY`, `ETH_RPC_URL`, `OPERATOR_TOKEN`, `MM_SESSION_B64`,
       `MM_WALLETS_B64`, `WORKER_URL`, `CARD_WORKER_BASE`, `REVERSE_GAS_ETH`, `STEG_PARENT`.
     - `frontend/.env.local`: `VITE_AGENT_NAME`, `VITE_MAINNET_RPC` (Alchemy — ships in the
       client bundle by design).
     - Vercel prod env (not in repo): `VITE_CHATKIT_DOMAIN_KEY`, `VITE_MAINNET_RPC`.
   - **Scan git HISTORY** for committed secrets before open-sourcing:
     `git log -p | grep -iE '0x[a-f0-9]{64}|alchemy|g/v2/|domain_pk_|MM_(SESSION|WALLETS)'`.
     If anything real is found → scrub with `git filter-repo` (or BFG) + rotate the key.
     NOTE: `OPERATOR_HOT_KEY` priv key value appears in **this and earlier PLAN docs / memory
     only as the address**, but double-check no PLAN-*.md or committed file embeds the raw
     0xbfc17f37… private key. The Alchemy URL `…/v2/lrMqugbPNZcypSuWA_g9C` HAS appeared in
     committed mint-script *output*? (it prints `rpc:` to stderr, not committed) — verify.
   - **Hardcoded ChatKit domain keys:** `frontend/src/components/ChatPanel.tsx` has a
     fallback `domain_pk_69a088ac…`; git history also has `domain_pk_6a3ca4e9…`. These are
     ChatKit *domain public keys* (host-bound, low sensitivity) — decide keep vs drop the
     fallback before public.
   - Add **`.env.example`** templates (root, brain, frontend) listing every var with dummy
     values + a one-line comment each.
   - Rotate `OPERATOR_TOKEN` + consider rotating the operator hot key before/after public.

3. **Docs cleanup (delete, don't consolidate).** **Delete** all other plan/demo docs —
   `PLAN-C-*.md`, `PLAN-D-*.md`, `DEMO.md`, and any other stray `*.md` notes — keeping ONLY
   this `PLAN-E-cleanup-and-forum-post.md` (it drives the remaining work). Then write a
   top-level **`README.md`** that explains the system (architecture; the email-login →
   Adapter8004 provisioning → auth-gate flow; the headless TEE server wallet; how to run the
   trio) — this is the source of truth the forum post is distilled from.

4. **Known issues — fix or document (both surfaced live this session):**
   - **Transfer step (step 9) is non-retryable + 150s timeout** → under RPC latency it can
     time out, leaving an agent provisioned-through-reverse but NOT handed off (operator
     still owns it; not self-sovereign). Seen on `uitest9.steg.eth` (owner still
     `0xe53`, addr `0xBFBC51…`, agentId 35416 — recoverable via
     `bun scripts/transfer-subname.ts --name uitest9.steg.eth --to 0xBFBC518847718AeAf61D16cA3B2f6e736Ba12342 --send --yes`).
     FIX: give transfer a **safe timeout-only retry** (a timed-out-but-mined transfer leaves
     the hot key no longer owner, so a retry fails cleanly — no double-transfer). ~5 lines in
     `brain/app/provision_routes.py` + redeploy.
   - **NLI hallucinates data for unsupported tools.** Asked for Aave APYs, the agent invented
     "6.64%/9.71%" (Aave is NOT implemented — cockpit Aave tab says "coming soon"). Only when
     pushed did it admit it has no Aave tool. For a fund-moving agent this is a trust bug →
     FIX: system-prompt the agent to disclaim unsupported capabilities instead of fabricating.

5. **Verify still green:** `brain/.venv/bin/python -m py_compile app/*.py`; `cd frontend &&
   npx tsc --noEmit && npm run build`.

---

## Workstream B — ENS forum post ("ENS as agent authority")

**Deliverable:** a forum-ready Markdown draft + a curated screenshot set. Distill from the
new README + the verified facts above.

**Process:** draft **collaboratively** — use the AskUserQuestion tool to extract "the juice"
(the hero moment, the framing/angle, the novel claims, tone/length) from the operator before
and during drafting, rather than writing it solo from the facts. The outline below is the
skeleton; the questioning fills in the soul.

**Juice captured (AskUserQuestion, 2026-06-25):**
- **Title:** TBD (not "ENS as agent authority").
- **Hero moments — use ALL four, braided:** (1) headless TEE wallet on Railway, (2) the auth
  gate (flip a record → next action blocked), (3) email → self-sovereign agent, (4) the
  Adapter8004 standards stack.
- **Lead (first ~2 paragraphs) braids:** the auth-gate primitive + ENS-as-agent-identity +
  Adapter8004 standards composition + the headless server. (Layered lead, not single-angle.)
- **Intent:** *showcase / inspire builders* ("look what's now possible on ENS"); reach &
  adoption over RFC.
- **Length:** standard technical, **~1200–1800 words** (full arc per the outline).
- **TEE flex to emphasize:** keys never leave the TEE yet it runs **unattended**; **survives
  redeploys** (persistent Railway volume — wallet/session not ephemeral); **fully
  CLI/script-driven & reproducible** (`mm` + bun/viem, no GUI).
- **Honest novelty claims (all of these):** the auth gate (keyless, L1-read revocation
  decoupled from the key); **ERC-8004 ↔ ENS via Adapter8004** (the composition); the
  **self-sovereign handoff** (agent ends up owning its own name); **all live on mainnet
  end-to-end**; and **provisioning all these compositions in ONE flow**.
- **Open questions to pose (drives replies):** (a) **capability granularity** — how
  fine-grained should `auth.capability` get (per-tool? per-amount? policy language?); (b)
  **TEE trust assumptions** — what trusting a TEE for agent keys implies, and is it
  acceptable. (Dropped: auth.* naming + "should it be an ENSIP" as lead Qs.)
- **Voice:** **fully named / personal**, first-person. **Byline: `estmcmxci`.**
- **Demo link:** TBD — operator will swap in a URL (NOT metamask-two.vercel.app).
- **Title direction:** demo/outcome-forward (the arc) — BUT must convey that the agent has a
  **full, TEE-backed, ENS-bound wallet that can read / write / execute on-chain ops via a
  natural-language interface (NLI)**, not just a passive identity. I'll propose 2–3 concrete
  titles at the top of the draft for the operator to pick.
- **⭐ Don't under-sell (operator flagged):** the agent isn't just *named* — its TEE wallet is
  **bound to its ENS name** and the operator/agent **reads, writes, and executes on-chain
  operations through natural language** (the cockpit/NLI). Identity + authority + *agency*
  (it can actually act, and self-write its own ENS records). Weave this through the lead, the
  "how it works," and the demo.

**Draft outline:**
1. **Hook** — "What if an AI agent's permission to move funds was an ENS record you control —
   flip it off and its next action is denied, without ever touching its keys?"
2. **Problem** — agent signing keys are all-or-nothing; today, revoking access means rotating
   keys / moving funds. There's no clean *authority* layer separate from the key.
3. **The idea** — ENS as the control plane. Three records on the agent's name:
   `auth.credential[primary]` (who may sign), `auth.capability[primary]` (what it may do),
   `auth.revocation[primary]` (on/off) — read **keylessly** by any relying party straight
   from L1.
4. **How it works** (concise, with the 9-step provisioning + the gate) — subname per agent →
   ERC-8004 bind → ENSIP-25/26 identity → a **TEE-based agent wallet** holds the keys → every
   fund-moving action first checks the agent's ENS `auth.*` via a keyless `/evaluate` →
   operator flips `auth.revocation` at ENS → next action blocked. Self-sovereign: the agent
   owns its own name and can even self-govern.
5. **Proof / live demo** — provision an agent under `<name>.steg.eth` from just an email;
   revoke at ENS; watch a transfer get blocked. Link `https://metamask-two.vercel.app` +
   screenshots (the gate-blocked message, the radial provisioning ring, the success/identity
   card). Cite the real txs (uitest10 agentId 35417; gate-block; self-signed `url` write
   `0xa477cea8…`).
6. **Why ENS specifically** — human-readable identity, resolver-as-policy-store, reverse
   records for the agent's own name, composability with ERC-8004; the operator controls
   authority at ENS independently of the signing key.
7. **Open questions for the community** — naming conventions for `auth.*` record keys; should
   this be an ENSIP?; relationship to ERC-8004; capability granularity.
8. **CTA** — try the demo, give feedback.

**Tone/constraints:** generic "TEE-based agent wallet" only (no MetaMask/Early-Access
naming). Lead with the ENS angle; keep crypto-jargon tight (ENS forum audience is technical
but ENS-centric, not necessarily agent-infra people).

**Screenshots to (re)capture** via Playwright on the live site (the ones from this session
are ephemeral in `.playwright-mcp/`): (a) the email-login landing card, (b) the radial ring
mid-provision ("N/9 · <step>" + rolling text), (c) the success "✓ <name> is live" panel with
TEE wallet + ERC-8004 id, (d) the Identity tab (records + self-sovereign manager), (e) the
**gate-blocked** chat message. Optionally a short screen recording of provision → revoke →
blocked.

---

## Pre-publish safety (URL goes public, unauthenticated, single-tenant)
- **Leave the showcase agent REVOKED** so fund-moving is blocked for random visitors
  (uitest10 already is). Or pre-provision a dedicated read-only showcase agent.
- Keep agent + operator (`0xe53`) balances trivial (limits damage from spam provisions /
  NLI abuse). At time of writing operator ≈ 0.0035 ETH.
- The post should note provisioning is **operator-co-signed** (Ledger) — a visitor can
  *request* a name but the operator approves it, so the demo is interact-with-NLI +
  request-a-mint, not fully self-serve.
- Known caveat to disclose or fix first: brain is single-tenant (one `mm`, one active
  wallet) with open `/chatkit`,`/agent`,`/provision` + CORS `*`. Real hardening (later):
  Vercel Deployment Protection, or auth on those endpoints + per-session wallet isolation.

---

## Suggested order
1. Workstream A: cleanup + secret audit + README (foundation; README feeds the post).
2. Workstream B: draft the forum post from the README + verified facts.
3. Recapture the screenshot set on the live site.
4. Pre-publish safety pass, then post.

## Session start (services from this session may be down)
- Frontend is DEPLOYED (Vercel) — no local dev server needed to view it. For local iteration:
  `cd frontend && npm run dev` (:5173; vite proxies to the deployed brain + worker).
- Brain + worker are deployed; no local services required.
- Playwright is an MCP server (`plugin:playwright:playwright`) — if its tools aren't loaded,
  run `/mcp` to reconnect, then `ToolSearch("select:mcp__plugin_playwright_playwright__browser_navigate,…")`.
  Driving the ChatKit NLI: it's a cross-origin iframe — use `browser_snapshot target=iframe`
  refs (not JS); card buttons need a JS click (`button.prov-card__cta` etc.) due to the
  iframe pointer-intercept. Kill stale `ms-playwright-mcp` chrome if the profile is locked.
- Git: local-only repo (no remote yet), branch `feat/option-c-provisioning-deploy`. Recent
  commits: a9cb0d6 (PLAN-D P1+P2), 4214d51 (P3), 18e1536 (retry-msg + WalletConnect),
  dc64e1a (Vercel deploy prep).
