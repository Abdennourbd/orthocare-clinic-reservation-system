import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 14 — shared rate-limit budgets for every admin appointment route.
// Session-userId-keyed (`staff:<userId>:appointments-*`), never IP-keyed —
// same reasoning as the patients budgets (src/lib/patients/rateLimits.ts): a
// single-site clinic sits behind one shared public IP, so an IP-keyed limit
// would either do nothing useful (one shared bucket for the whole front desk)
// or lock the entire clinic out from one bad actor's traffic. Declared once
// here, not re-declared per route file.

/** GET day view, GET call queue, GET search, GET /[id] — one shared pool. */
export const APPOINTMENTS_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};

/** POST manual booking, PATCH /[id] status change, POST /[id]/reschedule. */
export const APPOINTMENTS_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};
