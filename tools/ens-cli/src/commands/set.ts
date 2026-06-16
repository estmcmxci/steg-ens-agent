import { Cli, z } from 'incur'
import { encodeFunctionData } from 'viem/utils'
import { namehash } from 'viem/ens'
import { validateName } from '../lib/utils.ts'
import { publicResolverAbi, addresses } from '../lib/contracts.ts'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { resolveCoinType } from '../lib/cointype.ts'

type BatchOperation =
  | { type: 'address'; address: string; coinType?: number; chainId?: number }
  | { type: 'text'; key: string; value: string }
  | { type: 'contenthash'; hash: string }

function encodeSetAddr(node: `0x${string}`, address: string, coinType?: number): `0x${string}` {
  if (coinType != null) {
    return encodeFunctionData({
      abi: publicResolverAbi,
      functionName: 'setAddr',
      args: [node, BigInt(coinType), address as `0x${string}`],
    })
  }
  return encodeFunctionData({
    abi: publicResolverAbi,
    functionName: 'setAddr',
    args: [node, address as `0x${string}`],
  })
}

function encodeSetText(node: `0x${string}`, key: string, value: string): `0x${string}` {
  return encodeFunctionData({
    abi: publicResolverAbi,
    functionName: 'setText',
    args: [node, key, value],
  })
}

function encodeSetContenthash(node: `0x${string}`, hash: string): `0x${string}` {
  return encodeFunctionData({
    abi: publicResolverAbi,
    functionName: 'setContenthash',
    args: [node, hash as `0x${string}`],
  })
}

function encodeBatchOperation(node: `0x${string}`, op: BatchOperation): `0x${string}` {
  switch (op.type) {
    case 'address':
      return encodeSetAddr(node, op.address, resolveCoinType(op))
    case 'text':
      return encodeSetText(node, op.key, op.value)
    case 'contenthash':
      return encodeSetContenthash(node, op.hash)
  }
}

export const setCommands = Cli.create('set', {
  description: 'Set ENS records (outputs calldata JSON)',
})
  .command('address', {
    description: 'Generate calldata to set the address record for an ENS name',
    args: z.object({
      name: z.string().describe('ENS name (e.g. myname.eth)'),
      address: z.string().describe('Address to set'),
    }),
    options: globalOptions.merge(
      z.object({
        coinType: z.coerce
          .number()
          .optional()
          .describe('ENSIP-9 coin type (e.g. 0 for BTC, 60 for ETH)'),
        chainId: z.coerce
          .number()
          .optional()
          .describe('EVM chain ID — auto-converts to ENSIP-9 coin type (e.g. 10 for Optimism)'),
      }),
    ),
    env: globalEnv,
    alias: { coinType: 'c', chainId: 'i' },
    async run(c) {
      const { chain } = clientFromContext(c)
      const resolverAddress = addresses[chain].resolver
      const node = namehash(validateName(c.args.name))
      const coinType = resolveCoinType(c.options)
      const data = encodeSetAddr(node, c.args.address, coinType)
      return { to: resolverAddress, data, value: '0' }
    },
  })
  .command('text', {
    description: 'Generate calldata to set a text record for an ENS name',
    args: z.object({
      name: z.string().describe('ENS name (e.g. myname.eth)'),
      key: z.string().describe('Text record key (e.g. com.twitter, url)'),
      value: z.string().describe('Text record value'),
    }),
    options: globalOptions,
    env: globalEnv,
    async run(c) {
      const { chain } = clientFromContext(c)
      const resolverAddress = addresses[chain].resolver
      const node = namehash(validateName(c.args.name))
      const data = encodeSetText(node, c.args.key, c.args.value)
      return { to: resolverAddress, data, value: '0' }
    },
  })
  .command('contenthash', {
    description: 'Generate calldata to set the content hash for an ENS name',
    args: z.object({
      name: z.string().describe('ENS name (e.g. myname.eth)'),
      hash: z.string().describe('Content hash in hex (EIP-1577 encoded)'),
    }),
    options: globalOptions,
    env: globalEnv,
    async run(c) {
      const { chain } = clientFromContext(c)
      const resolverAddress = addresses[chain].resolver
      const node = namehash(validateName(c.args.name))
      const data = encodeSetContenthash(node, c.args.hash)
      return { to: resolverAddress, data, value: '0' }
    },
  })
  .command('batch', {
    description:
      'Generate multicall calldata to set multiple records in a single transaction. Pass a JSON array of operations.',
    args: z.object({
      name: z.string().describe('ENS name (e.g. myname.eth)'),
    }),
    options: globalOptions.merge(
      z.object({
        data: z
          .string()
          .describe(
            'JSON array of operations: [{"type":"text","key":"url","value":"https://..."},{"type":"address","address":"0x...","chainId":10},{"type":"address","address":"0x...","coinType":0},{"type":"contenthash","hash":"0x..."}]',
          ),
      }),
    ),
    env: globalEnv,
    async run(c) {
      const { chain } = clientFromContext(c)
      const resolverAddress = addresses[chain].resolver
      const node = namehash(validateName(c.args.name))
      const operations: BatchOperation[] = JSON.parse(c.options.data)
      const calls = operations.map((op) => encodeBatchOperation(node, op))

      const data = encodeFunctionData({
        abi: publicResolverAbi,
        functionName: 'multicall',
        args: [calls],
      })

      return { to: resolverAddress, data, value: '0' }
    },
  })
