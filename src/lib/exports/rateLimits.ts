import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 19 — dedicated budget for the export routes. Exports aggregate a whole
// month (or a full day sheet) in one request, so they get their own pool
// rather than sharing the day-view read pool: a burst of downloads must never
// starve the receptionist's day view / call queue, and vice versa.
// Session-userId-keyed, never IP-keyed (same reasoning as the appointments
// budgets — the whole front desk sits behind one shared public IP).
export const EXPORTS_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 5 * 60_000,
};
