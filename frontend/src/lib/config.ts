import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

// WalletConnect-based wallets load ONLY when a real project id is configured. With the
// old 'placeholder' fallback, RainbowKit's AppKit eagerly hit api.web3modal.org/config
// (403) and pulse.walletconnect.org telemetry (400) on every page load — two noisy
// console errors for a feature this app doesn't use (the agent wallet is server-side /
// TEE; the UI says "no wallet to connect"). Gating them keeps the console clean.
// Set VITE_WALLET_CONNECT_PROJECT_ID to re-enable the WalletConnect/Rainbow connectors.
const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID;

const wallets = projectId
  ? [injectedWallet, rainbowWallet, walletConnectWallet] // full set when configured
  : [injectedWallet]; // injected-only — no WalletConnect network calls

const connectors = connectorsForWallets([{ groupName: 'Popular', wallets }], {
  appName: 'ENS Assistant',
  projectId: projectId ?? '',
});

export const config = createConfig({
  chains: [sepolia, mainnet],
  connectors,
  transports: {
    [sepolia.id]: http('https://sepolia.drpc.org'),
    [mainnet.id]: http(import.meta.env.VITE_MAINNET_RPC || 'https://eth.drpc.org'),
  },
});
