import { getPrisma } from "@/lib/db";

// Postgres-backed fixed-window rate limiter (Task 1).
// Used by public endpoints (booking, login, slots, self-service token lookups)
// to stop a single IP or phone from flooding the service.
//
// Design:
//  - One row per (key). `key` encodes scope, e.g. "ip:1.2.3.4:appointments".
//  - Fixed window: when `now` is past `windowStart + windowMs`, the counter is
//    reset to 1, so a burst can't exceed the window and a stale row doesn't
//    permanently block a client.
//  - Atomicity: check-and-increment is a single Postgres statement
//    (INSERT ... ON CONFLICT DO UPDATE ... RETURNING), so concurrent requests
//    from the same key cannot race past the limit.

export interface RateLimitOptions {
  /** Number of allowed requests within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    message = "Too many requests. Please try again later.",
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Consume one unit for `key` and return whether the request is allowed.
 * Throws `RateLimitError` when the limit is exceeded.
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<void> {
  const now = new Date();

  // Atomic upsert that resets the count when the current window has expired.
  // `windowStart` is the start of the window the counter is currently counting
  // toward; if `windowStart + windowMs <= now` the window has rolled over and
  // the counter is reset to 1 instead of incremented.
  const [row] = await getPrisma().$queryRaw<
    Array<{ count: number; windowStart: Date }>
  >`
    INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "updatedAt")
    VALUES (${key}, ${now}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitCounter"."windowStart" + (${windowMs} * interval '1 millisecond') <= ${now}
          THEN 1
        ELSE "RateLimitCounter"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitCounter"."windowStart" + (${windowMs} * interval '1 millisecond') <= ${now}
          THEN ${now}
        ELSE "RateLimitCounter"."windowStart"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "windowStart";
  `;

  const count = row?.count ?? 1;
  if (count > limit) {
    // Report the ACTUAL time until the current window resets, so a
    // `Retry-After` header built from `retryAfterMs` is accurate rather than
    // the full window length. The upsert always returns a row, so `row` is
    // defined here.
    const retryAfterMs = Math.max(
      0,
      row!.windowStart.getTime() + windowMs - now.getTime(),
    );
    throw new RateLimitError(retryAfterMs);
  }
}

/**
 * Delete rate-limit counter rows whose window has long expired, so the table
 * doesn't grow without bound as unique keys (IPs, phones) accumulate over time.
 * Intended to be called periodically (e.g. from the Task 9 cron). Rows are
 * retained for at least `retentionMs` after their last active window start.
 */
export async function cleanupRateLimitCounters(
  retentionMs = 7 * 24 * 60 * 60 * 1000, // 7 days by default
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionMs);
  const result = await getPrisma().rateLimitCounter.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return result.count;
}
