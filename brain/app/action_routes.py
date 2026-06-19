"""
/action — the action-layer gate exposed to the cockpit (PLAN.md §5 B).

The browser can't run `mm`; only the brain (co-located with the CLI) can. These
endpoints wrap the terminal-proven A2 flow, with NO new keys or signing logic:

  - GET  /action/authority — TEE-sign a probe request + run it through the public
    relying-party `/evaluate`; returns the current ALLOWED/REVOKED verdict (no gas).
    Drives the cockpit's live authority badge — when the operator toggles
    auth.revocation on-chain (out-of-band, Ledger), a re-check flips the verdict.
  - POST /action/evaluate {request?} — same, for an explicit erc20.transfer request.
  - POST /action/execute  {request?} — the gate IN ACTION: evaluate first, and ONLY
    if allowed broadcast a real (0-value self-) transfer via mm (TEE, beast mode).
    Returns the verdict + tx, or refuses with the deny reason.

Signing is the TEE wallet via `mm`; the verdict comes from the public, keyless
`/evaluate`. WORKER_URL + STEG_DEMO_NAME come from the brain env (brain/.env
defaults WORKER_URL to the local worker on :8787). Each endpoint shells out to the
already-proven bun scripts (scripts/demo-mm.ts, scripts/tee-self-transfer.ts).
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

# repo root = .../metamask (this file is brain/app/action_routes.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_NAME = os.environ.get("STEG_DEMO_NAME", "agent.steg.eth")

router = APIRouter(prefix="/action", tags=["action"])


class TransferParams(BaseModel):
    token: Optional[str] = None
    to: Optional[str] = None
    amount: Optional[str] = None


class ActionRequestBody(BaseModel):
    credentialId: Optional[str] = None
    params: Optional[TransferParams] = None


def _script_env(req: Optional[ActionRequestBody]) -> dict[str, str]:
    """Env for the bun scripts: inherit the brain's env, FORCE mm/TEE signing
    (demo-mm.ts falls back to a local viem key if MM_MNEMONIC/AGENT_PRIVATE_KEY are
    set — we want the TEE wallet), and thread any custom request fields through the
    env knobs that scripts/demo-request.ts reads."""
    env = dict(os.environ)
    env.pop("MM_MNEMONIC", None)
    env.pop("AGENT_PRIVATE_KEY", None)
    env.setdefault("STEG_DEMO_NAME", DEMO_NAME)
    if req:
        if req.credentialId:
            env["CREDENTIAL_ID"] = req.credentialId
        if req.params:
            if req.params.token:
                env["TOKEN"] = req.params.token
            if req.params.to:
                env["TO"] = req.params.to
            if req.params.amount:
                env["AMOUNT"] = req.params.amount
    return env


async def _run(cmd: list[str], env: dict[str, str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode or 0, out.decode().strip(), err.decode().strip()


def _last_json(stdout: str) -> Optional[dict[str, Any]]:
    """Parse the script's JSON result from stdout (logs go to stderr). demo-mm.ts
    pretty-prints a multi-line object; tee-self-transfer.ts prints a compact line.
    Try the whole stdout first, then fall back to the last single-line object."""
    text = stdout.strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
    return None


async def _evaluate(req: Optional[ActionRequestBody]) -> dict[str, Any]:
    """Sign + evaluate via demo-mm.ts; return {ok, verdict:{allowed, reason, …}}.
    demo-mm prints the worker's { ok, data:{…} } verdict envelope to stdout."""
    code, out, err = await _run(["bun", "scripts/demo-mm.ts"], _script_env(req))
    body = _last_json(out)
    verdict = body.get("data") if isinstance(body, dict) else None
    if isinstance(verdict, dict):
        return {"ok": True, "verdict": verdict}
    return {
        "ok": False,
        "verdict": None,
        "error": (err.splitlines()[-1] if err else "evaluate failed"),
    }


@router.get("/authority")
async def authority() -> dict[str, Any]:
    """Live authority probe for the cockpit badge — the default request, TEE-signed,
    evaluated against current on-chain auth.* state. No gas, no broadcast."""
    return await _evaluate(None)


@router.post("/evaluate")
async def evaluate(req: Optional[ActionRequestBody] = None) -> dict[str, Any]:
    """Evaluate an explicit (or default) erc20.transfer request. No gas."""
    return await _evaluate(req)


@router.post("/execute")
async def execute(req: Optional[ActionRequestBody] = None) -> dict[str, Any]:
    """The gate in action: evaluate first, and ONLY if allowed broadcast the TEE
    0-value self-transfer. Returns the verdict + tx, or refuses with the reason.

    NOTE (PLAN.md §5 B decision 3): the evaluated request (erc20.transfer of a
    placeholder token) and the executed tx (native 0-value self-transfer) are not
    the same action — the gate is enforced here in the brain. Unifying them via a
    native-transfer capability is the parked follow-up."""
    ev = await _evaluate(req)
    verdict = ev.get("verdict") or {}
    if not ev.get("ok") or not verdict.get("allowed"):
        return {
            "ok": True,
            "executed": False,
            "verdict": verdict,
            "reason": verdict.get("reason") or ev.get("error"),
        }
    code, out, err = await _run(
        ["bun", "scripts/tee-self-transfer.ts", "--send", "--yes"], _script_env(req)
    )
    tx = _last_json(out)
    if code != 0 or not isinstance(tx, dict) or not tx.get("txHash"):
        return {
            "ok": False,
            "executed": False,
            "verdict": verdict,
            "error": (err.splitlines()[-1] if err else "execute failed"),
        }
    return {"ok": True, "executed": True, "verdict": verdict, "tx": tx}
