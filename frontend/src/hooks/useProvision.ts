/* useProvision — React hook that drives the brain's background provision job and
 * exposes reactive progress for the onboarding wizard (PLAN.md §3.3.1 / PLAN-D Part 2).
 *
 * Was: held one long SSE connection (streamProvision) — a closed tab or flaky
 * network aborted the run. Now: start() POSTs to create a background job, persists
 * the jobId in sessionStorage, and POLLS GET /provision/status/{jobId} until the run
 * is complete/error. A refresh resumes by re-polling the saved jobId. The eth_call
 * pre-flight + the per-step timeouts in the backend are the safety/robustness gates;
 * this hook just maps the polled job record into the per-step state the stepper renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startProvision,
  getProvisionStatus,
  ProvisionJobNotFound,
  type ProvisionBody,
  type ProvisionJob,
} from '../lib/provisionApi';

/** Poll cadence + where the in-flight jobId is persisted (so a refresh resumes).
 * Exported so App can decide, on mount, to re-enter the provision flow when a run
 * is still in progress (otherwise the cockpit mounts and the resume never runs). */
const POLL_MS = 2500;
export const PROVISION_JOB_KEY = 'provision.jobId';

export type StepState = 'pending' | 'active' | 'done' | 'error';

/** Ordered display steps — ids match the backend SSE `step` values. */
export const PROVISION_STEPS: { id: string; label: string }[] = [
  { id: 'wallet_create', label: 'Wallet' },
  { id: 'fund', label: 'Fund' },
  { id: 'records', label: 'Records' },
  { id: 'bind', label: 'Bind' },
  { id: 'identity', label: 'Identity' },
  { id: 'agent_uri', label: 'Card' },
  { id: 'ensip25', label: 'Claim' },
  { id: 'reverse', label: 'Reverse' },
  { id: 'transfer', label: 'Handoff' },
];

export interface ProvisionState {
  status: 'idle' | 'running' | 'complete' | 'error';
  steps: Record<string, StepState>;
  current?: string;
  message?: string;
  /** Name/label of the run — recovered from the job record so a resumed run (after a
   * refresh, when the local form state is empty) can still render the success panel. */
  name?: string;
  label?: string;
  agentId?: string;
  serverWallet?: string;
  card?: string;
  txByStep: Record<string, string>;
  error?: string;
}

function initialSteps(): Record<string, StepState> {
  return Object.fromEntries(PROVISION_STEPS.map((s) => [s.id, 'pending']));
}

const IDLE: ProvisionState = { status: 'idle', steps: initialSteps(), txByStep: {} };

/** Map a polled job record onto the hook's ProvisionState (shapes already align;
 * this just fills missing steps and normalizes null → undefined). */
function fromJob(job: ProvisionJob): ProvisionState {
  return {
    status: job.status, // 'running' | 'complete' | 'error'
    steps: { ...initialSteps(), ...job.steps },
    current: job.current ?? undefined,
    message: job.message ?? undefined,
    name: job.name ?? undefined,
    label: job.label ?? undefined,
    agentId: job.agentId ?? undefined,
    serverWallet: job.serverWallet ?? undefined,
    card: job.card ?? undefined,
    txByStep: job.txByStep ?? {},
    error: job.error ?? undefined,
  };
}

export function useProvision() {
  // If a run is persisted (refresh mid-provision), seed 'running' so the progress
  // panel shows immediately instead of flashing the login form before the first poll.
  const [state, setState] = useState<ProvisionState>(() =>
    sessionStorage.getItem(PROVISION_JOB_KEY) ? { ...IDLE, status: 'running' } : IDLE,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // One poll of the job; reschedules itself while running, stops on terminal/404.
  const poll = useCallback(async (jobId: string) => {
    try {
      const job = await getProvisionStatus(jobId);
      if (!aliveRef.current) return;
      setState(fromJob(job));
      if (job.status === 'running') {
        timerRef.current = setTimeout(() => void poll(jobId), POLL_MS);
      } else {
        sessionStorage.removeItem(PROVISION_JOB_KEY); // terminal — stop persisting
      }
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof ProvisionJobNotFound) {
        // Job gone (brain restart / pruned). No run to resume → reset to idle.
        sessionStorage.removeItem(PROVISION_JOB_KEY);
        setState(IDLE);
        return;
      }
      // Transient network/5xx: the server-side job is unaffected — keep polling.
      timerRef.current = setTimeout(() => void poll(jobId), POLL_MS);
    }
  }, []);

  // Resume an in-flight run across a refresh; stop polling on unmount.
  useEffect(() => {
    aliveRef.current = true;
    const saved = sessionStorage.getItem(PROVISION_JOB_KEY);
    if (saved) void poll(saved);
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [poll, clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    sessionStorage.removeItem(PROVISION_JOB_KEY);
    setState({ status: 'idle', steps: initialSteps(), txByStep: {} });
  }, [clearTimer]);

  const start = useCallback(
    async (body: ProvisionBody = {}) => {
      clearTimer();
      setState({ status: 'running', steps: initialSteps(), txByStep: {} });
      try {
        const job = await startProvision(body);
        sessionStorage.setItem(PROVISION_JOB_KEY, job.id);
        setState(fromJob(job));
        if (job.status === 'running') {
          timerRef.current = setTimeout(() => void poll(job.id), POLL_MS);
        }
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not reach the agent',
        }));
      }
    },
    [clearTimer, poll],
  );

  return { ...state, start, reset };
}
