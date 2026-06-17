import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { fetchCheck, fetchProfile, type ENSCheckResult, type ENSProfile } from '../lib/api';

function chainToNetwork(chainId: number | undefined): string {
  return chainId === 1 ? 'mainnet' : 'sepolia';
}

export interface SearchResult {
  query: string;
  check: ENSCheckResult;
  profile: ENSProfile | null; // populated for taken names
}

export function useENSSearch() {
  const { chainId } = useAccount();
  const network = chainToNetwork(chainId);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef(0); // monotonic counter to discard stale responses

  const search = useCallback(async (label: string) => {
    // Strip .eth suffix if user types it
    const clean = label.replace(/\.eth$/i, '').trim().toLowerCase();
    if (!clean || clean.length < 1) {
      setResult(null);
      setError(null);
      setIsSearching(false);
      return;
    }

    // Basic validation: only allow valid ENS labels
    if (/[^a-z0-9\-_]/.test(clean)) {
      setResult(null);
      setError('Invalid characters in name');
      setIsSearching(false);
      return;
    }

    const requestId = ++abortRef.current;
    setIsSearching(true);
    setError(null);

    try {
      const check = await fetchCheck(clean, network);
      // Stale response guard
      if (abortRef.current !== requestId) return;

      let profile: ENSProfile | null = null;
      if (!check.available) {
        // Fetch profile for taken names
        try {
          profile = await fetchProfile(`${clean}.eth`, network);
        } catch {
          // Profile fetch can fail for some names — that's ok
        }
        if (abortRef.current !== requestId) return;
      }

      setResult({ query: clean, check, profile });
      setError(null);
    } catch (err) {
      if (abortRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Search failed');
      setResult(null);
    } finally {
      if (abortRef.current === requestId) {
        setIsSearching(false);
      }
    }
  }, [network]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const clean = query.replace(/\.eth$/i, '').trim().toLowerCase();
    if (!clean) {
      setResult(null);
      setError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(() => search(clean), 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const clear = useCallback(() => {
    setQuery('');
    setResult(null);
    setError(null);
    setIsSearching(false);
    abortRef.current++;
  }, []);

  return { query, setQuery, result, isSearching, error, clear };
}
