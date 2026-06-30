/**
 * x402 zero-spend 402 capture — ERD §15 Phase 0, Steps 1–3 (OAuth) + 7–8 (capture).
 *
 * Connects to Travala's MCP, drives search → package → and captures the
 * authenticated `travala_book` 402 payment challenge **without signing or
 * settling** — the make-or-break test that decides Branch 1 (standard
 * x402-over-MCP) vs Branch 2 (proprietary Coinbase/ERC-7715 handoff). ERD §7.4 / §15 Step 9.
 *
 * Discovery (connect, listTools, search) is UNAUTHENTICATED; only `travala_book`
 * is OAuth-gated (Bearer), so the one-time consent triggers there. Zero-spend by
 * construction (ERD §15.7 #1): the x402 client is capture-only — `schemes: []`
 * (no signer) + `autoPayment: false` — and we read the challenge via
 * `getToolPaymentRequirements()`, which never pays. mm / the wallet is NOT involved.
 *
 * Secrets (§15.7 #12): DCR client info + tokens persist to a gitignored
 * `.travala-oauth.local.json` (never logged); the callback listener binds
 * 127.0.0.1 with `state` validation.
 *
 * Run:
 *   bun scripts/x402-capture.ts                 # discovery only (connect + list tools + schemas)
 *   TRAVALA_CAPTURE=1 bun scripts/x402-capture.ts   # search -> package -> capture the book 402 (consent once)
 * Optional arg overrides (JSON): TRAVALA_SEARCH, TRAVALA_CUSTOMER, and explicit
 *   TRAVALA_PACKAGE_ID / TRAVALA_SESSION_ID / TRAVALA_HOTEL_ID to skip auto-extraction.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformationMixed,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { createx402MCPClient, isPaymentRequiredError, extractPaymentRequiredFromError } from "@x402/mcp"

const TRAVALA_MCP_URL = "https://travel-mcp.travala.com/mcp"
const CALLBACK_PORT = 8788
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`
const SCOPES = "mcp:read mcp:book"
const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".travala-oauth.local.json")

// ── File-backed OAuth client provider (DCR + PKCE + rotation-aware tokens) ──
interface Store {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  state?: string
}
const loadStore = (): Store => {
  try {
    return existsSync(STORE_PATH) ? (JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store) : {}
  } catch {
    return {}
  }
}
const saveStore = (s: Store): void => {
  writeFileSync(STORE_PATH, JSON.stringify(s, null, 2), { mode: 0o600 })
  try {
    chmodSync(STORE_PATH, 0o600)
  } catch {
    /* best effort */
  }
}

class TravalaOAuthProvider implements OAuthClientProvider {
  lastAuthorizationUrl?: URL
  private store: Store = loadStore()
  get redirectUrl(): string {
    return REDIRECT_URI
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "steg x402 payer (agent.steg.eth)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client (PKCE)
      scope: SCOPES,
    }
  }
  async state(): Promise<string> {
    if (!this.store.state) {
      this.store.state = crypto.randomUUID()
      saveStore(this.store)
    }
    return this.store.state
  }
  get expectedState(): string | undefined {
    return this.store.state
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.store.clientInformation
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.store.clientInformation = info
    saveStore(this.store)
  }
  tokens(): OAuthTokens | undefined {
    return this.store.tokens
  }
  saveTokens(tokens: OAuthTokens): void {
    this.store.tokens = tokens // OAuth 2.1 rotates refresh tokens — persist every time
    saveStore(this.store)
  }
  redirectToAuthorization(authorizationUrl: URL): void {
    this.lastAuthorizationUrl = authorizationUrl
  }
  saveCodeVerifier(codeVerifier: string): void {
    this.store.codeVerifier = codeVerifier
    saveStore(this.store)
  }
  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error("no PKCE code verifier saved")
    return this.store.codeVerifier
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "tokens") this.store.tokens = undefined
    if (scope === "all" || scope === "client") this.store.clientInformation = undefined
    if (scope === "all" || scope === "verifier") this.store.codeVerifier = undefined
    saveStore(this.store)
  }
}

// ── one-shot, state-validated localhost callback listener ──
function makeCallbackServer(provider: TravalaOAuthProvider) {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const waitForCode = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })
  const server = Bun.serve({
    port: CALLBACK_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url)
      if (u.pathname !== "/callback") return new Response("not found", { status: 404 })
      const err = u.searchParams.get("error")
      if (err) {
        rejectCode(new Error(`OAuth error: ${err} ${u.searchParams.get("error_description") ?? ""}`))
        return new Response(`OAuth error: ${err}`, { status: 400 })
      }
      const code = u.searchParams.get("code")
      const state = u.searchParams.get("state")
      if (!code) return new Response("missing ?code", { status: 400 })
      if (state !== provider.expectedState) {
        rejectCode(new Error("OAuth state mismatch (possible CSRF) — aborting"))
        return new Response("state mismatch", { status: 400 })
      }
      resolveCode(code)
      return new Response(
        "<html><body style='font-family:sans-serif'>✅ Travala sign-in complete — close this tab and return to the terminal.</body></html>",
        { headers: { "content-type": "text/html" } },
      )
    },
  })
  return { waitForCode, stop: () => server.stop(true) }
}

// Run an operation; if it needs OAuth (UnauthorizedError), do the one-time
// interactive consent, then retry. Used to wrap the OAuth-gated `travala_book`.
async function runWithConsent<T>(
  provider: TravalaOAuthProvider,
  transport: StreamableHTTPClientTransport,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op()
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e
    const url = provider.lastAuthorizationUrl
    if (!url) throw new Error("auth required but no authorization URL was produced")
    const cb = makeCallbackServer(provider)
    try {
      console.log("\n🔑 ONE-TIME TRAVALA CONSENT — open this URL, sign in with your email, approve `mcp:read mcp:book`:\n")
      console.log(url.toString())
      console.error(`\n[oauth] waiting for the redirect to ${REDIRECT_URI} …`)
      const code = await cb.waitForCode
      await transport.finishAuth(code)
      console.error("[oauth] ✅ authenticated; refresh_token persisted (.travala-oauth.local.json, gitignored).")
    } finally {
      cb.stop()
    }
    return await op() // retry, now authenticated
  }
}

// ── result parsing helpers ──
function toolJson(result: unknown): unknown {
  const r = result as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> }
  if (r?.structuredContent !== undefined) return r.structuredContent
  const text = r?.content?.find((c) => c?.type === "text")?.text
  if (typeof text === "string") {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return result
}
function deepFind(obj: unknown, key: string): string | undefined {
  let found: string | undefined
  const walk = (v: unknown) => {
    if (found !== undefined || v === null || typeof v !== "object") return
    for (const [k, val] of Object.entries(v)) {
      if (k === key && (typeof val === "string" || typeof val === "number")) {
        found = String(val)
        return
      }
      walk(val)
    }
  }
  walk(obj)
  return found
}

// ── driver ──
const provider = new TravalaOAuthProvider()
const transport = new StreamableHTTPClientTransport(new URL(TRAVALA_MCP_URL), { authProvider: provider })
const client = createx402MCPClient({ name: "steg-x402-payer", version: "0.1.0", schemes: [], autoPayment: false })

try {
  await runWithConsent(provider, transport, () => client.connect(transport))
  console.error("[mcp] connected (discovery is unauthenticated; only travala_book needs OAuth).")

  const { tools } = await client.listTools()
  console.error(`[mcp] tools: ${tools.map((t) => t.name).join(", ")}`)

  if (!process.env.TRAVALA_CAPTURE) {
    console.log("\nℹ️  Discovery done. To capture the book 402 (consent once, zero-spend), re-run with:\n   TRAVALA_CAPTURE=1 bun scripts/x402-capture.ts")
  } else {
    // dates default to +30/+32 days; override via TRAVALA_SEARCH.
    const d = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
    const search = process.env.TRAVALA_SEARCH
      ? (JSON.parse(process.env.TRAVALA_SEARCH) as Record<string, unknown>)
      : { location: "Lisbon", checkIn: d(30), checkOut: d(32), rooms: ["2"], response_format: "json" }

    console.error(`\n[search] travala_search_hotel ${JSON.stringify(search)}`)
    const hotelRes = toolJson(await client.callTool("travala_search_hotel", search))
    console.log(`[search] result (truncated):\n${JSON.stringify(hotelRes).slice(0, 1200)}`)

    let sessionId = process.env.TRAVALA_SESSION_ID ?? deepFind(hotelRes, "sessionId")
    let packageId = process.env.TRAVALA_PACKAGE_ID ?? deepFind(hotelRes, "packageId")
    const hotelId = process.env.TRAVALA_HOTEL_ID ?? deepFind(hotelRes, "hotelId") ?? deepFind(hotelRes, "id")

    if (!packageId && hotelId) {
      const pkgArgs = { hotelId, sessionId, checkIn: search.checkIn, checkOut: search.checkOut, rooms: search.rooms, response_format: "json" }
      console.error(`\n[package] travala_search_package ${JSON.stringify(pkgArgs)}`)
      const pkgRes = toolJson(await client.callTool("travala_search_package", pkgArgs))
      console.log(`[package] result (truncated):\n${JSON.stringify(pkgRes).slice(0, 1200)}`)
      packageId = process.env.TRAVALA_PACKAGE_ID ?? deepFind(pkgRes, "packageId")
      sessionId = sessionId ?? deepFind(pkgRes, "sessionId")
    }

    console.error(`\n[ids] sessionId=${sessionId ?? "—"} packageId=${packageId ?? "—"} hotelId=${hotelId ?? "—"}`)
    if (!packageId || !sessionId) {
      console.log("\n⚠️  Could not resolve packageId+sessionId from the search results. Inspect the output above and re-run with explicit TRAVALA_PACKAGE_ID / TRAVALA_SESSION_ID.")
    } else {
      const customer = process.env.TRAVALA_CUSTOMER
        ? (JSON.parse(process.env.TRAVALA_CUSTOMER) as Record<string, unknown>)
        : { firstName: "Steg", lastName: "Tester", email: "steg-x402-test@example.com", phone: "+10000000000" }
      const bookArgs = { packageId, sessionId, customer }
      console.error(`\n[capture] travala_book {packageId, sessionId, customer} — RAW inspect, NO sign, NO settle`)

      // Raw inspect: call travala_book directly so we SEE the actual response —
      // standard x402 (Branch 1, usually a -32042 error with PaymentRequired in
      // error.data), a proprietary next_action/_meta (Branch 2), or an error
      // (expired session / validation). getToolPaymentRequirements hid this.
      let captured: { accepts?: unknown[] } | null = null
      try {
        const res = await runWithConsent(provider, transport, () => client.callTool("travala_book", bookArgs))
        console.log(`\n[book] RAW result (no error thrown):\n${JSON.stringify(res, null, 2).slice(0, 4000)}`)
      } catch (err) {
        const e = err as { code?: unknown; message?: unknown; data?: unknown }
        console.log(`\n[book] threw — code=${String(e?.code)} message=${String(e?.message)}`)
        console.log(`[book] error.data:\n${(JSON.stringify(e?.data, null, 2) ?? "undefined").slice(0, 4000)}`)
        if (isPaymentRequiredError(err)) captured = extractPaymentRequiredFromError(err) as { accepts?: unknown[] } | null
      }

      if (captured?.accepts?.length) {
        console.log(`\n✅ 402 CAPTURED — BRANCH 1 (standard x402-over-MCP): ${captured.accepts.length} accepts entr${captured.accepts.length > 1 ? "ies" : "y"}.`)
        console.log(`PaymentRequired:\n${JSON.stringify(captured, null, 2)}`)
        console.log(`\n=> Next: verify the EIP-712 domain on accepts[] (asset / network / extra.name / extra.version) per §15.7 #7.`)
      } else {
        console.log(`\n=> Not a standard x402 402. Inspect the raw output above: BRANCH 2 (next_action / payment_handle / ERC-7715), or an error (expired session / validation). §15 Step 9.`)
      }

      // Safety read (ERD §15.7): confirm NOTHING was booked by this or the prior run.
      try {
        const mine = await runWithConsent(provider, transport, () => client.callTool("travala_manage_bookings", {}))
        console.log(`\n[safety] travala_manage_bookings (should show no NEW/paid booking):\n${JSON.stringify(mine).slice(0, 1500)}`)
      } catch (e) {
        console.log(`\n[safety] manage_bookings check failed: ${String((e as { message?: unknown })?.message)}`)
      }
    }
  }
} finally {
  await client.close().catch(() => {})
  await transport.close().catch(() => {})
}
