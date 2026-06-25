import '@rainbow-me/rainbowkit/styles.css';

import { useCallback, useRef, useState } from 'react';
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

const DEFAULT_AGENT = import.meta.env.VITE_AGENT_NAME || 'agent.steg.eth';

function AppContent() {
  // The anchored agent is dynamic: disconnect → in-card email login → re-anchor to
  // the freshly provisioned agent. (Was a fixed name + always-connected.)
  const [anchorName, setAnchorName] = useState(DEFAULT_AGENT);
  // Public landing = the email-login / provision flow, NOT a pre-anchored cockpit.
  // The cockpit is reached only after a user opens a freshly provisioned agent
  // (connectTo → connected=true). A persisted provision job also lands here, so
  // AgentLoginProvision mounts and useProvision resumes it after a reload (PLAN-D
  // Part 2). VITE_AGENT_NAME (DEFAULT_AGENT) is now just the post-open fallback anchor.
  const [connected, setConnected] = useState(false);
  const { profile, nameList, isLoading, refresh, selectName } = useENSProfile(anchorName, connected);
  const { sendPrompt } = useChatBridge();

  const disconnect = useCallback(() => setConnected(false), []);
  const reconnect = useCallback(() => setConnected(true), []);
  const connectTo = useCallback((name: string) => {
    setAnchorName(name);
    setConnected(true);
  }, []);

  const profileCard = (
    <ENSProfileCard
      profile={profile}
      nameList={nameList}
      isLoading={isLoading}
      connected={connected}
      onSendPrompt={sendPrompt}
      onSelectName={selectName}
      onRefresh={refresh}
      onDisconnect={disconnect}
      onProvisioned={connectTo}
      onCancelLogin={reconnect}
    />
  );

  const chat = (
    <ErrorBoundary fallback={<ChatKitFallback onRetry={() => window.location.reload()} />}>
      <ChatPanel
        ensNames={nameList?.names ?? []}
        isWalletConnected={connected}
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
