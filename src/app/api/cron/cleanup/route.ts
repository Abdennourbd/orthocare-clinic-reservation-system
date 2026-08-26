import { NextRequest, NextResponse } from "next/server";
import { cleanupRateLimitCounters } from "@/lib/security/rateLimit";
import { requireCronSecret } from "@/lib/security/cronAuth";

/**
 * Cron: prune expired rate-limit counter rows so the table doesn't grow
 * without bound as unique keys (IPs, phones) accumulate.
 *
 * Authenticated with the `CRON_SECRET` header (see plan.md §Cron). Safe to
 * run repeatedly — cleanup is idempotent.
 *
 * Schedule (see `vercel.json`): daily 03:00 UTC = 04:00 clinic-local.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const deleted = await cleanupRateLimitCounters();
  return NextResponse.json({ ok: true, deleted });
}
