import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 17.2 — shared rate-limit budgets for every admin waitlist route.
// Session-userId-keyed (`staff:<userId>:waitlist-*`), never IP-keyed — same
// reasoning as the appointments/patients budgets: a single-site clinic sits
// behind one shared public IP. A dedicated pool (not the patients-write
// pool): waitlist writes must never eat the patient-write budget and vice
// versa — same "separate bucket" convention as the SMS batches/history
// split (src/lib/messaging/rateLimits.ts).

/** GET list — one shared read pool. */
export const WAITLIST_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** POST create, DELETE deactivate. */
export const WAITLIST_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};
