interface ChatKitFallbackProps {
  onRetry?: () => void;
}

export function ChatKitFallback({ onRetry }: ChatKitFallbackProps) {
  return (
    <div className="error-card" style={{ flex: 1 }}>
      <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>
        Chat failed to load
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Please check your connection and try again.
      </div>
      {onRetry && (
        <button className="error-btn error-btn--primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
