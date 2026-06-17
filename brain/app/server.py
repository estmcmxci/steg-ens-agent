"""ChatKitServer subclass for the ENS Agent."""

from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from agents import Runner
from chatkit.agents import AgentContext, ThreadItemConverter, stream_agent_response
from chatkit.server import ChatKitServer
from chatkit.types import (
    Action,
    HiddenContextItem,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
    WidgetItem,
)

from .agent import ens_agent
from .store import MemoryStore


class ENSChatKitServer(ChatKitServer[dict[str, Any]]):
    def __init__(self, store: MemoryStore) -> None:
        super().__init__(store=store)
        self._converter = ThreadItemConverter()

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: dict[str, Any],
    ) -> AsyncIterator[ThreadStreamEvent]:
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        # Load thread history and convert to agent input format
        items_page = await self.store.load_thread_items(
            thread.id, after=None, limit=100, order="asc", context=context,
        )
        input_items = await self._converter.to_agent_input(items_page.data)

        # Inject wallet address from request headers so the agent knows it
        wallet_address = context.get("wallet_address")
        chain_id = context.get("chain_id")
        if wallet_address:
            input_items.insert(0, {
                "role": "developer",
                "content": f"The user's wallet is connected: {wallet_address} on chain ID {chain_id or 'unknown'}. Use this address as the 'owner' or 'from_addr' parameter when the user doesn't specify one.",
            })

        result = Runner.run_streamed(ens_agent, input=input_items, context=agent_context)

        # stream_agent_response handles ClientToolCall emission automatically:
        # when a write tool sets ctx.context.client_tool_call, the SDK emits
        # a ClientToolCallItem at the end of the stream, which ChatKit renders
        # and the frontend handles via onClientTool.
        async for event in stream_agent_response(agent_context, result):
            yield event

    async def action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: dict[str, Any],
    ) -> AsyncIterator[ThreadStreamEvent]:
        now = datetime.now(timezone.utc)

        if action.type == "tx_confirmed":
            tx_hash = action.payload.get("tx_hash", "unknown")
            hidden = HiddenContextItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=now,
                content=f"Transaction confirmed with hash: {tx_hash}",
            )
            await self.store.add_thread_item(thread.id, hidden, context)
            async for event in self.respond(thread, None, context):
                yield event

        elif action.type == "countdown_complete":
            hidden = HiddenContextItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=now,
                content="The commit-reveal wait period is complete. The user is ready to proceed with registration.",
            )
            await self.store.add_thread_item(thread.id, hidden, context)
            async for event in self.respond(thread, None, context):
                yield event

        elif action.type == "tx_rejected":
            reason = action.payload.get("reason", "User rejected the transaction")
            hidden = HiddenContextItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=now,
                content=f"Transaction rejected by user: {reason}",
            )
            await self.store.add_thread_item(thread.id, hidden, context)
            async for event in self.respond(thread, None, context):
                yield event

        elif action.type == "wallet_connected":
            address = action.payload.get("address")
            chain_id = action.payload.get("chainId")
            hidden = HiddenContextItem(
                id=self.store.generate_item_id("message", thread, context),
                thread_id=thread.id,
                created_at=now,
                content=f"User's wallet is connected: {address} on chain {chain_id}",
            )
            await self.store.add_thread_item(thread.id, hidden, context)
            # Context injection only — no re-run needed
