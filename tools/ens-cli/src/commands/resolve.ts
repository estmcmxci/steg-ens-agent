import { z } from 'incur'
import { validateName } from '../lib/utils.ts'
import { getEnsAddress, getEnsName, getEnsText, getEnsAvatar, getEnsResolver } from 'viem/ens'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { resolveCoinType } from '../lib/cointype.ts'

const coinTypeOptions = z.object({
  coinType: z.coerce.number().optional().describe('ENSIP-9 coin type (e.g. 0 for BTC, 60 for ETH)'),
  chainId: z.coerce
    .number()
    .optional()
    .describe('EVM chain ID — auto-converts to ENSIP-9 coin type (e.g. 10 for Optimism)'),
})

const resolveOptions = coinTypeOptions.merge(globalOptions)

export const resolveCommand = {
  description: 'Resolve an ENS name to an address',
  args: z.object({
    name: z.string().describe('ENS name to resolve (e.g. vitalik.eth)'),
  }),
  options: resolveOptions,
  env: globalEnv,
  alias: { coinType: 'c', chainId: 'i' },
  async run(c: any) {
    const { client } = clientFromContext(c)
    const name = validateName(c.args.name)
    const coinType = resolveCoinType(c.options)
    const universalResolverAddress = c.options.universalResolver as `0x${string}` | undefined
    const resolver = await getEnsResolver(client, {
      name,
      ...(universalResolverAddress ? { universalResolverAddress } : {}),
    })
    const address = await getEnsAddress(client, {
      name,
      ...(coinType != null ? { coinType: BigInt(coinType) } : {}),
      ...(universalResolverAddress ? { universalResolverAddress } : {}),
    })
    return {
      name,
      resolver,
      address,
      ...(coinType != null ? { coinType } : {}),
    }
  },
}

export const reverseCommand = {
  description: 'Reverse resolve an address to an ENS name',
  args: z.object({
    address: z.string().describe('Ethereum address to reverse resolve'),
  }),
  options: resolveOptions,
  env: globalEnv,
  alias: { coinType: 'c', chainId: 'i' },
  async run(c: any) {
    const { client } = clientFromContext(c)
    const address = c.args.address as `0x${string}`
    const coinType = resolveCoinType(c.options)
    const universalResolverAddress = c.options.universalResolver as `0x${string}` | undefined
    const name = await getEnsName(client, {
      address,
      ...(coinType != null ? { coinType: BigInt(coinType) } : {}),
      ...(universalResolverAddress ? { universalResolverAddress } : {}),
    })
    return {
      address,
      name,
      ...(coinType != null ? { coinType } : {}),
    }
  },
}

export const textCommand = {
  description: 'Get a text record for an ENS name',
  args: z.object({
    name: z.string().describe('ENS name (e.g. vitalik.eth)'),
    key: z.string().describe('Text record key (e.g. com.twitter, url, description)'),
  }),
  options: globalOptions,
  env: globalEnv,
  async run(c: any) {
    const { client } = clientFromContext(c)
    const name = validateName(c.args.name)
    const universalResolverAddress = c.options.universalResolver as `0x${string}` | undefined
    const value = await getEnsText(client, {
      name,
      key: c.args.key,
      ...(universalResolverAddress ? { universalResolverAddress } : {}),
    })
    return { name, key: c.args.key, value }
  },
}

export const avatarCommand = {
  description: 'Get the avatar URL for an ENS name',
  args: z.object({
    name: z.string().describe('ENS name (e.g. vitalik.eth)'),
  }),
  options: globalOptions,
  env: globalEnv,
  async run(c: any) {
    const { client } = clientFromContext(c)
    const name = validateName(c.args.name)
    const universalResolverAddress = c.options.universalResolver as `0x${string}` | undefined
    const avatar = await getEnsAvatar(client, {
      name,
      ...(universalResolverAddress ? { universalResolverAddress } : {}),
    })
    return { name, avatar }
  },
}
