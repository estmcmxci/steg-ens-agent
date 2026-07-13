# PRD — ENSv2 USDC Registrar Concierge for `steg-ens-agent`

> **talk to a bot, pay in one flow, get an ENS name delivered to your address.**

## Status
Draft

## Owner
Émile / `steg-ens-agent`

## Summary
Build a **public vendor / registrar concierge** on top of `steg-ens-agent` that lets a user converse with `@stegdotbot`, pay in **USDC**, and have the system register an ENS name **on behalf of** the user directly to their intended wallet.

The core bet is that **ENSv2 Sepolia** is a much better substrate for this than ENSv1 because:
- the registrar supports **ERC20 payment tokens**
- pricing is **USD-denominated**
- `register()` takes an explicit **`owner`** parameter
- `steg-ens-agent` already has:
  - a conversational Telegram surface
  - a TEE-backed execution wallet
  - x402-compatible payment/signing primitives

This PRD defines:
1. the product
2. the minimum viable architecture
3. the implementation plan mapping `steg` vs `ensemble`
4. the proof-script plan for validating the onchain OBO flow on ENSv2 Sepolia with USDC

---

## Problem
Today, ENS registration is operationally awkward for both humans and agents:
- commit-reveal is multi-step
- pricing is dynamic
- setup flows are annoying
- in ENSv1, payment being ETH-native makes USDC/x402 merchant flows awkward

Meanwhile, `steg-ens-agent` already has an agent runtime, a TEE wallet, and a Telegram bot; and `ensemble-beta` already has clean ENS registration orchestration primitives.

The missing product is a **public conversational vendor** that can:
- quote an ENS registration job
- accept payment from a user
- execute registration on behalf of that user
- deliver the name directly to the user’s target wallet

---

## Product thesis
The right abstraction is **not** “pay the agent a fee.”

The right abstraction is:

> buy a fulfilled registration job from a public agent vendor.

That means the user should be able to say:

> register `alice.eth` to `0x...`

and the bot should:
1. verify availability
2. quote an all-in price
3. accept payment
4. fulfill commit + register
5. deliver the name directly to the intended wallet

---

## Goals

### Primary goal
Prove and then ship a public-vendor flow where:
- buyer pays in **USDC**
- vendor executes on **ENSv2 Sepolia**
- name is registered **OBO the buyer**
- owner of the registered name is the buyer’s wallet, not the vendor wallet

### Secondary goals
- keep the user experience conversational
- reuse as much of `steg-ens-agent` as possible
- reuse or port the deterministic ENS registration flow from `ensemble-beta`
- support future x402-native machine buyers without forcing raw x402 UX onto Telegram humans

### Non-goals (v1)
- mainnet launch
- renewals
- premium / Dutch-auction edge cases beyond price quoting
- complex subregistry setup
- full reverse/primary-name automation if not yet proven
- mass search / marketplaces
- generalized public registrar protocol API

---

## User stories

### Story 1 — human Telegram buyer
As a Telegram user,
I want to message `@stegdotbot` with a desired ENS name and my wallet,
so that the bot can quote me, take payment, and register the name to my wallet.

### Story 2 — programmatic buyer
As an x402-capable agent or machine client,
I want to request a quote and pay programmatically,
so that the same vendor backend can fulfill the registration job without human chat UX.

### Story 3 — operator / developer
As the operator of `steg-ens-agent`,
I want a deterministic job engine and proof script,
so I can validate the OBO registration path before wrapping it in Telegram/payment UX.

---

## Product requirements

### Core functional requirements
1. User can request registration of an exact `.eth` label.
2. User can specify a target owner wallet.
3. System checks availability on ENSv2 Sepolia.
4. System quotes a **single all-in USDC price**.
5. System creates a registration job bound to that quote.
6. System records payment against that job.
7. System commits the registration.
8. System waits the minimum commitment age.
9. System registers the name with:
   - `owner = target wallet`
   - `paymentToken = Sepolia USDC`
10. System returns receipts and final status.

### Nice-to-have v1.1
- optional forward resolution setup to target wallet
- optional conversational discovery / alternative suggestions
- x402-native buyer endpoint using the same backend job model

### Explicitly deferred
- auto primary-name setup for user wallet unless fully verified
- reverse resolution automation if authority/signature model is not yet settled

---

## UX requirements

### Telegram buyer flow
1. User: `register alice.eth to 0xabc...`
2. Bot: confirms availability + returns all-in price + quote expiry.
3. Bot: provides payment instruction / invoice.
4. After payment settles, bot confirms it is executing commit.
5. After wait window, bot confirms registration.
6. Bot returns tx hashes and final owner.

### UX principles
- user should never need to understand commit-reveal internals
- price should be presented as a **job purchase**, not as “agent fee + separate work”
- buyer should know the quote expiry and the exact target wallet

---

## System architecture

### Layer 1 — conversational control plane (`steg`)
Use `steg-ens-agent` as the front door:
- Telegram bot UX
- job creation
- payment state
- status updates
- final delivery messaging

### Layer 2 — deterministic registration engine (`ensemble` logic)
Borrow / port the ENS registration engine shape from `ensemble-beta`:
- label normalization
- availability check
- commitment generation
- session persistence
- register payload prep
- retry-safe job state transitions

This may live as:
- imported logic/scripts inside `steg`
- or a private worker called by `steg`

### Layer 3 — execution wallet (`steg` TEE wallet)
Use the TEE-backed server wallet to:
- hold USDC
- approve registrar
- broadcast `commit()`
- broadcast `register()`
- pay gas

### Layer 4 — payment layer
Support two buyer surfaces over time:
- **human checkout** (Telegram-friendly invoice/link/payment instruction)
- **machine checkout** (x402-native)

Both should settle into the same backend registration job model.

---

## Repo/module mapping

This section is intentionally concrete. The goal is to avoid hand-wavy “steg does UX, ensemble does ENS.”

### `steg-ens-agent`: exact parts to reuse

#### 1. Bot/runtime entrypoints — reuse as the conversational shell
- `brain/app/main.py`
  - already starts long-lived background processes via `lifespan`
  - natural place to also start a delayed registration-resume worker later
- `brain/app/telegram_poller.py`
  - already provides the production Telegram intake loop
  - should remain the only message ingress for Telegram users
- `brain/app/telegram_core.py`
  - already handles stable per-chat threads and agent execution
  - can remain the user-facing orchestration surface, but should call registrar-specific tools/routes instead of trying to hold the whole state machine in model memory

**Use as-is:** poller architecture, chat threading, reply flow  
**Adapt:** add registrar-specific tool entrypoints and job-status messages  
**Do not use for durable business state:** the in-memory chat store itself

#### 2. Existing job/state pattern — reuse as the template for durable registration jobs
- `brain/app/provision_job_store.py`
  - this is the best existing in-repo pattern for a multi-step background workflow with explicit statuses
  - registrar jobs should mirror this structure rather than inventing a separate orchestration style

**Use as inspiration / partial copy:**
- state-machine shape
- `create/get/apply/prune` store pattern
- explicit step IDs and UI-facing JSON shape

**New analogous module proposed:**
- `brain/app/registrar_job_store.py`

#### 3. TEE execution and payment rails — reuse directly
- `scripts/mm-x402-account.ts`
  - proves `mm` can act as an x402-capable signer
- `scripts/x402-pay.ts`
  - existing paid execution pattern
- `scripts/lib/x402-payment-gate.ts`
  - shows how to gate payment-specific actions and bind them to the agent wallet

**Use as-is or with minimal adaptation:**
- wallet execution via `mm`
- x402 signing / payment abstractions
- fail-closed payment gating style

#### 4. Worker/verifier surface — keep separate from registrar fulfillment
- `worker/routes/evaluate.ts` and the auth-gate path are specific to Steg’s ENS authority thesis
- they should remain orthogonal to registrar concierge fulfillment

**Important:** registrar checkout/fulfillment should not be forced through the existing auth-gate model unless explicitly desired. Public-vendor registration is a different product surface than “agent self-authorized fund movement.”

---

### `ensemble-beta`: exact parts to reuse or port

The most valuable thing in `ensemble-beta` is not the whole worker wholesale; it is the **deterministic ENS state machine** already encoded in its worker routes and helper libs.

#### 1. Route contract / orchestration shape — strong candidate to port
- `worker/routes/check.ts`
- `worker/routes/commit.ts`
- `worker/routes/register.ts`

These already define a clean registration flow for agents:
- input normalization
- availability + duration handling
- secret generation
- commitment generation
- short-lived session persistence
- register-time validation
- commitment-age checks
- retryable failure semantics

**Use as the base design almost verbatim**, but adapt from ENSv1-style ETH flow to ENSv2 Sepolia USDC flow.

#### 2. Helper logic to port/adapt
From `ensemble` worker libs (already inspected earlier):
- network config helpers
- calldata / argument building patterns
- rent-price query logic
- commitment computation logic
- resolver-data construction patterns

These should likely become either:
- `steg` scripts under `scripts/lib/ensv2-*`
- or an internal TS helper module shared by scripts and any private worker route

#### 3. Session persistence model — port conceptually, not literally
`ensemble` stores commit session state in Worker KV (`ENS_SESSIONS`).
That exact storage backend is not mandatory here, but the **shape** is right:
- `secret`
- `label`
- `owner`
- `duration`
- `network`
- resolver/config params
- commitment
- created timestamp

In `steg`, this should become a registrar-job/session record, probably in:
- a Python-side `registrar_job_store.py` for orchestration state, and/or
- a TS-side JSON record if the proof scripts own the first implementation

#### 4. What not to reuse blindly from `ensemble`
- public bearer-API-key surface in `worker/index.ts`
  - useful for a developer API, but not the first thing this product needs
- unsigned-tx-only assumption
  - `ensemble` is built around returning tx objects for external signing
  - `steg` should instead **execute** via its TEE wallet
- ENSv1-oriented price/value assumptions
  - these need explicit ENSv2 USDC adaptation

---

### Proposed division of responsibility: exact file-level plan

#### A. Keep Telegram + orchestration in Python (`brain/app`)
Add:
- `brain/app/registrar_job_store.py`
  - modeled after `provision_job_store.py`
  - stores quote/payment/commit/register lifecycle
- `brain/app/registrar_routes.py`
  - optional operator/debug endpoints like `/registrar/quote`, `/registrar/status/{id}`, `/registrar/fulfill/{id}`
- `brain/app/registrar_tools.py`
  - thin tool wrappers the agent can call from Telegram chat
- `brain/app/registrar_runner.py`
  - background workflow driver for commit → wait → register

Reasoning:
- Telegram UX and long-lived conversation state already live in Python here
- `steg` already uses Python for orchestration and TS scripts for chain execution
- this keeps the user-facing control plane in one place

#### B. Put deterministic ENSv2 chain logic in TypeScript (`scripts/`)
Add:
- `scripts/lib/ensv2-config.ts`
  - Sepolia registrar/oracle/token constants
- `scripts/lib/ensv2-registrar.ts`
  - quote/check/commit/register helpers
- `scripts/ensv2-sepolia-quote.ts`
- `scripts/ensv2-sepolia-commit.ts`
- `scripts/ensv2-sepolia-register.ts`
- `scripts/ensv2-sepolia-obo-register.ts`

Reasoning:
- this matches existing `steg` style: orchestration in Python, onchain mechanics in TS/Bun
- easiest path to a proof script without first designing a whole new worker
- keeps viem + contract interaction close to existing x402/chain tooling

#### C. Optional later: expose a private/internal worker route set
If needed later, add a private worker or brain route layer for:
- quote
- payment status
- job status

But v1 does **not** need to begin as a generic public HTTP API. The proof should be script-first.

---

### Use-as-is / adapt / don’t-use table

| Source | File / surface | Decision | Why |
|---|---|---|---|
| `steg` | `brain/app/telegram_poller.py` | **Use as-is** | already production Telegram ingress |
| `steg` | `brain/app/telegram_core.py` | **Adapt** | keep chat shell, add registrar tools rather than holding workflow in LLM memory |
| `steg` | `brain/app/provision_job_store.py` | **Reuse pattern** | best in-repo model for explicit multi-step jobs |
| `steg` | `brain/app/store.py` | **Do not rely on for registrar durability** | in-memory chat store is not business-state storage |
| `steg` | `scripts/mm-x402-account.ts` | **Use as-is / reference** | proves unattended wallet signing abstraction |
| `steg` | `scripts/x402-pay.ts` | **Adapt** | strong pattern for paid execution + guard rails |
| `steg` | `worker/evaluate` auth path | **Keep separate** | orthogonal to public-vendor registrar fulfillment |
| `ensemble` | `worker/routes/check.ts` | **Port/adapt** | clean exact-label availability/quote entrypoint |
| `ensemble` | `worker/routes/commit.ts` | **Port/adapt** | good secret/session/commit shape |
| `ensemble` | `worker/routes/register.ts` | **Port/adapt** | good reveal validation and retry semantics |
| `ensemble` | `worker/index.ts` public API-key pattern | **Not v1 priority** | execution should happen inside `steg`, not as unsigned-tx API first |
| `ensemble` | unsigned-tx model | **Do not reuse directly** | `steg` should execute via TEE wallet |

---

### Recommended integration sequence
1. **Port the deterministic `ensemble` route logic into TS scripts/helpers inside `steg`**
   - do not start by wiring public worker endpoints
2. **Create a registrar job store in Python modeled on `provision_job_store.py`**
3. **Let Python orchestration call Bun/TS scripts for actual ENSv2 steps**
4. **Only after the proof works, expose conversational Telegram UX against those jobs**
5. **Only later decide whether a reusable public API surface is worth adding**

This keeps the build path aligned with how `steg` already works today rather than forcing it into `ensemble`’s unsigned-worker shape.

---

## Job lifecycle model
Each registration request should become a real job object, not just chat memory.

### Suggested states
- `draft`
- `quoted`
- `awaiting_payment`
- `paid`
- `committing`
- `committed`
- `waiting_reveal`
- `registering`
- `completed`
- `failed`
- `refund_pending` (if needed later)

### Suggested job fields
- `job_id`
- `label`
- `target_owner`
- `duration`
- `payment_token`
- `quote_amount`
- `quote_expires_at`
- `payment_status`
- `secret`
- `commitment`
- `commit_tx_hash`
- `register_tx_hash`
- `final_owner`
- `status`
- `error`

---

## Payment model

### V1 recommendation
Keep the merchant model but separate **buyer UX** from **backend settlement semantics**.

- Buyer sees: **one all-in USDC price**
- Vendor treasury handles:
  - ENSv2 USDC registrar payment
  - gas
  - margin / risk buffer

### Human buyer UX
Most likely not raw x402 headers. Instead:
- payment instruction
- invoice / pay link
- or chat-guided settlement

### Machine buyer UX
Later:
- x402 endpoint returning `402 Payment Required`
- same quote/job backend

---

## Why ENSv2 Sepolia is promising
Second-pass repo inspection suggests this is not merely theoretical.

### Verified in repo
From `ensdomains/contracts-v2`:
- deployment namespace exists:
  - `contracts/deployments/sepolia-official-v1-20260525-r2/`
- includes artifacts for:
  - `ETHRegistrar`
  - `StandardRentPriceOracle`
  - `ETHRegistry`
  - `RootRegistry`
  - `MockUSDC`
  - `MockDAI`

### Extracted deployment addresses
- `ETHRegistrar`: `0x8c2e866b439358c41ae05de9cbe8a00bfefaffca`
- `StandardRentPriceOracle`: `0xe19d37839f42f7d2694d8c5712f412c66a218161`
- `ETHRegistry`: `0xdedb92913a25abe1f7bcdd85d8a344a43b398b67`
- `RootRegistry`: `0xc960f7217d3643b525ef36bec8adf86953cd9ab8`

### Sepolia payment-token nuance
From `contracts/script/deploy-constants.ts`:
- `SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

From `contracts/deploy/01_StandardRentPriceOracle.ts`:
- Sepolia deployment path includes `SEPOLIA_USDC` in the accepted payment token set for Sepolia / clean-testnet environments.

However, Greg pointed to the `ensdomains/ensjs` branch `feature/fet-1885-ensjs-refactor`, and `packages/ensjs/src/clients/l1.ts` gives an important client-facing nuance:
- it exposes the ENSv2 Sepolia addresses directly, including:
  - `ensRegistry = 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`
  - `ensEthRegistrar = 0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA`
  - `ensStandardRentPriceOracle = 0xe19D37839F42F7d2694D8C5712f412C66A218161`
- but the token addresses currently surfaced there are:
  - `usdc = 0xBA11ebdB3f9a2c5946D8629517f06364E53A2E10`
  - `dai = 0x2922bCD677Af690fCD1eCC699519e4bfaBc73fF8`

Those match the deployed `MockUSDC` / `MockDAI` artifacts in the Sepolia deployment set.

### Implication
This suggests two separate truths:
1. ENSv2 Sepolia is clearly built around an **ERC20-payment registrar model**, which aligns with the product direction.
2. The **currently surfaced client config** may still be using **MockUSDC / MockDAI** on Sepolia rather than real Circle Sepolia USDC.

So the near-term proof should be framed carefully:
- architecture proof: OBO registration via ENSv2 Sepolia ERC20 payments
- stronger later proof: verify whether real Sepolia USDC (`0x1c7D4B...`) is also accepted live by the oracle

---

## Open verification items
These still need to be proven live, not inferred.

1. `isPaymentToken(SEPOLIA_USDC)` returns `true` on deployed oracle.
2. `getRegisterPrice(label, duration, SEPOLIA_USDC)` succeeds.
3. Vendor wallet can approve Sepolia USDC to the registrar.
4. Vendor wallet can commit and register while assigning `owner` to a third-party wallet.
5. Resolver / subregistry args for a minimal successful OBO registration are understood.
6. Name lands in target wallet cleanly with no hidden post-step.
7. Decide what v1 promises around forward resolution and reverse/primary name.

---

## Implementation plan (Build Plan #1)

### Phase 0 — prove the rail
Before building UX, prove the onchain OBO flow works.

Deliverable:
- one proof script that succeeds end-to-end on ENSv2 Sepolia using USDC and a third-party target owner wallet

### Phase 1 — private registration engine
Build a private/internal engine in `steg-ens-agent` that can:
- check
- quote
- commit
- wait
- register

This can be:
- a set of `scripts/ensv2-*`
- or a small internal worker/module

Deliverables:
- deterministic helper module for quote/commit/register
- persisted job state
- operator-usable CLI or admin entrypoint

### Phase 2 — payment-bound jobs
Add job creation and payment binding.

Deliverables:
- quote object
- quote expiry
- job persistence
- payment confirmation hook
- fulfillment trigger

### Phase 3 — Telegram merchant UX
Expose a narrow buyer flow through `@stegdotbot`.

Deliverables:
- intake prompts for exact label + target wallet
- quote presentation
- payment handoff
- async completion updates

### Phase 4 — optional public programmatic surface
Expose a machine-friendly quote + pay + fulfill path.

Deliverables:
- x402-capable endpoint design
- shared backend jobs with Telegram flow

---

## Proof script plan (Build Plan #2)
The proof script should come **before** broad product work.

### Script purpose
Validate that `steg-ens-agent` can act as a vendor wallet and register a name **OBO** a target wallet on ENSv2 Sepolia using USDC.

### Suggested script name
`scripts/ensv2-sepolia-obo-register.ts`

### Inputs
- `LABEL`
- `TARGET_OWNER`
- `DURATION` (default 1 year)
- `PAYMENT_TOKEN`
  - **first proof default:** `0xBA11ebdB3f9a2c5946D8629517f06364E53A2E10` (`MockUSDC`, per current `ensjs` branch wiring)
  - **second proof target:** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (real Sepolia USDC from deploy constants), but only after verifying the oracle accepts it live
- `RPC URL`
- wallet execution context (`mm` or viem signer path)

### Known contract addresses for the first proof
Use the addresses surfaced in `ensdomains/ensjs` branch `feature/fet-1885-ensjs-refactor` unless newer canonical addresses supersede them:
- `ensRegistry`: `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`
- `ensEthRegistrar`: `0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA`
- `ensStandardRentPriceOracle`: `0xe19D37839F42F7d2694D8C5712f412C66A218161`
- `ensPermissionedResolverImpl`: `0xdcE5205A553573FFd47629327DDdf36186022FfA`
- `ensVerifiableFactory`: `0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198`
- `MockUSDC`: `0xBA11ebdB3f9a2c5946D8629517f06364E53A2E10`
- `MockDAI`: `0x2922bCD677Af690fCD1eCC699519e4bfaBc73fF8`

### Script steps
#### Phase A — client-config-grounded proof (MockUSDC)
1. Check `isPaymentToken(MockUSDC)` on `StandardRentPriceOracle`
2. Check `isAvailable(label)` on `ETHRegistrar`
3. Query `getRegisterPrice(label, duration, MockUSDC)`
4. Generate random secret
5. Compute commitment via `makeCommitment(...)`
6. Submit `commit(commitment)`
7. Wait `MIN_COMMITMENT_AGE`
8. Approve registrar for required MockUSDC amount
9. Submit `register(label, owner=TARGET_OWNER, secret, ..., paymentToken=MockUSDC, ...)`
10. Read back ownership / success state
11. Output receipts and exact parameters used

#### Phase B — stronger proof (real Sepolia USDC)
12. Independently check `isPaymentToken(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)`
13. If supported, repeat quote/approve/register path using real Sepolia USDC
14. Compare behavior against the MockUSDC path and record whether the live oracle supports both or only the mock token path

### Acceptance criteria
- script completes without manual wallet intervention
- final owner equals `TARGET_OWNER`
- payment token is Sepolia USDC
- tx hashes are captured
- result is reproducible enough to serve as foundation for the registrar-concierge build

### If it fails, capture where
- payment token unsupported
- price quote revert
- approval failure
- commitment mismatch
- registrar arg mismatch
- owner assignment limitation
- resolver/subregistry requirement mismatch

---

## Suggested file/module plan

### New docs
- `docs/prd-ensv2-usdc-registrar-concierge.md` (this file)

### New scripts (proposed)
- `scripts/ensv2-sepolia-quote.ts`
- `scripts/ensv2-sepolia-commit.ts`
- `scripts/ensv2-sepolia-register.ts`
- `scripts/ensv2-sepolia-obo-register.ts` (proof script)

### New brain modules (proposed)
- `brain/app/registrar_jobs.py`
- `brain/app/registrar_routes.py`
- `brain/app/registrar_tools.py`

### Optional worker additions (later)
- quote/status endpoints if public API becomes desirable

---

## Unresolved product wrinkle: checkout and agent-to-agent access

The largest unresolved product question is still **checkout UX**, especially because this product may need to serve **both humans and agents**.

### The wrinkle
For a human Telegram user, the intuitive experience is:
- chat with the bot
- receive a quote
- click a payment link / invoice
- wait for fulfillment

For an agent buyer, the intuitive experience is different:
- request a quote programmatically
- receive a machine-readable payment requirement
- pay without a human clicking anything
- receive a machine-readable fulfillment result

Those are not the same surface, even if they share the same backend job model.

### Implication
If this product is meant to sell ENS registrations not just to humans in Telegram but also to **other agents**, then `steg-ens-agent` likely needs an additional **A2A-capable endpoint** or machine-facing commerce surface.

That surface would need to support at least:
- quote request / response
- payment requirement or invoice material
- fulfillment status lookup
- final delivery receipt

In practice, Telegram is probably the right **human-facing shell**, but not the right sole interface for an agent-native merchant.

### Likely product split
#### Human flow
- Telegram conversation
- payment link / invoice / checkout page
- bot sends updates and receipts

#### Agent flow
- machine-readable quote API or A2A endpoint
- machine-readable payment requirement
- machine-readable fulfillment receipt
- likely x402-compatible over time

### Research leads
The PRD should not pretend this is solved. Instead, the next research questions are:

1. **What should the human checkout rail be?**
   - simple payment link
   - invoice page
   - bot-native payment instruction
   - embedded wallet checkout

2. **What should the machine checkout rail be?**
   - x402 endpoint
   - custom quote/pay/receipt API
   - MCP-style tool surface
   - lightweight A2A commerce endpoint

3. **Should human and agent buyers share the same quote/job model?**
   - likely yes at the backend
   - but possibly with different payment and receipt formats

4. **What protocol should another agent use to buy from `@stegdotbot`?**
   - direct HTTP API
   - x402-over-HTTP
   - A2A task endpoint
   - future ENS-native service discovery / agent URI path

5. **How should discovery work for non-human buyers?**
   - if the product is merchant-like, another agent needs a discoverable endpoint and machine-readable contract for quote + payment + fulfillment

### Why this matters strategically
This isn’t just a UI detail. It changes the nature of the product:
- if only Telegram users can buy, it is a **human concierge**
- if agents can also buy through a machine-facing endpoint, it becomes an **agent merchant / agent-native registrar vendor**

That second story is stronger, but it implies more protocol surface than a Telegram bot alone.

### Working product principle
Treat **Telegram as one client**, not the whole product boundary.

The core product should be:
- quote engine
- payment-binding job model
- fulfillment engine
- receipt/status interface

Then layer:
- Telegram UI for humans
- A2A / machine API for agents

---

## Risks
1. **Human payment UX** may be the hardest practical bottleneck even if the onchain rail works.
2. **Primary-name setup** may still be awkward or authority-dependent.
3. **Quote staleness** can create mismatch between promised and actual fulfillable price.
4. **Name races** remain possible between quote and commit.
5. **Vendor treasury management** is still needed even if everything is USDC-denominated.
6. ENSv2 Sepolia artifacts may exist but still have edge cases not obvious from repo inspection.
7. A credible **agent-to-agent buyer flow** likely requires a second surface beyond Telegram, which adds protocol and product-design scope.

---

## Acceptance criteria for the product direction
This initiative is validated if:
1. a proof script successfully registers a name OBO a third-party wallet on ENSv2 Sepolia using USDC,
2. `steg-ens-agent` can wrap that flow in a persistent job model,
3. a Telegram user can obtain a quote, pay, and receive a completed registration to their wallet.

---

## Immediate next actions
1. Implement the proof script first.
2. Verify onchain:
   - `isPaymentToken(SEPOLIA_USDC)`
   - `getRegisterPrice(...)`
3. Determine minimal valid `subregistry` / `resolver` args for a clean OBO registration.
4. Once proven, wire the flow into job orchestration inside `steg-ens-agent`.
5. Only then design the public payment UX in detail.
