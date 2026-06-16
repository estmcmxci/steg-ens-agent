import { z } from 'incur'
import { bytesToHex } from 'viem/utils'
import { labelhash, namehash, packetToBytes } from 'viem/ens'
import { globalOptions, globalEnv, clientFromContext, isV2Active } from '../lib/context.ts'
import {
  addresses,
  baseRegistrarAbi,
  ensRegistryAbi,
  universalResolverAbi,
  v2RegistryAbi,
} from '../lib/contracts.ts'
import { validateName } from '../lib/utils.ts'

function toNullableAddress(value: `0x${string}`) {
  const zeroAddress = '0x0000000000000000000000000000000000000000'
  return value === zeroAddress ? null : value
}

const statusLabels = ['AVAILABLE', 'RESERVED', 'REGISTERED'] as const

function mapStatus(status: number | bigint) {
  return statusLabels[Number(status)] ?? 'UNKNOWN'
}

function getExpiryDetails(name: string, expiry: bigint) {
  if (expiry === 0n) return { expiry: null, expiryDate: null }

  const [label, tld, ...rest] = name.split('.')
  if (!label || tld !== 'eth' || rest.length > 0) {
    return { expiry: null, expiryDate: null }
  }

  return {
    expiry,
    expiryDate: new Date(Number(expiry) * 1000).toISOString(),
  }
}

export const whoisCommand = {
  description: 'Show ENS registry owner, resolver, and .eth expiry for a name',
  args: z.object({
    name: z.string().describe('ENS name to inspect (e.g. vitalik.eth)'),
  }),
  options: globalOptions,
  env: globalEnv,
  async run(c: any) {
    const { client, chain } = clientFromContext(c)
    const universalResolverAddress = c.options.universalResolver as `0x${string}` | undefined
    const { isV2, ethRegistry } = await isV2Active(c, universalResolverAddress)
    const name = validateName(c.args.name)
    const node = namehash(name)

    if (isV2) {
      // TODO: handle non-2LD .eth names
      const labels = name.split('.')
      if (labels.length !== 2 || labels[1] !== 'eth') {
        throw new Error(`v2 whois only supports 2LD .eth names for now`)
      }
      const label = labels[0]!

      const { resolver } = await client.readContract({
        address: universalResolverAddress ?? addresses[chain].universalResolver,
        abi: universalResolverAbi,
        functionName: 'findResolver',
        args: [bytesToHex(packetToBytes(name))],
      })

      const { status, expiry, latestOwner, tokenId, resource } = await client.readContract({
        address: ethRegistry,
        abi: v2RegistryAbi,
        functionName: 'getState',
        args: [BigInt(labelhash(label))],
      })

      const owner = await client.readContract({
        address: ethRegistry,
        abi: v2RegistryAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      })

      return {
        name,
        owner: toNullableAddress(owner),
        resolver: toNullableAddress(resolver),
        registry: ethRegistry,
        status: mapStatus(status),
        ...getExpiryDetails(name, expiry),
        latestOwner: toNullableAddress(latestOwner),
        tokenId,
        resource,
      }
    }

    const [owner, resolver] = await Promise.all([
      client.readContract({
        address: addresses[chain].registry,
        abi: ensRegistryAbi,
        functionName: 'owner',
        args: [node],
      }),
      client.readContract({
        address: addresses[chain].registry,
        abi: ensRegistryAbi,
        functionName: 'resolver',
        args: [node],
      }),
    ])

    let expiry: bigint | null = null
    const [label, tld, ...rest] = name.split('.')
    if (label && tld === 'eth' && rest.length === 0) {
      expiry = await client.readContract({
        address: addresses[chain].baseRegistrar,
        abi: baseRegistrarAbi,
        functionName: 'nameExpires',
        args: [BigInt(labelhash(label))],
      })
    }

    return {
      name,
      owner: toNullableAddress(owner),
      resolver: toNullableAddress(resolver),
      ...getExpiryDetails(name, expiry ?? 0n),
    }
  },
}
