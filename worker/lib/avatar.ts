/**
 * ENSIP-12 Avatar Resolution
 *
 * Adapted from CLI src/utils/avatar.ts — client is a required parameter
 * instead of importing getPublicClient.
 */

import type { PublicClient } from "viem";
import { validateAvatarUri } from "./ensip5";

const ERC721_TOKEN_URI_ABI = [
	{
		name: "tokenURI",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "tokenId", type: "uint256" }],
		outputs: [{ type: "string" }],
	},
] as const;

const ERC1155_URI_ABI = [
	{
		name: "uri",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [{ type: "string" }],
	},
] as const;

const IPFS_GATEWAY = "https://ipfs.io";

export function ipfsToGatewayUrl(uri: string): string {
	if (uri.startsWith("ipfs://")) {
		return `${IPFS_GATEWAY}/ipfs/${uri.slice(7)}`;
	}
	if (uri.startsWith("ipns://")) {
		return `${IPFS_GATEWAY}/ipns/${uri.slice(7)}`;
	}
	return uri;
}

export interface AvatarResolution {
	rawUri: string;
	imageUrl: string | null;
	type: string;
	error: string | null;
	metadata?: Record<string, unknown>;
}

export async function resolveAvatarUri(
	rawUri: string,
	client: PublicClient,
): Promise<AvatarResolution> {
	const validation = validateAvatarUri(rawUri);

	if (!validation.valid) {
		return {
			rawUri,
			imageUrl: null,
			type: validation.type,
			error: validation.error,
		};
	}

	try {
		switch (validation.type) {
			case "https":
				return { rawUri, imageUrl: rawUri, type: "https", error: null };

			case "data":
				return { rawUri, imageUrl: rawUri, type: "data", error: null };

			case "ipfs":
			case "ipns":
				return {
					rawUri,
					imageUrl: ipfsToGatewayUrl(rawUri),
					type: validation.type,
					error: null,
				};

			case "nft": {
				const nft = validation.nft!;

				let metadataUri: string;
				if (nft.standard === "erc721") {
					metadataUri = (await client.readContract({
						address: nft.contractAddress,
						abi: ERC721_TOKEN_URI_ABI,
						functionName: "tokenURI",
						args: [BigInt(nft.tokenId)],
					})) as string;
				} else {
					metadataUri = (await client.readContract({
						address: nft.contractAddress,
						abi: ERC1155_URI_ABI,
						functionName: "uri",
						args: [BigInt(nft.tokenId)],
					})) as string;

					if (metadataUri.includes("{id}")) {
						const hexId = BigInt(nft.tokenId)
							.toString(16)
							.padStart(64, "0");
						metadataUri = metadataUri.replace("{id}", hexId);
					}
				}

				const metadataUrl = ipfsToGatewayUrl(metadataUri);

				let metadata: Record<string, unknown>;
				if (metadataUrl.startsWith("data:")) {
					const commaIndex = metadataUrl.indexOf(",");
					const jsonStr = metadataUrl.slice(commaIndex + 1);
					metadata = JSON.parse(decodeURIComponent(jsonStr));
				} else {
					const response = await fetch(metadataUrl);
					if (!response.ok) {
						return {
							rawUri,
							imageUrl: null,
							type: "nft",
							error: `Metadata fetch failed: ${response.status}`,
						};
					}
					metadata = (await response.json()) as Record<string, unknown>;
				}

				const imageField =
					(metadata.image as string) ||
					(metadata.image_url as string) ||
					null;

				if (!imageField) {
					return {
						rawUri,
						imageUrl: null,
						type: "nft",
						error: "No image field in NFT metadata",
						metadata,
					};
				}

				const imageUrl = ipfsToGatewayUrl(imageField);
				return { rawUri, imageUrl, type: "nft", error: null, metadata };
			}

			default:
				return {
					rawUri,
					imageUrl: null,
					type: validation.type,
					error: "Unsupported URI type",
				};
		}
	} catch (error) {
		const e = error as Error;
		return {
			rawUri,
			imageUrl: null,
			type: validation.type,
			error: `Resolution failed: ${e.message}`,
		};
	}
}
