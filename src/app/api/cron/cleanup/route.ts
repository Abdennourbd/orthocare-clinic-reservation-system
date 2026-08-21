import { NextRequest, NextResponse } from "next/server";
import { cleanupRateLimitCounters } from "@/lib/security/rateLimit";

/**
 * Cron: prune expired rate-limit counter rows so the table doesn't grow
 * without bound as unique keys (IPs, phones) accumulate.
 *
 * Authenticated with the `CRON_SECRET` header (see plan.md §Cron). Safe to
 * run repeatedly — cleanup is idempotent.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret || provided !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const deleted = await cleanupRateLimitCounters();
  return NextResponse.json({ ok: true, deleted });
}
