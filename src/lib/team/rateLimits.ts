import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 20 — rate-limit budgets for team management. Session-userId-keyed
// (`staff:<userId>:team-*`), never IP-keyed: same reasoning as appointments
// (one shared front-desk IP). Declared once here, not per route file.

/** GET list — one shared pool. */
export const TEAM_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** POST create, PATCH /[id], POST /[id]/reset-password. */
export const TEAM_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};
