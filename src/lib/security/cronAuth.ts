import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron auth shared by every `/api/cron/*` route.
 *
 * **Vercel Cron sends `CRON_SECRET` in the `Authorization` header as
 * `Bearer <CRON_SECRET>`** (see Vercel docs → "Securing cron jobs"). Manual or
 * third-party triggers (curl, cron-job.org, …) may send the same secret in the
 * `x-cron-secret` header instead. Both are accepted; the comparison is
 * constant-time either way. (The previous implementation read only
 * `x-cron-secret`, which Vercel never sends — every scheduled job would have
 * 401'd in production.)
 *
 * @returns a 401 response when the secret is missing or does not match, or
 *   null when the caller should proceed with the job.
 */
export function requireCronSecret(request: NextRequest): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : null;
  const provided = bearer ?? request.headers.get("x-cron-secret");

  if (!provided || !safeEqual(secret, provided)) return unauthorized();
  return null;
}

function unauthorized(): Response {
  return new NextResponse("Unauthorized", { status: 401 });
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