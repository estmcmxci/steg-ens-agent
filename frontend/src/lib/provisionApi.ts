/* Provision client — drives the brain's POST /provision choreography (PLAN-D Part 2).
 *
 * The brain (brain/app/provision_routes.py) used to STREAM the run as SSE over one
 * long-lived connection — a dropped/stalled browser aborted the server-side run
 * mid-flight. It now runs the choreography as a detached background JOB: POST
 * /provision returns a job record immediately, and the client POLLS
 * GET /provision/status/{jobId} until it's complete/error. The run survives a closed
 * tab or a flaky network, and a refresh resumes by re-polling the saved jobId.
 *
 * The job record mirrors the steps of the option-B choreography (PLAN.md §3.3): a
 * fresh TEE server wallet → ENS forward records → ERC-8004 bind → ENSIP-26/25
 * identity → server-wallet reverse → hand the name to the agent's own wallet. No
 * wallet-connect: the brain signs operator steps with the hot key, the user only
 * "signs in".
 */

/** The polled provision-job record. Shape mirrors the brain's ProvisionJobStore
 * (camelCase) so it maps almost 1:1 onto the hook's ProvisionState. */
export interface ProvisionJob {
  jobId: string;
  id: string;
  name: string;
  label: string;
  status: 'running' | 'complete' | 'error';
  steps: Record<string, 'pending' | 'active' | 'done' | 'error'>;
  current: string | null;
  message: string | null;
  agentId: string | null;
  serverWallet: string | null;
  card: string | null;
  txByStep: Record<string, string>;
  error: string | null;
}

export interface ProvisionBody {
  name?: string;
  label?: string;
}

/** Thrown by getProvisionStatus when the brain has no such job (never created, or
 * pruned after a restart). The hook treats this as "no active run" and resets. */
export class ProvisionJobNotFound extends Error {
  constructor(jobId: string) {
    super(`provision job not found: ${jobId}`);
    this.name = 'ProvisionJobNotFound';
  }
}

export interface MintRequestRecord {
  id: string;
  name: string;
  label: string;
  email: string | null;
  status: 'pending' | 'fulfilled';
  created_at: number;
  fulfilled_at: number | null;
}

/* requestMint — register a pending subname mint with the brain's operator queue
 * (Option C). Only the operator's Ledger can mint under wrapped steg.eth, so when
 * the wizard enters its "awaiting mint" state we POST the chosen label so the
 * operator isn't blind. This is best-effort: useMintWatch's on-chain poll remains
 * the real detector, so a failed request never blocks onboarding. Idempotent per
 * name on the backend, so re-submitting the same label is safe. */
export async function requestMint(
  label: string,
  email?: string,
): Promise<MintRequestRecord | null> {
  try {
    const res = await fetch('/provision/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, email: email ?? null }),
    });
    if (!res.ok) {
      console.warn(`mint request failed: ${res.status} ${res.statusText}`);
      return null;
    }
    return (await res.json()) as MintRequestRecord;
  } catch (err) {
    console.warn('mint request could not reach the brain', err);
    return null;
  }
}

/** POST /provision — create the background job. Returns the initial job record
 * (status 'running'); the run continues server-side regardless of this client. */
export async function startProvision(body: ProvisionBody): Promise<ProvisionJob> {
  const res = await fetch('/provision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`provision request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ProvisionJob;
}

/** GET /provision/status/{jobId} — one poll of the job record. Throws
 * ProvisionJobNotFound on 404 so the caller can stop polling and reset. */
export async function getProvisionStatus(jobId: string): Promise<ProvisionJob> {
  const res = await fetch(`/provision/status/${encodeURIComponent(jobId)}`);
  if (res.status === 404) throw new ProvisionJobNotFound(jobId);
  if (!res.ok) {
    throw new Error(`provision status failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ProvisionJob;
}
