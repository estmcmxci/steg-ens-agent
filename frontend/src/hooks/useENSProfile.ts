import { useCallback, useEffect, useState } from 'react';
import {
  fetchProfile,
  fetchNameList,
  type ENSProfile,
  type ENSNameList,
} from '../lib/api';

// Re-anchored: the identity is the AGENT, not a connected browser wallet.
// We fetch a fixed name (agent.steg.eth on mainnet) — no wagmi, no wallet connect.
const AGENT_NAME = import.meta.env.VITE_AGENT_NAME || 'agent.steg.eth';
const NETWORK = 'mainnet';

export function useENSProfile() {
  const [profile, setProfile] = useState<ENSProfile | null>(null);
  const [nameList, setNameList] = useState<ENSNameList | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const prof = await fetchProfile(AGENT_NAME, NETWORK).catch(() => null);
      setProfile(prof);
      if (prof?.address) {
        const names = await fetchNameList(prof.address, NETWORK).catch(() => null);
        setNameList(names ?? { address: prof.address, names: [], total: 0, network: NETWORK });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ENS data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectName = useCallback(async (name: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const prof = await fetchProfile(name, NETWORK);
      setProfile(prof);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch profile');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // isConnected is always true — the agent IS the identity (no wallet to connect).
  return { profile, nameList, isLoading, error, refresh, selectName, isConnected: true, address: profile?.address ?? null, network: NETWORK };
}
