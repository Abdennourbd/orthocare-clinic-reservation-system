import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron auth shared by every `/api/cron/*` route: authenticate with the
 * `CRON_SECRET` env var via the `x-cron-secret` request header (plan.md
 * §Cron). Vercel Cron sends the header for configured schedules; any manual
 * or curl trigger must include it.
 *
 * @returns a 401 response when the header is missing or does not match, or
 *   null when the caller should proceed with the job.
 */
export function requireCronSecret(request: NextRequest): Response | null {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || !safeEqual(secret, provided)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}

/**
 * Constant-time comparison for the cron secret. Both sides are hashed first
 * so the comparison runs on fixed-length digests regardless of the provided
 * header's length (a raw `timingSafeEqual` would throw on unequal lengths).
 * Prevents a timing side-channel from leaking the secret byte-by-byte.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}