import { useState, type ReactNode } from 'react';
import type { useAgentWallet, Panel } from '../hooks/useAgentWallet';
import type {
  MMError,
  BalanceData,
  TxData,
  PerpsData,
  PredictData,
} from '../lib/agentApi';

type Wallet = ReturnType<typeof useAgentWallet>;

const TABS = ['Identity', 'Holdings', 'Activity', 'Perps', 'Predict', 'Aave'] as const;
type Tab = (typeof TABS)[number];

/* ── formatting helpers ── */
function usd(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 });
}

function amount(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/* ── shared status views ── */
function PanelLoading() {
  return (
    <div className="ppanel__status">
      <div className="skeleton" style={{ width: '70%', height: 12 }} />
      <div className="skeleton" style={{ width: '45%', height: 10, marginTop: 6 }} />
    </div>
  );
}

function PanelMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="ppanel__status">
      <span className="ppanel__empty-title">{title}</span>
      {detail && <span className="ppanel__empty-detail">{detail}</span>}
    </div>
  );
}

/** Renders loading / error states for a panel; calls `children` only when data is present. */
function PanelBody<T>({
  panel,
  empty,
  children,
}: {
  panel: Panel<T>;
  empty?: { title: string; detail?: string };
  children: (data: T) => ReactNode;
}) {
  if (panel.loading) return <PanelLoading />;
  if (panel.error) return <ErrorView error={panel.error} />;
  if (panel.data == null) return <PanelMessage title={empty?.title ?? 'Nothing here yet'} detail={empty?.detail} />;
  return <>{children(panel.data)}</>;
}

function ErrorView({ error }: { error: MMError }) {
  // MNEMONIC_LOCKED / setup-required reads better as a "locked" empty state than an error.
  const locked = error.code === 'MNEMONIC_LOCKED';
  return (
    <div className="ppanel__status">
      <span className="ppanel__empty-title">{locked ? 'Locked' : 'Unavailable'}</span>
      <span className="ppanel__empty-detail">{error.hint ?? error.message}</span>
    </div>
  );
}

/* ── panel bodies ── */
function HoldingsPanel({ panel }: { panel: Panel<BalanceData> }) {
  return (
    <PanelBody panel={panel} empty={{ title: 'No holdings' }}>
      {(data) => {
        const rows = data.chains.flatMap((c) =>
          c.tokens.map((t) => ({ ...t, chainName: c.name })),
        );
        if (rows.length === 0) return <PanelMessage title="No holdings" detail="This wallet is empty." />;
        return (
          <div className="ppanel__list">
            <div className="ppanel__total">
              <span>Total</span>
              <span className="ppanel__total-val">{usd(data.totalValue)}</span>
            </div>
            {rows.map((t) => (
              <div key={`${t.chainName}-${t.assetId}`} className="ppanel__row">
                <div className="ppanel__row-main">
                  <span className="ppanel__row-title">{t.token}</span>
                  <span className="ppanel__row-sub">{t.chainName}</span>
                </div>
                <div className="ppanel__row-amt">
                  <span className="ppanel__row-title">{usd(t.usdValue)}</span>
                  <span className="ppanel__row-sub">{amount(t.amount)} {t.token}</span>
                </div>
              </div>
            ))}
          </div>
        );
      }}
    </PanelBody>
  );
}

function ActivityPanel({ panel }: { panel: Panel<TxData> }) {
  return (
    <PanelBody panel={panel} empty={{ title: 'No activity' }}>
      {(data) => {
        if (!data.items?.length) return <PanelMessage title="No activity" detail="No recent transactions." />;
        return (
          <div className="ppanel__list">
            {data.items.map((tx) => (
              <a
                key={tx.txHash}
                className="ppanel__row ppanel__row--link"
                href={`https://etherscan.io/tx/${tx.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="ppanel__row-main">
                  <span className="ppanel__row-title">{tx.summary || tx.type}</span>
                  <span className="ppanel__row-sub">{relTime(tx.ts)}</span>
                </div>
                <span className={`badge ${tx.status === 'success' ? 'badge--success' : tx.status === 'failed' ? 'badge--danger' : 'badge--outline'}`}>
                  {tx.status}
                </span>
              </a>
            ))}
          </div>
        );
      }}
    </PanelBody>
  );
}

function PerpsPanel({ panel }: { panel: Panel<PerpsData> }) {
  return (
    <PanelBody panel={panel} empty={{ title: 'No perps data' }}>
      {(data) => {
        const positions = data.positions.ok ? data.positions.data ?? [] : [];
        const bal = data.balance.ok ? data.balance.data : null;
        return (
          <div className="ppanel__list">
            {bal && (
              <div className="ppanel__total">
                <span>Margin ({bal.venue})</span>
                <span className="ppanel__total-val">{usd(bal.totalBalance)}</span>
              </div>
            )}
            {positions.length === 0 ? (
              <PanelMessage title="No open positions" detail={bal ? 'Deposit margin and open a position from chat.' : undefined} />
            ) : (
              positions.map((p, i) => (
                <div key={p.symbol ?? i} className="ppanel__row">
                  <div className="ppanel__row-main">
                    <span className="ppanel__row-title">{p.symbol ?? 'position'} {p.side ? `· ${p.side}` : ''}</span>
                    <span className="ppanel__row-sub">size {p.size ?? '—'}</span>
                  </div>
                  {p.unrealizedPnl != null && (
                    <span className="ppanel__row-title">{usd(p.unrealizedPnl as string)}</span>
                  )}
                </div>
              ))
            )}
          </div>
        );
      }}
    </PanelBody>
  );
}

function PredictPanel({ panel }: { panel: Panel<PredictData> }) {
  // Predict reads need setup + MM_PASSWORD; until then the brain returns an error
  // (e.g. MNEMONIC_LOCKED), which PanelBody renders as a locked state.
  return (
    <PanelBody panel={panel} empty={{ title: 'No predict positions' }}>
      {() => <PanelMessage title="No predict positions" detail="No open prediction-market positions." />}
    </PanelBody>
  );
}

function AavePanel() {
  return (
    <PanelMessage
      title="Aave — coming soon"
      detail="Lending/borrowing isn't supported by the mm CLI yet (feature request filed)."
    />
  );
}

/* ── tabbed container ── */
export function PortfolioPanels({ wallet, identity }: { wallet: Wallet; identity: ReactNode }) {
  const [tab, setTab] = useState<Tab>('Identity');

  return (
    <div className="ppanels">
      <div className="ppanels__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`ppanels__tab${tab === t ? ' ppanels__tab--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTab(t); }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="ppanels__body" onClick={(e) => e.stopPropagation()}>
        {tab === 'Identity' && identity}
        {tab === 'Holdings' && <HoldingsPanel panel={wallet.balance} />}
        {tab === 'Activity' && <ActivityPanel panel={wallet.activity} />}
        {tab === 'Perps' && <PerpsPanel panel={wallet.perps} />}
        {tab === 'Predict' && <PredictPanel panel={wallet.predict} />}
        {tab === 'Aave' && <AavePanel />}
      </div>
    </div>
  );
}
