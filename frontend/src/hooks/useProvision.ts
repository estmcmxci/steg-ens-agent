/* useProvision — React hook that drives POST /provision and exposes reactive
 * progress for the onboarding wizard (PLAN.md §3.3.1 Phase 3).
 *
 * Consumes the SSE frames from streamProvision() and reduces them into a per-step
 * status map the progress stepper renders, plus the final agentId / serverWallet /
 * card URL on completion. The eth_call pre-flight in each backend script is the
 * safety gate; this hook just visualizes the stream.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamProvision, type ProvisionBody, type ProvisionFrame } from '../lib/provisionApi';

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

export function useProvision() {
  const [state, setState] = useState<ProvisionState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: 'idle', steps: initialSteps(), txByStep: {} });
  }, []);

  const apply = useCallback((frame: ProvisionFrame) => {
    setState((prev) => {
      const next: ProvisionState = { ...prev, steps: { ...prev.steps }, txByStep: { ...prev.txByStep } };
      switch (frame.event) {
        case 'begin':
          next.status = 'running';
          break;
        case 'step':
          if (frame.step && frame.status === 'start') {
            next.steps[frame.step] = 'active';
            next.current = frame.step;
            next.message = frame.message;
          } else if (frame.step && frame.status === 'done') {
            next.steps[frame.step] = 'done';
            if (frame.tx) next.txByStep[frame.step] = frame.tx;
            if (frame.agentId) next.agentId = frame.agentId;
            if (frame.serverWallet) next.serverWallet = frame.serverWallet;
          }
          break;
        case 'error':
          next.status = 'error';
          next.error = frame.message;
          if (frame.step) next.steps[frame.step] = 'error';
          break;
        case 'complete':
          next.status = 'complete';
          next.current = undefined;
          next.message = undefined;
          if (frame.agentId) next.agentId = frame.agentId;
          if (frame.serverWallet) next.serverWallet = frame.serverWallet;
          if (frame.card) next.card = frame.card;
          for (const s of PROVISION_STEPS) {
            if (next.steps[s.id] !== 'error') next.steps[s.id] = 'done';
          }
          break;
      }
      return next;
    });
  }, []);

  const start = useCallback(
    async (body: ProvisionBody = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: 'running', steps: initialSteps(), txByStep: {} });
      try {
        for await (const frame of streamProvision(body, controller.signal)) {
          apply(frame);
        }
      } catch (err) {
        if (controller.signal.aborted) return; // user reset / unmounted
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not reach the agent',
        }));
      }
    },
    [apply],
  );

  return { ...state, start, reset };
}
