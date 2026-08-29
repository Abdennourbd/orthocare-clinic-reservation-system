import PatientList from "@/components/admin/PatientList";

// Task 13 step 7 — patient directory page. No extra session check needed
// here: the `(dashboard)` layout (src/app/admin/(dashboard)/layout.tsx)
// already redirects to /admin/login when unauthenticated, and both roles can
// read/create patients (task-13.md §Décisions d'architecture 3), so — unlike
// audit/page.tsx — there is no ADMIN-only redirect to add.

export default function PatientsPage() {
  return <PatientList />;
}
