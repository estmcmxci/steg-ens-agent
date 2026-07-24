"""
Core Telegram message-handling logic — shared by the manual-test HTTP endpoint
(`telegram_routes.py`) and the live long-polling bot (`telegram_poller.py`).

Reuses `ens_agent` UNCHANGED (full tool parity was a deliberate choice — see
`telegram_routes.py`'s original docstring for the reasoning). Sets
`telegram_mode` for the duration of each call, which makes `gate_or_refusal()`
a no-op and makes `_x402_run()` pass `--no-gate` through — confirmed,
deliberate trade-off: Telegram's own access control (an allow-list checked by
the poller before this function is ever called) is the trust boundary here,
not the on-chain ENS authority gate.

Threads are keyed by `chat_id` (one stable ChatKit thread per Telegram chat),
in their own MemoryStore instance — separate from the web UI's store in
main.py, so Telegram history and browser-chat history never mix.
"""

from datetime import datetime, timezone
from typing import Any

from agents import Runner
from chatkit.agents import AgentContext, ThreadItemConverter
from chatkit.store import NotFoundError
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    InferenceOptions,
    ThreadMetadata,
    UserMessageItem,
    UserMessageTextContent,
)

from .agent import ens_agent
from .gate import telegram_mode
from .history import load_recent_items
from .store import MemoryStore

_converter = ThreadItemConverter()
_store = MemoryStore()
_CONTEXT: dict[str, Any] = {}


async def handle_telegram_message(chat_id: str, text: str) -> str:
    """Run one inbound Telegram message through ens_agent and return the reply
    text. `chat_id` should be the raw Telegram chat id (as a string) — this
    function applies its own `telegram-` thread-id prefix."""
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

    recent_items = await load_recent_items(_store, thread.id, _CONTEXT)
    input_items = await _converter.to_agent_input(recent_items)

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

    return reply_text


async def reset_telegram_thread(chat_id: str) -> None:
    """Drop a chat's history so the next message starts a clean thread.

    An escape hatch that doesn't need a redeploy: when a thread goes bad — a
    pending confirmation the agent keeps re-asking about, a context it won't let
    go of — restarting the service was previously the only way out, and that
    wipes every chat's history, not just the stuck one.
    """
    await _store.delete_thread(f"telegram-{chat_id}", _CONTEXT)
