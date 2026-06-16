import { z } from 'incur'
import { encodeFunctionData } from 'viem/utils'
import { ethRegistrarControllerAbi, addresses } from '../lib/contracts.ts'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { extractLabel } from '../lib/utils.ts'

const ONE_YEAR = 31536000n
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export const renewCommand = {
  description:
    'Generate renewal transaction calldata for an ENS name. Requires a value (in wei) from the price command. IMPORTANT: Always fetch price immediately before sending this transaction, not earlier, because the required ETH amount changes with the ETH/USD price.',
  args: z.object({
    name: z.string().describe('ENS name to renew (e.g. myname.eth)'),
  }),
  options: globalOptions.merge(
    z.object({
      value: z
        .string()
        .describe(
          'ETH value in wei to send (use bufferedTotal from ens price, fetched immediately before this step)',
        ),
      duration: z.coerce
        .number()
        .optional()
        .describe('Renewal duration in seconds (default: 31536000 = 1 year)'),
    }),
  ),
  env: globalEnv,
  alias: { duration: 'd', value: 'v' },
  async run(c: any) {
    const { chain } = clientFromContext(c)
    const controllerAddress = addresses[chain].controller
    const label = extractLabel(c.args.name)
    const duration = c.options.duration != null ? BigInt(c.options.duration) : ONE_YEAR

    const data = encodeFunctionData({
      abi: ethRegistrarControllerAbi,
      functionName: 'renew',
      args: [label, duration, ZERO_BYTES32],
    })

    return {
      to: controllerAddress,
      data,
      value: c.options.value,
      name: c.args.name,
      label,
      duration: duration.toString(),
    }
  },
}
