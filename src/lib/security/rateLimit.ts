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
    Array<{ count: number }>
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
    RETURNING "count";
  `;

  const count = row?.count ?? 1;
  if (count > limit) {
    throw new RateLimitError(windowMs);
  }
}
