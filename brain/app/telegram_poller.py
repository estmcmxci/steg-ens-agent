"""
Long-polls Telegram's `getUpdates` and relays messages through
`handle_telegram_message` in-process — no separate container, no Pinata/
OpenClaw, no LLM-reasoned "should I forward this" step. Runs as a background
asyncio task started from `main.py`'s lifespan.

Access control: `TELEGRAM_ALLOWED_USER_IDS` (comma-separated numeric Telegram
user IDs). This is the ONLY access control on this bot's fund-moving power —
a message from anyone else gets a plain refusal and never reaches
`ens_agent`/`mm`. Confirmed, deliberate trade-off (see `gate.py`'s
`telegram_mode`): revoking the agent's ENS authority does NOT stop this bot;
only removing a user from this allow-list does.

Fails closed: if `TELEGRAM_ALLOWED_USER_IDS` isn't set, the poller refuses to
start rather than defaulting to open-to-anyone.
"""

import asyncio
import logging
import os

import httpx

from .telegram_core import handle_telegram_message

logger = logging.getLogger("telegram_poller")

_API_BASE = "https://api.telegram.org/bot{token}"
_MAX_MESSAGE_CHARS = 4000  # Telegram's hard cap is 4096; leave headroom.


def _allowed_user_ids() -> set[str]:
    raw = os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "")
    return {s.strip() for s in raw.split(",") if s.strip()}


async def _send_message(client: httpx.AsyncClient, api: str, chat_id: int, text: str) -> None:
    url = f"{api}/sendMessage"
    for i in range(0, len(text), _MAX_MESSAGE_CHARS):
        chunk = text[i : i + _MAX_MESSAGE_CHARS]
        resp = await client.post(url, json={"chat_id": chat_id, "text": chunk})
        if resp.status_code != 200:
            logger.error("sendMessage failed: %s %s", resp.status_code, resp.text[:300])


async def run_telegram_poller() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram poller disabled")
        return
    allowed = _allowed_user_ids()
    if not allowed:
        logger.warning(
            "TELEGRAM_ALLOWED_USER_IDS not set — poller disabled "
            "(fail-closed: this bot never defaults to open-to-anyone)"
        )
        return

    api = _API_BASE.format(token=token)
    offset = 0
    logger.info("Telegram poller started (allowed users: %s)", ", ".join(sorted(allowed)))

    async with httpx.AsyncClient(timeout=35.0) as client:
        while True:
            try:
                resp = await client.get(f"{api}/getUpdates", params={"offset": offset, "timeout": 30})
                resp.raise_for_status()
                updates = resp.json().get("result", [])
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("getUpdates failed, retrying in 5s")
                await asyncio.sleep(5)
                continue

            for update in updates:
                offset = update["update_id"] + 1
                message = update.get("message")
                if not message or "text" not in message:
                    continue

                chat_id = message["chat"]["id"]
                sender_id = str(message["from"]["id"])
                text = message["text"]

                if sender_id not in allowed:
                    logger.warning("refused message from non-allow-listed user %s", sender_id)
                    await _send_message(client, api, chat_id, "Not authorized.")
                    continue

                try:
                    reply = await handle_telegram_message(str(chat_id), text)
                except Exception:
                    logger.exception("handle_telegram_message failed")
                    reply = "Something went wrong on my end — try again in a moment."

                await _send_message(client, api, chat_id, reply)
