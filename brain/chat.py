"""
Terminal chat runner — the smallest proof of the UI→brain→mm loop.

Skips ChatKit/the frontend entirely: just runs the Agents SDK agent in a REPL so
you can talk to your wallet from the terminal. Multi-turn (keeps history).

Run (from brain/, with the venv active and .env populated):
    python chat.py

Needs OPENAI_API_KEY in .env (use a freshly-rotated key) and the CF Worker
running locally (bun run worker:dev in the repo root) for ENS/identity tools.
Wallet balance/address tools shell out to the local `mm` CLI.
"""

import asyncio

from dotenv import load_dotenv

load_dotenv()

from agents import Runner  # noqa: E402  (after load_dotenv)

from app.agent import ens_agent  # noqa: E402


async def main() -> None:
    print("talk to your agent wallet — agent.steg.eth (Ctrl-C to quit)\n")
    history: list = []
    while True:
        try:
            msg = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not msg:
            continue
        result = await Runner.run(ens_agent, history + [{"role": "user", "content": msg}])
        print(f"\nagent> {result.final_output}\n")
        history = result.to_input_list()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
