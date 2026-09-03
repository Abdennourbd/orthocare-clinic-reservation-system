import { redirect } from "next/navigation";
import WaitlistDashboard from "@/components/admin/WaitlistDashboard";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 17.3 — waitlist page. Both staff roles reach it (ADMIN +
// RECEPTIONIST can read and edit the waitlist — the API routes enforce the
// same rule independently). Only the session check lives here: the
// `(dashboard)` layout already redirects to /admin/login when
// unauthenticated, this re-check is the authoritative one for the page.

export default async function WaitlistPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "ADMIN" && staff.role !== "RECEPTIONIST") redirect("/admin");

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Liste d&rsquo;attente</h1>
        <p className="text-sm text-slate-500">
          Patients en attente d&rsquo;une place — ajout au guichet et suivi des dates surveillées.
        </p>
      </header>
      <WaitlistDashboard />
    </div>
  );
}
