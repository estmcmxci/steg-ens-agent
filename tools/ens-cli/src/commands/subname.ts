import { Cli, z } from 'incur'
import { encodeFunctionData, isAddressEqual } from 'viem/utils'
import { labelhash, namehash } from 'viem/ens'
import { addresses, ensRegistryAbi, nameWrapperAbi } from '../lib/contracts.ts'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { validateName } from '../lib/utils.ts'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const TTL = 0n

function splitSubname(name: string): { label: string; parent: string } {
  const dot = name.indexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    throw new Error(
      `"${name}" is not a subname. Expected at least one label under a parent (e.g. sub.parent.eth).`,
    )
  }
  return { label: name.slice(0, dot), parent: name.slice(dot + 1) }
}

export const subnameCommands = Cli.create('subname', {
  description: 'Create and manage ENS subnames',
}).command('create', {
  description:
    'Generate calldata to create a subname. Reads the parent owner first — if the parent has no onchain owner, a subname cannot be created via onchain contracts. If the parent is wrapped in the NameWrapper, generates calldata for the NameWrapper instead of the registry.',
  args: z.object({
    name: z.string().describe('Full subname to create (e.g. sub.parent.eth)'),
    owner: z.string().describe('Address that will own the new subname'),
  }),
  options: globalOptions.merge(
    z.object({
      resolver: z
        .string()
        .optional()
        .describe('Resolver address for the subname (defaults to chain public resolver)'),
      fuses: z.coerce
        .number()
        .optional()
        .describe(
          'NameWrapper fuses bitmask for the new subname (default: 0). Ignored when the parent is unwrapped.',
        ),
      expiry: z.coerce
        .number()
        .optional()
        .describe(
          'NameWrapper expiry as a unix timestamp for the new subname (default: 0). Ignored when the parent is unwrapped.',
        ),
    }),
  ),
  env: globalEnv,
  alias: { resolver: 'r' },
  async run(c) {
    const { client, chain } = clientFromContext(c)
    const registryAddress = addresses[chain].registry
    const nameWrapperAddress = addresses[chain].nameWrapper
    const name = validateName(c.args.name)
    const { label, parent } = splitSubname(name)
    const parentNode = namehash(parent)

    const parentRegistryOwner = await client.readContract({
      address: registryAddress,
      abi: ensRegistryAbi,
      functionName: 'owner',
      args: [parentNode],
    })

    if (parentRegistryOwner === ZERO_ADDRESS) {
      throw new Error(
        `Parent "${parent}" has no owner in the ENS registry, so a subname cannot be created via onchain contracts.`,
      )
    }

    const owner = c.args.owner as `0x${string}`
    const resolver = (c.options.resolver ?? addresses[chain].resolver) as `0x${string}`
    const labelHash = labelhash(label)
    const node = namehash(name)
    const isWrapped = isAddressEqual(parentRegistryOwner, nameWrapperAddress)

    if (isWrapped) {
      const wrappedOwner = await client.readContract({
        address: nameWrapperAddress,
        abi: nameWrapperAbi,
        functionName: 'ownerOf',
        args: [BigInt(parentNode)],
      })

      if (wrappedOwner === ZERO_ADDRESS) {
        throw new Error(
          `Parent "${parent}" is owned by the NameWrapper but has no wrapped owner (likely expired). A subname cannot be created.`,
        )
      }

      const fuses = c.options.fuses ?? 0
      const expiry = BigInt(c.options.expiry ?? 0)

      const data = encodeFunctionData({
        abi: nameWrapperAbi,
        functionName: 'setSubnodeRecord',
        args: [parentNode, label, owner, resolver, TTL, fuses, expiry],
      })

      return {
        to: nameWrapperAddress,
        data,
        name,
        parent,
        label,
        parentNode,
        labelHash,
        node,
        parentOwner: wrappedOwner,
        parentRegistryOwner,
        wrapped: true,
        owner,
        resolver,
        fuses,
        expiry: expiry.toString(),
        note: 'Parent is wrapped — call NameWrapper.setSubnodeRecord. Transaction must be sent from the wrapped owner (or an approved operator).',
      }
    }

    const data = encodeFunctionData({
      abi: ensRegistryAbi,
      functionName: 'setSubnodeRecord',
      args: [parentNode, labelHash, owner, resolver, TTL],
    })

    return {
      to: registryAddress,
      data,
      name,
      parent,
      label,
      parentNode,
      labelHash,
      node,
      parentOwner: parentRegistryOwner,
      wrapped: false,
      owner,
      resolver,
      note: 'Transaction must be sent from the parent owner. If the parent owner above is a contract (e.g. a multisig), call it through that contract.',
    }
  },
})
