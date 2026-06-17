interface SigningOverlayProps {
  visible: boolean;
  operationLabel?: string;
}

export function SigningOverlay({ visible, operationLabel }: SigningOverlayProps) {
  if (!visible) return null;

  return (
    <div className="signing-overlay">
      <div className="skeleton signing-spinner" />
      <span className="signing-text">Waiting for wallet signature...</span>
      {operationLabel && <span className="signing-sub">{operationLabel}</span>}
    </div>
  );
}
