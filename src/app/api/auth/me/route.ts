import { NextRequest } from "next/server";
import { ok } from "@/lib/api/http";
import { requireStaff, withRefreshedSession } from "@/lib/auth/guard";

// Task 12 — current staff user. Also serves as the sliding-session refresher:
// the refreshed cookie keeps the 2h idle window alive while the staff member
// works.

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request, { allowPasswordChangePending: true });
  if (!guard.ok) return guard.response;
  return withRefreshedSession(
    ok({
      user: {
        id: guard.user.id,
        name: guard.user.name,
        email: guard.user.email,
        role: guard.user.role,
        mustChangePassword: guard.user.mustChangePassword,
      },
    }),
    guard,
  );
}
