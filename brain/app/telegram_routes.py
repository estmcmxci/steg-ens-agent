"""
Manual-test HTTP endpoint — `POST /telegram/message`.

NOT used by the live bot — `telegram_poller.py` calls `handle_telegram_message`
directly, in-process. Kept around because it's genuinely useful for
curl-based debugging without needing a real Telegram round trip.
"""

import os

from fastapi import APIRouter, HTTPException, Request

from .telegram_core import handle_telegram_message

router = APIRouter()


def _require_bridge_token(request: Request) -> None:
    expected = os.environ.get("TELEGRAM_BRIDGE_TOKEN")
    if not expected:
        raise HTTPException(status_code=500, detail="TELEGRAM_BRIDGE_TOKEN not configured")
    if request.headers.get("X-Bridge-Token") != expected:
        raise HTTPException(status_code=401, detail="invalid bridge token")


@router.post("/telegram/message")
async def telegram_message(request: Request) -> dict[str, str]:
    _require_bridge_token(request)

    body = await request.json()
    chat_id = body.get("chat_id")
    text = body.get("text")
    if not chat_id or not isinstance(chat_id, str):
        raise HTTPException(status_code=400, detail="missing or invalid chat_id")
    if not text or not isinstance(text, str):
        raise HTTPException(status_code=400, detail="missing or invalid text")

    reply = await handle_telegram_message(chat_id, text)
    return {"reply": reply}
