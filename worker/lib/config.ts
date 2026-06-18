/**
 * Network config, contract addresses, and Worker-compatible client factory.
 *
 * Adapted from CLI src/config/deployments.ts — removes process.env,
 * adds Cloudflare Worker Env type and createPublicClient.
 */

import { createPublicClient as viemCreatePublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";

export type NetworkConfig = {
	chainId: number;
	parentDomain: string;
	registry: `0x${string}`;
	resolver: `0x${string}`;
	registrarController: `0x${string}`;
	baseRegistrar: `0x${string}`;
	nameWrapper: `0x${string}`;
	reverseRegistrar: `0x${string}`;
	universalResolver: `0x${string}`;
	ensNodeSubgraph: string;
	rpcUrl: string;
	explorerUrl: string;
	/** adapter8004 proxy — ERC-8004 identity binding (mainnet only for now). */
	adapter8004?: `0x${string}`;
	/** ERC-8004 Identity Registry (CAIP-10 source for card registrations). */
	identityRegistry?: `0x${string}`;
};

export const ENS_DEPLOYMENTS: Record<string, NetworkConfig> = {
	mainnet: {
		chainId: 1,
		parentDomain: "eth",
		registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
		resolver: "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63",
		registrarController: "0x253553366Da8546fC250F225fe3d25d0C782303b",
		baseRegistrar: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
		nameWrapper: "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401",
		reverseRegistrar: "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb",
		universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
		ensNodeSubgraph: "https://api.alpha.ensnode.io/subgraph",
		rpcUrl: "https://eth.drpc.org",
		explorerUrl: "https://etherscan.io",
		adapter8004: "0xde152AfB7db5373F34876E1499fbD893A82dD336",
		identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
	},
	sepolia: {
		chainId: 11155111,
		parentDomain: "eth",
		registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
		resolver: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5",
		registrarController: "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968",
		baseRegistrar: "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85",
		nameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
		reverseRegistrar: "0xA0a1AbcDAe1a2a4A2EF8e9113Ff0e02DD81DC0C6",
		universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
		ensNodeSubgraph: "https://api.alpha-sepolia.ensnode.io/subgraph",
		rpcUrl: "https://sepolia.drpc.org",
		explorerUrl: "https://sepolia.etherscan.io",
		// adapter8004 not deployed/used on sepolia here; registry for reference only.
		identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
	},
};

export const DEFAULT_NETWORK = "sepolia";

export function getNetworkConfig(network?: string): NetworkConfig {
	const net = network || DEFAULT_NETWORK;
	const config = ENS_DEPLOYMENTS[net];
	if (!config) {
		throw new Error(
			`Unknown network: ${net}. Available: ${Object.keys(ENS_DEPLOYMENTS).join(", ")}`,
		);
	}
	return config;
}

/** Cloudflare Worker environment bindings */
export type Env = {
	ENS_SESSIONS: KVNamespace;
	ETH_RPC_URL_SEPOLIA: string;
	ETH_RPC_URL_MAINNET: string;
	API_KEY: string;
	/** Verifier: optional Universal Resolver override (read-side entrypoint). */
	ENS_UNIVERSAL_RESOLVER?: string;
	/** Verifier: Tier-1 fleet envelope name (the operator/MARP ceiling). */
	STEG_FLEET_NAME?: string;
};

const CHAINS: Record<number, typeof mainnet | typeof sepolia> = {
	1: mainnet,
	11155111: sepolia,
};

/**
 * Create a viem PublicClient using the RPC URL from Worker env bindings.
 */
export function createPublicClient(network: string, env: Env) {
	const config = getNetworkConfig(network);
	const rpcUrl =
		config.chainId === 1
			? env.ETH_RPC_URL_MAINNET
			: env.ETH_RPC_URL_SEPOLIA;

	return viemCreatePublicClient({
		chain: CHAINS[config.chainId] || sepolia,
		transport: http(rpcUrl),
	});
}
