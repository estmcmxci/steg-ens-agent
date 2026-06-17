import uuid
from typing import Any

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata


class MemoryStore(Store[dict[str, Any]]):
    """In-memory store for MVP. Can be replaced with SQLite/Redis later."""

    def __init__(self) -> None:
        self._threads: dict[str, ThreadMetadata] = {}
        self._items: dict[str, list[ThreadItem]] = {}
        self._attachments: dict[str, Attachment] = {}

    def generate_thread_id(self, context: dict[str, Any]) -> str:
        return str(uuid.uuid4())

    def generate_item_id(
        self, item_type: str, thread: ThreadMetadata, context: dict[str, Any]
    ) -> str:
        return str(uuid.uuid4())

    async def load_thread(
        self, thread_id: str, context: dict[str, Any]
    ) -> ThreadMetadata:
        if thread_id not in self._threads:
            raise NotFoundError(f"Thread {thread_id} not found")
        return self._threads[thread_id]

    async def save_thread(
        self, thread: ThreadMetadata, context: dict[str, Any]
    ) -> None:
        self._threads[thread.id] = thread

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: dict[str, Any],
    ) -> Page[ThreadMetadata]:
        threads = list(self._threads.values())
        if order == "desc":
            threads.reverse()
        return Page(data=threads[:limit], has_more=len(threads) > limit, after=None)

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: dict[str, Any],
    ) -> Page[ThreadItem]:
        items = list(self._items.get(thread_id, []))
        if order == "desc":
            items.reverse()
        return Page(data=items[:limit], has_more=len(items) > limit, after=None)

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: dict[str, Any]
    ) -> None:
        self._items.setdefault(thread_id, []).append(item)

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: dict[str, Any]
    ) -> None:
        items = self._items.setdefault(thread_id, [])
        for i, existing in enumerate(items):
            if existing.id == item.id:
                items[i] = item
                return
        items.append(item)

    async def load_item(
        self, thread_id: str, item_id: str, context: dict[str, Any]
    ) -> ThreadItem:
        for item in self._items.get(thread_id, []):
            if item.id == item_id:
                return item
        raise NotFoundError(f"Item {item_id} not found in thread {thread_id}")

    async def delete_thread(
        self, thread_id: str, context: dict[str, Any]
    ) -> None:
        self._threads.pop(thread_id, None)
        self._items.pop(thread_id, None)

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: dict[str, Any]
    ) -> None:
        items = self._items.get(thread_id, [])
        self._items[thread_id] = [i for i in items if i.id != item_id]

    async def save_attachment(
        self, attachment: Attachment, context: dict[str, Any]
    ) -> None:
        self._attachments[attachment.id] = attachment

    async def load_attachment(
        self, attachment_id: str, context: dict[str, Any]
    ) -> Attachment:
        if attachment_id not in self._attachments:
            raise NotFoundError(f"Attachment {attachment_id} not found")
        return self._attachments[attachment_id]

    async def delete_attachment(
        self, attachment_id: str, context: dict[str, Any]
    ) -> None:
        self._attachments.pop(attachment_id, None)
