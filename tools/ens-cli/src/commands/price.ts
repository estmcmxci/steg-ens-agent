import { z } from 'incur'
import { formatEther } from 'viem/utils'
import { ethRegistrarControllerAbi, addresses } from '../lib/contracts.ts'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { extractLabel } from '../lib/utils.ts'

const ONE_YEAR = 31536000n

export const priceCommand = {
  description:
    'Check the registration or renewal cost for an ENS name. Returns a bufferedTotal (with 5% buffer) to use as the transaction value. IMPORTANT: Always fetch price immediately before sending the register/renew transaction, not earlier, because ENS prices are denominated in USD but paid in ETH, so the required ETH amount changes with the ETH/USD price.',
  args: z.object({
    name: z.string().describe('ENS name to price (e.g. myname.eth)'),
  }),
  options: globalOptions.merge(
    z.object({
      duration: z.coerce
        .number()
        .optional()
        .describe('Registration duration in seconds (default: 31536000 = 1 year)'),
    }),
  ),
  env: globalEnv,
  alias: { duration: 'd' },
  async run(c: any) {
    const { client, chain } = clientFromContext(c)
    const label = extractLabel(c.args.name)
    const duration = c.options.duration != null ? BigInt(c.options.duration) : ONE_YEAR
    const price = await client.readContract({
      address: addresses[chain].controller,
      abi: ethRegistrarControllerAbi,
      functionName: 'rentPrice',
      args: [label, duration],
    })
    const total = price.base + price.premium
    const buffered = total + total / 20n // 5% buffer for ETH price changes
    return {
      name: c.args.name,
      label,
      duration: duration.toString(),
      base: price.base.toString(),
      premium: price.premium.toString(),
      total: total.toString(),
      totalEth: formatEther(total),
      bufferedTotal: buffered.toString(),
      bufferedTotalEth: formatEther(buffered),
      note: 'bufferedTotal includes a 5% buffer to account for ETH price fluctuations. Use bufferedTotal as the value for register/renew transactions. Any excess ETH is refunded by the contract.',
    }
  },
}
