import { z } from 'incur'
import { createEnsClient } from './client.ts'
import { addresses, universalResolverAbi, type Chain } from './contracts.ts'

export const globalOptions = z.object({
  rpc: z.string().optional().describe('Ethereum RPC URL'),
  chain: z.enum(['mainnet', 'sepolia']).default('mainnet').describe('Chain to use'),
  universalResolver: z.string().optional().describe('Custom Universal Resolver contract address'),
})

export const globalEnv = z.object({
  ETH_RPC_URL: z.string().optional().describe('Ethereum RPC URL (fallback if --rpc not provided)'),
})

type Context = {
  options: { rpc?: string; chain?: string }
  env: { ETH_RPC_URL?: string }
}

export function clientFromContext(c: Context) {
  const chain = (c.options.chain ?? 'mainnet') as Chain
  const rpc = c.options.rpc ?? c.env.ETH_RPC_URL
  return { client: createEnsClient({ rpc, chain }), chain }
}

// Switch to help with logic around ENSv2
// Check if the UR implements `findCanonicalRegistry()`, which only exists in v2
export async function isV2Active(c: Context, universalResolverAddress: `0x${string}` | undefined) {
  const { client, chain } = clientFromContext(c)

  try {
    const ethRegistry = await client.readContract({
      address: universalResolverAddress ?? addresses[chain].universalResolver,
      abi: universalResolverAbi,
      functionName: 'findCanonicalRegistry',
      args: ['0x0365746800'],
    })

    return { isV2: true, ethRegistry }
  } catch {
    return { isV2: false } as const
  }
}
