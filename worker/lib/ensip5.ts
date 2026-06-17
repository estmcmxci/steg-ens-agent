/**
 * ENSIP-5 Text Record Key Validation & ENSIP-12 Avatar URI Validation
 *
 * Copied verbatim from CLI src/utils/ensip5.ts — pure functions, no deps.
 */

export const ENSIP5_GLOBAL_KEYS = [
	"avatar",
	"description",
	"display",
	"email",
	"keywords",
	"mail",
	"notice",
	"location",
	"phone",
	"url",
	"header",
] as const;

export const ENSIP5_SERVICE_KEYS = [
	"com.github",
	"com.twitter",
	"com.discord",
	"io.keybase",
	"org.telegram",
	"com.reddit",
	"com.linkedin",
	"com.warpcast",
] as const;

const STANDARD_KEYS = new Set<string>([
	...ENSIP5_GLOBAL_KEYS,
	...ENSIP5_SERVICE_KEYS,
]);

const REVERSE_DNS_RE = /^[a-z]{2,}(\.[a-z0-9-]+)+$/i;

export interface TextRecordKeyValidation {
	isStandard: boolean;
	isReverseDns: boolean;
	warning: string | null;
}

export function validateTextRecordKey(key: string): TextRecordKeyValidation {
	if (STANDARD_KEYS.has(key)) {
		return { isStandard: true, isReverseDns: false, warning: null };
	}

	if (REVERSE_DNS_RE.test(key)) {
		return { isStandard: false, isReverseDns: true, warning: null };
	}

	return {
		isStandard: false,
		isReverseDns: false,
		warning:
			`"${key}" is not a standard ENSIP-5 key. ` +
			`Standard keys: ${ENSIP5_GLOBAL_KEYS.join(", ")}. ` +
			`Custom keys should use reverse-DNS format (e.g. com.myapp).`,
	};
}

const NFT_URI_RE =
	/^eip155:(\d+)\/(erc721|erc1155):(0x[0-9a-fA-F]{40})\/(\d+)$/;

export type AvatarUriType =
	| "https"
	| "ipfs"
	| "ipns"
	| "data"
	| "nft"
	| "unknown";

export interface NftInfo {
	chainId: number;
	standard: "erc721" | "erc1155";
	contractAddress: `0x${string}`;
	tokenId: string;
}

export interface AvatarUriValidation {
	type: AvatarUriType;
	valid: boolean;
	error: string | null;
	nft?: NftInfo;
}

export function validateAvatarUri(value: string): AvatarUriValidation {
	if (!value) {
		return { type: "unknown", valid: false, error: "Empty avatar value" };
	}

	if (value.startsWith("https://") || value.startsWith("http://")) {
		try {
			new URL(value);
			return { type: "https", valid: true, error: null };
		} catch {
			return { type: "https", valid: false, error: "Malformed URL" };
		}
	}

	if (value.startsWith("ipfs://")) {
		const hash = value.slice(7);
		if (hash.length < 10) {
			return { type: "ipfs", valid: false, error: "IPFS hash too short" };
		}
		return { type: "ipfs", valid: true, error: null };
	}

	if (value.startsWith("ipns://")) {
		const name = value.slice(7);
		if (name.length < 3) {
			return { type: "ipns", valid: false, error: "IPNS name too short" };
		}
		return { type: "ipns", valid: true, error: null };
	}

	if (value.startsWith("data:")) {
		if (!value.includes(",")) {
			return { type: "data", valid: false, error: "Data URI missing comma separator" };
		}
		return { type: "data", valid: true, error: null };
	}

	const nftMatch = value.match(NFT_URI_RE);
	if (nftMatch) {
		return {
			type: "nft",
			valid: true,
			error: null,
			nft: {
				chainId: Number.parseInt(nftMatch[1], 10),
				standard: nftMatch[2] as "erc721" | "erc1155",
				contractAddress: nftMatch[3] as `0x${string}`,
				tokenId: nftMatch[4],
			},
		};
	}

	if (value.startsWith("eip155:")) {
		return {
			type: "nft",
			valid: false,
			error: "Invalid NFT URI format. Expected: eip155:<chainId>/<erc721|erc1155>:<0xAddress>/<tokenId>",
		};
	}

	return {
		type: "unknown",
		valid: false,
		error:
			`Unrecognized avatar URI format. Valid formats: ` +
			`https://..., ipfs://..., ipns://..., data:..., ` +
			`eip155:<chainId>/<erc721|erc1155>:<0xAddress>/<tokenId>`,
	};
}
