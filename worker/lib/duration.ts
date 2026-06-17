/**
 * Duration Parsing
 *
 * Supports: "1y", "6m", "30d", raw seconds as number/string, or duration_years.
 */

const ONE_YEAR = 365 * 24 * 60 * 60;
const ONE_MONTH = 30 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

/**
 * Parse a duration string into seconds.
 *
 * Accepts:
 *   "1y", "2y"   → years (365 days)
 *   "6m", "3m"   → months (30 days)
 *   "30d", "90d" → days
 *   "31536000"   → raw seconds
 *   number       → raw seconds
 *
 * Returns null on invalid input.
 */
export function parseDuration(input: string | number | undefined): bigint | null {
	if (input === undefined || input === null) return null;

	if (typeof input === "number") {
		return BigInt(Math.floor(input));
	}

	const trimmed = input.trim().toLowerCase();

	// "1y", "2y" etc.
	const yearMatch = trimmed.match(/^(\d+(?:\.\d+)?)y$/);
	if (yearMatch) {
		return BigInt(Math.floor(parseFloat(yearMatch[1]) * ONE_YEAR));
	}

	// "6m", "3m" etc.
	const monthMatch = trimmed.match(/^(\d+(?:\.\d+)?)m$/);
	if (monthMatch) {
		return BigInt(Math.floor(parseFloat(monthMatch[1]) * ONE_MONTH));
	}

	// "30d", "90d" etc.
	const dayMatch = trimmed.match(/^(\d+(?:\.\d+)?)d$/);
	if (dayMatch) {
		return BigInt(Math.floor(parseFloat(dayMatch[1]) * ONE_DAY));
	}

	// Raw number string
	const num = Number(trimmed);
	if (!isNaN(num) && num > 0) {
		return BigInt(Math.floor(num));
	}

	return null;
}

export const DEFAULT_DURATION = BigInt(ONE_YEAR);
