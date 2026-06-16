import { Cli } from 'incur'
import { resolveCommand, reverseCommand, textCommand, avatarCommand } from './commands/resolve.ts'
import { availableCommand } from './commands/available.ts'
import { priceCommand } from './commands/price.ts'
import { registerCommands } from './commands/register.ts'
import { renewCommand } from './commands/renew.ts'
import { setCommands } from './commands/set.ts'
import { subnameCommands } from './commands/subname.ts'
import { whoisCommand } from './commands/whois.ts'

export const cli = Cli.create('ens', {
  version: '0.1.0',
  description:
    'ENS CLI for resolving names, checking availability, generating registration and record-setting calldata. Designed for autonomous agents. Use --rpc <url> or ETH_RPC_URL env var to set the RPC endpoint. Use --chain mainnet|sepolia to select the network.',
})
  // Resolution
  .command('resolve', resolveCommand)
  .command('reverse', reverseCommand)
  .command('text', textCommand)
  .command('avatar', avatarCommand)
  // Queries
  .command('available', availableCommand)
  .command('price', priceCommand)
  .command('whois', whoisCommand)
  // Write operations (calldata output)
  .command('renew', renewCommand)
  .command(registerCommands)
  .command(setCommands)
  .command(subnameCommands)
