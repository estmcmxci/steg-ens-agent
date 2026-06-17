/**
 * ENS Node Calculation Utilities
 *
 * Copied from CLI src/utils/node.ts — pure functions, no external deps.
 */

import { namehash } from "viem";
import { normalize } from "viem/ens";

export function getParentNode(): `0x${string}` {
	return namehash("eth") as `0x${string}`;
}

export function calculateEnsNode(label: string): `0x${string}` {
	const normalizedLabel = normalize(label);
	return namehash(`${normalizedLabel}.eth`) as `0x${string}`;
}

export function extractLabel(fullName: string): string {
	const parentSuffix = ".eth";
	let name = fullName;
	if (name.toLowerCase().endsWith(parentSuffix)) {
		name = name.slice(0, -parentSuffix.length);
	}
	return name;
}

export function isSubname(input: string): boolean {
	const label = extractLabel(input);
	return label.includes(".");
}

export function getFullEnsName(labelPath: string): string {
	const parts = labelPath.split(".");
	const normalizedParts = parts.map((part) => normalize(part));
	return `${normalizedParts.join(".")}.eth`;
}

export function isFullEnsName(name: string): boolean {
	return name.toLowerCase().endsWith(".eth");
}

export function normalizeEnsName(input: string): {
	label: string;
	fullName: string;
	node: `0x${string}`;
} {
	const labelPath = extractLabel(input);
	const fullName = getFullEnsName(labelPath);
	const node = namehash(fullName) as `0x${string}`;
	return { label: labelPath, fullName, node };
}
