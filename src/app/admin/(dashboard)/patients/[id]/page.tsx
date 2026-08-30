import { redirect } from "next/navigation";
import PatientDetail from "@/components/admin/PatientDetail";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 13 step 8 — patient record page. Both staff roles can view/edit a
// chart (task-13.md §Décisions d'architecture 3), so — like
// patients/page.tsx — there is no ADMIN-only redirect here; `role` is only
// forwarded to the client component so it can decide what to RENDER
// (deactivate/anonymize), never to decide what the API allows (see
// PatientDetail's header comment).
//
// Next 16: `params` is a Promise (CLAUDE.md "Next.js 16 gotchas") — awaited
// below before use.

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<Record<string, string>>;
}) {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");

  const { id } = await params;

  return <PatientDetail patientId={id} role={staff.role} />;
}
