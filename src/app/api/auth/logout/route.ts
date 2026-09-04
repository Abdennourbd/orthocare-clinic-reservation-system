import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/api/http";
import { assertSameOriginStrict, requireStaff } from "@/lib/auth/guard";
import { clearSessionCookieHeader } from "@/lib/auth/session";
import { logActionSafe } from "@/lib/audit/logAction";
import { AuditAction, AuditActorType } from "@/generated/prisma/client";

// Task 12 — staff logout: revokes nothing server-side (the cookie is the
// session), clears it and audits the action. Calling while unauthenticated is
// still a 200 (idempotent) but writes no audit row.

export async function POST(request: NextRequest) {
  if (!assertSameOriginStrict(request)) {
    return errorResponse(403, "FORBIDDEN", "Origine non autorisée.");
  }
  const guard = await requireStaff(request, { allowPasswordChangePending: true });
  if (guard.ok) {
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: guard.user.id },
      AuditAction.LOGOUT,
      "User",
      guard.user.id,
    );
  }
  return ok({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
}
