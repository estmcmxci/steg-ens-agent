import { useCallback, useState } from 'react';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';

interface TxParams {
  to: string;
  data?: string;
  value?: string;
}

interface TxResult {
  hash: string;
  status: 'success' | 'reverted' | 'submitted';
}

export function useWalletSigning() {
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<Error | null>(null);

  const { sendTransactionAsync, isPending: isSending } = useSendTransaction();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: pendingHash,
  });

  const signTransaction = useCallback(
    async (tx: TxParams): Promise<TxResult> => {
      setError(null);
      try {
        const hash = await sendTransactionAsync({
          to: tx.to as `0x${string}`,
          data: (tx.data as `0x${string}`) || undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
        });
        setPendingHash(hash);

        // Wait for 1 confirmation — but with a timeout so we don't hang
        // forever on mobile (RPC connections go stale when the browser is
        // backgrounded during wallet signing)
        const { waitForTransactionReceipt } = await import('wagmi/actions');
        const { config } = await import('../lib/config');

        const RECEIPT_TIMEOUT = 120_000; // 2min — WalletConnect can be slow
        try {
          const receipt = await Promise.race([
            waitForTransactionReceipt(config, { hash, confirmations: 1 }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('receipt_timeout')), RECEIPT_TIMEOUT),
            ),
          ]);
          setPendingHash(undefined);
          return {
            hash,
            status: receipt.status === 'success' ? 'success' : 'reverted',
          };
        } catch {
          // Receipt polling timed out or failed — tx WAS submitted, just unconfirmed.
          // Return the hash so the assistant can verify on-chain.
          setPendingHash(undefined);
          return { hash, status: 'submitted' as const };
        }
      } catch (err) {
        setPendingHash(undefined);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [sendTransactionAsync],
  );

  return {
    signTransaction,
    isPending: isSending || isConfirming,
    error,
  };
}
