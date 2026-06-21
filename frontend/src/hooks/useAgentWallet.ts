import { useCallback, useEffect, useState } from 'react';
import {
  fetchBalance,
  fetchActivity,
  fetchPerps,
  fetchPredict,
  fetchAave,
  type MMEnvelope,
  type MMError,
  type BalanceData,
  type TxData,
  type PerpsData,
  type PredictData,
} from '../lib/agentApi';

/** Per-panel view state: loading → (data | error). `error` carries mm's code/hint
 *  so panels can distinguish "locked" (setup needed) from "unsupported" / network. */
export interface Panel<T> {
  data: T | null;
  error: MMError | null;
  loading: boolean;
}

function pending<T>(): Panel<T> {
  return { data: null, error: null, loading: true };
}

function settle<T>(env: MMEnvelope<T>): Panel<T> {
  return {
    data: env.ok ? env.data : null,
    error: env.ok ? null : env.error ?? { code: 'UNKNOWN', message: 'Request failed' },
    loading: false,
  };
}

/**
 * Fetches the agent wallet's live `mm` state (one call per panel) from the brain's
 * /agent/* endpoints. Holdings + Activity are real; Perps/Predict surface empty or
 * locked states; Aave is a deferred placeholder. Returns each panel independently
 * plus the header's total USD, and a `refresh` that re-pulls everything.
 */
export function useAgentWallet(activityLimit = 10, agentKey?: string | null) {
  const [balance, setBalance] = useState<Panel<BalanceData>>(pending);
  const [activity, setActivity] = useState<Panel<TxData>>(pending);
  const [perps, setPerps] = useState<Panel<PerpsData>>(pending);
  const [predict, setPredict] = useState<Panel<PredictData>>(pending);
  const [aave, setAave] = useState<Panel<null>>(pending);

  // Fetch all panels. `silent=false` shows loading spinners (initial load /
  // agent change); `silent=true` updates in place (the background poll), so the
  // header + panels stay live after funding/swaps/txs without flashing.
  // `agentKey` is in the deps so re-anchoring to a freshly provisioned agent
  // re-fetches with the loading state.
  const fetchAll = useCallback((silent: boolean) => {
    if (!silent) {
      setBalance(pending);
      setActivity(pending);
      setPerps(pending);
      setPredict(pending);
      setAave(pending);
    }
    // On a SILENT background poll, a transient error (e.g. the balance backend
    // rate-limiting with HTTP 429) must NOT blank the panel — keep the last good
    // value. Only a non-silent (initial / agent-change) refresh surfaces errors.
    const apply = <T,>(setter: (u: (p: Panel<T>) => Panel<T>) => void, env: MMEnvelope<T>) => {
      setter((prev) => {
        if (env.ok) return settle(env);
        if (silent && prev.data) return { ...prev, loading: false }; // keep last good
        return settle(env);
      });
    };
    fetchBalance().then((e) => apply(setBalance, e));
    fetchActivity(activityLimit).then((e) => apply(setActivity, e));
    fetchPerps().then((e) => apply(setPerps, e));
    fetchPredict().then((e) => apply(setPredict, e));
    fetchAave().then((e) => apply(setAave, e));
  }, [activityLimit, agentKey]);

  const refresh = useCallback(() => fetchAll(false), [fetchAll]);

  useEffect(() => {
    fetchAll(false); // initial / on agent change — show loading
    // Background poll, slow enough to avoid the balance backend's rate limit (429).
    const iv = setInterval(() => fetchAll(true), 60000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  // Header balance — total USD across all holdings (null until loaded).
  const totalUsd = balance.data ? parseFloat(balance.data.totalValue) : null;

  return { balance, activity, perps, predict, aave, totalUsd, refresh };
}
