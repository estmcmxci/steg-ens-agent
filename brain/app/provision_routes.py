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
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# repo root = .../metamask (this file is brain/app/provision_routes.py)
REPO_ROOT = Path(__file__).resolve().parents[2]

# Gas to top the fresh server wallet up with for its one reverse setName tx.
# Reverse setName ≈ 114k gas; at sub-gwei mainnet gas that's ~0.000024 ETH, so
# 0.0003 is ~12x headroom while keeping the hot-key float lean (demo2, A1).
REVERSE_GAS_ETH = "0.0003"

router = APIRouter(prefix="/provision", tags=["provision"])


class ProvisionRequest(BaseModel):
    # Defaults target the milestone-7 thin-slice demo agent.
    name: str = "demo.steg.eth"
    label: str = "demo"


def _sse(obj: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(obj)}\n\n".encode()


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


async def _run(*cmd: str) -> tuple[int, str, str]:
    """Run a command from the repo root (scripts use repo-relative paths). The hot
    key + RPC are inherited from the brain's environment."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(REPO_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
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


async def _provision_stream(req: ProvisionRequest) -> AsyncGenerator[bytes, None]:
    name, label = req.name, req.label
    yield _sse({"event": "begin", "name": name, "label": label})

    # ── pre-flight: the hot key must be present (option B signer) ──
    if not os.environ.get("OPERATOR_HOT_KEY"):
        yield _sse({"event": "error", "step": "preflight",
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

    async def step(step_id: str, label_text: str, cmd: tuple[str, ...]) -> tuple[bool, dict[str, Any]]:
        """Run one step, return (ok, parsed-json-or-empty). Caller yields frames."""
        code, out, err = await _run(*cmd)
        parsed = _last_json(out) or {}
        return code == 0, {"code": code, "stderr_tail": err.splitlines()[-1] if err else "", **parsed}

    try:
        # 1. fresh TEE server wallet (steglabs / TEE, beast mode)
        yield _sse({"event": "step", "step": "wallet_create", "status": "start",
                    "message": f"Creating TEE server wallet '{label}' (beast)…"})
        code, out, err = await _run("mm", "wallet", "create", "--name", label,
                                    "--trading-mode", "beast", "--json")
        if code != 0:
            yield _sse({"event": "error", "step": "wallet_create", "message": err or out})
            return
        try:
            data = json.loads(out).get("data", {}) or {}
            # `wallet create` nests under data.wallet.address; `wallet show` uses data.address.
            server_wallet = data.get("address") or (data.get("wallet") or {}).get("address")
        except (json.JSONDecodeError, ValueError, AttributeError):
            server_wallet = None
        if not server_wallet:
            yield _sse({"event": "error", "step": "wallet_create",
                        "message": f"could not parse new wallet address from: {out[:200]}"})
            return
        yield _sse({"event": "step", "step": "wallet_create", "status": "done",
                    "serverWallet": server_wallet})

        # 1b. fund the fresh server wallet so it can pay for its own reverse setName.
        #     It's created with zero balance; the hot key tops it up for that one tx.
        yield _sse({"event": "step", "step": "fund", "status": "start",
                    "message": "Funding the new wallet for its reverse tx…"})
        ok, res = await step("fund", "fund",
                             _bun("scripts/fund-wallet.ts", "--to", server_wallet, "--amount", REVERSE_GAS_ETH))
        if not ok:
            yield _sse({"event": "error", "step": "fund", "message": res.get("stderr_tail", "funding failed")})
            return
        yield _sse({"event": "step", "step": "fund", "status": "done"})

        # 2. forward records: setAddr + auth.credential[primary] + agent-trust-models
        yield _sse({"event": "step", "step": "records", "status": "start",
                    "message": "Setting forward addr + auth.credential + trust-models…"})
        ok, res = await step("records", "records",
                             _bun("scripts/rebind-server-wallet.ts", "--name", name, "--addr", server_wallet))
        if not ok:
            yield _sse({"event": "error", "step": "records", "message": res.get("stderr_tail", "failed")})
            return
        yield _sse({"event": "step", "step": "records", "status": "done"})

        # 3. ERC-8004 bind → minted agent id
        yield _sse({"event": "step", "step": "bind", "status": "start",
                    "message": "Binding the name as an ERC-8004 agent…"})
        ok, res = await step("bind", "bind", _bun("scripts/bind-erc8004.ts", "--name", name))
        agent_id = res.get("agentId")
        if not ok or not agent_id:
            yield _sse({"event": "error", "step": "bind",
                        "message": res.get("stderr_tail", "bind failed / no agentId")})
            return
        yield _sse({"event": "step", "step": "bind", "status": "done",
                    "agentId": agent_id, "tx": res.get("txHash")})

        # 4. ENSIP-26 identity records (agent-id + display + description + skills)
        yield _sse({"event": "step", "step": "identity", "status": "start",
                    "message": "Writing ENSIP-26 identity records…"})
        ok, res = await step("identity", "identity",
                             _bun("scripts/set-agent-records.ts", "--name", name, "--agent-id", agent_id))
        if not ok:
            yield _sse({"event": "error", "step": "identity", "message": res.get("stderr_tail", "failed")})
            return
        yield _sse({"event": "step", "step": "identity", "status": "done"})

        # 5. agentURI → the card endpoint
        yield _sse({"event": "step", "step": "agent_uri", "status": "start",
                    "message": "Setting the ERC-8004 agentURI → card…"})
        ok, res = await step("agent_uri", "agent_uri",
                             _bun("scripts/set-agent-uri.ts", "--name", name, "--agent-id", agent_id))
        if not ok:
            yield _sse({"event": "error", "step": "agent_uri", "message": res.get("stderr_tail", "failed")})
            return
        yield _sse({"event": "step", "step": "agent_uri", "status": "done"})

        # 6. ENSIP-25 claim
        yield _sse({"event": "step", "step": "ensip25", "status": "start",
                    "message": "Writing the ENSIP-25 registration claim…"})
        ok, res = await step("ensip25", "ensip25",
                             _bun("scripts/set-agent-registration.ts", "--name", name, "--agent-id", agent_id))
        if not ok:
            yield _sse({"event": "error", "step": "ensip25", "message": res.get("stderr_tail", "failed")})
            return
        yield _sse({"event": "step", "step": "ensip25", "status": "done"})

        # 7. reverse record — server wallet self-signs via mm (must select it first)
        yield _sse({"event": "step", "step": "reverse", "status": "start",
                    "message": "Server wallet setting its own reverse record (TEE)…"})
        sel_code, _, sel_err = await _run("mm", "wallet", "select", "--address", server_wallet, "--json")
        if sel_code != 0:
            yield _sse({"event": "error", "step": "reverse", "message": f"wallet select failed: {sel_err}"})
            return
        code, out, err = await _run("bun", "scripts/set-reverse-server-wallet.ts",
                                    "--name", name, "--wallet", server_wallet, "--send", "--yes")
        if code != 0:
            yield _sse({"event": "error", "step": "reverse", "message": (err or out).splitlines()[-1] if (err or out) else "failed"})
            return
        yield _sse({"event": "step", "step": "reverse", "status": "done"})

        # 8. hand the name to the agent's OWN TEE wallet (self-sovereign): the agent
        #    then controls its own ENS records and can edit them via the NLI
        #    (ens_set_records_*). The hot key (which owned the node during provisioning)
        #    transfers the wrapped name to the server wallet. The operator's only role
        #    was minting the subname; it does NOT hold the name at rest.
        yield _sse({"event": "step", "step": "transfer", "status": "start",
                    "message": "Handing the name to the agent's own wallet…"})
        ok, res = await step("transfer", "transfer",
                             _bun("scripts/transfer-subname.ts", "--name", name, "--to", server_wallet))
        if not ok:
            yield _sse({"event": "error", "step": "transfer", "message": res.get("stderr_tail", "failed")})
            return
        yield _sse({"event": "step", "step": "transfer", "status": "done"})

        # Success: mm is already selected on server_wallet (step 7 selected it;
        # the hot-key transfer in step 8 doesn't change mm's active wallet). Mark
        # success so the finally leaves mm here instead of restoring prior_wallet.
        provisioned_ok = True
        yield _sse({"event": "complete", "name": name, "agentId": agent_id,
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
async def provision(req: ProvisionRequest) -> StreamingResponse:
    return StreamingResponse(_provision_stream(req), media_type="text/event-stream")
