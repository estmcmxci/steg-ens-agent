/* Agent-wallet REST client — read-only `mm` state proxied through the brain.
 *
 * The browser can't run `mm`; the brain (co-located with the CLI) exposes these
 * public GETs under /agent/* (see brain/app/agent_routes.py). Each returns mm's
 * native envelope: {ok:true, data} on success, {ok:false, error:{code,message,hint}}
 * when locked/unset/unsupported. Actions stay in the chat — this is read-only.
 */

export interface MMError {
  code: string;
  message: string;
  hint?: string;
}

export interface MMEnvelope<T> {
  ok: boolean;
  data: T | null;
  error?: MMError | null;
}

/* ── Holdings (mm wallet balance) ── */
export interface BalanceToken {
  token: string;
  amount: string;
  usdValue: string;
  assetId: string;
  name: string;
  type: string;
}
export interface BalanceChain {
  chain: string;
  chainId: string;
  name: string;
  totalValue: string;
  tokens: BalanceToken[];
}
export interface BalanceData {
  currency: string;
  totalValue: string;
  chains: BalanceChain[];
  unprocessedNetworks: string[];
  unpricedAssetIds: string[];
}

/* ── Activity (mm tx history) ── */
export interface TxItem {
  txHash: string;
  type: string;
  status: string;
  summary: string;
  ts: string;
}
export interface TxData {
  items: TxItem[];
  unprocessedNetworks: string[];
  warnings: string[];
}

/* ── Perps (composite: positions + balance) ── */
export interface PerpsBalance {
  venue: string;
  totalBalance: string;
  spendableBalance: string;
  withdrawableBalance: string;
  marginUsed: string;
  unrealizedPnl: string;
  returnOnEquity: string;
}
export interface PerpsPosition {
  symbol?: string;
  side?: string;
  size?: string;
  entryPrice?: string;
  unrealizedPnl?: string;
  liquidationPrice?: string;
  [k: string]: unknown;
}
export interface PerpsData {
  positions: MMEnvelope<PerpsPosition[]>;
  balance: MMEnvelope<PerpsBalance>;
}

/* ── Predict (mm predict portfolio) — shape passthrough; locked when unset ── */
export type PredictData = Record<string, unknown>;

/* ── Aave — static deferred placeholder ── */
export type AaveData = MMEnvelope<null> & { status?: string };

const TIMEOUT_MS = 30_000;

async function agentFetch<T>(path: string): Promise<MMEnvelope<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { signal: controller.signal });
    return (await res.json()) as MMEnvelope<T>;
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'Request timed out' : 'Could not reach the agent';
    return { ok: false, data: null, error: { code: 'NETWORK', message } };
  } finally {
    clearTimeout(timer);
  }
}

export const fetchBalance = () => agentFetch<BalanceData>('/agent/balance');
export const fetchActivity = (limit = 10) => agentFetch<TxData>(`/agent/tx?limit=${limit}`);
export const fetchPredict = () => agentFetch<PredictData>('/agent/predict');
export const fetchAave = () => agentFetch<null>('/agent/aave') as Promise<AaveData>;

// Perps returns a composite (positions + balance), not a single mm envelope.
export async function fetchPerps(): Promise<MMEnvelope<PerpsData>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/agent/perps', { signal: controller.signal });
    const data = (await res.json()) as PerpsData;
    return { ok: true, data, error: null };
  } catch {
    return { ok: false, data: null, error: { code: 'NETWORK', message: 'Could not reach the agent' } };
  } finally {
    clearTimeout(timer);
  }
}
