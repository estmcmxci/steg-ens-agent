import { Hono } from "hono";
import type { Address } from "viem";
import { formatEther } from "viem";
import type { Env } from "../lib/config";
import { createPublicClient, getNetworkConfig } from "../lib/config";
import { computeCommitment, getRentPrice } from "../lib/reads";
import { buildRegisterCalldata } from "../lib/calldata";

const app = new Hono<{ Bindings: Env }>();

type SessionData = {
	secret: `0x${string}`;
	label: string;
	owner: Address;
	duration: string;
	set_primary: boolean;
	resolver: Address;
	resolver_data: `0x${string}`[];
	commitment?: `0x${string}`;
	network: string;
	created_at: number;
};

const COMMITMENTS_ABI = [
	{
		name: "commitments",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "commitment", type: "bytes32" }],
		outputs: [{ type: "uint256" }],
	},
] as const;

app.post("/register", async (c) => {
	const body = await c.req.json<{ session_id: string }>();

	if (!body.session_id) {
		return c.json(
			{ ok: false, error: { code: "MISSING_PARAM", message: "session_id is required" } },
			400,
		);
	}

	// Read session from KV
	const raw = await c.env.ENS_SESSIONS.get(body.session_id);
	if (!raw) {
		return c.json(
			{
				ok: false,
				error: {
					code: "SESSION_EXPIRED",
					message: "Session not found or expired. Please create a new commit.",
				},
			},
			404,
		);
	}

	const session = JSON.parse(raw) as SessionData;
	const config = getNetworkConfig(session.network);
	const client = createPublicClient(session.network, c.env);
	const duration = BigInt(session.duration);

	// Recompute (or use stored) commitment and verify it exists on-chain
	let commitment = session.commitment;
	if (!commitment) {
		commitment = await computeCommitment(
			session.label,
			session.owner,
			duration,
			session.secret,
			session.resolver,
			session.resolver_data,
			session.set_primary,
			client,
			config,
		);
	}

	const commitTimestamp = (await client.readContract({
		address: config.registrarController,
		abi: COMMITMENTS_ABI,
		functionName: "commitments",
		args: [commitment],
	})) as bigint;

	if (commitTimestamp === 0n) {
		return c.json(
			{
				ok: false,
				error: {
					code: "COMMITMENT_NOT_FOUND",
					message:
						"The commit transaction was not found on-chain. " +
						"This usually means the commit tx was not confirmed, was sent to the wrong chain, " +
						"or was dropped from the mempool. Please restart the registration process.",
					debug: {
						commitment,
						network: session.network,
						controller: config.registrarController,
						label: session.label,
					},
				},
			},
			400,
		);
	}

	// Check commitment age
	const now = BigInt(Math.floor(Date.now() / 1000));
	const age = now - commitTimestamp;
	const minAge = 60n; // minCommitmentAge on both networks
	if (age < minAge) {
		return c.json(
			{
				ok: false,
				error: {
					code: "COMMITMENT_TOO_NEW",
					message: `Commitment is only ${age}s old, need at least ${minAge}s. Please wait ${minAge - age} more seconds.`,
				},
			},
			400,
		);
	}

	// Get current rent price with 10% buffer
	const price = await getRentPrice(session.label, duration, client, config);

	// Build register calldata
	const tx = buildRegisterCalldata(
		session.label,
		session.owner,
		duration,
		session.secret,
		session.resolver,
		session.resolver_data,
		session.set_primary,
		price.totalWithBuffer,
		config,
	);

	// Simulate the register tx server-side before sending to user
	try {
		await client.call({
			to: tx.to,
			data: tx.data,
			value: BigInt(tx.value),
			account: session.owner,
		});
	} catch (simErr: unknown) {
		// Don't delete session — let user retry
		const errMsg =
			simErr instanceof Error ? simErr.message : String(simErr);
		const errData =
			simErr && typeof simErr === "object" && "data" in simErr
				? (simErr as { data: unknown }).data
				: undefined;
		return c.json(
			{
				ok: false,
				error: {
					code: "SIMULATION_FAILED",
					message: `Register transaction would revert on-chain: ${errMsg}`,
					debug: {
						commitment,
						commitment_age_seconds: Number(age),
						commit_timestamp: Number(commitTimestamp),
						network: session.network,
						controller: config.registrarController,
						label: session.label,
						owner: session.owner,
						resolver: session.resolver,
						duration: session.duration,
						set_primary: session.set_primary,
						resolver_data_count: session.resolver_data.length,
						value_wei: tx.value,
						revert_data: errData,
					},
				},
			},
			400,
		);
	}

	// Delete session (one-time use) — only after successful verification + simulation
	await c.env.ENS_SESSIONS.delete(body.session_id);

	const fullName = `${session.label}.eth`;

	return c.json({
		ok: true,
		data: {
			tx,
			price_eth: formatEther(price.total),
			price_with_buffer_eth: formatEther(price.totalWithBuffer),
			name: fullName,
			network: session.network,
			commitment_age_seconds: Number(age),
		},
	});
});

export default app;
