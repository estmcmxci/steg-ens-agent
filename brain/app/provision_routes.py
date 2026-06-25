"""
POST /provision — milestone-7 onboarding orchestrator (PLAN.md §3.3 / §3.3.1 Phase 2).

Streams (SSE) the option-B choreography that turns a freshly-minted, hot-key-owned
subname (e.g. demo.steg.eth) into a fully-provisioned ENS-native agent: a new TEE
server wallet, ENS forward records + auth.*, an ERC-8004 bind, ENSIP-26/25 identity,
the server wallet's own reverse record, and finally the hand-off of the name to the
operator (authority operator-revocable at rest, §4).

What this does NOT do: the one-time `mint-subname.ts` (operator Ledger) — that runs
BEFORE the demo so the hot key already owns the subname. /provision is 0-Ledger.

Signing:
  - operator steps → the parameterized bun scripts with `--hot-key --send --yes`,
    which sign with OPERATOR_HOT_KEY (env, never committed). Each script keeps its
    eth_call pre-flight as the safety gate, so `--yes` only skips the human prompt.
  - the reverse step → the fresh TEE server wallet self-signs via `mm` (beast mode).

Each step emits `{event, step, status, ...}` SSE frames so the wizard can render a
live progress panel. On any failure the stream emits an `error` frame and stops, and
a `finally` restores the previously-active `mm` wallet (so a half-provisioned wallet
never becomes the active signer). On SUCCESS (G3) mm is left selected on the newly
provisioned wallet so NLI executes act as the new agent.
"""

import asyncio
import json
import os
import re
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from .pending_store import InvalidLabelError, PendingMintStore
from .provision_job_store import ProvisionJobStore

# repo root = .../metamask (this file is brain/app/provision_routes.py)
REPO_ROOT = Path(__file__).resolve().parents[2]

# Parent under which agents are minted. Override per-deployment via STEG_PARENT.
STEG_PARENT = os.environ.get("STEG_PARENT", "steg.eth")

# Operator work-queue of subname mints awaiting a Ledger co-sign (Option C). The
# chain is the real source of truth; this is just so the operator isn't blind.
pending_store = PendingMintStore(parent=STEG_PARENT)

# Background provision jobs (PLAN-D Part 2): POST /provision creates a job + a
# background task; the client polls GET /provision/status/{id} instead of holding one
# long SSE. Survives a dropped/stalled browser. In-memory (chain is source of truth).
job_store = ProvisionJobStore()

# Gas to top the fresh server wallet up with for its one reverse setName tx.
# Reverse setName ≈ 114k gas. The old 0.0003 default was calibrated for sub-gwei gas
# and is too tight at live mainnet gas (e.g. 2.4 gwei → ~0.00027 + estimate margin →
# the server wallet runs out and the reverse step fails). Default 0.001 covers reverse
# up to ~7 gwei with headroom; override via env for gas spikes. (Diagnosed 2026-06-24:
# the masked "Bun crash" at reverse was this under-funding — see PLAN-C §6.)
REVERSE_GAS_ETH = os.environ.get("REVERSE_GAS_ETH", "0.001")

# Hard ceiling on any single bun/mm subprocess. A step whose tx has already mined but
# whose receipt-wait never returns (observed 2026-06-24: ensip25 hung ~10 min after its
# tx mined) must not block the run forever. 150s leaves headroom over a legit slow step
# (records multicall + receipt ≈ 30–60s). Override via env for gas-congested chains.
STEP_TIMEOUT = float(os.environ.get("PROVISION_STEP_TIMEOUT", "150"))
# Sentinel return code for a killed-on-timeout subprocess (matches POSIX 128+SIGKILL).
TIMEOUT_CODE = 124

router = APIRouter(prefix="/provision", tags=["provision"])


class ProvisionRequest(BaseModel):
    # Defaults target the milestone-7 thin-slice demo agent.
    name: str = "demo.steg.eth"
    label: str = "demo"


_BUN_FOOTER_RE = re.compile(r"^\s*bun v\d", re.IGNORECASE)


def _is_bun_crash(stderr: str) -> bool:
    """Detect a *genuine* transient Bun native crash (vs a clean script error worth
    surfacing, not retrying).

    IMPORTANT: Bun prints its version footer ('Bun v1.3.x (Linux x64)') after BOTH a
    real panic AND an ordinary uncaught JS exception (e.g. viem throwing an RPC error).
    Matching that footer string previously misclassified normal errors — like
    'insufficient funds' (RPC -32003) — as Bun crashes, triggering pointless retries
    and hiding the real cause. So we match ONLY true crash signatures, never the footer."""
    s = stderr.lower()
    return any(m in s for m in ("panic", "segmentation", "illegal instruction", "oom",
                                "trace/bpt", "abort trap", "bun has crashed", "panicked"))


def _is_retryable(code: int, stderr: str) -> bool:
    """A step failure worth re-running: a transient Bun native crash OR a timeout kill.
    Both are non-deterministic (the tx may have even mined) — only pass this to the
    retry path for IDEMPOTENT steps, where a re-run just re-sets the same setText."""
    return code == TIMEOUT_CODE or _is_bun_crash(stderr)


def _error_detail(stderr: str, fallback: str = "failed") -> str:
    """Extract the meaningful error from a bun script's stderr. The trailing Bun
    version footer is useless (printed on every uncaught throw), so drop it and prefer
    viem's human-readable markers (insufficient funds, reverts, nonce, RPC details)."""
    if not stderr:
        return fallback
    lines = [ln.rstrip() for ln in stderr.splitlines() if ln.strip()]
    meaningful = [ln for ln in lines if not _BUN_FOOTER_RE.match(ln)]
    if not meaningful:
        return fallback
    for marker in ("insufficient funds", "details:", "shortmessage", "reverted",
                   "insufficientfundserror", "noncetoolow", "transactionexecutionerror",
                   "rpc request failed"):
        for ln in meaningful:
            if marker in ln.lower():
                return ln.strip()[:300]
    return meaningful[-1].strip()[:300]


def _last_json(stdout: str) -> dict[str, Any] | None:
    """The bun scripts print a single machine-readable JSON line to stdout (logs go
    to stderr). Return the last parseable JSON object, or None."""
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
    return None


async def _run(*cmd: str, timeout: float = STEP_TIMEOUT) -> tuple[int, str, str]:
    """Run a command from the repo root (scripts use repo-relative paths). The hot
    key + RPC are inherited from the brain's environment.

    A subprocess that doesn't finish within `timeout` seconds is killed and reported
    as `(TIMEOUT_CODE, "", "timed out after Ns")` — no run hangs forever waiting on a
    receipt that never returns. Idempotent steps treat this as retryable (see
    `_is_retryable`); for a re-broadcast of an already-mined setText this just re-sets
    the same value (extra gas, correct end state)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(REPO_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return TIMEOUT_CODE, "", f"timed out after {timeout:g}s"
    return proc.returncode or 0, out.decode().strip(), err.decode().strip()


async def _mm_address() -> str | None:
    """Active mm wallet address (to restore later)."""
    code, out, _ = await _run("mm", "wallet", "show", "--json")
    if code != 0:
        return None
    try:
        return json.loads(out).get("data", {}).get("address")
    except (json.JSONDecodeError, ValueError, AttributeError):
        return None


# Each operator step is a parameterized bun script run with the hot key.
def _bun(*script_args: str) -> tuple[str, ...]:
    return ("bun", *script_args, "--hot-key", "--send", "--yes")


async def _run_provision(job_id: str, req: ProvisionRequest) -> None:
    """Drive the option-B choreography as a background task, reducing each frame into
    the job record (job_store.apply) instead of yielding SSE. Frame shapes are
    unchanged — the reducer mirrors the frontend apply(). Runs detached from any
    client connection, so a dropped/stalled browser can't abort it (PLAN-D Part 2)."""
    name, label = req.name, req.label

    def emit(frame: dict[str, Any]) -> None:
        job_store.apply(job_id, frame)

    emit({"event": "begin", "name": name, "label": label})

    # ── pre-flight: the hot key must be present (option B signer) ──
    if not os.environ.get("OPERATOR_HOT_KEY"):
        emit({"event": "error", "step": "preflight",
                    "message": "OPERATOR_HOT_KEY not set in the brain environment."})
        return

    prior_wallet = await _mm_address()
    server_wallet: str | None = None
    agent_id: str | None = None
    # G3 — on SUCCESS, leave mm selected on the freshly provisioned wallet so NLI
    # executes act AS the new agent (the cockpit re-anchors to it via onProvisioned).
    # On any failure we still restore prior_wallet below, so a half-provisioned
    # wallet never becomes the active signer.
    provisioned_ok = False

    async def step(step_id: str, label_text: str, cmd: tuple[str, ...],
                   retries: int = 0) -> tuple[bool, dict[str, Any]]:
        """Run one step, return (ok, parsed-json-or-empty). Caller emits frames.

        `retries` > 0 re-runs the command on a transient Bun native crash (Bun 1.3.5
        intermittently segfaults in the hot-key send path). ONLY pass retries>0 for
        idempotent setText-based steps — re-running setText just re-sets the same
        value. Do NOT retry bind/fund/transfer (non-idempotent: a duplicate register,
        a double ETH send, or a transfer of an already-moved name)."""
        last: dict[str, Any] = {}
        for attempt in range(retries + 1):
            code, out, err = await _run(*cmd)
            parsed = _last_json(out) or {}
            last = {"code": code,
                    "stderr_tail": err.splitlines()[-1] if err else "",
                    "error": _error_detail(err),
                    **parsed}
            if code == 0:
                return True, last
            # Retry only on a transient Bun native crash (segfault/panic) or a timeout
            # kill — a clean script error (bad input, auth, insufficient funds) won't be
            # fixed by re-running.
            if attempt < retries and _is_retryable(code, err):
                continue
            return False, last
        return False, last

    try:
        # 1. fresh TEE server wallet (steglabs / TEE, beast mode)
        emit({"event": "step", "step": "wallet_create", "status": "start",
                    "message": f"Creating TEE server wallet '{label}' (beast)…"})
        code, out, err = await _run("mm", "wallet", "create", "--name", label,
                                    "--trading-mode", "beast", "--json")
        if code != 0:
            emit({"event": "error", "step": "wallet_create", "message": err or out})
            return
        try:
            data = json.loads(out).get("data", {}) or {}
            # `wallet create` nests under data.wallet.address; `wallet show` uses data.address.
            server_wallet = data.get("address") or (data.get("wallet") or {}).get("address")
        except (json.JSONDecodeError, ValueError, AttributeError):
            server_wallet = None
        if not server_wallet:
            emit({"event": "error", "step": "wallet_create",
                        "message": f"could not parse new wallet address from: {out[:200]}"})
            return
        emit({"event": "step", "step": "wallet_create", "status": "done",
                    "serverWallet": server_wallet})

        # 1b. fund the fresh server wallet so it can pay for its own reverse setName.
        #     It's created with zero balance; the hot key tops it up for that one tx.
        emit({"event": "step", "step": "fund", "status": "start",
                    "message": "Funding the new wallet for its reverse tx…"})
        # fund-wallet.ts is idempotent (skips if the recipient already holds the
        # amount), so it's safe to retry on a transient Bun native crash. amd64 hits
        # these segfaults far more than the local arm64 dev box.
        ok, res = await step("fund", "fund",
                             _bun("scripts/fund-wallet.ts", "--to", server_wallet, "--amount", REVERSE_GAS_ETH),
                             retries=3)
        if not ok:
            emit({"event": "error", "step": "fund", "message": res.get("error", "funding failed")})
            return
        emit({"event": "step", "step": "fund", "status": "done"})

        # 2. forward records: setAddr + auth.credential[primary] + agent-trust-models
        emit({"event": "step", "step": "records", "status": "start",
                    "message": "Setting forward addr + auth.credential + trust-models…"})
        ok, res = await step("records", "records",
                             _bun("scripts/rebind-server-wallet.ts", "--name", name, "--addr", server_wallet),
                             retries=4)
        if not ok:
            emit({"event": "error", "step": "records", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "records", "status": "done"})

        # 3. ERC-8004 bind → minted agent id
        emit({"event": "step", "step": "bind", "status": "start",
                    "message": "Binding the name as an ERC-8004 agent…"})
        ok, res = await step("bind", "bind", _bun("scripts/bind-erc8004.ts", "--name", name))
        agent_id = res.get("agentId")
        if not ok or not agent_id:
            emit({"event": "error", "step": "bind",
                        "message": res.get("error", "bind failed / no agentId")})
            return
        emit({"event": "step", "step": "bind", "status": "done",
                    "agentId": agent_id, "tx": res.get("txHash")})

        # 4. ENSIP-26 identity records (agent-id + display + description + skills)
        emit({"event": "step", "step": "identity", "status": "start",
                    "message": "Writing ENSIP-26 identity records…"})
        ok, res = await step("identity", "identity",
                             _bun("scripts/set-agent-records.ts", "--name", name, "--agent-id", agent_id),
                             retries=4)
        if not ok:
            emit({"event": "error", "step": "identity", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "identity", "status": "done"})

        # 5. agentURI → the card endpoint
        emit({"event": "step", "step": "agent_uri", "status": "start",
                    "message": "Setting the ERC-8004 agentURI → card…"})
        ok, res = await step("agent_uri", "agent_uri",
                             _bun("scripts/set-agent-uri.ts", "--name", name, "--agent-id", agent_id),
                             retries=4)
        if not ok:
            emit({"event": "error", "step": "agent_uri", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "agent_uri", "status": "done"})

        # 6. ENSIP-25 claim
        emit({"event": "step", "step": "ensip25", "status": "start",
                    "message": "Writing the ENSIP-25 registration claim…"})
        ok, res = await step("ensip25", "ensip25",
                             _bun("scripts/set-agent-registration.ts", "--name", name, "--agent-id", agent_id),
                             retries=4)
        if not ok:
            emit({"event": "error", "step": "ensip25", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "ensip25", "status": "done"})

        # 7. reverse record — server wallet self-signs via mm (must select it first)
        emit({"event": "step", "step": "reverse", "status": "start",
                    "message": "Server wallet setting its own reverse record (TEE)…"})
        sel_code, _, sel_err = await _run("mm", "wallet", "select", "--address", server_wallet, "--json")
        if sel_code != 0:
            emit({"event": "error", "step": "reverse", "message": f"wallet select failed: {sel_err}"})
            return
        # setName is idempotent → safe to retry on a Bun crash or a timeout kill (this
        # is the step that hung ~10 min on 2026-06-24 after its tx had already mined).
        ok, res = await step("reverse", "reverse",
                             ("bun", "scripts/set-reverse-server-wallet.ts",
                              "--name", name, "--wallet", server_wallet, "--send", "--yes"),
                             retries=2)
        if not ok:
            emit({"event": "error", "step": "reverse", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "reverse", "status": "done"})

        # 8. hand the name to the agent's OWN TEE wallet (self-sovereign): the agent
        #    then controls its own ENS records and can edit them via the NLI
        #    (ens_set_records_*). The hot key (which owned the node during provisioning)
        #    transfers the wrapped name to the server wallet. The operator's only role
        #    was minting the subname; it does NOT hold the name at rest.
        emit({"event": "step", "step": "transfer", "status": "start",
                    "message": "Handing the name to the agent's own wallet…"})
        ok, res = await step("transfer", "transfer",
                             _bun("scripts/transfer-subname.ts", "--name", name, "--to", server_wallet))
        if not ok:
            emit({"event": "error", "step": "transfer", "message": res.get("error", "failed")})
            return
        emit({"event": "step", "step": "transfer", "status": "done"})

        # Success: mm is already selected on server_wallet (step 7 selected it;
        # the hot-key transfer in step 8 doesn't change mm's active wallet). Mark
        # success so the finally leaves mm here instead of restoring prior_wallet.
        provisioned_ok = True
        # The agent is fully provisioned → clear any pending mint request for this
        # name so the operator queue doesn't keep showing an already-done name.
        pending_store.fulfill(name=name)
        emit({"event": "complete", "name": name, "agentId": agent_id,
                    "serverWallet": server_wallet, "activeWallet": server_wallet,
                    "card": f"{os.environ.get('CARD_WORKER_BASE', 'https://steg-agent-card.estmcmxci.workers.dev')}/card/{name}"})

    finally:
        # On FAILURE, restore the previously-active wallet so a half-provisioned
        # demo wallet never becomes the active signer (and the cockpit's read-only
        # /agent/* card keeps reporting the live agent). On SUCCESS (G3) we leave
        # mm on the new wallet so NLI executes act as the freshly provisioned agent.
        if prior_wallet and not provisioned_ok:
            await _run("mm", "wallet", "select", "--address", prior_wallet, "--json")


@router.post("")
async def provision(req: ProvisionRequest) -> dict[str, Any]:
    """Create a provision job and kick off the run as a detached background task, then
    return the initial job record immediately (JSON, not SSE). The client polls
    GET /provision/status/{jobId} for progress — the run survives a dropped/stalled
    browser (PLAN-D Part 2)."""
    job_store.prune()  # opportunistic GC of stale finished jobs
    job = job_store.create(name=req.name, label=req.label)
    # Detach: the task owns the run; nothing here awaits it, so the HTTP response
    # returns now and the run continues regardless of the client connection.
    asyncio.create_task(_run_provision(job["id"], req))
    return {"jobId": job["id"], **job}


@router.get("/status/{job_id}")
async def provision_status(job_id: str) -> dict[str, Any]:
    """Return the current job record for the client's poll loop. 404 if unknown
    (never created, or pruned after a brain restart) — the client treats that as
    'no active run' and falls back to a fresh start / on-chain reality."""
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such provision job")
    return {"jobId": job["id"], **job}


# ── Option C operator co-sign queue ──────────────────────────────────────────
# These let a browser register a "please mint <label>.steg.eth" request (so the
# operator isn't blind) and let the operator's approve-mints CLI drain the queue.
#
# Auth asymmetry (component 4): the operator endpoints (/pending, /fulfill) are the
# operator's private work-list — bearer-token-gated so only approve-mints.ts can read
# or close them, and so the public can't enumerate requesters' emails. The user-facing
# /request must stay open (the browser calls it with no auth), so it can't be token-
# gated — it's rate-limited per-IP instead to blunt automated spam. The operator
# remains the real human filter regardless; the throttle only stops flooding.


def require_operator(authorization: str | None = Header(default=None)) -> None:
    """Bearer-token gate for the operator endpoints. The token is read at call time
    from OPERATOR_TOKEN. If unset (local dev), auth is DISABLED so the loop works with
    no setup — set OPERATOR_TOKEN in any public/deployed brain to lock these down."""
    token = os.environ.get("OPERATOR_TOKEN", "").strip()
    if not token:
        return  # auth disabled — no token configured
    if authorization != f"Bearer {token}":
        raise HTTPException(
            status_code=401,
            detail="operator token required",
            headers={"WWW-Authenticate": "Bearer"},
        )


# Per-IP sliding-window rate limit on the public /request endpoint. In-memory is fine
# (single instance; the operator is the human filter regardless). Tunable via env.
RATE_LIMIT_MAX = int(os.environ.get("PROVISION_RATE_MAX", "5"))
RATE_LIMIT_WINDOW = float(os.environ.get("PROVISION_RATE_WINDOW", "60"))
_request_hits: dict[str, deque[float]] = {}


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    dq = _request_hits.setdefault(ip, deque())
    while dq and now - dq[0] > RATE_LIMIT_WINDOW:
        dq.popleft()
    if len(dq) >= RATE_LIMIT_MAX:
        retry = int(RATE_LIMIT_WINDOW - (now - dq[0])) + 1
        raise HTTPException(
            status_code=429,
            detail="too many requests; slow down",
            headers={"Retry-After": str(retry)},
        )
    dq.append(now)


class MintRequestCreate(BaseModel):
    label: str
    email: str | None = None


class FulfillRequest(BaseModel):
    # Operator CLI marks a request done after broadcasting the mint. Provide one.
    id: str | None = None
    name: str | None = None


@router.post("/request")
async def create_mint_request(req: MintRequestCreate, request: Request) -> dict[str, Any]:
    """Record a pending subname mint for the operator to co-sign. Public (the browser
    calls it), so rate-limited per-IP. Idempotent per name — re-POSTing the same label
    returns the existing pending request."""
    _check_rate_limit(request.client.host if request.client else "unknown")
    try:
        record = pending_store.request(req.label, req.email)
    except InvalidLabelError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return record


@router.get("/pending", dependencies=[Depends(require_operator)])
async def list_pending() -> dict[str, Any]:
    """Unfulfilled mint requests, oldest first — the operator's work-list (token-gated)."""
    pending = pending_store.pending()
    return {"count": len(pending), "pending": pending}


@router.post("/fulfill", dependencies=[Depends(require_operator)])
async def fulfill_mint_request(req: FulfillRequest) -> dict[str, Any]:
    """Mark a request fulfilled (operator CLI after broadcasting the mint; token-gated)."""
    if not req.id and not req.name:
        raise HTTPException(status_code=422, detail="provide id or name")
    record = pending_store.fulfill(request_id=req.id, name=req.name)
    if record is None:
        raise HTTPException(status_code=404, detail="no matching pending request")
    return record
