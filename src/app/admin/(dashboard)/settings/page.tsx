import { redirect } from "next/navigation";
import SettingsDashboard from "@/components/admin/settings/SettingsDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 21 — settings page, ADMIN only (least privilege). A receptionist who
// reaches this URL server-side is redirected, and the backing API enforces
// the same rule independently.

export default async function SettingsPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <SettingsDashboard />;
}
