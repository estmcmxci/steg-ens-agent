import { Hono } from "hono";
import type { Address } from "viem";
import { keccak256, encodePacked } from "viem";
import { normalize } from "viem/ens";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { getTokenOwner } from "../lib/reads";
import { buildTransferCalldata } from "../lib/calldata";

const app = new Hono<{ Bindings: Env }>();

app.post("/transfer", async (c) => {
	const body = await c.req.json<{
		label: string;
		from: string;
		to: string;
		network?: string;
	}>();

	if (!body.label || !body.from || !body.to) {
		return c.json(
			{
				ok: false,
				error: {
					code: "MISSING_PARAM",
					message: "label, from, and to are required",
				},
			},
			400,
		);
	}

	const network = body.network || "sepolia";
	const config = getNetworkConfig(network);
	const client = createPublicClient(network, c.env);

	const normalizedLabel = normalize(body.label);
	const fullName = `${normalizedLabel}.eth`;
	const from = body.from as Address;
	const to = body.to as Address;

	// Compute tokenId = uint256(keccak256(label))
	const tokenId = BigInt(
		keccak256(encodePacked(["string"], [normalizedLabel])),
	);

	// Pre-flight: verify `from` owns the token
	try {
		const currentOwner = await getTokenOwner(tokenId, client, config);
		if (currentOwner.toLowerCase() !== from.toLowerCase()) {
			return c.json(
				{
					ok: false,
					error: {
						code: "NOT_OWNER",
						message: `Token not owned by 'from' address. Current owner: ${currentOwner}`,
					},
				},
				400,
			);
		}
	} catch {
		return c.json(
			{
				ok: false,
				error: {
					code: "TOKEN_NOT_FOUND",
					message: `Could not find token for ${fullName}. It may not be registered.`,
				},
			},
			404,
		);
	}

	const tx = buildTransferCalldata(from, to, tokenId, config);

	return c.json({
		ok: true,
		data: {
			tx,
			name: fullName,
			from,
			recipient: to,
			token_id: tokenId.toString(),
			network,
		},
	});
});

export default app;
