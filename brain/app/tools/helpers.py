import os

import httpx

# 127.0.0.1, not localhost — avoids IPv6 (::1) vs wrangler's IPv4 bind locally.
WORKER_URL = os.environ.get("WORKER_URL", "http://127.0.0.1:8787")
WORKER_API_KEY = os.environ.get("WORKER_API_KEY", "")


async def worker_get(path: str, params: dict | None = None) -> str:
    """GET request to the ENS Worker API. Returns response text."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{WORKER_URL}{path}",
            params={k: v for k, v in (params or {}).items() if v is not None},
            timeout=30,
        )
        return resp.text


async def worker_post(path: str, body: dict) -> str:
    """POST request to the ENS Worker API with auth header. Returns response text."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{WORKER_URL}{path}",
            json=body,
            headers={"Authorization": f"Bearer {WORKER_API_KEY}"},
            timeout=30,
        )
        return resp.text
