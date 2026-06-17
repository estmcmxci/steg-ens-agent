from agents import function_tool

from .helpers import worker_get


@function_tool
async def ens_check(label: str, duration: str = "1y", network: str = "sepolia") -> str:
    """Check if an ENS name is available for registration and get the price.

    Args:
        label: The label to check (without .eth suffix), e.g. "coolname".
        duration: Registration duration like "1y", "2y", "6m". Defaults to "1y".
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    return await worker_get("/check", {"label": label, "duration": duration, "network": network})


@function_tool
async def ens_profile(input: str, network: str = "sepolia") -> str:
    """Get the full profile for an ENS name or address, including text records, avatar, owner, and expiry.

    Args:
        input: An ENS name (e.g. "vitalik.eth") or Ethereum address.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    return await worker_get("/profile", {"input": input, "network": network})


@function_tool
async def ens_resolve(
    input: str, txt: str = "", contenthash: bool = False, network: str = "sepolia"
) -> str:
    """Resolve an ENS name to an address, or look up a specific text record or contenthash.

    Use this for targeted lookups (single record, contenthash). Use ens_profile for full overviews.

    Args:
        input: An ENS name or Ethereum address.
        txt: Optional text record key to resolve (e.g. "email", "com.twitter").
        contenthash: If true, resolve the contenthash for this name.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    params: dict = {"input": input, "network": network}
    if txt:
        params["txt"] = txt
    if contenthash:
        params["contenthash"] = "true"
    return await worker_get("/resolve", params)


@function_tool
async def ens_list(address: str, network: str = "sepolia") -> str:
    """List all ENS names owned by an Ethereum address.

    Args:
        address: The Ethereum address to look up.
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    return await worker_get("/list", {"address": address, "network": network})


@function_tool
async def ens_verify(name: str, records: str = "", network: str = "sepolia") -> str:
    """Verify that on-chain records for an ENS name match expected values.

    Args:
        name: The ENS name to verify (e.g. "coolname.eth").
        records: Comma-separated list of record keys to check (e.g. "address,email").
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    params: dict = {"name": name, "network": network}
    if records:
        params["records"] = records
    return await worker_get("/verify", params)


@function_tool
async def ens_namehash(name: str) -> str:
    """Compute the namehash for an ENS name.

    Args:
        name: The ENS name (e.g. "vitalik.eth").
    """
    return await worker_get("/namehash", {"name": name})


@function_tool
async def ens_labelhash(label: str) -> str:
    """Compute the labelhash for an ENS label.

    Args:
        label: The label (e.g. "vitalik", without .eth).
    """
    return await worker_get("/labelhash", {"label": label})


@function_tool
async def ens_resolver(name: str, network: str = "sepolia") -> str:
    """Get the resolver contract address for an ENS name.

    Args:
        name: The ENS name (e.g. "vitalik.eth").
        network: "mainnet" or "sepolia". Defaults to "sepolia".
    """
    return await worker_get("/resolver", {"name": name, "network": network})


@function_tool
async def ens_deployments() -> str:
    """Get all ENS contract deployment addresses for mainnet and sepolia."""
    return await worker_get("/deployments")
