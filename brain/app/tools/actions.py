"""
Action tools — writes that MOVE FUNDS.

Confirm-before-execute is structural here: it's split into two tools.
`transfer_preview` validates + summarizes and NEVER sends; `transfer_execute`
actually signs+broadcasts. The agent is instructed to always preview, surface
the summary, get explicit user confirmation, then execute.

(This is instruction-level confirmation — the LLM mediates it. A hard gate
comes later: a UI confirm modal and/or the ENS authorization verifier checking
the action before it's honored. For now the wallet is a low-value throwaway.)

`transfer_execute` signs in BYOK, so it needs MM_PASSWORD in the environment to
unlock the mnemonic. `mm transfer` uses the transaction path (which works in
BYOK), not the bugged message-signing path.
"""

import re

from agents import function_tool

from .wallet import _mm

_ADDR = re.compile(r"^0x[0-9a-fA-F]{40}$")


@function_tool
async def transfer_preview(to: str, amount: str, token: str, chain_id: int) -> str:
    """Preview a transfer WITHOUT sending. ALWAYS call this first, show the
    summary to the user, and get their explicit confirmation before calling
    transfer_execute. Validates the recipient (must be a 0x… address — ENS is
    NOT supported by mm transfer) and reports the current balance so the user
    can see it's affordable.

    Args:
        to: recipient 0x address (40 hex). ENS names are not accepted.
        amount: human-readable amount (e.g. "0.01", "100").
        token: token symbol or ERC-20 contract address (e.g. "ETH", "USDC").
        chain_id: EVM chain ID (1 = Ethereum mainnet).
    """
    if not _ADDR.match(to):
        return f"INVALID recipient '{to}': must be a 0x + 40 hex address. ENS names are not supported by mm transfer — ask the user for a hex address."
    balance = await _mm("wallet", "balance", "--json")
    return (
        f"PREVIEW — NOTHING SENT.\n"
        f"Transfer {amount} {token} → {to} on chain {chain_id}.\n"
        f"Current wallet balance: {balance}\n"
        f"Show this to the user. Only after they EXPLICITLY confirm, call "
        f"transfer_execute with the identical args."
    )


@function_tool
async def transfer_execute(to: str, amount: str, token: str, chain_id: int) -> str:
    """Execute a transfer — SIGNS AND BROADCASTS real funds. ONLY call this after
    transfer_preview AND an explicit user confirmation in the conversation. Never
    call it speculatively or to 'test'. Requires MM_PASSWORD in the environment.

    Args: same as transfer_preview.
    """
    if not _ADDR.match(to):
        return f"REFUSED: invalid recipient '{to}'."
    return await _mm(
        "transfer", "--to", to, "--amount", str(amount),
        "--chain-id", str(chain_id), "--token", token, "--json",
    )


@function_tool
async def swap_execute(
    from_token: str,
    to_token: str,
    amount: str,
    from_chain: int = 1,
    to_chain: int | None = None,
    slippage: float | None = None,
    quote_id: str | None = None,
) -> str:
    """Execute a swap/bridge — SIGNS AND BROADCASTS. ONLY call after swap_quote
    (which is the preview) AND explicit user confirmation. swap_quote is the
    confirm step for swaps — show its output, get a 'yes', then call this.
    Pass quote_id from the quote to execute that exact quote, or omit it to
    re-quote at execution. Requires MM_PASSWORD (BYOK signing).

    Args:
        from_token/to_token: symbols (ETH, USDC). amount: human-readable.
        from_chain: source chain ID (1 = mainnet). to_chain: for bridges.
        slippage: max % (0-100). quote_id: from swap_quote, to bind the price.
    """
    if quote_id:
        return await _mm("swap", "execute", "--quote-id", quote_id, "--json")
    args = ["swap", "execute", "--from", from_token, "--to", to_token,
            "--amount", str(amount), "--from-chain", str(from_chain), "--json"]
    if to_chain is not None:
        args += ["--to-chain", str(to_chain)]
    if slippage is not None:
        args += ["--slippage", str(slippage)]
    return await _mm(*args)
