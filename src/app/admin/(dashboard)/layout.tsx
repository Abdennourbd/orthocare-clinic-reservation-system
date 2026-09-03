import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/admin/Sidebar";
import MobileNav from "@/components/admin/MobileNav";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 12 — guarded dashboard layout: every /admin page inside this group
// requires a valid staff session (active + tokenVersion match). The proxy
// already redirected anonymous visitors; this re-check is the authoritative
// one for server-rendered pages.
//
// Mobile (staff use phones): below `md` the desktop sidebar hides and the
// MobileNav hamburger + drawer takes over (same links, same role-gating).
// `min-w-0` on the content column keeps wide tables/cards from squeezing the
// layout into a horizontal overflow.

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
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav name={staff.name} role={staff.role} />
        <main className="min-w-0 flex-1 p-4 sm:p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
