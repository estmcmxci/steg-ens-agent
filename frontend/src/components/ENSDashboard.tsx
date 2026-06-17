import type { ENSProfile, ENSNameList } from '../lib/api';
import { ENSProfileCard } from './ENSProfileCard';

interface ENSDashboardProps {
  profile: ENSProfile | null;
  nameList: ENSNameList | null;
  isLoading: boolean;
  isConnected: boolean;
  onSendPrompt?: (text: string) => void;
  onRefresh?: () => void;
}

export function ENSDashboard({
  profile,
  nameList,
  isLoading,
  isConnected,
  onSendPrompt,
  onRefresh,
}: ENSDashboardProps) {
  return (
    <div className="story">
      <div className="story__nebula" />

      {/* Header — just the ENS logo */}
      <div className="story__header">
        <img src="/ens-logo.svg" alt="ENS" className="story__logo" />
      </div>

      {/* Profile card — handles both connected and disconnected states */}
      <div className="story__card">
        <ENSProfileCard
          profile={profile}
          nameList={nameList}
          isLoading={isLoading}
          isConnected={isConnected}
          onSendPrompt={onSendPrompt}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}
