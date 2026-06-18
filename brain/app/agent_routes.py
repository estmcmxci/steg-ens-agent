"""
Read-only REST endpoints exposing the agent wallet's live `mm` state to the
cockpit frontend.

The browser can't run `mm` — only the brain (co-located with the CLI) can. These
GETs mirror a subset of the 57 confirm-gated chat tools, but as plain public
reads with NO MM_PASSWORD: every endpoint here is unprivileged. *Actions* stay in
the chat (where they're confirm-gated and `/evaluate`-checked); this is read-only
exposure for the portfolio card.

`mm` already prints its own `{ok, data}` / `{ok, error}` envelope, so we pass it
straight through — the frontend consumes that shape directly.
"""

import json
from typing import Any

from fastapi import APIRouter

from .tools.wallet import _mm

router = APIRouter(prefix="/agent", tags=["agent-wallet"])


async def _mm_json(*args: str) -> dict[str, Any]:
    """Run an `mm` read and return its native JSON envelope.

    On success mm emits `{ok: true, data: ...}`; on failure `{ok: false, error:
    {code, message, hint}}`. We pass either through verbatim. If output isn't JSON
    at all (e.g. raw stderr), we synthesize an ok:false envelope so panels can
    always render an error/empty state instead of crashing.
    """
    raw = await _mm(*args)
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {"ok": False, "data": None, "error": {"code": "MM_ERROR", "message": raw or "no output from mm"}}
    if isinstance(parsed, dict) and "ok" in parsed:
        return parsed
    return {"ok": True, "data": parsed, "error": None}


@router.get("/balance")
async def agent_balance() -> dict[str, Any]:
    """Holdings panel — native + token balances across chains, with USD values."""
    return await _mm_json("wallet", "balance", "--json")


@router.get("/tx")
async def agent_tx(limit: int = 10, chain: str | None = None) -> dict[str, Any]:
    """Activity panel — recent transactions. `limit` 1-500; optional `chain` filter."""
    args = ["tx", "history", "--limit", str(limit), "--json"]
    if chain:
        args += ["--chain", chain]
    return await _mm_json(*args)


@router.get("/perps")
async def agent_perps() -> dict[str, Any]:
    """Perps panel — open positions + account margin balance (composite). Each leg
    carries its own mm envelope so the panel can render an empty state per leg."""
    return {
        "positions": await _mm_json("perps", "positions", "--json"),
        "balance": await _mm_json("perps", "balance", "--json"),
    }


@router.get("/predict")
async def agent_predict() -> dict[str, Any]:
    """Predict panel — Polymarket portfolio. Reads need Predict setup + MM_PASSWORD,
    so when unset this returns ok:false (e.g. MNEMONIC_LOCKED) — the panel shows a
    locked/empty state. Action stays in the chat."""
    return await _mm_json("predict", "portfolio", "--json")


@router.get("/aave")
async def agent_aave() -> dict[str, Any]:
    """Aave panel — deferred placeholder. There's no native `mm aave` command yet
    (feature request filed in docs/feature-request-aave-v3.md), so this is a static
    ok:false envelope the panel renders as 'coming soon'."""
    return {
        "ok": False,
        "data": None,
        "error": {
            "code": "UNSUPPORTED",
            "message": "Aave V3 is not yet supported by the mm CLI.",
            "hint": "Feature request filed in docs/feature-request-aave-v3.md.",
        },
        "status": "deferred",
    }
