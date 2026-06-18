/* Provision SSE client — drives the brain's POST /provision choreography.
 *
 * The brain (brain/app/provision_routes.py) streams the milestone-7 onboarding as
 * Server-Sent Events. EventSource is GET-only and we need a POST body, so we read
 * the streamed response with a ReadableStream reader and parse `data: {…}` frames.
 *
 * Each frame is one step of the option-B choreography (PLAN.md §3.3): a fresh TEE
 * server wallet → ENS forward records → ERC-8004 bind → ENSIP-26/25 identity →
 * server-wallet reverse → hand the name to the operator. No wallet-connect: the
 * brain signs operator steps with the hot key, the user only "signs in".
 */

export interface ProvisionFrame {
  event: 'begin' | 'step' | 'error' | 'complete';
  step?: string;
  status?: 'start' | 'done';
  message?: string;
  name?: string;
  label?: string;
  agentId?: string;
  serverWallet?: string;
  tx?: string;
  card?: string;
}

export interface ProvisionBody {
  name?: string;
  label?: string;
}

/** POST /provision and yield each parsed SSE frame as it arrives. */
export async function* streamProvision(
  body: ProvisionBody,
  signal?: AbortSignal,
): AsyncGenerator<ProvisionFrame> {
  const res = await fetch('/provision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`provision request failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as ProvisionFrame;
      } catch {
        /* skip malformed frame */
      }
    }
  }
}
