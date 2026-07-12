import asyncio
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from chatkit.server import NonStreamingResult, StreamingResult
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .agent_routes import router as agent_router
from .provision_routes import router as provision_router
from .server import ENSChatKitServer
from .store import MemoryStore
from .telegram_poller import run_telegram_poller
from .telegram_routes import router as telegram_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Background task, not a request handler — logs a warning and no-ops if
    # TELEGRAM_BOT_TOKEN/TELEGRAM_ALLOWED_USER_IDS aren't set, so this is safe
    # to always start.
    poller_task = asyncio.create_task(run_telegram_poller())
    yield
    poller_task.cancel()


app = FastAPI(title="ENS Agent Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = MemoryStore()
server = ENSChatKitServer(store=store)

# Read-only `mm` state for the cockpit portfolio card (public, no MM_PASSWORD).
app.include_router(agent_router)

# Milestone-7 onboarding: SSE choreography that provisions a fresh agent (option B).
app.include_router(provision_router)

# Telegram bridge (bearer-token-gated; see telegram_routes.py for the gate-bypass
# trade-off this endpoint deliberately makes).
app.include_router(telegram_router)


@app.get("/")
async def health() -> dict[str, Any]:
    return {"status": "ok", "agent": "ENS Assistant"}


@app.post("/chatkit")
async def chatkit_endpoint(request: Request) -> Response:
    body = await request.body()
    # Pass wallet info from frontend headers into request context
    context: dict[str, Any] = {}
    wallet_address = request.headers.get("X-Wallet-Address")
    chain_id = request.headers.get("X-Chain-Id")
    if wallet_address:
        context["wallet_address"] = wallet_address
    if chain_id:
        context["chain_id"] = chain_id
    result = await server.process(body, context=context)
    if isinstance(result, StreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json, media_type="application/json")
