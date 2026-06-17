/**
 * ABI Definitions
 *
 * Copied from CLI src/utils/contracts.ts — all ABI `as const` arrays.
 */

export const REGISTRY_ABI = [
	{
		name: "resolver",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "address" }],
	},
	{
		name: "owner",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "address" }],
	},
	{
		name: "setSubnodeRecord",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "parentNode", type: "bytes32" },
			{ name: "labelHash", type: "bytes32" },
			{ name: "owner", type: "address" },
			{ name: "resolver", type: "address" },
			{ name: "ttl", type: "uint64" },
		],
		outputs: [],
	},
	{
		name: "setOwner",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "node", type: "bytes32" },
			{ name: "owner", type: "address" },
		],
		outputs: [],
	},
] as const;

export const RESOLVER_ABI = [
	{
		name: "addr",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "address" }],
	},
	{
		name: "text",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "node", type: "bytes32" },
			{ name: "key", type: "string" },
		],
		outputs: [{ type: "string" }],
	},
	{
		name: "name",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "string" }],
	},
	{
		name: "setAddr",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "node", type: "bytes32" },
			{ name: "addr", type: "address" },
		],
		outputs: [],
	},
	{
		name: "setText",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "node", type: "bytes32" },
			{ name: "key", type: "string" },
			{ name: "value", type: "string" },
		],
		outputs: [],
	},
	{
		name: "multicall",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "data", type: "bytes[]" }],
		outputs: [{ name: "results", type: "bytes[]" }],
	},
	{
		name: "addr",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "node", type: "bytes32" },
			{ name: "coinType", type: "uint256" },
		],
		outputs: [{ type: "bytes" }],
	},
	{
		name: "contenthash",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "node", type: "bytes32" }],
		outputs: [{ type: "bytes" }],
	},
] as const;

const REGISTRAR_CONTROLLER_COMMON_ABI = [
	{
		name: "available",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "name", type: "string" }],
		outputs: [{ type: "bool" }],
	},
	{
		name: "rentPrice",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "name", type: "string" },
			{ name: "duration", type: "uint256" },
		],
		outputs: [
			{
				name: "price",
				type: "tuple",
				components: [
					{ name: "base", type: "uint256" },
					{ name: "premium", type: "uint256" },
				],
			},
		],
	},
	{
		name: "commit",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "commitment", type: "bytes32" }],
		outputs: [],
	},
	{
		name: "minCommitmentAge",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint256" }],
	},
	{
		name: "maxCommitmentAge",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint256" }],
	},
] as const;

export const REGISTRAR_CONTROLLER_ABI = REGISTRAR_CONTROLLER_COMMON_ABI;

export const REGISTRAR_CONTROLLER_ABI_V3 = [
	...REGISTRAR_CONTROLLER_COMMON_ABI,
	{
		name: "makeCommitment",
		type: "function",
		stateMutability: "pure",
		inputs: [
			{ name: "name", type: "string" },
			{ name: "owner", type: "address" },
			{ name: "duration", type: "uint256" },
			{ name: "secret", type: "bytes32" },
			{ name: "resolver", type: "address" },
			{ name: "data", type: "bytes[]" },
			{ name: "reverseRecord", type: "bool" },
			{ name: "ownerControlledFuses", type: "uint16" },
		],
		outputs: [{ type: "bytes32" }],
	},
	{
		name: "register",
		type: "function",
		stateMutability: "payable",
		inputs: [
			{ name: "name", type: "string" },
			{ name: "owner", type: "address" },
			{ name: "duration", type: "uint256" },
			{ name: "secret", type: "bytes32" },
			{ name: "resolver", type: "address" },
			{ name: "data", type: "bytes[]" },
			{ name: "reverseRecord", type: "bool" },
			{ name: "ownerControlledFuses", type: "uint16" },
		],
		outputs: [],
	},
	{
		name: "renew",
		type: "function",
		stateMutability: "payable",
		inputs: [
			{ name: "name", type: "string" },
			{ name: "duration", type: "uint256" },
		],
		outputs: [],
	},
] as const;

const REGISTRATION_TUPLE = {
	name: "registration",
	type: "tuple",
	components: [
		{ name: "label", type: "string" },
		{ name: "owner", type: "address" },
		{ name: "duration", type: "uint256" },
		{ name: "secret", type: "bytes32" },
		{ name: "resolver", type: "address" },
		{ name: "data", type: "bytes[]" },
		{ name: "reverseRecord", type: "uint8" },
		{ name: "referrer", type: "bytes32" },
	],
} as const;

export const REGISTRAR_CONTROLLER_ABI_V4 = [
	...REGISTRAR_CONTROLLER_COMMON_ABI,
	{
		name: "makeCommitment",
		type: "function",
		stateMutability: "pure",
		inputs: [REGISTRATION_TUPLE],
		outputs: [{ type: "bytes32" }],
	},
	{
		name: "register",
		type: "function",
		stateMutability: "payable",
		inputs: [REGISTRATION_TUPLE],
		outputs: [],
	},
	{
		name: "renew",
		type: "function",
		stateMutability: "payable",
		inputs: [
			{ name: "label", type: "string" },
			{ name: "duration", type: "uint256" },
			{ name: "referrer", type: "bytes32" },
		],
		outputs: [],
	},
] as const;

export const REVERSE_REGISTRAR_ABI = [
	{
		name: "node",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "addr", type: "address" }],
		outputs: [{ type: "bytes32" }],
	},
	{
		name: "setName",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "name", type: "string" }],
		outputs: [{ type: "bytes32" }],
	},
	{
		name: "setNameForAddr",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "addr", type: "address" },
			{ name: "owner", type: "address" },
			{ name: "resolver", type: "address" },
			{ name: "name", type: "string" },
		],
		outputs: [{ type: "bytes32" }],
	},
] as const;

export const BASE_REGISTRAR_ABI = [
	{
		name: "safeTransferFrom",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "from", type: "address" },
			{ name: "to", type: "address" },
			{ name: "tokenId", type: "uint256" },
		],
		outputs: [],
	},
	{
		name: "ownerOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "tokenId", type: "uint256" }],
		outputs: [{ type: "address" }],
	},
] as const;

/**
 * Get the correct registrar controller ABI for the chain.
 * Mainnet (chainId 1) uses v3, everything else uses v4.
 */
export function getRegistrarControllerAbi(chainId: number) {
	return chainId === 1
		? REGISTRAR_CONTROLLER_ABI_V3
		: REGISTRAR_CONTROLLER_ABI_V4;
}
