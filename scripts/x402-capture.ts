/**
 * x402 zero-spend 402 capture — ERD §15 Phase 0, Steps 7–8.
 *
 * Drives search → book and RAW-inspects the authenticated `travala_book` 402
 * **without signing or settling** (capture-only client from lib/travala-mcp:
 * schemes:[], autoPayment:false). Decides Branch 1 (standard x402-over-MCP) vs
 * Branch 2 (proprietary next_action). Result (2026-06-30): Branch 2 — a
 * next_action handoff wrapping a standard exact-EVM EIP-3009 payment.
 *
 * Run:
 *   bun scripts/x402-capture.ts                 # discovery only (connect + list tools)
 *   TRAVALA_CAPTURE=1 bun scripts/x402-capture.ts   # search -> raw book 402 (consent once)
 */

import { isPaymentRequiredError, extractPaymentRequiredFromError } from "@x402/mcp"
import { connectTravala, runWithConsent, toolJson, deepFind } from "./lib/travala-mcp"

const { client, transport, provider } = await connectTravala()

try {
  console.error("[mcp] connected (discovery is unauthenticated; only travala_book needs OAuth).")
  const { tools } = await client.listTools()
  console.error(`[mcp] tools: ${tools.map((t) => t.name).join(", ")}`)

  if (!process.env.TRAVALA_CAPTURE) {
    console.log("\nℹ️  Discovery done. To capture the book 402 (consent once, zero-spend), re-run with:\n   TRAVALA_CAPTURE=1 bun scripts/x402-capture.ts")
  } else {
    const d = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)
    const search = process.env.TRAVALA_SEARCH
      ? (JSON.parse(process.env.TRAVALA_SEARCH) as Record<string, unknown>)
      : { location: "Lisbon", checkIn: d(30), checkOut: d(32), rooms: ["2"], response_format: "json" }

    console.error(`\n[search] travala_search_hotel ${JSON.stringify(search)}`)
    const hotelRes = toolJson(await client.callTool("travala_search_hotel", search))
    console.log(`[search] result (truncated):\n${JSON.stringify(hotelRes).slice(0, 1200)}`)

    const sessionId = process.env.TRAVALA_SESSION_ID ?? deepFind(hotelRes, "sessionId")
    const packageId = process.env.TRAVALA_PACKAGE_ID ?? deepFind(hotelRes, "packageId")
    console.error(`\n[ids] sessionId=${sessionId ?? "—"} packageId=${packageId ?? "—"}`)

    if (!packageId || !sessionId) {
      console.log("\n⚠️  Could not resolve packageId+sessionId; inspect the output and re-run with explicit TRAVALA_PACKAGE_ID / TRAVALA_SESSION_ID.")
    } else {
      const customer = process.env.TRAVALA_CUSTOMER
        ? (JSON.parse(process.env.TRAVALA_CUSTOMER) as Record<string, unknown>)
        : { firstName: "Steg", lastName: "Tester", email: "steg-x402-test@example.com", phone: "+10000000000" }
      const bookArgs = { packageId, sessionId, customer }
      console.error(`\n[capture] travala_book — RAW inspect, NO sign, NO settle`)

      let captured: { accepts?: unknown[] } | null = null
      try {
        const res = await runWithConsent(provider, transport, () => client.callTool("travala_book", bookArgs))
        console.log(`\n[book] RAW result:\n${JSON.stringify(res, null, 2).slice(0, 4000)}`)
      } catch (err) {
        const e = err as { code?: unknown; message?: unknown; data?: unknown }
        console.log(`\n[book] threw — code=${String(e?.code)} message=${String(e?.message)}`)
        console.log(`[book] error.data:\n${(JSON.stringify(e?.data, null, 2) ?? "undefined").slice(0, 4000)}`)
        if (isPaymentRequiredError(err)) captured = extractPaymentRequiredFromError(err) as { accepts?: unknown[] } | null
      }

      if (captured?.accepts?.length) {
        console.log(`\n✅ Standard x402-over-MCP (Branch 1): ${captured.accepts.length} accepts.\n${JSON.stringify(captured, null, 2)}`)
      } else {
        console.log(`\n=> Not a standard MCP 402 — inspect the raw output for Branch 2 (next_action). §15 Step 9.`)
      }
    }
  }
} finally {
  await client.close().catch(() => {})
  await transport.close().catch(() => {})
}
