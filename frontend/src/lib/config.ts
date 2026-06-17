import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'placeholder';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [injectedWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  { appName: 'ENS Assistant', projectId },
);

export const config = createConfig({
  chains: [sepolia, mainnet],
  connectors,
  transports: {
    [sepolia.id]: http('https://sepolia.drpc.org'),
    [mainnet.id]: http('https://eth.drpc.org'),
  },
});
