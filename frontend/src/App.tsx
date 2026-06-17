import '@rainbow-me/rainbowkit/styles.css';

import { useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

import { config } from './lib/config';
import { rainbowKitTheme } from './lib/theme';
import { useENSProfile } from './hooks/useENSProfile';
import { ChatBridgeContext, useChatBridge, type ChatBridgeMethods } from './hooks/useChatBridge';

import { ChatPanel } from './components/ChatPanel';
import { ENSProfileCard } from './components/ENSProfileCard';
import { CenteredLayout } from './components/CenteredLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ChatKitFallback } from './components/ChatKitFallback';

const queryClient = new QueryClient();

function AppContent() {
  const { profile, nameList, isLoading, isConnected, refresh, selectName } = useENSProfile();
  const { sendPrompt } = useChatBridge();

  const profileCard = (
    <ENSProfileCard
      profile={profile}
      nameList={nameList}
      isLoading={isLoading}
      isConnected={isConnected}
      onSendPrompt={sendPrompt}
      onSelectName={selectName}
      onRefresh={refresh}
    />
  );

  const chat = (
    <ErrorBoundary fallback={<ChatKitFallback onRetry={() => window.location.reload()} />}>
      <ChatPanel
        ensNames={nameList?.names ?? []}
        isWalletConnected={isConnected}
        onTransactionSuccess={refresh}
      />
    </ErrorBoundary>
  );

  const logo = (
    <img src="/ens-logo.svg" alt="ENS" className="centered__logo" />
  );

  return <CenteredLayout profileCard={profileCard} chat={chat} logo={logo} />;
}

export default function App() {
  const bridgeRef = useRef<ChatBridgeMethods | null>(null);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowKitTheme}>
          <ChatBridgeContext.Provider value={bridgeRef}>
            <ErrorBoundary>
              <div className="app-shell">
                <AppContent />
              </div>
            </ErrorBoundary>
          </ChatBridgeContext.Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
