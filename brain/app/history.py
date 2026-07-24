"""
Rolling history window, shared by the web surface (`server.py`) and the Telegram
surface (`telegram_core.py`).

Both surfaces used to ask the store for `after=None, limit=100, order="asc"`.
`MemoryStore.load_thread_items` slices `items[:limit]`, so that request returns
the OLDEST 100 items. Under 100 items in a thread it looks correct; past 100 it
freezes: every new message is appended to the store but falls outside the
window, so the model is re-run on the same prefix forever and keeps answering
the last message it can see. Observed live on 2026-07-24 — the Telegram bot
replied to every message as though it were a stale, half-typed one.

Ask for the NEWEST N instead, and start the window on a user turn.
"""

from typing import Any

from chatkit.store import Store
from chatkit.types import ThreadItem, UserMessageItem

# Turn count is roughly half this: each turn stores a user item and an
# assistant item (tool/workflow items push it higher).
HISTORY_LIMIT = 100


def _trim_to_user_turn(items: list[ThreadItem]) -> list[ThreadItem]:
    """Drop leading items until the window opens on a user message.

    A window cut at an arbitrary index can open midway through a turn — on a
    tool result whose call was cut off, say — which the model API rejects as an
    orphan. Opening on a user message is always well-formed.
    """
    for i, item in enumerate(items):
        if isinstance(item, UserMessageItem):
            return items[i:]
    return items


async def load_recent_items(
    store: Store[Any],
    thread_id: str,
    context: Any,
    limit: int = HISTORY_LIMIT,
) -> list[ThreadItem]:
    """Return the most recent items of a thread, oldest-first."""
    page = await store.load_thread_items(
        thread_id, after=None, limit=limit, order="desc", context=context,
    )
    return _trim_to_user_turn(list(reversed(page.data)))
