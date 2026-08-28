import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/admin/Sidebar";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 12 — guarded dashboard layout: every /admin page inside this group
// requires a valid staff session (active + tokenVersion match). The proxy
// already redirected anonymous visitors; this re-check is the authoritative
// one for server-rendered pages.

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");

  // Forced password change: nothing else is reachable until the password is
  // rotated (the API keeps working, but every UI path funnels here).
  if (staff.mustChangePassword) redirect("/admin/change-password");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar name={staff.name} role={staff.role} />
      <main className="flex-1 p-6" id="main-content">
        {children}
      </main>
    </div>
  );
}
