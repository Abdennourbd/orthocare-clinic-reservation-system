import { redirect } from "next/navigation";
import ContentDashboard from "@/components/admin/content/ContentDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 21 — content page, ADMIN only (least privilege). A receptionist who
// reaches this URL server-side is redirected, and all backing APIs enforce
// the same rule independently.

export default async function ContentPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN") redirect("/admin");

  return <ContentDashboard />;
}
