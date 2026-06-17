import type { ENSNameEntry } from '../lib/api';

interface ENSNameListProps {
  names: ENSNameEntry[];
  isLoading: boolean;
  onSelectName?: (name: string) => void;
  onRefresh?: () => void;
}

function expiryBadge(entry: ENSNameEntry) {
  if (!entry.expiry) return null;
  const { expired, days_left } = entry.expiry;
  let cls = 'ds-badge--success';
  if (expired) cls = 'ds-badge--danger';
  else if (days_left < 30) cls = 'ds-badge--danger';
  else if (days_left < 90) cls = 'ds-badge--warning';

  const label = expired
    ? 'Expired'
    : days_left < 1
      ? 'Today'
      : `${days_left}d`;

  return <span className={`ds-badge ds-badge--sm ${cls}`}>{label}</span>;
}

function NameListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ds-space-2)', padding: 'var(--ds-space-3)' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} className={`ds-skeleton ds-stagger-${i}`} style={{ height: 36, borderRadius: 'var(--ds-radius-md)' }} />
      ))}
    </div>
  );
}

export function ENSNameList({ names, isLoading, onSelectName, onRefresh }: ENSNameListProps) {
  return (
    <div className="ds-widget">
      <div className="ds-widget__header">
        <span className="ds-widget__title">Your Names</span>
        {onRefresh && (
          <button className="ds-btn ds-btn--ghost ds-btn--sm" onClick={onRefresh}>
            ↻
          </button>
        )}
      </div>
      <div className="ds-widget__content ds-widget__content--sm">
        {isLoading ? (
          <NameListSkeleton />
        ) : names.length === 0 ? (
          <div
            style={{
              padding: 'var(--ds-space-6) var(--ds-space-4)',
              textAlign: 'center',
              color: 'var(--ds-color-text-muted)',
              fontSize: 'var(--ds-text-sm)',
            }}
          >
            No names found
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ds-space-1)' }}>
            {names.map((entry, i) => (
              <button
                key={entry.name}
                className={`ds-interactive ds-focusable ds-animate-in ds-stagger-${Math.min(i + 1, 8)}`}
                onClick={() => onSelectName?.(entry.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--ds-space-2) var(--ds-space-3)',
                  borderRadius: 'var(--ds-radius-md)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  color: 'var(--ds-color-text-primary)',
                  fontSize: 'var(--ds-text-sm)',
                  textAlign: 'left',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
                {expiryBadge(entry)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
