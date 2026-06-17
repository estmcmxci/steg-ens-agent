import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';

export function WalletHeader() {
  const { chain } = useAccount();

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="header__title">ENS Assistant</span>
        {chain && (
          <span className={`header__network ${chain.testnet ? 'header__network--testnet' : 'header__network--mainnet'}`}>
            <span className="header__network-dot" />
            {chain.name}
          </span>
        )}
      </div>
      <div className="header__right">
        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus="avatar"
        />
      </div>
    </header>
  );
}
