import { redirect } from "next/navigation";
import ExportsDashboard from "@/components/admin/ExportsDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 19 — exports page, ADMIN only (a monthly export is a bulk extract of
// patient data — plan.md §KPIs & exports). A receptionist who reaches this
// URL server-side is redirected, and both backing APIs enforce the same rule
// independently.

export default async function ExportsPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <ExportsDashboard />;
}
