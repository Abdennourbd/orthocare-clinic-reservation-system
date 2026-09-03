import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 21 — rate-limit budgets for content + settings + closures.
// Session-userId-keyed (`staff:<userId>:content-*`), never IP-keyed: same
// reasoning as team/appointments (one shared front-desk IP). Declared once
// here, not per route file.

/** GET list/detail — one shared pool. */
export const CONTENT_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** POST create, PATCH /[id], DELETE /[id]. */
export const CONTENT_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};

/** GET /api/admin/settings. */
export const SETTINGS_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** PATCH /api/admin/settings. */
export const SETTINGS_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};

/** GET /api/admin/closures. */
export const CLOSURES_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** POST /closures, DELETE /[id], POST /[id]/resolve. */
export const CLOSURES_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};
