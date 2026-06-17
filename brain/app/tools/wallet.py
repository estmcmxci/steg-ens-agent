"""
Agent-wallet tools — the MetaMask `mm` CLI exposed as agent tools.

This is the v1 keystone: the brain shells out to the locally-authenticated `mm`
CLI (BYOK wallet) for wallet reads. No keys here, no signing yet — just "talk to
your wallet." The brain co-locates with `mm` on the same machine, so these tools
invoke the CLI directly.

(`mm wallet balance`/`address` are reads and need no MM_PASSWORD. Signing/exec
tools come later — and `send-transaction` works in BYOK, so no server wallet is
needed for the first action tool either.)
"""

import asyncio
import json

from agents import function_tool

from .helpers import worker_get


async def _mm(*args: str) -> str:
    """Run an `mm` CLI command and return stdout (or stderr on failure)."""
    proc = await asyncio.create_subprocess_exec(
        "mm",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    text = out.decode().strip()
    return text if proc.returncode == 0 and text else err.decode().strip()


@function_tool
async def wallet_balance() -> str:
    """Get the agent wallet's balances — native + token holdings across chains,
    with USD values. Use this whenever the user asks about their balance,
    holdings, portfolio, or how much they have. Returns JSON from the mm CLI."""
    return await _mm("wallet", "balance", "--json")


@function_tool
async def wallet_address() -> str:
    """Get the agent wallet's address (the active mm BYOK wallet). Use when the
    user asks for their address or where to send funds."""
    return await _mm("wallet", "address", "--json")


@function_tool
async def agent_identity() -> str:
    """Get the agent's onchain ENS identity profile for agent.steg.eth (its
    name, address, and records) from the ENS Worker. Use when the user asks
    who/what this agent is, or about its ENS name."""
    profile = await worker_get("/profile", {"input": "agent.steg.eth", "network": "mainnet"})
    return profile


@function_tool
async def token_price(asset_ids: str, vs: str = "usd", market_data: bool = False) -> str:
    """Get spot prices for tokens. `asset_ids` is a comma-separated list of
    CAIP-19 asset IDs (e.g. ETH = "eip155:1/slip44:60", an ERC-20 =
    "eip155:1/erc20:0x..."). TIP: the assetId for each holding is in the
    wallet_balance output, so you can price exactly what the wallet holds.
    Set market_data=true to include market cap / 24h change."""
    args = ["price", "spot", "--asset-ids", asset_ids, "--vs", vs, "--json"]
    if market_data:
        args.append("--market-data")
    return await _mm(*args)


@function_tool
async def swap_quote(
    from_token: str,
    to_token: str,
    amount: str,
    from_chain: int = 1,
    to_chain: int | None = None,
    slippage: float | None = None,
) -> str:
    """Get a READ-ONLY swap/bridge quote (expected output, fees, route, quote-id).
    Does NOT execute. Use when the user asks "how much X for Y" or to preview a
    swap. Same-chain if to_chain is omitted; cross-chain bridges otherwise.
    Token args are symbols (ETH, USDC). Chains are EVM chain IDs (1 = mainnet)."""
    args = ["swap", "quote", "--from", from_token, "--to", to_token,
            "--amount", str(amount), "--from-chain", str(from_chain), "--json"]
    if to_chain is not None:
        args += ["--to-chain", str(to_chain)]
    if slippage is not None:
        args += ["--slippage", str(slippage)]
    return await _mm(*args)


@function_tool
async def tx_history(limit: int = 10, chain: str | None = None) -> str:
    """List recent transactions for the agent wallet. `limit` 1-500 (default 10).
    Optional `chain` filter (e.g. "1" or "1,137"). Use when the user asks about
    recent activity, history, or past transactions."""
    args = ["tx", "history", "--limit", str(limit), "--json"]
    if chain:
        args += ["--chain", chain]
    return await _mm(*args)


@function_tool
async def wallet_show() -> str:
    """Show full details of the active wallet (id, address, mode, name). Use for
    'show my wallet' / wallet details."""
    return await _mm("wallet", "show", "--json")


@function_tool
async def wallet_list() -> str:
    """List all wallets under the authenticated account. Use when the user asks
    what wallets they have."""
    return await _mm("wallet", "list", "--json")


@function_tool
async def chains_list() -> str:
    """List supported EVM chains (chain IDs + names). Use to discover chain IDs
    or answer 'what chains are supported'."""
    return await _mm("chains", "list", "--json")


@function_tool
async def decode_calldata(payload: str) -> str:
    """Decode raw EVM calldata (0x-hex) into a function name, params, and a
    plain-language intent. Use to explain what a transaction/calldata does before
    anyone signs it. `payload` must be 0x-prefixed hex."""
    return await _mm("decode", "--payload", payload, "--json")


@function_tool
async def token_search(query: str, chain: str | None = None, limit: int = 10) -> str:
    """Search tokens by symbol or name (e.g. 'USDC', 'Wrapped Ether'). Returns
    matching tokens with their addresses/asset IDs. Optional `chain` (e.g. '1' or
    '1,137'). Use to find a token's address/assetId."""
    args = ["token", "list", "search", "--query", query, "--limit", str(limit), "--json"]
    if chain:
        args += ["--chain", chain]
    return await _mm(*args)


@function_tool
async def token_list(kind: str = "trending", chain: str | None = None) -> str:
    """List notable tokens. `kind` is one of: 'popular', 'trending', 'top-gainer'.
    Optional `chain` (defaults to mainnet). Use for token discovery / 'what's
    trending'."""
    if kind not in ("popular", "trending", "top-gainer"):
        return "kind must be one of: popular, trending, top-gainer"
    args = ["token", "list", kind, "--json"]
    if chain:
        args += ["--chain", chain]
    return await _mm(*args)
