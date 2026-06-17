"""
Perps (Hyperliquid) tools.

Reads are plain. Actions use mm's native `--dry-run` as the preview: every action
tool takes `dry_run: bool = True`, so by default it previews and signs nothing.
The agent must call with dry_run=True, show the result, get explicit confirmation,
then call again with dry_run=False to execute (which adds `--yes` to skip mm's own
prompt and needs MM_PASSWORD for BYOK signing).
"""

from agents import function_tool

from .wallet import _mm


# --- reads ---

@function_tool
async def perps_markets(symbol: str | None = None) -> str:
    """List Hyperliquid perp markets (price, funding, etc.). Optional `symbol`
    filter (e.g. 'BTC')."""
    args = ["perps", "markets", "--json"]
    if symbol:
        args += ["--symbol", symbol]
    return await _mm(*args)


@function_tool
async def perps_balance() -> str:
    """Perps account balance / available USDC margin on Hyperliquid."""
    return await _mm("perps", "balance", "--json")


@function_tool
async def perps_positions() -> str:
    """Open perpetual positions: size, entry, PnL, liquidation price."""
    return await _mm("perps", "positions", "--json")


@function_tool
async def perps_orders() -> str:
    """Resting (open) perp orders."""
    return await _mm("perps", "orders", "--json")


@function_tool
async def perps_quote(symbol: str, side: str, size: str, leverage: int,
                      order_type: str = "market", limit_px: str | None = None) -> str:
    """Quote a perp order — the PREVIEW for perps_open (est. fees, margin, liq
    price). side: 'long'|'short'. size: base asset. leverage: positive int.
    order_type: 'market'|'limit' (limit needs limit_px)."""
    args = ["perps", "quote", "--symbol", symbol, "--side", side, "--size", str(size),
            "--leverage", str(leverage), "--type", order_type, "--json"]
    if limit_px is not None:
        args += ["--limit-px", str(limit_px)]
    return await _mm(*args)


@function_tool
async def perps_list_venues() -> str:
    """List perpetual venues (e.g. hyperliquid)."""
    return await _mm("perps", "list-venues", "--json")


# --- actions (dry_run=True previews; dry_run=False executes, needs MM_PASSWORD) ---

@function_tool
async def perps_open(symbol: str, side: str, size: str, leverage: int,
                     order_type: str = "market", limit_px: str | None = None,
                     dry_run: bool = True) -> str:
    """Open a perp position. ALWAYS call dry_run=True first (previews, signs
    nothing), show the user, get EXPLICIT confirmation, THEN call dry_run=False to
    execute. side: 'long'|'short'; leverage: positive int. Execute needs MM_PASSWORD."""
    args = ["perps", "open", "--symbol", symbol, "--side", side, "--size", str(size),
            "--leverage", str(leverage), "--type", order_type, "--json"]
    if limit_px is not None:
        args += ["--limit-px", str(limit_px)]
    args += ["--dry-run"] if dry_run else ["--yes"]
    return await _mm(*args)


@function_tool
async def perps_close(symbol: str | None = None, size: str | None = None,
                      close_all: bool = False, dry_run: bool = True) -> str:
    """Close a perp position (or all with close_all=True). Partial close via
    `size`. dry_run=True previews; dry_run=False executes (MM_PASSWORD). Preview+confirm first."""
    args = ["perps", "close", "--json"]
    if close_all:
        args += ["--all"]
    elif symbol:
        args += ["--symbol", symbol]
        if size:
            args += ["--size", str(size)]
    args += ["--dry-run"] if dry_run else ["--yes"]
    return await _mm(*args)


@function_tool
async def perps_modify(symbol: str, leverage: int | None = None, tp: str | None = None,
                       sl: str | None = None, dry_run: bool = True) -> str:
    """Modify leverage / take-profit (tp) / stop-loss (sl) on a position. dry_run=True
    previews; dry_run=False executes (MM_PASSWORD). Preview+confirm first."""
    args = ["perps", "modify", "--symbol", symbol, "--json"]
    if leverage is not None:
        args += ["--leverage", str(leverage)]
    if tp is not None:
        args += ["--tp", str(tp)]
    if sl is not None:
        args += ["--sl", str(sl)]
    args += ["--dry-run"] if dry_run else ["--yes"]
    return await _mm(*args)


@function_tool
async def perps_cancel(order_id: int, symbol: str | None = None, dry_run: bool = True) -> str:
    """Cancel a resting perp order by order_id. dry_run=True previews; dry_run=False
    executes (MM_PASSWORD). Preview+confirm first."""
    args = ["perps", "cancel", "--order-id", str(order_id), "--json"]
    if symbol:
        args += ["--symbol", symbol]
    args += ["--dry-run"] if dry_run else ["--yes"]
    return await _mm(*args)


@function_tool
async def perps_deposit(amount: str, dry_run: bool = True) -> str:
    """Deposit USDC into the perps venue (Hyperliquid). dry_run=True previews;
    dry_run=False executes (MM_PASSWORD). Preview+confirm first."""
    args = ["perps", "deposit", "--amount", str(amount), "--json"]
    if dry_run:
        args += ["--dry-run"]
    return await _mm(*args)


@function_tool
async def perps_withdraw(amount: str, dry_run: bool = True) -> str:
    """Withdraw USDC from the perps venue. dry_run=True previews; dry_run=False
    executes (MM_PASSWORD). Preview+confirm first."""
    args = ["perps", "withdraw", "--amount", str(amount), "--json"]
    if dry_run:
        args += ["--dry-run"]
    return await _mm(*args)


@function_tool
async def perps_transfer(amount: str, direction: str) -> str:
    """Move USDC between spot and perp accounts. direction: 'spot-to-perp' |
    'perp-to-spot'. Internal (no external recipient). Get explicit user
    confirmation before calling. Executes immediately; needs MM_PASSWORD."""
    return await _mm("perps", "transfer", "--amount", str(amount),
                     "--direction", direction, "--json")
