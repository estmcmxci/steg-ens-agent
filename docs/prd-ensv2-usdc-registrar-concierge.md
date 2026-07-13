# PRD — ENSv2 USDC Registrar Concierge for `steg-ens-agent`

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

### Keep in `steg-ens-agent`
- conversational UX
- job store / job lifecycle
- payment confirmation handling
- scheduler / delayed resume after commit age
- TEE wallet execution
- operator controls
- Telegram notifications

### Port or borrow from `ensemble-beta`
- `/check` semantics
- `/commit` semantics
- `/register` semantics
- session-state structure for commit-reveal
- deterministic calldata / argument shaping
- retry logic around commitment age and expiration

### Potential code targets in `steg-ens-agent`
- `brain/app/`:
  - new registrar-concierge tools or routes
  - job store / orchestration logic
- `scripts/`:
  - proof scripts
  - ENSv2 registrar helpers
- `worker/`:
  - optional private/public quote/status endpoints
- `records/`:
  - persist fulfillment receipts / job outputs if useful

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

### Sepolia USDC clue
From `contracts/script/deploy-constants.ts`:
- `SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

From `contracts/deploy/01_StandardRentPriceOracle.ts`:
- Sepolia deployment path includes `SEPOLIA_USDC` in the accepted payment token set for Sepolia / clean-testnet environments.

### Implication
ENSv2 Sepolia appears intentionally designed to support a **real Sepolia USDC** payment token in the rent-price oracle path, which is exactly what the merchant model wants.

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
- `PAYMENT_TOKEN` (default Sepolia USDC)
- `RPC URL`
- wallet execution context (`mm` or viem signer path)

### Script steps
1. Check `isPaymentToken(SEPOLIA_USDC)` on `StandardRentPriceOracle`
2. Check `isAvailable(label)` on `ETHRegistrar`
3. Query `getRegisterPrice(label, duration, SEPOLIA_USDC)`
4. Generate random secret
5. Compute commitment via `makeCommitment(...)`
6. Submit `commit(commitment)`
7. Wait `MIN_COMMITMENT_AGE`
8. Approve registrar for required USDC amount
9. Submit `register(label, owner=TARGET_OWNER, secret, ..., paymentToken=SEPOLIA_USDC, ...)`
10. Read back ownership / success state
11. Output receipts and exact parameters used

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

## Risks
1. **Human payment UX** may be the hardest practical bottleneck even if the onchain rail works.
2. **Primary-name setup** may still be awkward or authority-dependent.
3. **Quote staleness** can create mismatch between promised and actual fulfillable price.
4. **Name races** remain possible between quote and commit.
5. **Vendor treasury management** is still needed even if everything is USDC-denominated.
6. ENSv2 Sepolia artifacts may exist but still have edge cases not obvious from repo inspection.

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
