import json

from agents import RunContextWrapper, function_tool
from chatkit.agents import AgentContext, ClientToolCall

from .helpers import worker_post


def _maybe_set_client_tool(
    ctx: RunContextWrapper[AgentContext], response: str, operation_type: str = "transaction"
) -> None:
    """If the worker response contains a tx, set a client tool call for wallet signing."""
    try:
        data = json.loads(response)
    except (json.JSONDecodeError, TypeError):
        return

    if not isinstance(data, dict) or not data.get("ok"):
        return

    payload = data.get("data", {})

    # Single transaction
    if "tx" in payload:
        arguments: dict = {"tx": payload["tx"], "operation": payload.get("name", "ENS Transaction"), "operation_type": operation_type}
        if "wait_seconds" in payload:
            arguments["wait_seconds"] = payload["wait_seconds"]
        if "session_id" in payload:
            arguments["session_id"] = payload["session_id"]
        ctx.context.client_tool_call = ClientToolCall(
            name="sign_transaction",
            arguments=arguments,
        )
        return

    # Multi-transaction (subname)
    if "transactions" in payload:
        txs = payload["transactions"]
        if txs:
            # Send the first step for signing
            first = txs[0]
            ctx.context.client_tool_call = ClientToolCall(
                name="sign_transaction",
                arguments={"tx": first.get("tx", {}), "operation": first.get("step", "subname"), "steps": txs, "operation_type": operation_type},
            )


@function_tool
async def ens_build_commit_tx(
    ctx: RunContextWrapper[AgentContext],
    label: str,
    owner: str,
    duration: str = "1y",
    set_primary: bool = True,
    network: str = "sepolia",
) -> str:
    """Build a commit transaction for ENS name registration (step 1 of 2).

    The commit-reveal process prevents front-running. After the commit tx is signed,
    the user must wait ~60 seconds before the register step.

    Args:
        label: The label to register (without .eth), e.g. "coolname".
        owner: The Ethereum address that will own the name.
        duration: Registration duration like "1y", "2y". Defaults to "1y".
        set_primary: Whether to set this as the owner's primary name. Defaults to True.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    response = await worker_post("/commit", {
        "label": label,
        "owner": owner,
        "duration": duration,
        "set_primary": set_primary,
        "network": network,
    })
    _maybe_set_client_tool(ctx, response, operation_type="commit")
    return response


@function_tool
async def ens_build_register_tx(
    ctx: RunContextWrapper[AgentContext],
    session_id: str,
) -> str:
    """Build a register transaction (step 2 of 2) using the session from the commit step.

    Must be called after the commit tx is confirmed and the ~60s wait period has passed.

    Args:
        session_id: The session ID returned from the commit step.
    """
    response = await worker_post("/register", {"session_id": session_id})
    _maybe_set_client_tool(ctx, response, operation_type="register")
    return response


@function_tool
async def ens_build_set_records_tx(
    ctx: RunContextWrapper[AgentContext],
    name: str,
    text_records: str | None = None,
    address: str | None = None,
    resolver: str | None = None,
    network: str = "sepolia",
) -> str:
    """Build a transaction to set text records, address, or resolver for an ENS name.

    Args:
        name: The ENS name (e.g. "coolname.eth").
        text_records: JSON string of key-value text records, e.g. '{"email": "user@example.com", "com.twitter": "@user"}'.
        address: Ethereum address to set as the name's address record.
        resolver: Custom resolver address. Uses the default public resolver if omitted.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    body: dict = {"name": name, "network": network}
    if text_records is not None:
        body["text_records"] = json.loads(text_records)
    if address is not None:
        body["address"] = address
    if resolver is not None:
        body["resolver"] = resolver
    response = await worker_post("/records", body)
    _maybe_set_client_tool(ctx, response, operation_type="set_records")
    return response


@function_tool
async def ens_build_renew_tx(
    ctx: RunContextWrapper[AgentContext],
    label: str,
    duration: str = "1y",
    network: str = "sepolia",
) -> str:
    """Build a transaction to renew an ENS name registration.

    Args:
        label: The label to renew (without .eth), e.g. "coolname".
        duration: Renewal duration like "1y", "2y". Defaults to "1y".
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    response = await worker_post("/renew", {
        "label": label,
        "duration": duration,
        "network": network,
    })
    _maybe_set_client_tool(ctx, response, operation_type="renew")
    return response


@function_tool
async def ens_build_transfer_tx(
    ctx: RunContextWrapper[AgentContext],
    label: str,
    from_addr: str,
    to_addr: str,
    network: str = "sepolia",
) -> str:
    """Build a transaction to transfer ownership of an ENS name.

    Only works for unwrapped names. If the name is wrapped in the NameWrapper,
    the transfer will fail.

    Args:
        label: The label to transfer (without .eth), e.g. "coolname".
        from_addr: The current owner's Ethereum address.
        to_addr: The recipient's Ethereum address.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    response = await worker_post("/transfer", {
        "label": label,
        "from": from_addr,
        "to": to_addr,
        "network": network,
    })
    _maybe_set_client_tool(ctx, response, operation_type="transfer")
    return response


@function_tool
async def ens_build_primary_tx(
    ctx: RunContextWrapper[AgentContext],
    name: str,
    address: str,
    owner: str,
    network: str = "sepolia",
) -> str:
    """Build a transaction to set the primary ENS name for an address.

    Args:
        name: The ENS name to set as primary (e.g. "coolname.eth").
        address: The Ethereum address to set the primary name for.
        owner: The owner of the name (must match the transaction sender).
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    response = await worker_post("/primary", {
        "name": name,
        "address": address,
        "owner": owner,
        "network": network,
    })
    _maybe_set_client_tool(ctx, response, operation_type="set_primary")
    return response


@function_tool
async def ens_build_subname_tx(
    ctx: RunContextWrapper[AgentContext],
    label: str,
    parent: str,
    owner: str,
    address: str | None = None,
    reverse: bool = True,
    network: str = "sepolia",
) -> str:
    """Build transactions to create an ENS subname (e.g. "sub.parent.eth").

    This returns up to 3 sequential transactions: create subname, set address, set reverse record.

    Args:
        label: The subname label (e.g. "sub" for sub.parent.eth).
        parent: The parent name (e.g. "parent.eth").
        owner: The Ethereum address that will own the subname.
        address: Optional address record to set on the subname.
        reverse: Whether to set the subname as the reverse record. Defaults to True.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    body: dict = {
        "label": label,
        "parent": parent,
        "owner": owner,
        "reverse": reverse,
        "network": network,
    }
    if address is not None:
        body["address"] = address
    response = await worker_post("/subname", body)
    _maybe_set_client_tool(ctx, response, operation_type="create_subname")
    return response
