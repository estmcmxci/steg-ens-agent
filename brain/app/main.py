from typing import Any

from dotenv import load_dotenv

load_dotenv()

from chatkit.server import NonStreamingResult, StreamingResult
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .server import ENSChatKitServer
from .store import MemoryStore

app = FastAPI(title="ENS Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = MemoryStore()
server = ENSChatKitServer(store=store)


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
