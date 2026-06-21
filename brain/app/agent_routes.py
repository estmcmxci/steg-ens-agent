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
import os
from typing import Any

import httpx
from fastapi import APIRouter

from .tools.wallet import _mm

# Alchemy-direct balance fallback (mm's account-balance API rate-limits hard with
# HTTP 429 under load; this bypasses it entirely using the project's RPC).
_USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
_CHAINLINK_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"


async def _rpc(url: str, method: str, params: list) -> str | None:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=10
        )
        return r.json().get("result")


async def _alchemy_balance() -> dict[str, Any]:
    """Compute the active wallet's USD balance (native ETH + USDC) straight from the
    RPC, matching mm's BalanceData shape. Used when mm's balance API is rate-limited."""
    rpc = os.environ.get("ETH_RPC_URL")
    if not rpc:
        raise RuntimeError("no ETH_RPC_URL for Alchemy balance")
    # active wallet address (mm wallet show is a LOCAL read — not the throttled balance API)
    addr = json.loads(await _mm("wallet", "show", "--json"))["data"]["address"]
    pad = addr[2:].rjust(64, "0")
    eth_wei = int(await _rpc(rpc, "eth_getBalance", [addr, "latest"]) or "0x0", 16)
    usdc_hex = await _rpc(rpc, "eth_call", [{"to": _USDC_MAINNET, "data": "0x70a08231" + pad}, "latest"])
    price_hex = await _rpc(rpc, "eth_call", [{"to": _CHAINLINK_ETH_USD, "data": "0x50d25bcd"}, "latest"])
    eth = eth_wei / 1e18
    usdc = (int(usdc_hex, 16) / 1e6) if usdc_hex and usdc_hex != "0x" else 0.0
    eth_price = (int(price_hex, 16) / 1e8) if price_hex and price_hex != "0x" else 0.0
    eth_usd = eth * eth_price
    total = eth_usd + usdc
    tokens = [{"token": "ETH", "amount": f"{eth:.18f}", "usdValue": f"{eth_usd:.4f}",
               "assetId": "eip155:1/slip44:60", "name": "Ether", "type": "native"}]
    if usdc > 0:
        tokens.append({"token": "USDC", "amount": f"{usdc:.6f}", "usdValue": f"{usdc:.4f}",
                       "assetId": f"eip155:1/erc20:{_USDC_MAINNET}", "name": "USD Coin", "type": "erc20"})
    return {
        "currency": "usd",
        "totalValue": f"{total:.4f}",
        "chains": [{"chain": "eip155:1", "chainId": "eip155:1", "name": "Ethereum",
                    "totalValue": f"{total:.4f}", "tokens": tokens}],
        "unprocessedNetworks": [],
        "unpricedAssetIds": [],
    }

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
    """Holdings panel — native + token balances across chains, with USD values.
    Falls back to an Alchemy-direct computation when mm's balance API rate-limits."""
    res = await _mm_json("wallet", "balance", "--json")
    if res.get("ok"):
        return res
    try:
        return {"ok": True, "data": await _alchemy_balance(), "error": None}
    except Exception:
        return res  # surface the original mm error if the fallback also fails


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
