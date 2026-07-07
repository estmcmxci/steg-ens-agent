/**
 * Shared Travala MCP + OAuth layer (ERD §15 / Phase 0–3).
 *
 * A file-backed OAuth client (DCR + PKCE + rotation-aware tokens), a one-shot
 * 127.0.0.1 callback listener with `state` validation, and a capture-only MCP
 * client factory. Reused by scripts/x402-capture.ts (Phase 0) and
 * scripts/x402-pay.ts (Phase 1), and intended for the brain in Phase 3.
 *
 * Discovery (connect, listTools, search) is unauthenticated; only `travala_book`
 * is OAuth-gated, so consent triggers lazily via `runWithConsent`.
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
import { createx402MCPClient } from "@x402/mcp"

export const TRAVALA_MCP_URL = "https://travel-mcp.travala.com/mcp"
export const CALLBACK_PORT = 8788
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`
export const SCOPES = "mcp:read mcp:book"
const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".travala-oauth.local.json")

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

export class TravalaOAuthProvider implements OAuthClientProvider {
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
      token_endpoint_auth_method: "none",
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
    this.store.tokens = tokens
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

/** Run an op; if it needs OAuth (UnauthorizedError), do the one-time interactive
 *  consent (print URL + 127.0.0.1 callback), then retry. */
export async function runWithConsent<T>(
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
      console.error("[oauth] ✅ authenticated; refresh_token persisted (gitignored).")
    } finally {
      cb.stop()
    }
    return await op()
  }
}

/** Connect a capture-only x402 MCP client (no signer wired; can't auto-pay). */
export async function connectTravala() {
  const provider = new TravalaOAuthProvider()
  const transport = new StreamableHTTPClientTransport(new URL(TRAVALA_MCP_URL), { authProvider: provider })
  const client = createx402MCPClient({ name: "steg-x402-payer", version: "0.1.0", schemes: [], autoPayment: false })
  await runWithConsent(provider, transport, () => client.connect(transport))
  return { client, transport, provider }
}

/** MCP tool result → its JSON (structuredContent or parsed content[].text). */
export function toolJson(result: unknown): unknown {
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

/** First value for `key` anywhere in a nested object (string|number). */
export function deepFind(obj: unknown, key: string): string | undefined {
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
