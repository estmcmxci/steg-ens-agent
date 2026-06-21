"""
Predict (Polymarket) tools.

Market reads (status, geoblock, markets, book) are public. Account reads
(positions, portfolio, orders, balance, redeem-list) and ALL actions need a
completed Predict setup (predict_setup) and MM_PASSWORD in the env (BYOK).

No native --dry-run here: predict_quote is the preview for predict_place. The
other actions (place/cancel/redeem/deposit/withdraw/setup) have no preview, so
the agent MUST get explicit user confirmation in the conversation before calling
them. Prices are per-share in (0,1]; sizes are in shares.
"""

from agents import function_tool

from ..gate import gate_or_refusal
from .wallet import _mm


# --- setup / status ---

@function_tool
async def predict_status() -> str:
    """Check Predict back-end status and whether the account is set up."""
    return await _mm("predict", "status", "--json")


@function_tool
async def predict_geoblock() -> str:
    """Check whether Polymarket is geoblocked for the current IP."""
    return await _mm("predict", "geoblock", "--json")


@function_tool
async def predict_setup() -> str:
    """One-time Predict setup (creates credentials + approvals; signs on-chain).
    Get explicit user confirmation first. Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    return await _mm("predict", "setup", "--json")


# --- market reads (public) ---

@function_tool
async def predict_markets_search(query: str, limit: int = 10) -> str:
    """Search prediction markets by text query (e.g. 'election', 'BTC 100k')."""
    return await _mm("predict", "markets", "search", query, "--limit", str(limit), "--json")


@function_tool
async def predict_markets_list(tag: str | None = None, limit: int = 10, active: bool = True) -> str:
    """List prediction markets. Optional `tag`, `limit`, `active` (open markets)."""
    args = ["predict", "markets", "list", "--limit", str(limit), "--json"]
    if tag:
        args += ["--tag", tag]
    if active:
        args += ["--active"]
    return await _mm(*args)


@function_tool
async def predict_markets_get(market: str) -> str:
    """Inspect a single prediction market (outcomes, token IDs, prices) by slug
    or condition ID. The outcome token IDs here are what you pass to quote/place."""
    return await _mm("predict", "markets", "get", market, "--json")


@function_tool
async def predict_book(token_id: str) -> str:
    """Fetch the order book for an outcome token ID (bids/asks)."""
    return await _mm("predict", "book", token_id, "--json")


# --- account reads (need setup + MM_PASSWORD) ---

@function_tool
async def predict_positions() -> str:
    """View your prediction-market positions. Needs Predict setup + MM_PASSWORD."""
    return await _mm("predict", "positions", "--json")


@function_tool
async def predict_orders() -> str:
    """View your open prediction orders. Needs Predict setup + MM_PASSWORD."""
    return await _mm("predict", "orders", "--json")


@function_tool
async def predict_portfolio() -> str:
    """Full Predict portfolio snapshot. Needs Predict setup + MM_PASSWORD."""
    return await _mm("predict", "portfolio", "--json")


@function_tool
async def predict_balance() -> str:
    """Predict deposit-wallet balance (pUSD). Needs Predict setup + MM_PASSWORD."""
    return await _mm("predict", "balance", "--json")


@function_tool
async def predict_redeem_list() -> str:
    """List redeemable (winning) positions. Needs Predict setup + MM_PASSWORD."""
    return await _mm("predict", "redeem", "list", "--json")


# --- actions (confirm in conversation first; need MM_PASSWORD) ---

@function_tool
async def predict_quote(token_id: str, side: str, size: str, limit_price: str | None = None) -> str:
    """Preview a prediction order cost — the PREVIEW for predict_place. side:
    'buy'|'sell'. size: shares. Show this, get confirmation, then predict_place."""
    args = ["predict", "quote", token_id, "--side", side, "--size", str(size), "--json"]
    if limit_price is not None:
        args += ["--limit-price", str(limit_price)]
    return await _mm(*args)


@function_tool
async def predict_place(token_id: str, side: str, size: str, price: str,
                        order_type: str = "GTC") -> str:
    """Place a prediction-market order — SIGNS. ONLY after predict_quote AND
    explicit user confirmation. side: 'buy'|'sell'. size: shares. price: per-share
    (0-1), the limit/worst price. order_type: GTC|GTD|FOK|FAK. Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    return await _mm("predict", "place", token_id, "--side", side, "--size", str(size),
                     "--price", str(price), "--order-type", order_type, "--json")


@function_tool
async def predict_cancel(order_id: str | None = None, cancel_all: bool = False,
                         market: str | None = None) -> str:
    """Cancel prediction order(s). Give an order_id, or cancel_all=True, or a
    market condition ID. Confirm with the user first. Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    args = ["predict", "cancel", "--json"]
    if cancel_all:
        args += ["--all"]
    elif order_id:
        args += [order_id]
    elif market:
        args += ["--market", market]
    return await _mm(*args)


@function_tool
async def predict_redeem(condition_id: str | None = None, redeem_all: bool = False) -> str:
    """Redeem winning position(s). Give a condition_id or redeem_all=True. Confirm
    with the user first (redeem_all redeems everything). Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    args = ["predict", "redeem", "--json"]
    if redeem_all:
        args += ["--all"]
    elif condition_id:
        args += [condition_id]
    return await _mm(*args)


@function_tool
async def predict_deposit(amount: str) -> str:
    """Fund the Predict deposit wallet with pUSD. Confirm the amount first.
    Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    return await _mm("predict", "deposit", "--amount", str(amount), "--json")


@function_tool
async def predict_withdraw(amount: str, to: str | None = None) -> str:
    """Withdraw pUSD from the Predict deposit wallet. Defaults to your owner EOA;
    `to` overrides. Confirm amount + recipient first. Needs MM_PASSWORD."""
    if (refusal := await gate_or_refusal()):
        return refusal
    args = ["predict", "withdraw", "--amount", str(amount), "--json"]
    if to:
        args += ["--to", to]
    return await _mm(*args)
