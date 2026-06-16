import { toCoinType } from 'viem/ens'

export function resolveCoinType(opts: { coinType?: number; chainId?: number }): number | undefined {
  if (opts.coinType != null && opts.chainId != null) {
    throw new Error('Cannot specify both --coin-type and --chain-id. Use one or the other.')
  }
  if (opts.chainId != null) {
    return Number(toCoinType(opts.chainId))
  }
  return opts.coinType
}
