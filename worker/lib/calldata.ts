/**
 * Pure Calldata Builders
 *
 * All functions return { to, data, value } — zero RPC calls.
 * Extracted from CLI write operations in contracts.ts.
 */

import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import type { NetworkConfig } from "./config";
import {
	REGISTRAR_CONTROLLER_ABI_V3,
	REGISTRAR_CONTROLLER_ABI_V4,
	REGISTRAR_CONTROLLER_ABI,
	RESOLVER_ABI,
	BASE_REGISTRAR_ABI,
	REVERSE_REGISTRAR_ABI,
	REGISTRY_ABI,
} from "./abi";

export type UnsignedTx = {
	to: Address;
	data: Hex;
	value: string;
};

/**
 * Build calldata for commit(bytes32 commitment)
 */
export function buildCommitCalldata(
	commitment: `0x${string}`,
	config: NetworkConfig,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: REGISTRAR_CONTROLLER_ABI,
		functionName: "commit",
		args: [commitment],
	});

	return {
		to: config.registrarController,
		data,
		value: "0",
	};
}

/**
 * Build calldata for register — V3/V4 branching based on chainId.
 */
export function buildRegisterCalldata(
	label: string,
	owner: Address,
	duration: bigint,
	secret: `0x${string}`,
	resolver: Address,
	resolverData: `0x${string}`[],
	reverseRecord: boolean,
	value: bigint,
	config: NetworkConfig,
): UnsignedTx {
	const isV4 = config.chainId !== 1;

	let data: Hex;
	if (isV4) {
		data = encodeFunctionData({
			abi: REGISTRAR_CONTROLLER_ABI_V4,
			functionName: "register",
			args: [
				{
					label,
					owner,
					duration,
					secret,
					resolver,
					data: resolverData,
					reverseRecord: reverseRecord ? 1 : 0,
					referrer:
						"0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
				},
			],
		});
	} else {
		data = encodeFunctionData({
			abi: REGISTRAR_CONTROLLER_ABI_V3,
			functionName: "register",
			args: [
				label,
				owner,
				duration,
				secret,
				resolver,
				resolverData,
				reverseRecord,
				0,
			],
		});
	}

	return {
		to: config.registrarController,
		data,
		value: value.toString(),
	};
}

/**
 * Build calldata for renew — V3: 2 args, V4: 3 args (+ referrer).
 */
export function buildRenewCalldata(
	label: string,
	duration: bigint,
	value: bigint,
	config: NetworkConfig,
): UnsignedTx {
	const isV4 = config.chainId !== 1;

	let data: Hex;
	if (isV4) {
		data = encodeFunctionData({
			abi: REGISTRAR_CONTROLLER_ABI_V4,
			functionName: "renew",
			args: [
				label,
				duration,
				"0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
			],
		});
	} else {
		data = encodeFunctionData({
			abi: REGISTRAR_CONTROLLER_ABI_V3,
			functionName: "renew",
			args: [label, duration],
		});
	}

	return {
		to: config.registrarController,
		data,
		value: value.toString(),
	};
}

/**
 * Build calldata for ERC-721 safeTransferFrom.
 */
export function buildTransferCalldata(
	from: Address,
	to: Address,
	tokenId: bigint,
	config: NetworkConfig,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: BASE_REGISTRAR_ABI,
		functionName: "safeTransferFrom",
		args: [from, to, tokenId],
	});

	return {
		to: config.baseRegistrar,
		data,
		value: "0",
	};
}

/**
 * Build calldata for setText on a resolver.
 */
export function buildSetTextCalldata(
	node: `0x${string}`,
	key: string,
	value: string,
	resolver: Address,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: RESOLVER_ABI,
		functionName: "setText",
		args: [node, key, value],
	});

	return { to: resolver, data, value: "0" };
}

/**
 * Build calldata for setAddr on a resolver.
 */
export function buildSetAddrCalldata(
	node: `0x${string}`,
	address: Address,
	resolver: Address,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: RESOLVER_ABI,
		functionName: "setAddr",
		args: [node, address],
	});

	return { to: resolver, data, value: "0" };
}

/**
 * Wrap multiple resolver calls into multicall(bytes[]).
 */
export function buildMulticallCalldata(
	resolver: Address,
	calls: Hex[],
): UnsignedTx {
	const data = encodeFunctionData({
		abi: RESOLVER_ABI,
		functionName: "multicall",
		args: [calls],
	});

	return { to: resolver, data, value: "0" };
}

/**
 * Build resolver data for setting records during registration.
 */
export function buildResolverData(
	node: `0x${string}`,
	addressToSet?: Address,
	textRecords?: Record<string, string>,
): `0x${string}`[] {
	const data: `0x${string}`[] = [];

	if (addressToSet) {
		data.push(
			encodeFunctionData({
				abi: RESOLVER_ABI,
				functionName: "setAddr",
				args: [node, addressToSet],
			}),
		);
	}

	if (textRecords) {
		for (const [key, value] of Object.entries(textRecords)) {
			data.push(
				encodeFunctionData({
					abi: RESOLVER_ABI,
					functionName: "setText",
					args: [node, key, value],
				}),
			);
		}
	}

	return data;
}

/**
 * Build calldata for setNameForAddr on ReverseRegistrar (set primary name).
 */
export function buildSetPrimaryCalldata(
	address: Address,
	owner: Address,
	resolver: Address,
	name: string,
	config: NetworkConfig,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: REVERSE_REGISTRAR_ABI,
		functionName: "setNameForAddr",
		args: [address, owner, resolver, name],
	});

	return { to: config.reverseRegistrar, data, value: "0" };
}

/**
 * Build calldata for setSubnodeRecord on Registry (create subname).
 */
export function buildSubnodeCalldata(
	parentNode: `0x${string}`,
	labelHash: `0x${string}`,
	owner: Address,
	resolver: Address,
	config: NetworkConfig,
): UnsignedTx {
	const data = encodeFunctionData({
		abi: REGISTRY_ABI,
		functionName: "setSubnodeRecord",
		args: [parentNode, labelHash, owner, resolver, 0n],
	});

	return { to: config.registry, data, value: "0" };
}
