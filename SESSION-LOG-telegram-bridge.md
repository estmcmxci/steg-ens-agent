# Session log — Telegram wallet bridge (2026-07-12)

Full arc of the session that shipped Telegram parity for steg's wallet-action
agent. Written up because a lot of the value was in decisions and dead ends,
not just the final diff.

## Where this started

The session began in `synthesis` (a different, unrelated project — the Trust
Resolution Layer / ENS identity-verification work) redeploying its reference
agent, `emilemarcelagustin.eth`, to a fresh Pinata Agents container after the
original one turned out to be fully deleted, not just down. That work
surfaced a real bug (Pinata's path-route prefix-stripping docs don't match
observed behavior — fixed by mounting routes at both `/` and `/app`) and a
real secrets-exposure incident (`pinata agents config get` dumps the
container's fully-decrypted secrets in plaintext, undocumented — leaked an
OpenAI key, a Pimlico key, and a session-key password into the conversation
transcript; accepted as low-stakes since that deployment isn't production).

While poking at Pinata's native Telegram channel feature on that same agent,
the user asked to instead read `~/Desktop/telegram-wallet-bridge/
PLAN-telegram-pinata-bridge.md` and rebuild the agent per that plan — a
completely different, much higher-stakes system: Telegram parity for
`steg-ens-agent` ("Brain", `/Users/oakgroup/metamask`), which drives a real
TEE wallet (`mm` CLI) with 61 tools — transfers, swaps, x402 payments, perps,
predictions, ENS record self-editing.

## The scoping conversation (worth remembering — these were real corrections)

1. **Tool scope**: the plan filtered Telegram down to 50 tools (excluding 11
   ENS tools) via a second, filtered `Agent` object. User decided Telegram
   should get full parity instead — all 61 tools, same as the web UI.
2. **Gate bypass**: the plan's most consequential decision — Telegram-
   triggered actions run with NO on-chain ENS-authority gate check at all
   (`telegram_mode` short-circuits `gate_or_refusal()`). Re-confirmed
   explicitly this session, not just inherited from the plan doc. Revoking
   the agent's ENS authority will NOT stop the Telegram bot — only removing a
   user from `TELEGRAM_ALLOWED_USER_IDS` does.
3. **A real misunderstanding, caught before it became a mistake**: I initially
   proposed reusing `ens_agent` directly for Telegram (a legitimate
   simplification once tool-filtering was dropped) but explained it badly —
   the user pushed back, worried this meant NOT wiring up the actual `mm`
   TEE-wallet capability. Turned out to be a communication gap, not a design
   flaw: `ens_agent` already uses `all_tools` (confirmed by reading
   `agent.py:112` and `tools/__init__.py` directly, not trusting the plan
   doc's prose) — the `mm`-calling capability lives in the tool functions,
   not in which `Agent` object runs them.
4. **A real scope mismatch, caught before any code was written**: the user
   said "get mm working on my existing emilemarcelagustin.eth Telegram bot" —
   which would have meant giving a deliberately execution-less, publicly-
   documented identity-verification demo agent real fund-moving power,
   contradicting its own published on-chain policy. Flagged directly; user
   confirmed they wanted a genuinely separate bot instead, matching the
   plan's original intent.
5. **Fork, don't edit in place** — per the user's own recorded 2026-07-09
   instruction inside the plan doc. `/Users/oakgroup/metamask` has no
   uncommitted changes from this work; everything happened in
   `~/metamask-telegram`, a plain `git clone` sibling.
6. **The architecture actually shipped is NOT what the plan specified** — and
   that's the right outcome, not a deviation to apologize for. See below.

## The pivot: Pinata/OpenClaw relay → in-process polling

Built the plan's design first: a new, separate Pinata agent running OpenClaw
as a "pure delegate" (`~/webdev/agency-telegram-bridge/deploy/telegram-bridge/`
— manifest.json, `SOUL.md`, `skills/ask-steg/SKILL.md`). Two things came out
of actually building it:

- **Confirmed a real limitation the plan had flagged as an open question**:
  fetched OpenClaw's actual docs — skills are compiled into the system prompt
  and reasoned about by the LLM. There is no message-interception hook. "Pure
  delegate" can only ever be best-effort prompt engineering, not a guarantee.
- **The user flagged the actual dealbreaker**: a second Pinata agent is a
  second billable container, on top of the one already running for
  `emilemarcelagustin.eth`.

Pivoted to a strictly better option once that constraint surfaced: Brain
already runs continuously on Railway (`steg-brain-production`). Added the
Telegram integration as an in-process long-polling loop inside the SAME
FastAPI app — zero new infrastructure, and a deterministic code path instead
of an LLM-reasoned "should I forward this" step. The Pinata scaffold was left
in place (harmless, local-only, nothing deployed) as a record of the road not
taken and why.

## What actually shipped

All in `~/metamask-telegram` (fork of `/Users/oakgroup/metamask`), deployed
to the existing `steg-brain-production` Railway service:

| File | What |
|---|---|
| `brain/app/gate.py` | `telegram_mode: ContextVar[bool]` — `gate_or_refusal()` short-circuits to allowed when set. Per-asyncio-task isolation, can't leak into a concurrent `/chatkit` request. |
| `brain/app/tools/actions.py` | `_x402_run()` passes the script's pre-existing `--no-gate` flag when `telegram_mode` is set (the flag already existed in `scripts/x402-brain-pay.ts`; the Python caller just never used it before). |
| `brain/app/telegram_core.py` | `handle_telegram_message(chat_id, text)` — the actual logic. Reuses `ens_agent` UNCHANGED (full tool parity — no second, filtered Agent object to keep in sync). One `MemoryStore` per Telegram deployment, separate from the web UI's, threads keyed by `chat_id`. |
| `brain/app/telegram_poller.py` | Long-polls Telegram's `getUpdates` in-process. Checks `TELEGRAM_ALLOWED_USER_IDS` (fails CLOSED if unset — never defaults to open). Calls `handle_telegram_message` directly, no HTTP hop. Replies via `sendMessage`, chunked at 4000 chars. |
| `brain/app/telegram_routes.py` | Thin `POST /telegram/message` wrapper around `telegram_core`, kept only for curl-based manual testing (bridge-token gated). Not used by the live bot. |
| `brain/app/main.py` | FastAPI `lifespan` starts the poller as a background task; added `logging.basicConfig()` (see below — this was missing and silently ate the poller's own startup confirmation). |

Env vars on `steg-brain-production` (Railway): `TELEGRAM_BOT_TOKEN` (fresh
bot, `@stegdotbot`, separate from `emilemarcelagustin.eth`'s),
`TELEGRAM_ALLOWED_USER_IDS` (single owner ID, `2132218140`).
`TELEGRAM_BRIDGE_TOKEN` set locally for manual testing but not required in
production (the poller doesn't use it).

## A real bug caught during deploy, not before

After setting both env vars, Railway logs showed no confirmation the poller
had started — turned out `logger.info()`/`logger.warning()` calls were being
silently dropped: Python's root logger defaults to WARNING with no handler,
so nothing below that level ever printed. Fixed with one
`logging.basicConfig()` call in `main.py`, redeployed, and then actually saw
`Telegram poller started (allowed users: 2132218140)` in the logs. Worth
remembering: absence of a log line does NOT mean absence of a problem if
logging was never configured to begin with.

## Verification

- Local: real `wallet_balance` data round-tripped through the endpoint before
  any deploy; thread continuity confirmed across turns; a zero-spend x402
  preview ran clean under the gate bypass.
- Production: `getMe`/`getWebhookInfo` confirmed the bot identity and that no
  webhook was fighting the poller for updates.
- Real end-to-end, via actual Telegram messages to `@stegdotbot`: wallet
  balance/address/activity reads, a genuinely EXECUTED $1 USDC→ETH swap
  (KyberSwap, Etherscan-linked), an ENS profile lookup (`carlos.steg.eth`),
  live ETH price, and a real x402 payment (0.007 USDC on Base) for a web
  search — all through the Telegram bot, thread continuity holding across the
  whole conversation.

## Known limitations, not fixed this session

- `MemoryStore` is in-memory — a Railway restart drops Telegram thread
  history. Pre-existing limitation the web UI already has; not a new
  regression.
- The gate bypass means Telegram is genuinely a bigger blast radius than the
  web UI: no on-chain revocation safety net on this path, ever. Access
  control is entirely `TELEGRAM_ALLOWED_USER_IDS`.
- `~/webdev/agency-telegram-bridge/` (the superseded Pinata/OpenClaw scaffold)
  still exists, local-only, nothing deployed from it. Fine to ignore or
  delete; kept as a record of why the simpler path was chosen.
- Secrets-hygiene note for future sessions: a Telegram bot token got pasted
  into the conversation transcript this session (via a failed shell command
  echoing back), same category as the earlier Pinata leak. Low stakes (fresh,
  single-purpose token) but worth remembering the pattern — prefer having the
  user run secret-setting commands themselves in their own terminal.

## Part 2 — landing the code and contributing the pattern back

Everything above was written mid-session, right after the bridge was verified
working. The rest of the day was about making the work durable and turning
the lesson into a contribution — with two more real corrections along the way.

### Both local repos were disconnected from their real remotes

`~/metamask-telegram`'s `origin` was still the local path
`/Users/oakgroup/metamask` (an artifact of `git clone`ing a local directory) —
not GitHub. The user caught this before letting me push anywhere. Fixed by
pointing `origin` at the real repo, `https://github.com/estmcmxci/
steg-ens-agent.git`, and branching `feat/telegram-bridge` off the in-flight
`feat/x402-mm-payer` (per the user's explicit choice: land it as-is on top of
that branch rather than rebasing onto `main` for a cleaner standalone diff).
Pushed, and the user separately opened + merged it as
[steg-ens-agent#2](https://github.com/estmcmxci/steg-ens-agent/pull/2) — now
on `main` at commit `f1c7915ba3cb9e506b017e5a87446bbd37b202f5`. This is the
canonical reference implementation now, not just a branch.

### Contributing the pattern to MetaMask/agent-skills

The user wanted the pattern (not the steg-specific deployment) proposed as a
new skill in `MetaMask/agent-skills` — the real, existing repo of skills for
`@metamask/agentic-cli` (the same `mm` CLI this whole bridge is built around).
Used `~/metamask-agent-skills` (already a proper fork on disk: `origin` =
`estmcmxci/metamask-agent-skills`, `upstream` = `MetaMask/agent-skills`) —
found by searching the filesystem after nearly cloning a fresh, disconnected
copy by mistake.

Wrote `skills/metamask-agent-telegram-bridge/` (`SKILL.md`, `workflows/
telegram-bridge.md`, `scripts/telegram_poller.py`) as a generic pattern —
deliberately stripped of steg/Pinata/OpenClaw specifics, since none of that
context is needed to use the pattern and Pinata/OpenClaw was a road not taken,
not part of the lesson worth teaching. `call_agent()` in the skeleton is left
as an explicit `NotImplementedError` — integration with a specific project's
agent runner is inherently project-specific and can't be pre-solved generically.

Sequence: opened [issue #29](https://github.com/MetaMask/agent-skills/issues/29)
pitching the skill (modeled on the user's own prior issue #23, an unrelated
x402-MCP-transport proposal, as a template for tone/structure) → pushed
`feat/telegram-bridge-skill` to `origin` → user opened
[PR #30](https://github.com/MetaMask/agent-skills/pull/30) → once
steg-ens-agent#2 was merged, commented on #29 linking the now-real, merged
reference implementation (specific files, pinned to the merge commit) so
reviewers have working code to check, not just narrative claims.

### Two mistakes caught this half, both worth remembering

1. **Missed an explicit signal.** The user wrote "PR open. so you're saying
   any agent that reads that skill could build this e2e?" — the first two
   words were them telling me PR #30 already existed. I answered the second
   half of the message and never acknowledged the first, so I kept saying
   "PR not yet opened" for a while after it was. Read short factual
   statements at the start of a message as literal state updates, not just
   conversational framing, even when a longer question follows immediately.
2. **Almost posted an inaccurate comment, twice, on the wrong issue.** Asked
   to do for issue #23 (x402 MCP transport, unrelated proposal, also the
   user's) what we'd just done for #29 — link a reference implementation.
   First mistake: assumed `steg-ens-agent#1` (merged, "Feat/x402 mm payer")
   was that reference, without checking its actual commit list first — it's
   the HTTP-transport signer foundation, not the MCP transport itself. Caught
   by the user asking "wait, what do you mean?" before anything was posted.
   Investigated further and found the REAL MCP-transport code already exists
   as two open PRs in `MetaMask/agent-skills` itself —
   [#25](https://github.com/MetaMask/agent-skills/pull/25) (thorough,
   mainnet-verified against a real Cloudflare `x402-mcp` server, 33/33 tests)
   and [#24](https://github.com/MetaMask/agent-skills/pull/24) (an earlier,
   thinner attempt on the same head branch — likely a duplicate worth the
   user reconciling, not something I should touch). Second mistake, caught
   without needing the user to say anything this time: a draft comment
   pointing issue #23 at PR #25 would have been circular — #25 isn't
   *external* validation of a not-yet-built proposal (unlike #29's case),
   it's the PR that already closes #23 directly, and GitHub auto-links that.
   No comment was posted. Lesson: "point the issue at the reference
   implementation" is only a useful move when the reference is genuinely
   separate from the thing being proposed — check whether the target PR
   already says "Closes #N" before treating it as external evidence.

### Final state, end of session

- `steg-ens-agent`: `main` has the merged Telegram bridge (steg-ens-agent#2).
  Live in production on `steg-brain-production`, bot `@stegdotbot`. Done.
- `MetaMask/agent-skills`: issue #29 open with a comment linking the merged
  reference; PR #30 open, unreviewed. Open loose end for a future session:
  check for maintainer feedback on #29/#30.
- Issue #23 (unrelated x402 MCP work): left untouched, correctly — real
  implementations already exist (#24, #25) and don't need us. The #24/#25
  duplicate is the user's to reconcile, not something to act on unprompted.
