import { z } from 'incur'
import { ethRegistrarControllerAbi, addresses } from '../lib/contracts.ts'
import { globalOptions, globalEnv, clientFromContext } from '../lib/context.ts'
import { extractLabel } from '../lib/utils.ts'

export const availableCommand = {
  description: 'Check if an ENS name is available for registration',
  args: z.object({
    name: z.string().describe('ENS name to check (e.g. myname.eth)'),
  }),
  options: globalOptions,
  env: globalEnv,
  async run(c: any) {
    const { client, chain } = clientFromContext(c)
    const label = extractLabel(c.args.name)
    const available = await client.readContract({
      address: addresses[chain].controller,
      abi: ethRegistrarControllerAbi,
      functionName: 'available',
      args: [label],
    })
    return { name: c.args.name, label, available }
  },
}
