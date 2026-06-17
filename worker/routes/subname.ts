import { Hono } from "hono";
import type { Address } from "viem";
import { namehash, keccak256, toBytes } from "viem";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { getNetworkConfig } from "../lib/config";
import {
	buildSubnodeCalldata,
	buildSetAddrCalldata,
	buildSetPrimaryCalldata,
	type UnsignedTx,
} from "../lib/calldata";

const app = new Hono<{ Bindings: Env }>();

app.post("/subname", async (c) => {
	const body = await c.req.json<{
		label: string;
		parent?: string;
		owner: string;
		address?: string;
		reverse?: boolean;
		network?: string;
	}>();

	if (!body.label) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "label is required" } },
			400,
		);
	}
	if (!body.owner) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "owner is required" } },
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);

	const parentDomain = body.parent || "eth";
	const normalizedLabel = normalize(body.label);
	const fullName = `${normalizedLabel}.${parentDomain}`;
	const owner = body.owner as Address;
	const contractAddress = (body.address || body.owner) as Address;

	// Compute nodes
	const parentNode = namehash(parentDomain) as `0x${string}`;
	const labelHash = keccak256(toBytes(normalizedLabel)) as `0x${string}`;
	const subnameNode = namehash(fullName) as `0x${string}`;

	const transactions: Array<{ step: string; tx: UnsignedTx }> = [];

	// Step 1: Create subname via setSubnodeRecord
	const subnodeTx = buildSubnodeCalldata(
		parentNode,
		labelHash,
		owner,
		config.resolver,
		config,
	);
	transactions.push({ step: "create_subname", tx: subnodeTx });

	// Step 2: Set forward resolution (address record)
	const addrTx = buildSetAddrCalldata(subnameNode, contractAddress, config.resolver);
	transactions.push({ step: "set_address", tx: addrTx });

	// Step 3: Set reverse resolution (optional)
	if (body.reverse !== false) {
		const reverseTx = buildSetPrimaryCalldata(
			contractAddress,
			owner,
			config.resolver,
			fullName,
			config,
		);
		transactions.push({ step: "set_reverse", tx: reverseTx });
	}

	return c.json({
		ok: true,
		data: {
			transactions,
			name: fullName,
			parent: parentDomain,
			parent_node: parentNode,
			label_hash: labelHash,
			subname_node: subnameNode,
			owner,
			address: contractAddress,
			network,
		},
	});
});

export default app;
