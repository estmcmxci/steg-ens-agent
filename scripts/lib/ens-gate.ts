/**
 * ens-gate.ts — the ENS authority probe, shared by every x402 EXECUTE path.
 *
 * Shells scripts/demo-mm.ts → worker /evaluate — the same probe the brain's
 * gate_or_refusal() uses. Identity-scoped, operator-revocable kill-switch
 * (ERD §15.7 #2): revoke at ENS → the agent's next gated payment is refused.
 * Forces TEE signing (drops local keys), fail-closed on any error.
 */

export async function gateAllows(): Promise<{ allowed: boolean; reason: string }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.MM_MNEMONIC
  delete env.AGENT_PRIVATE_KEY
  env.STEG_DEMO_NAME = process.env.STEG_DEMO_NAME ?? ""
  const proc = Bun.spawn(["bun", "scripts/demo-mm.ts"], { stdout: "pipe", stderr: "pipe", env })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  let reason = "unknown"
  try {
    reason = (JSON.parse(out) as { data?: { reason?: string } }).data?.reason ?? reason
  } catch {
    /* leave reason */
  }
  return { allowed: code === 0, reason }
}
