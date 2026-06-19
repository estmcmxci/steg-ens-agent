"""
ENS authority gate (PLAN.md §5 B) — the guard the chat write tools call before
they broadcast.

This is the thesis made operational inside the conversation: every fund-moving
action the agent takes is checked against the agent's ENS-published authorization
(auth.* records on agent.steg.eth), read fresh from L1 mainnet by the public,
keyless relying-party `/evaluate`. The operator can revoke at ENS — without
touching the TEE key — and the agent's NEXT action is denied.

Mechanism (reuses the A2-proven path, no new signing code): shell the standalone
`scripts/demo-mm.ts`, which TEE-signs a canonical authority-probe ActionRequest
via `mm wallet sign-message` and POSTs it to the worker `/evaluate`. We read the
verdict and let the action through only when allowed.

Scope note: the probe matches the on-chain capability (the narrow placeholder
erc20.transfer credential), so the gate keys on the AUTHORITY/revocation state —
"operator revoked → agent refuses". Evaluating each real tx's exact params needs a
broader on-chain capability (an operator Ledger write) and stays the parked
follow-up. WORKER_URL + STEG_DEMO_NAME come from the brain env (brain/.env).

Fail CLOSED: if the gate can't get a verdict (worker down, mm error), it DENIES.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

# repo root = .../metamask (this file is brain/app/gate.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_NAME = os.environ.get("STEG_DEMO_NAME", "agent.steg.eth")


def _parse_verdict(stdout: str) -> Optional[dict[str, Any]]:
    """demo-mm prints the worker's { ok, data:{allowed, reason, …} } envelope to
    stdout. Return the inner verdict dict, or None."""
    text = stdout.strip()
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict):
        return None
    data = obj.get("data")
    return data if isinstance(data, dict) else obj


async def evaluate_action() -> dict[str, Any]:
    """TEE-sign the authority probe + run it through /evaluate. Returns the verdict
    {allowed: bool, reason: str, stateHash?: str}. Denies (fail-closed) if no
    verdict can be obtained."""
    env = dict(os.environ)
    # demo-mm falls back to a local viem key if these are set — force mm/TEE signing.
    env.pop("MM_MNEMONIC", None)
    env.pop("AGENT_PRIVATE_KEY", None)
    env.setdefault("STEG_DEMO_NAME", DEMO_NAME)

    proc = await asyncio.create_subprocess_exec(
        "bun", "scripts/demo-mm.ts",
        cwd=str(REPO_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    verdict = _parse_verdict(out.decode())
    if isinstance(verdict, dict) and "allowed" in verdict:
        return verdict

    tail = ""
    if err:
        lines = err.decode().strip().splitlines()
        tail = lines[-1] if lines else ""
    return {"allowed": False, "reason": f"GATE_UNAVAILABLE: {tail or 'no verdict from /evaluate'}"}


async def gate_or_refusal() -> Optional[str]:
    """Convenience for the write tools: returns None if the action is authorized,
    or a ready-to-relay refusal string if it's denied. Call at the TOP of every
    fund-moving execute tool, before touching `mm`."""
    verdict = await evaluate_action()
    if verdict.get("allowed"):
        return None
    reason = verdict.get("reason", "DENIED")
    return (
        f"⛔ BLOCKED by the ENS authority gate — reason: {reason}. NOTHING was sent. "
        f"The operator may have revoked this agent's authorization at ENS "
        f"(auth.revocation on agent.steg.eth). Tell the user plainly that the action "
        f"was blocked because the agent's ENS-published authority denied it — the key "
        f"was never the issue."
    )
