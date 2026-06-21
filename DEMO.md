# DEMO.md — Steg agent-wallet cockpit, one-shot e2e demo

The full thesis in one continuous run: **email → a self-sovereign MetaMask TEE agent
wallet named under ENS, with a verifiable ERC-8004 identity + ENS-published authorization,
that manages its own records and acts onchain — all via chat (NLI).**

This was **proven end-to-end on mainnet** this session with agent **`carlos.steg.eth`**
(see §6 Reference run). This doc is the runbook to repeat it in one shot. It works
**Playwright-driven** (fast) or **manual** (fallback) — each step lists both.

> ⚠️ One human action only: **a single operator Ledger tap** to mint the subname (§ Act 1).
> Everything else is hands-off (hot-key + TEE signed).

---

## 0. What the demo proves (the 4 acts)

| Act | Beat | Mechanism |
|---|---|---|
| **1 Onboard** | email → pick a name → provision a **self-sovereign** agent (it owns its own ENS name) + avatar | mint (1 Ledger) → `/provision` (hot-key + TEE) → name transferred to the agent's TEE wallet |
| **2 Identity** | agent **proves** its verifiable identity (ERC-8004 + auth.*) + **edits its own records** (chat + the Edit-records UI) | `agent_identity` (dynamic) + `ens_set_records_*` (TEE-signed) |
| **3 Action** | gated **swap** (ETH→USDC) + **predict reads** (Polymarket odds) | `swap_execute` / `predict_markets_search`, each through the ENS authority gate |
| **4 Self-governance** | agent **pauses itself** at ENS → gate **denies** its next tx → **resumes** → tx allowed | `ens_set_records` flips `auth.revocation[primary]`; `/evaluate` gate enforces it |

---

## 1. Prerequisites & setup (MUST be green before Act 1)

### 1.1 Infra fixes that make the demo stable (already in the tree, uncommitted)
These were the hard-won fixes this session — confirm they're present:
- **Alchemy RPC everywhere** (free RPCs are too slow / rate-limit). Wired into **4 gitignored files**:
  - `worker/.dev.vars` → `ETH_RPC_URL_MAINNET=<alchemy>`
  - `brain/.env` → `ETH_RPC_URL=<alchemy>`
  - repo `.env` → `ETH_RPC_URL=<alchemy>` (bun scripts)
  - `frontend/.env.local` → `VITE_MAINNET_RPC=<alchemy>` (+ `VITE_AGENT_NAME=<demo name>`)
  - Alchemy URL: `https://eth-mainnet.g.alchemy.com/v2/<KEY>` — the real key lives ONLY in the
    gitignored env files above (never commit it). `$ALCHEMY` in this doc = that full URL.
- **Worker profile reads parallelized** (`worker/lib/reads.ts`) — was a sequential await-loop (~14s); now `Promise.all` (~2-6s). Without this the card shows "Could not load profile".
- **Balance via Alchemy fallback** (`brain/app/agent_routes.py`) — mm's account-balance API **429s hard** under load; `/agent/balance` now computes ETH+USDC+Chainlink-price directly from the RPC when mm fails.
- **Provision retry-hardened** (`brain/app/provision_routes.py`) — the idempotent setText steps retry on the intermittent **Bun 1.3.5 native crash**. Provision also transfers the name to the **agent's own TEE wallet** (self-sovereign), not the operator.
- **Dynamic identity** (`brain/app/tools/wallet.py` `agent_identity`) — resolves the ACTIVE wallet's reverse ENS, so the agent reports as whichever agent it currently is.
- **TEE record-editing tools** (`brain/app/tools/actions.py` `ens_set_records_preview/_execute`) + **gate on all fund-moving actions** (perps/predict too).

### 1.2 Start the three services (3 tabs), all on Alchemy
```bash
# worker (CF Worker, :8787) — reads .dev.vars (Alchemy)
cd ~/Desktop/metamask && bun run worker:dev
# brain (FastAPI + ChatKit, :8000) — reads brain/.env (Alchemy, OPENAI_API_KEY, OPERATOR_HOT_KEY, WORKER_URL)
cd ~/Desktop/metamask/brain && .venv/bin/uvicorn app.main:app --port 8000
# frontend (Vite, :5173) — reads frontend/.env.local (VITE_MAINNET_RPC, VITE_AGENT_NAME)
cd ~/Desktop/metamask/frontend && npm run dev
```
Health check: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:{8787,8000}/ && curl ... :5173/` → all `200`.

### 1.3 mm session + operator hot key + funds
- **mm logged in** as the on-disk steglabs server-wallet session. `mm wallet show --json` → `ok:true`. If the
  cliToken expired (it dies in ~1-2 days, refresh can hard-fail), run `mm login email` + OTP (human).
- **`OPERATOR_HOT_KEY`** in `brain/.env` = a **clean EOA** (`cast wallet new`), **funded ~0.001 ETH**.
  - This session reused hot key `0xe53AaAE8CDde5077e60775A9e509d541A38d9Ac5`.
- Pick a **fresh demo label** (taken: demo, demo2, demo3, alice, bob, carlos). Next e.g. `dave`.

### 1.4 Preflight (read-only, GO/NO-GO)
```bash
cd ~/Desktop/metamask
export OPERATOR_HOT_KEY=$(grep '^OPERATOR_HOT_KEY=' brain/.env | cut -d= -f2-)
bun scripts/preflight-demo.ts --name dave.steg.eth --min-gas 0.0006   # expect: VERDICT: GO
```
Set the cockpit's default anchor to the demo name so reloads land on it:
```bash
echo "VITE_AGENT_NAME=dave.steg.eth" >> frontend/.env.local   # restart vite after editing
```

---

## 2. Act 1 — Onboard (the one Ledger tap + hands-off provision)

### 2.1 Mint the subname — **THE ONLY HUMAN ACTION** (operator Ledger)
```bash
OPERATOR_HOT_KEY=$(grep '^OPERATOR_HOT_KEY=' brain/.env | cut -d= -f2-) \
  bun scripts/mint-subname.ts --name dave.steg.eth --send
# type 'yes' → approve setSubnodeRecord on the Ledger. Mints dave.steg.eth → owned by the hot key.
```
Verify: `cast call 0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401 "ownerOf(uint256)(address)" $(cast namehash dave.steg.eth) --rpc-url $ALCHEMY` == the hot key.

### 2.2 Drive the cockpit: email → label → provision
- **Manual:** open `http://localhost:5173/` → **Disconnect** (if connected) → type any email + the label `dave` → **Continue with email** → an "awaiting operator mint" panel appears. Because the mint already landed, the in-browser poll detects it within ~4s and **auto-streams `/provision`** (9 steps). Wait for "**dave.steg.eth is live**" → click **Open dave.steg.eth**.
- **Curl alternative (no UI):** `curl -N -X POST http://127.0.0.1:8000/provision -H 'content-type: application/json' -d '{"name":"dave.steg.eth","label":"dave"}'` → watch the SSE `complete` frame for `agentId` + `serverWallet`.
- **Playwright notes** (the cockpit is a single narrow card with the chat in an `iframe[name=chatkit]`; the iframe **intercepts pointer events** over the card → use **JS clicks** for card buttons):
  ```js
  // reach login + submit (React inputs need the native setter + input event)
  const setVal=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  const dc=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Disconnect'); if(dc) dc.click();
  // after the login card renders (.pcard__login):
  const card=document.querySelector('.pcard__login');
  setVal(card.querySelector('input[type=email]'),'m@oakgroup.co');
  setVal(card.querySelector('.pcard__login-input--label'),'dave');
  card.querySelector('form').requestSubmit();
  // poll for the success block then click "Open dave.steg.eth":
  document.querySelector('.prov-card__success .prov-card__cta')?.click();
  ```
  Provision takes ~2-3 min; poll `.prov-card__success` (done) / `.prov-card__error`.

### 2.3 Verify self-sovereign + fund for Act 3
```bash
NODE=$(cast namehash dave.steg.eth); R=0xF29100983E058B709F3D539b0c765937B804AC15; NW=0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
WALLET=$(cast call $R "addr(bytes32)(address)" $NODE --rpc-url $ALCHEMY)
echo "owner == wallet (self-sovereign)? $(cast call $NW "ownerOf(uint256)(address)" $NODE --rpc-url $ALCHEMY) vs $WALLET"
cast call $R "text(bytes32,string)(string)" $NODE avatar --rpc-url $ALCHEMY    # avatar set during provision
# card verified:
curl -s https://steg-agent-card.estmcmxci.workers.dev/card/dave.steg.eth | python3 -c "import json,sys;print(json.load(sys.stdin)['x-ens']['erc8004'])"  # {registered, verified:true, agentId}
```
**Fund the agent by SWEEPING the previous demo agent → the new one** (recycle the demo
float — the prior run's agent still holds ETH + USDC). Both legs are mm TEE sends from
the previous agent; no fresh ETH needed. **Prev agent this session = `carlos` =
`0xbCE78fb759Aa6B3f9478cE08e0AdF1Ca1dD847Ef` (~$3.28: ETH + 0.86 USDC).**
```bash
PREV=0xbCE78fb759Aa6B3f9478cE08e0AdF1Ca1dD847Ef        # carlos (last run's agent)
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
mm wallet select --address $PREV --json

# 1) sweep USDC: USDC.transfer(newWallet, fullUsdcBalance)
USDC_BAL=$(cast call $USDC "balanceOf(address)(uint256)" $PREV --rpc-url $ALCHEMY | awk '{print $1}')
mm wallet send-transaction --chain-id 1 \
  --payload "{\"to\":\"$USDC\",\"data\":\"$(cast calldata 'transfer(address,uint256)' $WALLET $USDC_BAL)\"}" \
  --intent "sweep USDC -> new agent" --wait --json

# 2) sweep ETH: send (balance − ~0.0002 gas reserve) to the new wallet
ETH_WEI=$(cast balance $PREV --rpc-url $ALCHEMY); SEND_WEI=$(python3 -c "print($ETH_WEI - 200000000000000)")
mm wallet send-transaction --chain-id 1 \
  --payload "{\"to\":\"$WALLET\",\"value\":\"$(cast to-hex $SEND_WEI)\"}" \
  --intent "sweep ETH -> new agent" --wait --json

mm wallet select --address $WALLET --json              # agent acts as ITSELF for the demo
```
> If the prev agent is drained (or it's the first run), top up from a funded source instead:
> `mm wallet select --address 0x0943142F488fb694141841bF46e17Be2bB5C7EE1 --json` then send ~0.0017 ETH to `$WALLET`.

The cockpit header should now show **dave.steg.eth · avatar · ~$3** (balance via the Alchemy fallback).

---

## 3. Act 2 — Self-sovereign identity (chat + the Edit-records UI)

All chat actions: type the prompt → agent **previews** → reply **`yes`** → it **TEE-signs** (the agent owns
its name) → returns a clickable Etherscan link. Playwright: chat input is
`iframe[name=chatkit] >> getByRole('textbox',{name:'Ask me anything about ENS...'})`, send is
`getByRole('button',{name:'Send message'})`; **refs change per message — re-snapshot each time.**

1. **Prove identity** (the headline):
   > *Prove you're a verifiable onchain agent: show your ERC-8004 agent registration, your published ENS authorization state (auth.credential signer, auth.capability, and whether auth.revocation shows you're revoked), and your verifiable card link. Explain what each one proves.*
   - Expect: ERC-8004 id, `auth.credential` signer = the agent's own wallet, `auth.capability`, `auth.revocation {revoked:false}`, and a clickable `/card/dave.steg.eth` link.
2. **Edit records via chat:**
   > *Set my description to "Self-sovereign ENS agent — owns its own name" and my url to https://steg.eth.link*
   → `yes`. Verify: `cast call $R "text(bytes32,string)(string)" $NODE description --rpc-url $ALCHEMY`.
3. **Edit records via the Edit-records UI** (drive the actual editor):
   - **Manual/Playwright:** **expand the card** (click the header — it's collapsed by default) → **Identity** tab → click **Edit records** (the pencil by "RECORDS") → fill **Twitter** `@estmcmxci`, **GitHub** `steg-eth`, **Telegram** `estmcmxci`, **Email** `m@oakgroup.co` → **Save Changes**.
   - This injects an NLI prompt with **canonical keys** (`com.twitter`, `com.github`, `org.telegram`, `email`) into the chat → agent previews → reply `yes` → TEE-signs.
   - Playwright (card is JS-click territory): expand via `document.querySelector('.pcard__header')` click or real-click the header button; the editor inputs are real Playwright `getByRole('textbox',{name:'Enter twitter...'})` etc.; Save = `getByRole('button',{name:'Save Changes'})`.
   - Verify: `for k in com.twitter com.github org.telegram email; do cast call $R "text(bytes32,string)(string)" $NODE "$k" --rpc-url $ALCHEMY; done`.

---

## 4. Act 3 — Real onchain action, gated

1. **Balance + swap:**
   > *What's my balance? Then swap 0.0005 ETH to USDC.*
   → agent reads balance, quotes (Mayan, same-chain), asks confirm → `yes` → **gate ALLOWS** → broadcasts → Etherscan link. The agent re-quotes if the first quote expired. Verify: the agent's USDC balanceOf increases (~0.86 USDC).
2. **Predict reads (no placing — placing needs per-wallet `mm predict setup` + USDC):**
   > *Search Polymarket for active prediction markets about Bitcoin and show me the current odds.*
   → returns live markets with Yes/No odds. (Geoblock is clear from NZ.)

> **Bridge is intentionally dropped.** Relay/Mayan are **intent-based**: `mm` returns an order id that
> `_augment_tx` mis-reports as a settled tx (dead Etherscan link), and small amounts (0.001 ETH) fall below the
> fill threshold so nothing moves onchain. **Known bug to fix before showing a bridge** (detect order-id vs
> tx-hash; enforce a min bridge amount). Swap already carries "real onchain action."

---

## 5. Act 4 — Self-governance (the climax, no operator)

1. **Pause:**
   > *Pause your ability to transact — revoke your own authorization at ENS.*
   → `yes` → agent `ens_set_records` sets `auth.revocation[primary] = {"revoked":true}` (ungated record edit) → TEE-signs.
2. **Deny:**
   > *Now send a 0-value transaction from your wallet to itself.*
   → preview → `yes` → **gate DENIES** with `⛔ BLOCKED by the ENS authority gate (REVOKED)`. **Nothing broadcasts** — verify nonce unchanged: `cast nonce $WALLET --rpc-url $ALCHEMY`.
3. **Resume:**
   > *Resume — restore your authority.*
   → `yes` → sets `{"revoked":false}` → TEE-signs.
4. **Allow:**
   > *Now send that 0-value transaction.*
   → preview → `yes` → **gate ALLOWS** → broadcasts → Etherscan link. The decision flipped **purely on the
   agent's own ENS record**, key untouched.

---

## 6. Reference run (proven this session — `carlos.steg.eth`)

| | |
|---|---|
| name / agent id | `carlos.steg.eth` / ERC-8004 **35276** |
| TEE wallet (owns its own name) | `0xbCE78fb759Aa6B3f9478cE08e0AdF1Ca1dD847Ef` |
| hot key (provisioning) | `0xe53AaAE8CDde5077e60775A9e509d541A38d9Ac5` |
| mint (operator Ledger) | `0xd1340ba7720d295ca79770cf7508a31682a8f8168923bb0095fdbe167689975a` |
| description+url (chat, TEE) | `0x2a94efc1b4eeda5679d11092aa41ce282be148ef0faedb338541f38388d75276` |
| socials (UI editor → NLI, TEE) | `0xc49db4647ad4b3aa6e75c09e132a3f04ce229e4b02fa3d4d46fd6e32abef5748` |
| swap → 0.8593 USDC | via Mayan (carlos holds the USDC) |
| self-revoke (TEE) | `0x099a026a028368d0787ca676558cc146a7e56a6e44965de11f16bfe22320b71e` |
| card | https://steg-agent-card.estmcmxci.workers.dev/card/carlos.steg.eth → `verified:true` |

Verified: self-sovereign (owner == TEE wallet), avatar set, all records signed by the agent's **own** wallet,
gate deny landed (nonce unchanged), resume restored `{revoked:false}`.

---

## 7. Gotchas / cheat-sheet for the next session
- **Single human step** = the mint Ledger tap. If it fails with an RPC 408/429, the demo RPC was a free tier — Alchemy is wired now, retry.
- **Bun crash** on a setText step mid-provision is intermittent — the retry-hardening recovers it; if a fresh provision still dies, the steps are idempotent (re-run the failed `set-*.ts --hot-key --send`).
- **Card shows "Could not load profile"** → the worker `/profile` is slow/failed; confirm the parallel-reads fix is in `worker/lib/reads.ts` and the worker is on Alchemy (`worker/.dev.vars`). A transient first-load can need one **Retry** click.
- **Balance blank** → mm's balance API 429; the Alchemy fallback in `agent_routes.py` covers it. Don't poll `mm wallet balance` in a loop (it trips the 429).
- **Playwright + the card**: the ChatKit iframe overlaps the card → **JS-click** card controls (Disconnect, header-expand, Edit-records, Open). The **chat** and the **editor inputs** take real Playwright clicks/typing. Message refs change every turn — re-snapshot.
- **Anchor resets to the default agent** after a React error-boundary "Try again" → set `VITE_AGENT_NAME=<demo>.steg.eth` in `frontend/.env.local` so reloads land on the demo agent.
- Everything is on **mainnet**; gas is ~0.1-0.25 gwei (a few cents per action).
