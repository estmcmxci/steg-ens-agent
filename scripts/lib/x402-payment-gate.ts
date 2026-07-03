/**
 * x402-payment-gate.ts — the PAYMENT-SPECIFIC ENS authority probe (ERD Arc 3 §3d).
 *
 * Replaces the generic ens-gate (which signs a fixed erc20.transfer placeholder,
 * §15.7 #2) for x402 payments: it signs the REAL x402.payment (asset/payTo/amount/
 * network) under the `x402-payment` credential and evaluates it at /evaluate — so
 * the verdict reflects the on-chain x402.payment capability (amount cap, recipient
 * allow-list, and PAYMENT-specific revocation, independent of transfers).
 *
 * Signs with the active mm wallet (TEE server-wallet) and evaluates whatever name
 * that wallet reverse-resolves to (G4), keeping signer ↔ credential coherent.
 * Fail-closed: any error → { allowed:false }.
 */

import { $ } from "bun"
import { signWithMM } from "../sign-with-mm"
import { DEFAULT_RPC, makePublicClient } from "./agent-config"
import type { X402PaymentRequest } from "../../src/types"

export interface PaymentGateParams {
  payTo: string
  amount: string // base units (integer string)
  asset: string
  network: string // CAIP-2
  credentialId?: string
  workerUrl?: string
}

export interface GateVerdict {
  allowed: boolean
  reason: string
  detail?: string
  name?: string
}

/** Evaluate whatever name the active mm wallet reverse-resolves to (G4). */
async function resolveAgentName(): Promise<string> {
  const pinned = process.env.STEG_DEMO_NAME
  if (pinned) return pinned
  try {
    const show = await $`mm wallet show --json`.quiet().text()
    const addr = JSON.parse(show)?.data?.address as `0x${string}` | undefined
    if (!addr) return "agent.steg.eth"
    const rpc = process.env.ETH_RPC_URL || DEFAULT_RPC
    return (await makePublicClient(rpc).getEnsName({ address: addr })) || "agent.steg.eth"
  } catch {
    return "agent.steg.eth"
  }
}

/**
 * Sign the concrete x402.payment and evaluate it against the agent's ENS-published
 * x402.payment capability. Returns the verdict (fail-closed on any error).
 */
export async function gatePayment(p: PaymentGateParams): Promise<GateVerdict> {
  const workerUrl = (p.workerUrl || process.env.WORKER_URL || "http://127.0.0.1:8787").replace(/\/$/, "")
  const request: X402PaymentRequest = {
    credentialId: p.credentialId ?? "x402-payment",
    actionType: "x402.payment",
    params: {
      asset: p.asset as `0x${string}`,
      payTo: p.payTo as `0x${string}`,
      amount: p.amount,
      network: p.network,
    },
  }
  try {
    const name = await resolveAgentName()
    const signature = await signWithMM(request)
    const res = await fetch(`${workerUrl}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, request, signature }),
    })
    const body = (await res.json()) as { data?: { allowed?: boolean; reason?: string; detail?: string } }
    const v = (body.data ?? body) as { allowed?: boolean; reason?: string; detail?: string }
    return { allowed: v.allowed === true, reason: v.reason ?? "unknown", detail: v.detail, name }
  } catch (e) {
    return { allowed: false, reason: "GATE_UNAVAILABLE", detail: String(e).slice(0, 160) }
  }
}
