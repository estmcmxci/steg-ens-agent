/**
 * Structured Read Operations
 *
 * All functions accept a viem PublicClient and NetworkConfig.
 * They return structured JSON instead of console output.
 */

import type { Address, PublicClient } from "viem";
import { formatEther, isAddress, keccak256, toHex } from "viem";
import { normalize } from "viem/ens";
import type { NetworkConfig } from "./config";
import {
	REGISTRAR_CONTROLLER_ABI,
	REGISTRAR_CONTROLLER_ABI_V3,
	REGISTRAR_CONTROLLER_ABI_V4,
	REGISTRY_ABI,
	RESOLVER_ABI,
	REVERSE_REGISTRAR_ABI,
	BASE_REGISTRAR_ABI,
} from "./abi";
import { normalizeEnsName, isSubname } from "./node";
import { getDomainByName, getDomainsForAddress } from "./ensnode";
import { resolveAvatarUri } from "./avatar";

// Standard text record keys for profile lookups
const STANDARD_TEXT_KEYS = [
	"avatar",
	"description",
	"display",
	"email",
	"url",
	"com.github",
	"com.twitter",
	"com.discord",
	"com.warpcast",
	"org.telegram",
];

/**
 * Check name availability + get rent price in one call.
 */
export async function checkName(
	label: string,
	durationSeconds: bigint,
	client: PublicClient,
	config: NetworkConfig,
): Promise<{
	available: boolean;
	label: string;
	fullName: string;
	price: {
		base: string;
		premium: string;
		total: string;
		total_with_buffer: string;
		wei: { base: string; premium: string; total: string; total_with_buffer: string };
	} | null;
	duration_seconds: number;
	network: string;
}> {
	const normalizedName = normalize(label);
	const fullName = `${normalizedName}.eth`;

	const isAvailable = (await client.readContract({
		address: config.registrarController,
		abi: REGISTRAR_CONTROLLER_ABI,
		functionName: "available",
		args: [normalizedName],
	})) as boolean;

	let price = null;
	if (isAvailable) {
		const rentPrice = (await client.readContract({
			address: config.registrarController,
			abi: REGISTRAR_CONTROLLER_ABI,
			functionName: "rentPrice",
			args: [normalizedName, durationSeconds],
		})) as { base: bigint; premium: bigint };

		const total = rentPrice.base + rentPrice.premium;
		const totalWithBuffer = total + total / 10n;

		price = {
			base: formatEther(rentPrice.base),
			premium: formatEther(rentPrice.premium),
			total: formatEther(total),
			total_with_buffer: formatEther(totalWithBuffer),
			wei: {
				base: rentPrice.base.toString(),
				premium: rentPrice.premium.toString(),
				total: total.toString(),
				total_with_buffer: totalWithBuffer.toString(),
			},
		};
	}

	return {
		available: isAvailable,
		label: normalizedName,
		fullName,
		price,
		duration_seconds: Number(durationSeconds),
		network: config.chainId === 1 ? "mainnet" : "sepolia",
	};
}

/**
 * Get a complete profile for an ENS name or address.
 */
export async function getProfile(
	input: string,
	client: PublicClient,
	config: NetworkConfig,
	subgraphUrl: string,
): Promise<{
	name: string;
	address: string | null;
	owner: string | null;
	resolver: string | null;
	primary_name: string | null;
	expiry: { date: string; timestamp: number; expired: boolean } | null;
	text_records: Record<string, string>;
	avatar_url: string | null;
	network: string;
}> {
	let fullName: string;
	let node: `0x${string}`;

	// If input is an address, try reverse resolution
	if (isAddress(input)) {
		const primaryName = await getPrimaryNameOnChain(
			input as Address,
			client,
			config,
		);
		if (!primaryName) {
			throw Object.assign(
				new Error(`No primary name found for ${input}`),
				{ code: "NO_PRIMARY_NAME" },
			);
		}
		const normalized = normalizeEnsName(primaryName);
		fullName = normalized.fullName;
		node = normalized.node;
	} else {
		const normalized = normalizeEnsName(input);
		fullName = normalized.fullName;
		node = normalized.node;
	}

	// Try ENSNode for fast indexed data
	let ensNodeData = null;
	try {
		ensNodeData = await getDomainByName(fullName, subgraphUrl);
	} catch {
		// Fall back to on-chain
	}

	// Get resolver
	let resolver: Address | null =
		(ensNodeData?.resolver?.address as Address) || null;
	if (!resolver) {
		resolver = await getResolver(node, client, config);
	}

	// Get owner: for second-level .eth names, query the BaseRegistrar (NFT owner)
	// since registry.owner() returns the NameWrapper/Registrar contract, not the user.
	// For subnames, fall back to registry.owner().
	let owner: Address | null = null;
	const label = fullName.replace(/\.eth$/, "");
	if (!isSubname(fullName)) {
		try {
			const labelHash = keccak256(toHex(label));
			const tokenId = BigInt(labelHash);
			owner = await getTokenOwner(tokenId, client, config);
		} catch {
			// Token may not exist; fall through
		}
	}
	if (!owner) {
		owner = await getOwner(node, client, config);
	}
	if (!owner) {
		owner = (ensNodeData?.owner?.id as Address) || null;
	}

	if (!resolver) {
		throw Object.assign(
			new Error(`${fullName} is not registered or has no resolver`),
			{ code: "NOT_REGISTERED" },
		);
	}

	// Get address record
	const addressRecord = await getAddressRecord(resolver, node, client);

	// Get primary name
	const primaryName = addressRecord
		? await getPrimaryNameOnChain(addressRecord, client, config)
		: null;

	// Get text records
	const textRecords: Record<string, string> = {};
	const keysToQuery = ensNodeData?.resolver?.texts || STANDARD_TEXT_KEYS;

	for (const key of keysToQuery) {
		const value = await getTextRecord(resolver, node, key, client);
		if (value) {
			textRecords[key] = value;
		}
	}

	// Resolve avatar
	let avatarUrl: string | null = null;
	if (textRecords["avatar"]) {
		try {
			const avatarResult = await resolveAvatarUri(
				textRecords["avatar"],
				client,
			);
			avatarUrl = avatarResult.imageUrl;
		} catch {
			// Best-effort
		}
	}

	// Expiry
	let expiry = null;
	if (ensNodeData?.expiryDate) {
		const ts = Number(ensNodeData.expiryDate);
		const expiryDate = new Date(ts * 1000);
		expiry = {
			date: expiryDate.toISOString(),
			timestamp: ts,
			expired: expiryDate < new Date(),
		};
	}

	const networkName = config.chainId === 1 ? "mainnet" : "sepolia";

	return {
		name: fullName,
		address: addressRecord,
		owner,
		resolver,
		primary_name: primaryName,
		expiry,
		text_records: textRecords,
		avatar_url: avatarUrl,
		network: networkName,
	};
}

/**
 * Compute a commitment hash for the commit-reveal process.
 */
export async function computeCommitment(
	label: string,
	owner: Address,
	duration: bigint,
	secret: `0x${string}`,
	resolver: Address,
	resolverData: `0x${string}`[],
	reverseRecord: boolean,
	client: PublicClient,
	config: NetworkConfig,
): Promise<`0x${string}`> {
	const isV4 = config.chainId !== 1;
	const normalizedName = normalize(label);

	if (isV4) {
		const registration = {
			label: normalizedName,
			owner,
			duration,
			secret,
			resolver,
			data: resolverData,
			reverseRecord: reverseRecord ? 1 : 0,
			referrer:
				"0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
		};
		return (await client.readContract({
			address: config.registrarController,
			abi: REGISTRAR_CONTROLLER_ABI_V4,
			functionName: "makeCommitment",
			args: [registration],
		})) as `0x${string}`;
	}

	return (await client.readContract({
		address: config.registrarController,
		abi: REGISTRAR_CONTROLLER_ABI_V3,
		functionName: "makeCommitment",
		args: [
			normalizedName,
			owner,
			duration,
			secret,
			resolver,
			resolverData,
			reverseRecord,
			0,
		],
	})) as `0x${string}`;
}

/**
 * Get the minimum commitment age in seconds.
 */
export async function getMinCommitmentAge(
	client: PublicClient,
	config: NetworkConfig,
): Promise<bigint> {
	return (await client.readContract({
		address: config.registrarController,
		abi: REGISTRAR_CONTROLLER_ABI,
		functionName: "minCommitmentAge",
	})) as bigint;
}

/**
 * Get rent price for a label + duration.
 */
export async function getRentPrice(
	label: string,
	duration: bigint,
	client: PublicClient,
	config: NetworkConfig,
): Promise<{ base: bigint; premium: bigint; total: bigint; totalWithBuffer: bigint }> {
	const normalizedName = normalize(label);

	const price = (await client.readContract({
		address: config.registrarController,
		abi: REGISTRAR_CONTROLLER_ABI,
		functionName: "rentPrice",
		args: [normalizedName, duration],
	})) as { base: bigint; premium: bigint };

	const total = price.base + price.premium;
	const totalWithBuffer = total + total / 10n;

	return {
		base: price.base,
		premium: price.premium,
		total,
		totalWithBuffer,
	};
}

/**
 * Get the current owner of an ERC-721 token on the BaseRegistrar.
 */
export async function getTokenOwner(
	tokenId: bigint,
	client: PublicClient,
	config: NetworkConfig,
): Promise<Address> {
	return (await client.readContract({
		address: config.baseRegistrar,
		abi: BASE_REGISTRAR_ABI,
		functionName: "ownerOf",
		args: [tokenId],
	})) as Address;
}

// ── Resolve operations ──────────────────────────────────────────────

/**
 * Decode contenthash bytes into a human-readable URI.
 */
function decodeContenthash(hex: `0x${string}`): string {
	const data = hex.slice(2);

	if (data.startsWith("e3010170")) {
		const cidBytes = data.slice(8);
		return `ipfs://${("f01701220" + cidBytes.slice(4)).toLowerCase()}`;
	}
	if (data.startsWith("e5010172")) {
		const cidBytes = data.slice(8);
		return `ipns://${("f01721220" + cidBytes.slice(4)).toLowerCase()}`;
	}
	if (data.startsWith("e4")) {
		const hashStart = data.indexOf("1b20");
		if (hashStart !== -1) {
			return `bzz://${data.slice(hashStart + 4)}`;
		}
		return `bzz://${data.slice(2)}`;
	}

	return hex;
}

/**
 * Get contenthash from resolver.
 */
export async function getContenthashRecord(
	resolverAddress: Address,
	node: `0x${string}`,
	client: PublicClient,
): Promise<{ raw: `0x${string}`; decoded: string } | null> {
	try {
		const value = (await client.readContract({
			address: resolverAddress,
			abi: RESOLVER_ABI,
			functionName: "contenthash",
			args: [node],
		})) as `0x${string}`;

		if (!value || value === "0x" || value === "0x0000000000000000000000000000000000000000") {
			return null;
		}

		return { raw: value, decoded: decodeContenthash(value) };
	} catch {
		return null;
	}
}

/**
 * Resolve an ENS name or address — forward resolution, reverse resolution,
 * single text key lookup, or contenthash.
 */
export async function resolveName(
	input: string,
	client: PublicClient,
	config: NetworkConfig,
	subgraphUrl: string,
	options?: { txt?: string; contenthash?: boolean; resolver?: Address },
): Promise<{
	input: string;
	type: "forward" | "reverse";
	name?: string;
	address?: string | null;
	text?: { key: string; value: string | null; avatar_url?: string | null };
	contenthash?: { raw: string; decoded: string } | null;
	resolver?: string | null;
	network: string;
}> {
	const networkName = config.chainId === 1 ? "mainnet" : "sepolia";

	// Reverse resolution: address → name
	if (isAddress(input)) {
		const primaryName = await getPrimaryNameOnChain(input as Address, client, config);
		return {
			input,
			type: "reverse",
			name: primaryName || undefined,
			address: input,
			network: networkName,
		};
	}

	// Forward resolution
	const { fullName, node } = normalizeEnsName(input);

	// Get resolver
	let resolver: Address | null = options?.resolver || null;
	if (!resolver) {
		let ensNodeData = null;
		try {
			ensNodeData = await getDomainByName(fullName, subgraphUrl);
			resolver = (ensNodeData?.resolver?.address as Address) || null;
		} catch { /* fall through */ }
	}
	if (!resolver) {
		resolver = await getResolverRecord(node, client, config);
	}

	if (!resolver) {
		throw Object.assign(
			new Error(`No resolver found for ${fullName}`),
			{ code: "NOT_REGISTERED" },
		);
	}

	// Text record query
	if (options?.txt) {
		const value = await getTextRecordPublic(resolver, node, options.txt, client);
		let avatarUrl: string | null = null;
		if (options.txt === "avatar" && value) {
			try {
				const result = await resolveAvatarUri(value, client);
				avatarUrl = result.imageUrl;
			} catch { /* best effort */ }
		}
		return {
			input,
			type: "forward",
			name: fullName,
			text: { key: options.txt, value, avatar_url: avatarUrl },
			resolver,
			network: networkName,
		};
	}

	// Contenthash query
	if (options?.contenthash) {
		const ch = await getContenthashRecord(resolver, node, client);
		return {
			input,
			type: "forward",
			name: fullName,
			contenthash: ch,
			resolver,
			network: networkName,
		};
	}

	// Default: get address
	const address = await getAddressRecord(resolver, node, client);
	return {
		input,
		type: "forward",
		name: fullName,
		address,
		resolver,
		network: networkName,
	};
}

/**
 * Verify that expected records are correctly set for an ENS name.
 */
export async function verifyName(
	name: string,
	client: PublicClient,
	config: NetworkConfig,
	expectedRecords?: string[],
): Promise<{
	name: string;
	node: string;
	owner: string | null;
	resolver: string | null;
	address: string | null;
	primary_name: { value: string | null; matches: boolean };
	text_records: Array<{ key: string; status: "set" | "empty"; value?: string }>;
	summary: { set: number; total: number; percent: number };
	network: string;
}> {
	const { fullName, node } = normalizeEnsName(name);
	const recordsToCheck = expectedRecords || ["avatar", "description"];
	const networkName = config.chainId === 1 ? "mainnet" : "sepolia";

	// For second-level .eth names, use BaseRegistrar (NFT owner) for fresh data
	let owner: Address | null = null;
	const verifyLabel = fullName.replace(/\.eth$/, "");
	if (!isSubname(fullName)) {
		try {
			const labelHash = keccak256(toHex(verifyLabel));
			const tokenId = BigInt(labelHash);
			owner = await getTokenOwner(tokenId, client, config);
		} catch {
			// fall through
		}
	}
	if (!owner) {
		owner = await getOwner(node, client, config);
	}
	if (!owner) {
		throw Object.assign(
			new Error(`${fullName} is not registered (no owner)`),
			{ code: "NOT_REGISTERED" },
		);
	}

	const resolver = await getResolverRecord(node, client, config);
	if (!resolver) {
		throw Object.assign(
			new Error(`${fullName} has no resolver set`),
			{ code: "NOT_REGISTERED" },
		);
	}

	const address = await getAddressRecord(resolver, node, client);

	let primaryName: string | null = null;
	if (address) {
		primaryName = await getPrimaryNameOnChain(address, client, config);
	}

	const textResults: Array<{ key: string; status: "set" | "empty"; value?: string }> = [];
	for (const key of recordsToCheck) {
		const value = await getTextRecordPublic(resolver, node, key, client);
		if (value) {
			textResults.push({ key, status: "set", value });
		} else {
			textResults.push({ key, status: "empty" });
		}
	}

	const setCount = textResults.filter((r) => r.status === "set").length;

	return {
		name: fullName,
		node,
		owner,
		resolver,
		address,
		primary_name: {
			value: primaryName,
			matches: primaryName ? primaryName.toLowerCase() === fullName.toLowerCase() : false,
		},
		text_records: textResults,
		summary: {
			set: setCount,
			total: recordsToCheck.length,
			percent: Math.round((setCount / recordsToCheck.length) * 100),
		},
		network: networkName,
	};
}

/**
 * List all ENS names owned by an address.
 */
export async function listNames(
	address: string,
	subgraphUrl: string,
	client: PublicClient,
	config: NetworkConfig,
): Promise<{
	address: string;
	names: Array<{
		name: string;
		expiry: { date: string; timestamp: number; expired: boolean; days_left: number } | null;
	}>;
	total: number;
}> {
	if (!isAddress(address)) {
		throw Object.assign(
			new Error("Invalid address format"),
			{ code: "INVALID_PARAM" },
		);
	}

	const domains = await getDomainsForAddress(address, subgraphUrl);
	const ethNames = domains.filter((d) => d.name?.endsWith(".eth"));

	// Verify on-chain ownership for second-level names to filter out stale subgraph data
	const verifiedNames: typeof ethNames = [];
	for (const d of ethNames) {
		const name = d.name || "";
		const label = name.replace(/\.eth$/, "");
		if (!isSubname(name)) {
			try {
				const labelHash = keccak256(toHex(label));
				const tokenId = BigInt(labelHash);
				const onChainOwner = await getTokenOwner(tokenId, client, config);
				if (onChainOwner.toLowerCase() !== address.toLowerCase()) {
					continue; // Subgraph stale — user no longer owns this
				}
			} catch {
				// Token may not exist; keep the entry
			}
		}
		verifiedNames.push(d);
	}

	const names = verifiedNames.map((d) => {
		let expiry = null;
		if (d.expiryDate) {
			const ts = Number(d.expiryDate);
			const expiryDate = new Date(ts * 1000);
			const daysLeft = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
			expiry = {
				date: expiryDate.toISOString(),
				timestamp: ts,
				expired: expiryDate < new Date(),
				days_left: daysLeft,
			};
		}
		return { name: d.name || "unknown", expiry };
	});

	return { address, names, total: names.length };
}

// ── Public helpers (used by routes directly) ────────────────────────

export async function getResolverRecord(
	node: `0x${string}`,
	client: PublicClient,
	config: NetworkConfig,
): Promise<Address | null> {
	return getResolver(node, client, config);
}

export async function getTextRecordPublic(
	resolverAddress: Address,
	node: `0x${string}`,
	key: string,
	client: PublicClient,
): Promise<string | null> {
	return getTextRecord(resolverAddress, node, key, client);
}

// ── Internal helpers ────────────────────────────────────────────────

async function getResolver(
	node: `0x${string}`,
	client: PublicClient,
	config: NetworkConfig,
): Promise<Address | null> {
	try {
		const resolver = (await client.readContract({
			address: config.registry,
			abi: REGISTRY_ABI,
			functionName: "resolver",
			args: [node],
		})) as Address;

		if (resolver === "0x0000000000000000000000000000000000000000") {
			return null;
		}
		return resolver;
	} catch {
		return null;
	}
}

async function getOwner(
	node: `0x${string}`,
	client: PublicClient,
	config: NetworkConfig,
): Promise<Address | null> {
	try {
		const owner = (await client.readContract({
			address: config.registry,
			abi: REGISTRY_ABI,
			functionName: "owner",
			args: [node],
		})) as Address;

		if (owner === "0x0000000000000000000000000000000000000000") {
			return null;
		}
		return owner;
	} catch {
		return null;
	}
}

async function getAddressRecord(
	resolverAddress: Address,
	node: `0x${string}`,
	client: PublicClient,
): Promise<Address | null> {
	try {
		const addr = (await client.readContract({
			address: resolverAddress,
			abi: RESOLVER_ABI,
			functionName: "addr",
			args: [node],
		})) as Address;

		if (addr && addr !== "0x0000000000000000000000000000000000000000") {
			return addr;
		}
	} catch {
		// No address record
	}
	return null;
}

async function getTextRecord(
	resolverAddress: Address,
	node: `0x${string}`,
	key: string,
	client: PublicClient,
): Promise<string | null> {
	try {
		const value = (await client.readContract({
			address: resolverAddress,
			abi: RESOLVER_ABI,
			functionName: "text",
			args: [node, key],
		})) as string;

		return value || null;
	} catch {
		return null;
	}
}

async function getPrimaryNameOnChain(
	address: Address,
	client: PublicClient,
	config: NetworkConfig,
): Promise<string | null> {
	try {
		// Get the reverse node for this address
		const reverseNode = (await client.readContract({
			address: config.reverseRegistrar,
			abi: REVERSE_REGISTRAR_ABI,
			functionName: "node",
			args: [address],
		})) as `0x${string}`;

		if (
			reverseNode ===
			"0x0000000000000000000000000000000000000000000000000000000000000000"
		) {
			return null;
		}

		// Look up the resolver for the reverse node from the registry
		const reverseResolver = await getResolver(reverseNode, client, config);
		if (!reverseResolver) {
			return null;
		}

		// Read name() from the actual reverse resolver
		const name = (await client.readContract({
			address: reverseResolver,
			abi: RESOLVER_ABI,
			functionName: "name",
			args: [reverseNode],
		})) as string;

		return name || null;
	} catch {
		return null;
	}
}
