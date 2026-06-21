/* useMintWatch — polls mainnet for "has the operator minted <name>.steg.eth yet?"
 * (PLAN.md §7 G1). The end user can't mint a subname under wrapped steg.eth — only
 * the operator's Ledger can (NameWrapper.setSubnodeRecord). So after the user picks a
 * label, the wizard waits in an "awaiting mint" state while this hook polls
 * NameWrapper.ownerOf(namehash(name)) in-browser via viem until the name exists.
 *
 * "minted" = ownerOf returns a non-zero address. An unminted name returns the zero
 * address (or reverts on expiry checks) — both map to not-minted. No backend needed;
 * viem + the mainnet RPC are already frontend deps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, http, namehash, zeroAddress, type Address } from 'viem';
import { mainnet } from 'viem/chains';

// NameWrapper (mainnet) — same address used by the operator's mint-subname.ts.
const NAME_WRAPPER: Address = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
const OWNER_OF_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const POLL_MS = 4000;

const client = createPublicClient({ chain: mainnet, transport: http('https://eth.drpc.org') });

export type MintWatchStatus = 'idle' | 'waiting' | 'minted' | 'error';

export interface MintWatchState {
  status: MintWatchStatus;
  owner?: Address;
  error?: string;
}

/** Read NameWrapper.ownerOf(namehash(name)). Returns the owner, or null if unminted. */
async function readOwner(name: string): Promise<Address | null> {
  const tokenId = BigInt(namehash(name));
  const owner = (await client.readContract({
    address: NAME_WRAPPER,
    abi: OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  })) as Address;
  return owner && owner !== zeroAddress ? owner : null;
}

export function useMintWatch() {
  const [state, setState] = useState<MintWatchState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const nameRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    nameRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  const watch = useCallback(
    (name: string) => {
      stop();
      nameRef.current = name;
      setState({ status: 'waiting' });

      const tick = async () => {
        if (nameRef.current !== name) return; // superseded
        try {
          const owner = await readOwner(name);
          if (nameRef.current !== name) return;
          if (owner) {
            setState({ status: 'minted', owner });
            stop();
          }
        } catch {
          // transient RPC / revert on an unminted name — stay in 'waiting', keep polling.
        }
      };

      void tick(); // immediate first check
      timer.current = setInterval(tick, POLL_MS);
    },
    [stop],
  );

  // Clean up on unmount.
  useEffect(() => stop, [stop]);

  return { ...state, watch, reset };
}
