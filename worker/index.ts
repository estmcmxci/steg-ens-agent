/**
 * ENS Agent API — Cloudflare Worker
 *
 * Exposes ENS operations as HTTP endpoints for AI agents.
 * Never holds private keys — builds unsigned tx objects for frontend wallet signing.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/config";
import checkRoute from "./routes/check";
import profileRoute from "./routes/profile";
import resolveRoute from "./routes/resolve";
import listRoute from "./routes/list";
import verifyRoute from "./routes/verify";
import commitRoute from "./routes/commit";
import registerRoute from "./routes/register";
import recordsRoute from "./routes/records";
import renewRoute from "./routes/renew";
import transferRoute from "./routes/transfer";
import primaryRoute from "./routes/primary";
import subnameRoute from "./routes/subname";
import utilsRoute from "./routes/utils";
import evaluateRoute from "./routes/evaluate";

const app = new Hono<{ Bindings: Env }>();

// CORS — allow all origins for MVP
app.use("*", cors());

// API key auth middleware for POST routes. /evaluate is exempt: authorization
// verification is public by design — any relying party verifies independently,
// and the route touches no keys (it only reads ENS).
app.use("*", async (c, next) => {
	if (c.req.method === "GET" || c.req.path === "/evaluate") {
		return next();
	}

	const authHeader = c.req.header("Authorization");
	const apiKey = authHeader?.startsWith("Bearer ")
		? authHeader.slice(7)
		: null;

	if (!apiKey || apiKey !== c.env.API_KEY) {
		return c.json(
			{
				ok: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Invalid or missing API key. Use Authorization: Bearer <key>",
				},
			},
			401,
		);
	}

	return next();
});

// Mount routes — reads (public)
app.route("/", checkRoute);
app.route("/", profileRoute);
app.route("/", resolveRoute);
app.route("/", listRoute);
app.route("/", verifyRoute);
app.route("/", utilsRoute);

// Authorization verifier (public, keyless) — the grafted Steg layer.
app.route("/", evaluateRoute);

// Mount routes — writes (auth required)
app.route("/", commitRoute);
app.route("/", registerRoute);
app.route("/", recordsRoute);
app.route("/", renewRoute);
app.route("/", transferRoute);
app.route("/", primaryRoute);
app.route("/", subnameRoute);

// Health check
app.get("/", (c) => {
	return c.json({ ok: true, service: "ens-agent-api", version: "0.2.0" });
});

// Global error handler
app.onError((err, c) => {
	const error = err as Error & { code?: string };
	const code = error.code || "INTERNAL_ERROR";
	const status =
		code === "NOT_REGISTERED" || code === "NO_PRIMARY_NAME" ? 404
		: code === "INVALID_PARAM" ? 400
		: 500;

	return c.json(
		{
			ok: false,
			error: {
				code,
				message: error.message,
			},
		},
		status,
	);
});

// 404 handler
app.notFound((c) => {
	return c.json(
		{
			ok: false,
			error: {
				code: "NOT_FOUND",
				message: `Route ${c.req.method} ${c.req.path} not found`,
			},
		},
		404,
	);
});

export default app;
