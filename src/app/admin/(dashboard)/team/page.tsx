import { redirect } from "next/navigation";
import TeamDashboard from "@/components/admin/TeamDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 20 — team page, ADMIN only (least privilege — plan.md §Auth/RBAC). A
// receptionist who reaches this URL server-side is redirected, and all four
// backing APIs enforce the same rule independently.

export default async function TeamPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <TeamDashboard currentUserId={staff.id} />;
}
