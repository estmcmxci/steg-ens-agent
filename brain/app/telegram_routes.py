"""
Telegram bridge endpoint — `POST /telegram/message`.

Not the ChatKit wire protocol (that's shaped for @openai/chatkit-react's SSE
client; replicating it for a Telegram skill would be needless protocol work).
This is a small, purpose-built request/response endpoint: `{chat_id, text}` in,
`{reply}` out.

Reuses `ens_agent` UNCHANGED — full tool parity was a deliberate choice, so
Telegram gets exactly the same `mm`-backed capability set (ENS reads, wallet
reads, transfers/swaps/x402/perps/predict, ENS record self-editing) as the web
UI. There is no second, filtered Agent to keep in sync with `agent.py`.

The only behavioral difference for a Telegram-triggered run is the gate:
`telegram_mode` (gate.py) is set for the duration of this request, which makes
`gate_or_refusal()` a no-op and makes `_x402_run()` pass `--no-gate` through to
the TS payer script. Confirmed, deliberate trade-off (see gate.py) — Telegram's
trust boundary is the bot itself (pairing + allow-list at the Pinata/OpenClaw
layer), NOT the ENS-published authority record. Revoking the agent's ENS
authority will still block `/chatkit`; it will NOT block this endpoint.

Threads are keyed by `chat_id` (one stable ChatKit thread per Telegram chat) in
their own MemoryStore instance — separate from the web UI's store in main.py,
so Telegram history and browser-chat history never mix.
"""

import os
from datetime import datetime, timezone
from typing import Any

from agents import Runner
from chatkit.agents import AgentContext, ThreadItemConverter
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    InferenceOptions,
    ThreadMetadata,
    UserMessageItem,
    UserMessageTextContent,
)
from chatkit.store import NotFoundError
from fastapi import APIRouter, HTTPException, Request

from .agent import ens_agent
from .gate import telegram_mode
from .store import MemoryStore

router = APIRouter()

_converter = ThreadItemConverter()
_store = MemoryStore()
_CONTEXT: dict[str, Any] = {}


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

    thread_id = f"telegram-{chat_id}"
    try:
        thread = await _store.load_thread(thread_id, _CONTEXT)
    except NotFoundError:
        thread = ThreadMetadata(id=thread_id, created_at=datetime.now(timezone.utc))
        await _store.save_thread(thread, _CONTEXT)

    user_item = UserMessageItem(
        id=_store.generate_item_id("message", thread, _CONTEXT),
        thread_id=thread.id,
        created_at=datetime.now(timezone.utc),
        content=[UserMessageTextContent(text=text)],
        inference_options=InferenceOptions(),
    )
    await _store.add_thread_item(thread.id, user_item, _CONTEXT)

    items_page = await _store.load_thread_items(
        thread.id, after=None, limit=100, order="asc", context=_CONTEXT,
    )
    input_items = await _converter.to_agent_input(items_page.data)

    agent_context = AgentContext(thread=thread, store=_store, request_context=_CONTEXT)

    token = telegram_mode.set(True)
    try:
        result = await Runner.run(ens_agent, input=input_items, context=agent_context)
    finally:
        telegram_mode.reset(token)

    reply_text = str(result.final_output)

    assistant_item = AssistantMessageItem(
        id=_store.generate_item_id("message", thread, _CONTEXT),
        thread_id=thread.id,
        created_at=datetime.now(timezone.utc),
        content=[AssistantMessageContent(text=reply_text, annotations=[])],
    )
    await _store.add_thread_item(thread.id, assistant_item, _CONTEXT)

    return {"reply": reply_text}
