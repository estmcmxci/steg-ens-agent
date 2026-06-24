# Plan D — Provision robustness (timeouts + background job) + circular-progress UI

**Status:** scoped, not started. Follow-on to PLAN-C (Option C provisioning, now deployed).
**Why:** the deployed brain provisions agents on-chain correctly, but the `/provision`
run is **welded to a single long SSE connection** and **has no per-step timeouts**, so a
run can hang forever after a step's tx has already mined. Observed 2026-06-24:
provisioning `uitest2.steg.eth` ran 8/9 steps then **hung ~10 min on `ensip25`** — even
though the ensip25 tx had already mined on-chain (record `="1"`). The `bun` subprocess
didn't exit / the receipt-wait never returned, and `proc.communicate()` blocked forever.
The last two steps (reverse, transfer) had to be completed by hand. The end-to-end UI
flow is therefore **not yet reliable**.

---

## Context a fresh session needs (read first)

- **Live deployed brain:** `https://steg-brain-production.up.railway.app` (Railway project
  `steg-chatkit-brain`, service `steg-brain`, env production). FastAPI in `brain/app/`.
- **Provision code:** `brain/app/provision_routes.py`. The core is `_provision_stream(req)`
  — an async generator that `yield _sse({...})`s frames for 9 steps:
  `wallet_create → fund → records → bind → identity → agent_uri → ensip25 → reverse →
  transfer`. Each operator step shells out via `_run(*cmd)` (asyncio subprocess) to
  `bun scripts/*.ts` (hot-key/viem) or `mm` (TEE). `step(...)` wraps `_run` with
  crash-retries for idempotent steps.
- **Frontend:** `frontend/src/hooks/useProvision.ts` (SSE reducer),
  `frontend/src/lib/provisionApi.ts` (`streamProvision` reads `POST /provision` SSE),
  `frontend/src/components/ProvisionProgress.tsx` (horizontal stepper),
  `frontend/src/components/AgentLoginProvision.tsx` (the card flow; also calls
  `requestMint`). `PROVISION_STEPS` (ids+labels) is defined in `useProvision.ts`.
- **mm persistence is SOLVED (PLAN-C §6a):** `/root/.metamask` is a Railway volume
  (`steg-brain-volume`); `entrypoint.sh` bootstraps-if-absent. Created wallets + refreshed
  tokens persist across deploys → **no `mm login` needed on redeploy** anymore. Proven.
- **Funding/errors are FIXED (PLAN-C §6):** `REVERSE_GAS_ETH` env-configurable (default
  0.001); `_is_bun_crash` ignores the Bun version footer; `_error_detail` surfaces the
  real RPC/insufficient-funds message. Operator hot key `0xe53AaAE8…9Ac5` (brain/.env);
  fund it ~0.01 ETH/agent before live runs.
- **Deploy:** `railway up --ci` (rebuild) or `railway redeploy -y` (restart). An env-var
  change alone does NOT swap the instance — force it. Operator token for the queue
  endpoints is `OPERATOR_TOKEN` (set in Railway vars).
- **Test wallets:** `michael.steg.eth` = `0x19caf…eacf2` (mostly USDC). `uitest` (first
  attempt) is half-provisioned with a stranded wallet — ignore it. `uitest2.steg.eth` is
  fully live (agentId 35382, self-owned by `0x796fCa…ef9fA`).

---

## Part 1 — Per-step timeouts (do FIRST; highest value, smallest change)

**Goal:** no step can hang forever. A `bun`/`mm` subprocess that doesn't finish in N
seconds is killed; idempotent steps retry, others surface a clear error.

**Where:** `brain/app/provision_routes.py`, `_run()` and `step()`.

**Design:**
- Add `STEP_TIMEOUT = float(os.environ.get("PROVISION_STEP_TIMEOUT", "150"))`.
- `_run(*cmd, timeout=STEP_TIMEOUT)`: wrap `proc.communicate()` in
  `asyncio.wait_for(..., timeout=timeout)`. On `asyncio.TimeoutError`: `proc.kill()`,
  `await proc.wait()`, return a sentinel like `(124, "", f"timed out after {timeout}s")`.
- In `step()`: treat a timeout as retryable **for steps that already pass `retries>0`**
  (the idempotent setText steps: records/identity/agent_uri/ensip25, and fund which is
  now idempotent). Add a helper `_is_retryable(code, err)` = `_is_bun_crash(err) or code
  == 124`. Use it in the retry condition.
- The bare `_run` calls (wallet_create, the reverse `mm wallet select` + reverse send)
  also get the timeout. Reverse is the one that hung — give it the timeout too; on a
  reverse timeout, surface a clear error (reverse isn't in the `step()` retry path today;
  consider giving reverse a small retry since its setName is idempotent).

**Acceptance:** kill-test — point a step at a command that sleeps > timeout; confirm it's
killed and (for idempotent steps) retried, and the run doesn't hang. Re-provision a fresh
label end-to-end on the deployed brain and confirm no indefinite hang.

**Watch out:** a legit slow step (records multicall + receipt) can take ~30–60s; 150s
default leaves headroom. A killed-then-retried idempotent step re-broadcasts the same
setText (extra gas, correct end state) — acceptable, same as today's crash-retries.

---

## Part 2 — Background job + status polling (resilience)

**Goal:** the provision runs as a server-side job that survives a dropped/stalled browser
connection; the client polls status instead of holding one long SSE.

**Brain (`provision_routes.py`):**
- Add a `ProvisionJobStore` (in-memory, like `pending_store.py`): per job
  `{id, name, label, status: running|complete|error, steps: {stepId: pending|active|done|
  error}, current, message, agentId, serverWallet, card, txByStep, error, createdAt,
  updatedAt}`. Step id list = the 9 step ids above.
- Refactor `_provision_stream` (generator yielding `_sse`) into `_run_provision(job_id,
  req)` (coroutine) that calls `emit(frame)` = `job_store.apply(job_id, frame)`. The frame
  shapes stay IDENTICAL (begin/step/error/complete) — just route them to the reducer
  instead of SSE. The reducer mirrors the frontend `apply()` in `useProvision.ts`.
- `POST /provision` → create job, `asyncio.create_task(_run_provision(job.id, req))`,
  return `{jobId, ...initialState}` (JSON, not SSE).
- `GET /provision/status/{jobId}` → return the job record (the client polls this ~2–3s).
- Keep `pending_store.fulfill(name=...)` on complete. Keep the `finally` mm-wallet restore.
- Optional: prune jobs older than ~1h. In-memory is fine (chain is source of truth).

**Frontend:**
- `provisionApi.ts`: replace `streamProvision` with `startProvision(body) → {jobId,...}`
  and `getProvisionStatus(jobId) → state`.
- `useProvision.ts`: `start()` POSTs, stores jobId, then polls
  `GET /provision/status/{jobId}` on an interval until `status` is `complete`/`error`;
  map the job record into the existing `ProvisionState`. On mount with a known jobId
  (persist in sessionStorage), resume polling so a refresh doesn't lose the run.

**Acceptance:** start a provision, close/reopen the browser tab mid-run, confirm it
resumes and finishes. Confirm a stalled network doesn't abort the server-side job.

**Note:** Part 1's timeouts still matter — a background job alone won't fix a hung task;
the timeout is what unsticks a stuck step. Do Part 1 first.

---

## Part 3 — Circular progress UI + live text (UX)

**Goal:** replace the horizontal dot-stepper + status string with a **radial/circular
progress ring** showing "Step N of 9" filled proportionally, with the current step's
human-readable `message` as live text (e.g. center or below the ring), and the step label.

**Where:** new `frontend/src/components/ProvisionRing.tsx` (SVG ring, `done/total` +
`current` + `message` props); swap it into `AgentLoginProvision.tsx` in place of
`ProvisionProgress` for the running state. Keep the success panel (TEE wallet, agentId,
"Open <name>") and the error panel (now showing the real `_error_detail` message).

**Design notes:** SVG `<circle>` with `stroke-dasharray`/`stroke-dashoffset` for the arc;
animate offset on step change; show `✓` and the agent name on complete; red ring + retry
on error. Keep it on-brand with the existing `prov-card__*` styling. The rolling text is
the existing per-step `message` from the job state — no new backend data needed.

**Acceptance:** ring advances smoothly through a live run; text updates per step; success
and error states render; looks polished (not generic).

---

## Suggested execution order & deploy
1. Part 1 (timeouts) → `railway up --ci` → re-provision a fresh label, confirm no hang.
2. Part 2 (background job + polling) → deploy → tab-close/resume test.
3. Part 3 (circular UI) → frontend only (no redeploy of brain needed).
Fund `0xe53` ~0.01 ETH before live runs. The mm volume means no `mm login` needed on
redeploys. Verify each phase against the deployed brain + local UI (vite proxies
`/provision` → Railway; see `frontend/vite.config.ts`).
