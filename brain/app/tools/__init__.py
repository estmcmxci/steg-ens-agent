"""
Tool registry.

v1 (talk-to-your-wallet): ENS read tools (call the keyless CF Worker) + the
agent-wallet read tools (shell out to `mm`). The browser-wallet write path from
ensemble-beta (writes.py: ens_build_*_tx, signed in the user's browser) is
DELIBERATELY NOT registered — this is an agent-driven flow, not a human-signs-
in-browser flow. Signing/action tools (mm-driven) get added later.
"""

from .reads import (
    ens_check,
    ens_profile,
    ens_resolve,
    ens_list,
    ens_verify,
    ens_namehash,
    ens_labelhash,
    ens_resolver,
    ens_deployments,
)
from .wallet import (
    wallet_balance,
    wallet_address,
    agent_identity,
    token_price,
    swap_quote,
    tx_history,
    wallet_show,
    wallet_list,
    chains_list,
    decode_calldata,
    token_search,
    token_list,
)
from .actions import (
    transfer_preview,
    transfer_execute,
    swap_execute,
)
from .perps import (
    perps_markets,
    perps_balance,
    perps_positions,
    perps_orders,
    perps_quote,
    perps_list_venues,
    perps_open,
    perps_close,
    perps_modify,
    perps_cancel,
    perps_deposit,
    perps_withdraw,
    perps_transfer,
)

# General ENS reads (public GET routes on the Worker).
read_tools = [
    ens_check,
    ens_profile,
    ens_resolve,
    ens_list,
    ens_verify,
    ens_namehash,
    ens_labelhash,
    ens_resolver,
    ens_deployments,
]

# Agent-wallet reads (mm CLI, local) — no money risk.
wallet_tools = [
    wallet_balance,
    wallet_address,
    agent_identity,
    token_price,
    swap_quote,
    tx_history,
    wallet_show,
    wallet_list,
    chains_list,
    decode_calldata,
    token_search,
    token_list,
]

# Actions — WRITES that move funds. Confirm-before-execute (preview/execute, or
# swap_quote -> swap_execute).
action_tools = [
    transfer_preview,
    transfer_execute,
    swap_execute,
]

# Perps (Hyperliquid). Reads + actions; actions preview via dry_run=True.
perps_tools = [
    perps_markets,
    perps_balance,
    perps_positions,
    perps_orders,
    perps_quote,
    perps_list_venues,
    perps_open,
    perps_close,
    perps_modify,
    perps_cancel,
    perps_deposit,
    perps_withdraw,
    perps_transfer,
]

all_tools = read_tools + wallet_tools + action_tools + perps_tools
