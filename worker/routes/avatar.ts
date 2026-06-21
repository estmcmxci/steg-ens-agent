import { Hono } from "hono";
import type { Env } from "../lib/config";
import { AVATAR_STEG_PNG_B64 } from "../lib/avatar-data";

/**
 * Avatar host (public, keyless). ENS `avatar` text records store a URI, not the
 * image bytes — and the source PNG (~200KB) is far too large for an on-chain
 * `data:` URI. So we serve it here and point the agent's `avatar` record at
 * `https://<worker>/avatar/<name>.png`. Currently every agent shares the Steg
 * thermal mark (the only image); per-agent avatars can be added later (KV /
 * per-name lookup) without changing the record convention.
 */

const app = new Hono<{ Bindings: Env }>();

// Decode once at module load (workers keep the isolate warm across requests).
const PNG_BYTES = Uint8Array.from(atob(AVATAR_STEG_PNG_B64), (c) => c.charCodeAt(0));

app.get("/avatar/:name", (c) => {
	// `:name` is accepted (e.g. alice.steg.eth.png) so the URL is per-agent-stable
	// and cache-friendly, but all names currently resolve to the same mark.
	return c.body(PNG_BYTES, 200, {
		"content-type": "image/png",
		"cache-control": "public, max-age=31536000, immutable",
		"access-control-allow-origin": "*",
	});
});

export default app;
