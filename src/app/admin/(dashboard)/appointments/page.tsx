import AppointmentsDashboard from "@/components/admin/AppointmentsDashboard";

// Task 14 step 5 — appointments dashboard page. No extra session check
// needed here: the `(dashboard)` layout already redirects when
// unauthenticated, and both roles can manage appointments (the API routes
// accept ADMIN and RECEPTIONIST explicitly), so there is no ADMIN-only
// redirect to add — same pattern as patients/page.tsx.

export default function AppointmentsPage() {
  return <AppointmentsDashboard />;
}
