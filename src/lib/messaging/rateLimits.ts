import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 16 — shared rate-limit budgets for every admin SMS route.
// Session-userId-keyed (`staff:<userId>:sms-*`), never IP-keyed — same
// reasoning as the appointments budgets (src/lib/booking/rateLimits.ts): a
// single-site clinic sits behind one shared public IP, so an IP-keyed limit
// would either do nothing useful (one shared bucket for the whole front desk)
// or lock the entire clinic out from one bad actor's traffic. Declared once
// here, not re-declared per route file.

/** POST single SMS (Task 16 manual send). */
export const SMS_SEND_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 5 * 60_000,
};

/** POST /broadcast — actually sending a delay broadcast is rare (a handful of
 * times a day at most) and each send fans out to the whole day's patients, so
 * the budget is tight. */
export const SMS_BROADCAST_RATE_LIMIT: RateLimitOptions = {
  limit: 5,
  windowMs: 5 * 60_000,
};

/** POST /broadcast/preview — same numbers as the send budget but a SEPARATE
 * named constant, i.e. its own pool: previewing repeatedly while tuning the
 * delay must never eat the send budget (and vice versa, a broadcast send must
 * never block a preview). */
export const SMS_BROADCAST_PREVIEW_RATE_LIMIT: RateLimitOptions = {
  limit: 5,
  windowMs: 5 * 60_000,
};

/** GET history + GET batches — one shared read pool. */
export const SMS_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 5 * 60_000,
};
