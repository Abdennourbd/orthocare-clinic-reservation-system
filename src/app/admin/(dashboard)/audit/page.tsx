import { redirect } from "next/navigation";
import AuditViewer from "@/components/admin/AuditViewer";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 12 — audit viewer page, ADMIN only (plan.md §Audit logging). A
// receptionist who reaches this URL server-side is redirected, and the
// backing API independently enforces the same rule.

export default async function AuditPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <AuditViewer />;
}
