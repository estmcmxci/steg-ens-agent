"""
Action tools — writes that MOVE FUNDS.

Confirm-before-execute is structural here: it's split into two tools.
`transfer_preview` validates + summarizes and NEVER sends; `transfer_execute`
actually signs+broadcasts. The agent is instructed to always preview, surface
the summary, get explicit user confirmation, then execute.

Two layers of confirmation now apply to every execute tool:
  1. Instruction-level: the LLM previews + gets explicit user 'yes' (above).
  2. The ENS authority gate (PLAN.md §5 B): before broadcasting, each execute
     tool calls `gate_or_refusal()`, which TEE-signs a probe and checks the
     public relying-party `/evaluate` against agent.steg.eth's ENS-published
     auth.* state. If the operator has REVOKED (at ENS, without the key), the
     tool refuses and nothing is sent. This is the hard gate the old header
     promised — the authorization verifier checking the action before it's honored.

`transfer_execute` signs via the TEE server wallet (beast mode) — no MM_PASSWORD.
"""

import asyncio
import json
import re
from pathlib import Path

from agents import function_tool

from ..gate import gate_or_refusal, telegram_mode
from .wallet import _mm

# Repo root (brain/app/tools/actions.py → metamask/) for shelling bun scripts.
_REPO_ROOT = Path(__file__).resolve().parents[3]

_ADDR = re.compile(r"^0x[0-9a-fA-F]{40}$")
_HASH_RE = re.compile(r"0x[0-9a-fA-F]{64}")

# chainId → block explorer base (for the clickable tx link the agent must always show).
_EXPLORERS = {
    1: "https://etherscan.io",
    10: "https://optimistic.etherscan.io",
    56: "https://bscscan.com",
    137: "https://polygonscan.com",
    8453: "https://basescan.org",
    42161: "https://arbiscan.io",
    43114: "https://snowtrace.io",
    59144: "https://lineascan.build",
    1329: "https://seitrace.com",
    11155111: "https://sepolia.etherscan.io",
}


def _augment_tx(raw: str, chain_id: int) -> str:
    """Augment an mm execute result with an explicit explorer URL + a render directive
    so the agent ALWAYS surfaces a clickable Etherscan link. Only a real 0x… tx hash
    is linked — mm without --wait can return a `pending:<uuid>` placeholder, which we
    leave alone (no link yet)."""
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw
    data = obj.get("data") if isinstance(obj, dict) and isinstance(obj.get("data"), dict) else obj
    tx_hash = None
    if isinstance(data, dict):
        for k in ("hash", "txHash", "transactionHash"):
            v = data.get(k)
            if isinstance(v, str) and _HASH_RE.fullmatch(v):
                tx_hash = v
                break
    if not tx_hash:  # fall back to the first real hash anywhere in the result
        m = _HASH_RE.search(raw)
        tx_hash = m.group(0) if m else None
    if not tx_hash or not isinstance(obj, dict):
        return raw
    url = f"{_EXPLORERS.get(chain_id, 'https://etherscan.io')}/tx/{tx_hash}"
    obj["explorerUrl"] = url
    obj["_render"] = (
        f"ALWAYS show the user this transaction as a clickable markdown link: "
        f"[View on Etherscan]({url})"
    )
    return json.dumps(obj)


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
    refusal = await gate_or_refusal()
    if refusal:
        return refusal
    # --wait so mm returns the mined tx hash (not a pending:<uuid> placeholder),
    # then augment with the explorer URL the agent must surface as a link.
    result = await _mm(
        "transfer", "--to", to, "--amount", str(amount),
        "--chain-id", str(chain_id), "--token", token, "--wait", "--json",
    )
    return _augment_tx(result, chain_id)


# ── x402 payments (ERD Arc 3) ────────────────────────────────────────────────
# The agent as an x402 PAYER: pay an x402-gated HTTP API (e.g. Exa web search)
# with USDC on Base, signed by the TEE server-wallet via EIP-3009. Same shape as
# transfer: preview (zero-spend) → execute (gate_or_refusal() → sign+settle).
# The heavy lifting lives in the proven TS core (scripts/x402-brain-pay.ts, which
# reuses mm-x402-account.ts + the §9/mainnet-Exa payer); we shell it exactly like
# demo-mm.ts, parsing its single-line JSON verdict.

# Default proof seller = Exa web search (Base-mainnet x402-over-HTTP, ~$0.007).
# Travala's payment host is 503 (deferred); swap `url`/`request_body` for any
# Branch-1 x402 seller.
_X402_DEFAULT_URL = "https://api.exa.ai/search"
_X402_DEFAULT_BODY = '{"query":"x402 payment protocol","numResults":3,"contents":{"text":{"maxCharacters":400}}}'


def _x402_enrich_body(url: str, body: str) -> str:
    """For Exa search, ensure the request asks for text contents so each result
    carries a snippet — Exa returns title+url only unless `contents` is set, and
    text costs the SAME $0.007 as a plain search. No-op for other sellers, or if
    the body already sets `contents`/isn't valid JSON."""
    if "api.exa.ai" not in url:
        return body
    try:
        obj = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return body
    if isinstance(obj, dict) and "contents" not in obj:
        obj["contents"] = {"text": {"maxCharacters": 400}}
        return json.dumps(obj)
    return body


async def _x402_run(url: str, body: str, max_units: int, pay_to: str | None, execute: bool) -> dict | str:
    """Shell scripts/x402-brain-pay.ts and return its parsed JSON verdict, or an
    error string. The script runs the PAYMENT-SPECIFIC ENS gate itself (it signs
    the real x402.payment — which needs the payTo/amount only known after the 402
    challenge — and evaluates it against the on-chain x402.payment capability), so
    we do NOT pre-gate in Python."""
    if not re.match(r"^https?://", url):
        return f"INVALID url '{url}': must be an http(s):// URL."
    body = _x402_enrich_body(url, body)
    args = ["bun", "scripts/x402-brain-pay.ts", "--url", url, "--body", body, "--max", str(max_units)]
    if pay_to:
        args += ["--pay-to", pay_to]
    if execute:
        args += ["--execute"]
    if telegram_mode.get():
        # Telegram-triggered request: gate.py's gate_or_refusal() is already a
        # no-op in this mode, and the script would otherwise run its OWN
        # internal gate probe (it has to — it signs the real x402.payment
        # inside itself, after the 402 challenge reveals payTo/amount). Skip
        # that internal probe too, for the same confirmed reason: Telegram's
        # trust boundary is the bot's pairing/allow-list, not the ENS gate.
        args += ["--no-gate"]
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(_REPO_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    # stdout is exactly one JSON line (the verdict); take the last {…} line.
    line = ""
    for candidate in out.decode().strip().splitlines():
        if candidate.strip().startswith("{"):
            line = candidate.strip()
    if not line:
        tail = err.decode().strip().splitlines()
        return f"x402 payer produced no verdict. {tail[-1] if tail else '(no output)'}"
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return f"x402 payer: unparseable output: {line[:200]}"
    return obj if isinstance(obj, dict) else f"x402 payer: unexpected output {line[:160]}"


@function_tool
async def x402_pay_preview(
    url: str = _X402_DEFAULT_URL,
    request_body: str = _X402_DEFAULT_BODY,
    max_usd: float = 0.01,
    pay_to: str | None = None,
) -> str:
    """Preview paying an x402-gated HTTP API WITHOUT sending (ZERO-SPEND). ALWAYS
    call this first, show the summary to the user, and get explicit confirmation
    before calling x402_pay_execute. It POSTs the request, reads the seller's 402
    payment challenge, runs the fail-closed guard (must be canonical Base USDC,
    amount ≤ your cap), and reports what the ENS authority gate WOULD decide — all
    without signing or spending.

    Args:
        url: the x402-gated endpoint to POST (default: Exa web search).
        request_body: JSON string sent as the POST body (e.g. an Exa query).
        max_usd: hard spend cap in USD (default 0.01). The payment is refused if
                 the seller asks for more.
        pay_to: optional 0x address to pin the expected payment recipient.
    """
    max_units = int(round(max_usd * 1_000_000))
    if max_units <= 0:
        return f"INVALID max_usd {max_usd}: must be greater than 0."
    if pay_to is not None and not _ADDR.match(pay_to):
        return f"INVALID pay_to '{pay_to}': must be a 0x + 40 hex address."
    res = await _x402_run(url, request_body, max_units, pay_to, execute=False)
    if isinstance(res, str):
        return res
    if not res.get("ok"):
        return f"x402 PREVIEW blocked at stage '{res.get('stage')}': {res.get('error')}. Nothing sent."
    gate = res.get("gate", {}) if isinstance(res.get("gate"), dict) else {}
    gate_line = "✓ allowed" if gate.get("allowed") else f"✗ would be DENIED ({gate.get('reason')})"
    domain = res.get("domain", {}) if isinstance(res.get("domain"), dict) else {}
    return (
        f"PREVIEW — NOTHING SENT (zero-spend).\n"
        f"Pay {res.get('amountUsd')} USDC ({res.get('amount')} base units) → {res.get('payTo')}\n"
        f"  seller   : {res.get('url')}\n"
        f"  asset    : {res.get('asset')} ({domain.get('name')} v{domain.get('version')}) on {res.get('network')}\n"
        f"  cap      : ${res.get('capUsd')}    ENS authority gate: {gate_line}\n"
        f"Show this to the user. Only after they EXPLICITLY confirm, call "
        f"x402_pay_execute with the identical args."
    )


@function_tool
async def x402_pay_execute(
    url: str = _X402_DEFAULT_URL,
    request_body: str = _X402_DEFAULT_BODY,
    max_usd: float = 0.01,
    pay_to: str | None = None,
) -> str:
    """Pay an x402-gated HTTP API — SIGNS AND SETTLES real USDC on Base. ONLY call
    after x402_pay_preview AND an explicit user confirmation. Never call it
    speculatively. The payer runs the PAYMENT-SPECIFIC ENS authority gate first:
    it signs the exact x402.payment (asset/recipient/amount) and evaluates it
    against the agent's ENS-published x402.payment capability. If the operator has
    revoked or capped payment authority at ENS, it is refused and nothing is
    signed. Otherwise the TEE server-wallet signs the EIP-3009 authorization and
    the facilitator settles it on Base (gasless).

    Args: same as x402_pay_preview.
    """
    max_units = int(round(max_usd * 1_000_000))
    if max_units <= 0:
        return f"REFUSED: invalid max_usd {max_usd}."
    if pay_to is not None and not _ADDR.match(pay_to):
        return f"REFUSED: invalid pay_to '{pay_to}'."
    res = await _x402_run(url, request_body, max_units, pay_to, execute=True)
    if isinstance(res, str):
        return res
    if not res.get("ok"):
        stage = res.get("stage")
        if stage == "gate":
            return (
                f"⛔ BLOCKED by the ENS authority gate — NOTHING was paid. {res.get('error')} "
                f"The operator revoked or capped this agent's x402.payment authority at ENS "
                f"(independently of ordinary transfers). This is NOT a key or balance issue. Do not retry."
            )
        return (
            f"x402 payment FAILED at stage '{stage}': {res.get('error')}. "
            f"The gate authorized it, but the payment itself did not complete — nothing further sent."
        )
    explorer = res.get("explorerUrl", "")
    return json.dumps({
        "paidUsd": res.get("amountUsd"),
        "payTo": res.get("payTo"),
        "agent": res.get("agent"),
        "tx": res.get("tx"),
        "explorerUrl": explorer,
        "onchainConfirmed": res.get("onchainConfirmed"),
        "results": res.get("purchased"),
        "_render": (
            f"The x402 payment settled — show the user a one-line confirmation with a clickable "
            f"link [View on Basescan]({explorer}), THEN present the purchased content in the "
            f"'results' field. For a search, render each result's title as a clickable markdown "
            f"link to its url, followed by its snippet. Do NOT say 'results will follow' — the "
            f"results ARE in the 'results' field; render them now."
        ),
    })


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
    refusal = await gate_or_refusal()
    if refusal:
        return refusal
    # mm swap execute has no --wait, but returns the tx hash; augment for the link.
    if quote_id:
        return _augment_tx(await _mm("swap", "execute", "--quote-id", quote_id, "--json"), from_chain)
    args = ["swap", "execute", "--from", from_token, "--to", to_token,
            "--amount", str(amount), "--from-chain", str(from_chain), "--json"]
    if to_chain is not None:
        args += ["--to-chain", str(to_chain)]
    if slippage is not None:
        args += ["--slippage", str(slippage)]
    return _augment_tx(await _mm(*args), from_chain)


@function_tool
async def raw_tx_preview(to: str, data: str = "0x", value: str = "0x0", chain_id: int = 1) -> str:
    """Preview a RAW EVM transaction WITHOUT sending — the escape hatch for
    arbitrary contract calls (e.g. an Aave supply built from the Aave API). ALWAYS
    call this before raw_tx_execute. It decodes the calldata so the user sees the
    human-readable intent of what they'd be approving.

    Args:
        to: contract/recipient 0x address.
        data: 0x-hex calldata ("0x" for a plain value transfer).
        value: 0x-hex wei (default "0x0").
        chain_id: EVM chain ID (1 = mainnet).
    """
    if not _ADDR.match(to):
        return f"INVALID 'to' address: {to}."
    decoded = await _mm("decode", "--payload", data, "--json") if data and data != "0x" else ""
    snippet = data if len(data) <= 80 else data[:80] + "…"
    return (
        f"PREVIEW — NOTHING SENT.\n"
        f"Raw tx → to={to}  value={value}  chainId={chain_id}\n"
        f"calldata: {snippet}\n"
        f"decoded intent: {decoded or '(no calldata — plain value transfer)'}\n"
        f"Show the user the decoded intent. Only after EXPLICIT confirmation call "
        f"raw_tx_execute with identical args."
    )


@function_tool
async def raw_tx_execute(to: str, data: str = "0x", value: str = "0x0", chain_id: int = 1) -> str:
    """Send a RAW EVM transaction — SIGNS AND BROADCASTS. ONLY after raw_tx_preview
    AND explicit user confirmation. Use for arbitrary contract calls when no
    dedicated tool exists (e.g. Aave supply/borrow calldata). Requires MM_PASSWORD.

    Args: same as raw_tx_preview. value is 0x-hex wei.
    """
    if not _ADDR.match(to):
        return f"REFUSED: invalid 'to' {to}."
    refusal = await gate_or_refusal()
    if refusal:
        return refusal
    payload = json.dumps({"to": to, "value": value, "data": data})
    result = await _mm("wallet", "send-transaction", "--chain-id", str(chain_id),
                       "--payload", payload, "--wait", "--json")
    return _augment_tx(result, chain_id)


# ── ENS record editing (TEE-signed) ─────────────────────────────────────────
# The agent owns its own ENS name (self-sovereign provisioning), so it can edit
# ALL its own records — avatar, description, url, socials, etc. — by building the
# resolver setText calldata and broadcasting it from its TEE wallet via `mm`. No
# browser wallet, no operator: the agent is the name's controller.

# Common ENSIP-5 text-record keys the agent can set on its own name.
_COMMON_RECORD_KEYS = (
    "avatar, description, url, email, name (display), location, "
    "com.twitter, com.github, com.discord, org.telegram"
)


async def _build_settext(name: str, records_json: str) -> dict | str:
    """Build resolver multicall calldata for the given text records. Returns
    {to, data, count} on success, or an error string."""
    proc = await asyncio.create_subprocess_exec(
        "bun", "scripts/build-settext.ts", "--name", name, "--records", records_json,
        cwd=str(_REPO_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        tail = err.decode().strip().splitlines()
        return f"BUILD FAILED: {tail[-1] if tail else 'could not build setText calldata'}"
    line = out.decode().strip().splitlines()[-1] if out else ""
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return f"BUILD FAILED: unparseable builder output: {line[:160]}"
    return obj


def _parse_records(records_json: str) -> dict | str:
    try:
        obj = json.loads(records_json)
    except (json.JSONDecodeError, ValueError):
        return f'INVALID records: must be a JSON object like {{"description":"hi","url":"https://x"}}. Got: {records_json[:120]}'
    if not isinstance(obj, dict) or not obj:
        return 'INVALID records: pass a non-empty JSON object of key→value, e.g. {"avatar":"https://…"}.'
    return obj


@function_tool
async def ens_set_records_preview(name: str, records: str) -> str:
    """Preview editing the agent's OWN ENS text records WITHOUT sending. ALWAYS call
    this before ens_set_records_execute. The agent owns its name, so it can set any
    text record on it (this is the agent self-managing its identity — NOT a fund move).

    Args:
        name: the agent's ENS name, e.g. "alice.steg.eth".
        records: JSON object of text records to set, e.g.
                 '{"description":"An ENS-native agent","url":"https://steg.eth"}'.
                 Common keys: """ + _COMMON_RECORD_KEYS + """.
    """
    parsed = _parse_records(records)
    if isinstance(parsed, str):
        return parsed
    built = await _build_settext(name, records)
    if isinstance(built, str):
        return built  # build error
    lines = "\n".join(f"  • {k} → {v}" for k, v in parsed.items())
    return (
        f"PREVIEW — NOTHING SENT.\n"
        f"Set {built['count']} text record(s) on {name} (resolver {built['to']}):\n"
        f"{lines}\n"
        f"Signed by the agent's own TEE wallet (it owns this name). After EXPLICIT "
        f"user confirmation, call ens_set_records_execute with identical args."
    )


@function_tool
async def ens_set_records_execute(name: str, records: str) -> str:
    """Set the agent's OWN ENS text records — SIGNS AND BROADCASTS via the agent's
    TEE wallet. ONLY after ens_set_records_preview AND explicit user confirmation.
    Works because the agent owns its name. NOT fund-moving; no authority gate.

    Args: same as ens_set_records_preview.
    """
    parsed = _parse_records(records)
    if isinstance(parsed, str):
        return parsed
    built = await _build_settext(name, records)
    if isinstance(built, str):
        return built  # build error
    payload = json.dumps({"to": built["to"], "value": "0x0", "data": built["data"]})
    result = await _mm("wallet", "send-transaction", "--chain-id", "1",
                       "--payload", payload, "--wait", "--json")
    return _augment_tx(result, 1)
