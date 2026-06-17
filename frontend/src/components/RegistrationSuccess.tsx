import { useEffect } from 'react';

interface RegistrationSuccessProps {
  name: string;
  txHash?: string;
  network?: string;
  onDismiss: () => void;
}

function etherscanUrl(txHash: string, network: string) {
  const base = network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io';
  return `${base}/tx/${txHash}`;
}

export function RegistrationSuccess({ name, txHash, network, onDismiss }: RegistrationSuccessProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="reg-success">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="reg-success__check">✓</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="reg-success__name">{name}</span>
          <span className="reg-success__label">Registered!</span>
          {txHash && network && (
            <a
              href={etherscanUrl(txHash, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="reg-success__link"
            >
              View on Etherscan
            </a>
          )}
        </div>
      </div>
      <button onClick={onDismiss} className="reg-success__close" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
