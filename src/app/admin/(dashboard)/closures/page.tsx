import { redirect } from "next/navigation";
import ClosuresDashboard from "@/components/admin/closures/ClosuresDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 21 — closures page, ADMIN only (least privilege). A receptionist who
// reaches this URL server-side is redirected, and all backing APIs enforce
// the same rule independently.

export default async function ClosuresPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <ClosuresDashboard />;
}
