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
export function useAgentWallet(activityLimit = 10) {
  const [balance, setBalance] = useState<Panel<BalanceData>>(pending);
  const [activity, setActivity] = useState<Panel<TxData>>(pending);
  const [perps, setPerps] = useState<Panel<PerpsData>>(pending);
  const [predict, setPredict] = useState<Panel<PredictData>>(pending);
  const [aave, setAave] = useState<Panel<null>>(pending);

  const refresh = useCallback(() => {
    setBalance(pending);
    setActivity(pending);
    setPerps(pending);
    setPredict(pending);
    setAave(pending);
    fetchBalance().then((e) => setBalance(settle(e)));
    fetchActivity(activityLimit).then((e) => setActivity(settle(e)));
    fetchPerps().then((e) => setPerps(settle(e)));
    fetchPredict().then((e) => setPredict(settle(e)));
    fetchAave().then((e) => setAave(settle(e)));
  }, [activityLimit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Header balance — total USD across all holdings (null until loaded).
  const totalUsd = balance.data ? parseFloat(balance.data.totalValue) : null;

  return { balance, activity, perps, predict, aave, totalUsd, refresh };
}
