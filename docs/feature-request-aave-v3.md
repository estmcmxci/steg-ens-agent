# Feature request: native Aave V3 commands in the Agentic CLI

**To:** MetaMask Agent Wallet / `@metamask/agentic-cli` team
**From:** Steg (agent.steg.eth) — building an agent brain that wraps `mm` as tools
**CLI version:** 2.0.0

## Summary

`mm` exposes **perps (Hyperliquid)** and **predict (Polymarket)** as first-class
command groups, but **lending (Aave V3) is not a command** — it exists only as
*workflow docs* (`skills/.../workflows/aave-*.md`). `mm aave` returns
`Command aave not found`. We're requesting native `mm aave` commands that mirror
the existing perps/predict surface.

## Current state (what we found)

The Aave workflows are recipes that hand-compose primitives:

1. Resolve chain + pool address (hardcoded table) and asset address
   (`mm token list search`).
2. Check balance (`mm wallet balance`).
3. **Call the external Aave API (GraphQL) to build the supply/borrow calldata.**
4. Handle ERC-20 approval if needed.
5. Execute via `mm wallet send-transaction`.

This works, but it can't be wrapped as a clean agent tool the way perps/predict
can. An integrator must reimplement the Aave API calls + calldata construction +
approval handling themselves — exactly the boilerplate `mm` already abstracts for
swaps and perps.

## Why it matters

We've built a conversational agent (OpenAI Agents SDK + ChatKit) whose tools are
thin wrappers over `mm` commands — `perps_open`, `predict_place`, `swap_execute`,
etc. — each using mm's native `--dry-run`/`--yes`/`--password` and JSON output.
Lending is a core DeFi primitive, but it's the one domain we **can't** expose as
a first-class, uniform tool, because there's no command to wrap. A native surface
would let every agent/integrator get Aave for free, with the same safety
affordances (dry-run preview, confirmation, BYOK unlock) as the rest of `mm`.

## Requested surface (mirroring perps/predict)

```
mm aave markets   [--chain <id>]                          # reserves, APYs, LTV
mm aave positions [--chain <id>]                          # supplied/borrowed, health factor
mm aave supply    --asset <sym|addr> --amount <x> --chain <id> [--dry-run] [--yes] [--password]
mm aave withdraw  --asset <sym|addr> --amount <x> --chain <id> [--dry-run] [--yes] [--password]
mm aave borrow    --asset <sym|addr> --amount <x> --chain <id> [--rate <variable|stable>] [--dry-run] [--yes] [--password]
mm aave repay     --asset <sym|addr> --amount <x> --chain <id> [--dry-run] [--yes] [--password]
mm aave collateral --asset <sym|addr> --enabled <true|false> --chain <id> [--dry-run] [--yes] [--password]
```

Design notes we'd value:
- **`--dry-run` preview** returning the resulting health factor / liquidation
  threshold (as perps quotes return liquidation price) — critical for safe agents.
- **Automatic approval handling** inside `supply`/`repay` (the workflow's step 4).
- Native asset/pool resolution (so integrators don't hardcode the pool table).
- JSON output consistent with the other command groups.

## Ask

1. Is native Aave on the roadmap? If so, when / what's the intended surface?
2. If we wanted to **fast-track** it, can you confirm the command shape so we can
   pre-build the agent-tool wrappers against it (and validate once it ships)?
3. Until then: is calling the Aave API + `send-transaction` the intended path, or
   is there a closer-to-native helper we missed?

Happy to share our agent-tool wrapper layer (the `mm`→tool pattern) if useful as
a reference for what integrators want from the command surface.
