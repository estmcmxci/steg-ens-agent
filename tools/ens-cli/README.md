# ENS CLI

> [!WARNING]
> This is an unofficial ENS tool. It's experimental and will have frequent breaking changes.

A command-line tool for interacting with ENS (Ethereum Name Service). Built for autonomous AI agents but works for humans too.

The CLI handles two categories of operations:

- **Read operations** (resolution, availability, pricing) execute directly and return results.
- **Write operations** (registration, renewal, record setting) output unsigned calldata as JSON (`{to, data, value}`) for the caller to sign and broadcast.

Built with [Incur](https://github.com/wevm/incur) for agent-native features (MCP server mode, skills, token-efficient output) and [viem](https://viem.sh) for ENS resolution with full CCIP-read support.

## Install preview build

```sh
alias ens='npx "https://pkg.pr.new/gskril/ens-cli/@ensdomains/cli@main"'
ens
```

Replace `COMMIT_HASH` with a recent commit hash. This creates a temporary `ens` alias for the current shell session. To make it permanent, add the line to your `~/.zshrc` or `~/.bashrc`.

To update to a newer commit, change the hash in the alias. To remove stale versions, clear your npx cache:

```sh
npx clear-npx-cache
```

## Commands

### Resolution

```sh
# Forward resolve a name to an address
ens resolve vitalik.eth
ens resolve vitalik.eth --coin-type 0  # BTC address

# Reverse resolve an address to a name
ens reverse 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# Get a text record
ens text vitalik.eth url
ens text vitalik.eth com.twitter

# Get avatar URL
ens avatar vitalik.eth

# Show owner, resolver, and expiry for a .eth name
ens whois vitalik.eth
```

### Availability & Pricing

```sh
# Check if a name is available
ens available myname.eth

# Check registration/renewal cost
ens price myname.eth
ens price myname.eth --duration 63072000  # 2 years
```

### Registration (commit/reveal)

Registration is a two-step process. Both commands output calldata JSON.

```sh
# Step 1: Generate commit transaction
ens register commit myname.eth 0xYourAddress --json
# Returns: { to, data, value, secret, ... }
# SAVE THE SECRET — you need it for step 2

# Step 2: Wait 60+ seconds after commit is mined, then generate register transaction
ens register reveal myname.eth 0xYourAddress \
  --secret 0x... \
  --value 2307947853431408 \
  --json
# Returns: { to, data, value }
```

Options for both commands: `--duration` (seconds, default 1 year), `--resolver`, `--reverse-record`.

### Renewal

```sh
# Check cost first
ens price myname.eth

# Generate renewal calldata
ens renew myname.eth --value 2307947853431408 --json
```

### Subnames

Generate calldata to create a subname under a parent you own. The command first reads the parent's onchain owner — if there is no owner, no calldata can be generated. If the parent is wrapped in the NameWrapper, the calldata targets the NameWrapper instead of the registry.

```sh
# Create a subname under an unwrapped parent (registry.setSubnodeRecord)
ens subname create sub.parent.eth 0xNewOwner

# Create a subname under a wrapped parent (NameWrapper.setSubnodeRecord)
ens subname create sub.wrapped.eth 0xNewOwner --fuses 0 --expiry 0

# Custom resolver
ens subname create sub.parent.eth 0xNewOwner --resolver 0x...
```

Options: `--resolver` (defaults to chain public resolver), `--fuses` and `--expiry` (NameWrapper only, both default to 0).

### Setting Records

All set commands output calldata JSON targeting the public resolver.

```sh
# Set address record
ens set address myname.eth 0x1234...
ens set address myname.eth 0x1234... --coin-type 0  # BTC

# Set text record
ens set text myname.eth url https://example.com
ens set text myname.eth com.twitter @myhandle

# Set content hash
ens set contenthash myname.eth 0x...

# Batch set multiple records (multicall)
ens set batch myname.eth --data '[
  {"type": "text", "key": "url", "value": "https://example.com"},
  {"type": "text", "key": "com.twitter", "value": "@myhandle"},
  {"type": "address", "address": "0x1234...", "coinType": 60}
]'
```

## Configuration

**RPC endpoint** (in order of precedence):

1. `--rpc <url>` flag
2. `ETH_RPC_URL` environment variable
3. Public fallback RPCs

**Chain selection:**

```sh
ens resolve vitalik.eth --chain mainnet  # default
ens resolve vitalik.eth --chain sepolia
```

**Output format:**

```sh
ens resolve vitalik.eth --json
ens resolve vitalik.eth --format yaml
```

## Agent Integration

The CLI has built-in support for AI agent discovery:

```sh
# View the LLM-readable command manifest
ens --llms

# Register as an MCP server
ens mcp add

# Generate skill files for agents
ens skills add

# Run in MCP stdio mode
ens --mcp
```

## Contributing

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Setup

```sh
git clone https://github.com/ensdomains/cli.git
cd cli
bun install
```

### Running locally

```sh
# Run any command directly
bun src/index.ts resolve vitalik.eth

# With a custom RPC
bun src/index.ts resolve vitalik.eth --rpc http://localhost:8545

# With environment variable
ETH_RPC_URL=http://localhost:8545 bun src/index.ts available myname.eth
```

### Project structure

```
src/
├── index.ts            # Entry point
├── cli.ts              # CLI definition, command mounting
├── lib/
│   ├── client.ts       # viem public client with fallback transports
│   └── contracts.ts    # ABIs and contract addresses
└── commands/
    ├── resolve.ts      # resolve, reverse, text, avatar
    ├── whois.ts        # owner, resolver, expiry lookup
    ├── available.ts    # Name availability check
    ├── price.ts        # Registration/renewal pricing
    ├── register.ts     # commit + reveal (nested group)
    ├── renew.ts        # Renewal calldata
    ├── set.ts          # address, text, contenthash, batch (nested group)
    └── subname.ts      # create (nested group)
```

### Adding a command

1. Create a command file in `src/commands/` exporting a function that returns a command definition (for flat commands) or a `Cli.create()` group (for nested subcommands).
2. Mount it in `src/cli.ts` via `.command()`.
3. Test against mainnet or a local fork: `bun src/index.ts <your-command>`.
