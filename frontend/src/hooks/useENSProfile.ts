import { useCallback, useEffect, useState } from 'react';
import {
  fetchProfile,
  fetchNameList,
  type ENSProfile,
  type ENSNameList,
} from '../lib/api';

// The identity is the AGENT, not a connected browser wallet. The anchored name is
// now DYNAMIC (was hardcoded): the cockpit can disconnect and re-anchor to a freshly
// provisioned agent. Callers pass the name + an `enabled` flag (false = logged out).
const NETWORK = 'mainnet';

export function useENSProfile(agentName: string, enabled = true) {
  const [profile, setProfile] = useState<ENSProfile | null>(null);
  const [nameList, setNameList] = useState<ENSNameList | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !agentName) {
      setProfile(null);
      setNameList(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const prof = await fetchProfile(agentName, NETWORK).catch(() => null);
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
  }, [agentName, enabled]);

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

  // Refetch whenever the anchored name changes or we (re)connect.
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profile, nameList, isLoading, error, refresh, selectName, address: profile?.address ?? null, network: NETWORK };
}
